-- Facebook emails for the master lead list (Justin OK'd about $12 of Bright Data on 2026-11-20:
-- "i want all the emails even if its xyz manufacturing@yahoo.com"). Hidden like lead_registry: no Command
-- Center screens, the results go to his Google Sheet. /api/registry/facebook does the work.
--
-- One row per open 4+ business. status:
--   search  no Facebook page known yet; a Google search (site:facebook.com) looks for one
--   none    the search found no page
--   queued  page known, waiting for the Bright Data Facebook Pages scraper
--   sent    in a scraper job (snapshot_id)
--   done    scraped; emails holds what the page lists (may be empty)
--   failed  the scraper could not read the page, or it belongs to a business in another state
create table public.lead_registry_fb (
  filing text primary key references public.lead_registry(filing) on delete cascade,
  priority int not null default 1,          -- 0 = no website of its own, so it goes first
  fb_url text,
  found_by text,                            -- research | search
  status text not null default 'search',
  search_tries int not null default 0,
  tries int not null default 0,
  locked_at timestamptz,
  snapshot_id text,
  sent_at timestamptz,
  done_at timestamptz,
  emails text[] not null default '{}',
  page jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_registry_fb_status on public.lead_registry_fb (status, priority, filing);
create index lead_registry_fb_snapshot on public.lead_registry_fb (snapshot_id) where snapshot_id is not null;
alter table public.lead_registry_fb enable row level security;

-- The run's spend guard: searches and pages at $1.50 per 1,000 each; nothing is handed out once spent_usd
-- reaches cap_usd or paused_reason is set (Bright Data out of credit, bad key).
create table public.lead_registry_fb_run (
  id int primary key default 1 check (id = 1),
  cap_usd numeric not null default 15,
  spent_usd numeric not null default 0,
  searches int not null default 0,
  pages int not null default 0,
  paused_reason text,
  paused_at timestamptz,
  started_at timestamptz not null default now()
);
insert into public.lead_registry_fb_run (id) values (1);
alter table public.lead_registry_fb_run enable row level security;

-- Every business in the Sheet (open, 4+): a Facebook page the research saw is queued, the rest wait for a search.
insert into public.lead_registry_fb (filing, priority, fb_url, found_by, status)
select r.filing, case when r.website is null then 0 else 1 end,
       f.url, case when f.url is null then null else 'research' end,
       case when f.url is null then 'search' else 'queued' end
from public.lead_registry r
cross join lateral (
  select case when trim(r.research->>'facebook') ~* '^https?://([a-z0-9-]+\.)?(facebook|fb)\.com/[^/?#]'
               and trim(r.research->>'facebook') !~* '(facebook|fb)\.com/(groups|events|marketplace|watch|hashtag|search|login|sharer|share|dialog|plugins|stories|reel|reels|permalink\.php|story\.php|photo\.php|video\.php|l\.php)([/?#]|$)'
              then trim(r.research->>'facebook') end as url
) f
where r.removed_reason is null and r.researched_at is not null
  and r.size_guess = '4+' and coalesce(r.closed, false) = false
on conflict (filing) do nothing;

create or replace function public.lead_registry_fb_claim_search(p_secret text, p_limit int)
returns table(filing text, name text, city text, county text)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if exists (select 1 from public.lead_registry_fb_run b where b.paused_reason is not null or b.spent_usd >= b.cap_usd) then return; end if;
  return query
  with c as (
    select f.filing from public.lead_registry_fb f
    where f.status = 'search' and f.search_tries < 3
      and (f.locked_at is null or f.locked_at < now() - interval '10 minutes')
    order by f.priority, f.filing
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.lead_registry_fb f set locked_at = now(), search_tries = f.search_tries + 1, updated_at = now()
  from c, public.lead_registry r
  where f.filing = c.filing and r.filing = f.filing
  returning f.filing, r.name, r.city, r.county;
end $$;

-- A search finished: p_url is the page it found, or null for none. Each search costs $0.0015.
create or replace function public.lead_registry_fb_found(p_secret text, p_filing text, p_url text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb
     set fb_url = coalesce(p_url, fb_url), found_by = case when p_url is null then found_by else 'search' end,
         status = case when p_url is null then 'none' else 'queued' end, locked_at = null, updated_at = now()
   where filing = p_filing and status = 'search';
  update public.lead_registry_fb_run set searches = searches + 1, spent_usd = spent_usd + 0.0015 where id = 1;
end $$;

-- A search that couldn't run (no credit, throttled): give the try back.
create or replace function public.lead_registry_fb_release(p_secret text, p_filing text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb set locked_at = null, search_tries = greatest(search_tries - 1, 0), updated_at = now()
   where filing = p_filing and status = 'search';
end $$;

create or replace function public.lead_registry_fb_claim_pages(p_secret text, p_limit int)
returns table(filing text, fb_url text)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if exists (select 1 from public.lead_registry_fb_run b where b.paused_reason is not null or b.spent_usd >= b.cap_usd) then return; end if;
  return query
  with c as (
    select f.filing from public.lead_registry_fb f
    where f.status = 'queued' and f.tries < 3
    order by f.priority, f.filing
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  )
  update public.lead_registry_fb f set status = 'sent', tries = f.tries + 1, sent_at = now(), snapshot_id = null, updated_at = now()
  from c where f.filing = c.filing
  returning f.filing, f.fb_url;
end $$;

-- The scraper job for claimed pages started (p_snapshot) or didn't (null). p_items: [{filing, url}], url being the
-- page address as sent. p_hold: the call itself was refused (no credit, bad key), so the try is given back.
create or replace function public.lead_registry_fb_sent(p_secret text, p_items jsonb, p_snapshot text, p_hold boolean)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb f
     set fb_url = coalesce(i.url, f.fb_url),
         snapshot_id = case when i.url is null then null else p_snapshot end,
         tries = case when i.url is not null and p_snapshot is null and p_hold then greatest(f.tries - 1, 0) else f.tries end,
         status = case when i.url is null then 'failed'
                       when p_snapshot is not null then 'sent'
                       when not p_hold and f.tries >= 3 then 'failed'
                       else 'queued' end,
         error = case when i.url is null then 'not a Facebook page address'
                      when p_snapshot is null and not p_hold and f.tries >= 3 then 'scraper job did not start'
                      else f.error end,
         updated_at = now()
    from jsonb_to_recordset(p_items) as i(filing text, url text)
   where f.filing = i.filing and f.status = 'sent';
end $$;

create or replace function public.lead_registry_fb_snapshots(p_secret text)
returns table(snapshot_id text, sent_at timestamptz)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select f.snapshot_id, min(f.sent_at) from public.lead_registry_fb f
   where f.status = 'sent' and f.snapshot_id is not null group by f.snapshot_id;
end $$;

-- One scraped page: every business in that job with that page address. p_error set = the page couldn't be used.
create or replace function public.lead_registry_fb_save(p_secret text, p_snapshot text, p_url text, p_emails text[], p_page jsonb, p_error text)
returns int language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb f
     set status = case when p_error is null then 'done' else 'failed' end,
         emails = case when p_error is null then coalesce(p_emails, '{}') else '{}' end,
         page = p_page, error = p_error, done_at = now(), updated_at = now()
   where f.snapshot_id = p_snapshot and f.status = 'sent'
     and rtrim(lower(regexp_replace(f.fb_url, '^https?://(www\.|m\.|web\.)?', '')), '/')
       = rtrim(lower(regexp_replace(p_url, '^https?://(www\.|m\.|web\.)?', '')), '/');
  get diagnostics n = row_count;
  return n;
end $$;

-- A scraper job is finished (or failed, or too old): pages it didn't return go back in the queue, 3 tries at most.
-- p_pages: pages it returned, at $0.0015 each.
create or replace function public.lead_registry_fb_close(p_secret text, p_snapshot text, p_pages int, p_failed boolean)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb f
     set status = case when f.tries >= 3 then 'failed' else 'queued' end,
         error = case when f.tries >= 3 then (case when p_failed then 'scraper job failed' else 'scraper returned nothing' end) else f.error end,
         snapshot_id = null, updated_at = now()
   where f.snapshot_id = p_snapshot and f.status = 'sent';
  update public.lead_registry_fb_run
     set pages = pages + greatest(coalesce(p_pages, 0), 0), spent_usd = spent_usd + greatest(coalesce(p_pages, 0), 0) * 0.0015
   where id = 1;
end $$;

create or replace function public.lead_registry_fb_pause(p_secret text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_fb_run set paused_reason = p_reason, paused_at = now() where id = 1 and paused_reason is null;
end $$;
