-- Second email pass for the master lead list (Justin 2026-11-21: "we need to get as mmany emails a possible").
-- For every Sheet business still without any email: Google "<name> <town> PA email" and "<name> <town> PA facebook"
-- (Bright Data SERP). Emails in result snippets that belong to the business are kept; a Facebook page found goes
-- into lead_registry_fb's scraper queue. Spend counts against lead_registry_fb_run (same Bright Data account).
-- Hidden: no Command Center screens. /api/registry/emailsearch does the work.
create table public.lead_registry_esearch (
  filing text primary key references public.lead_registry(filing) on delete cascade,
  status text not null default 'pending',   -- pending | done | failed
  tries int not null default 0,
  locked_at timestamptz,
  emails text[] not null default '{}',
  fb_url text,
  sources jsonb,
  error text,
  searched_at timestamptz
);
alter table public.lead_registry_esearch enable row level security;

create or replace function public.lead_registry_esearch_claim(p_secret text, p_limit int)
returns table(filing text, name text, city text, county text, website text, need_fb boolean)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if exists (select 1 from public.lead_registry_fb_run b where b.paused_reason is not null or b.spent_usd >= b.cap_usd) then return; end if;
  return query
  with c as (
    select e.filing from public.lead_registry_esearch e
    where e.status = 'pending' and e.tries < 3
      and (e.locked_at is null or e.locked_at < now() - interval '10 minutes')
    order by e.filing
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.lead_registry_esearch e set locked_at = now(), tries = e.tries + 1
  from c, public.lead_registry r
  where e.filing = c.filing and r.filing = e.filing
  returning e.filing, r.name, r.city, r.county, r.website,
    not exists (select 1 from public.lead_registry_fb f where f.filing = e.filing and f.fb_url is not null and f.status <> 'failed');
end $$;

-- p_searches: searches this business used ($0.0015 each). p_fb_url: a Facebook page found, queued for the scraper.
create or replace function public.lead_registry_esearch_save(p_secret text, p_filing text, p_status text, p_emails text[], p_fb_url text, p_sources jsonb, p_error text, p_searches int)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_esearch
     set status = p_status, emails = coalesce(p_emails, '{}'), fb_url = p_fb_url, sources = p_sources, error = p_error,
         locked_at = null, searched_at = now()
   where filing = p_filing;
  if p_fb_url is not null then
    insert into public.lead_registry_fb (filing, priority, fb_url, found_by, status)
    values (p_filing, 0, p_fb_url, 'email-search', 'queued')
    on conflict (filing) do update
       set fb_url = excluded.fb_url, found_by = 'email-search', status = 'queued', tries = 0, snapshot_id = null, error = null, updated_at = now()
     where public.lead_registry_fb.status in ('none', 'search') or (public.lead_registry_fb.status = 'failed' and public.lead_registry_fb.fb_url is distinct from excluded.fb_url);
  end if;
  update public.lead_registry_fb_run set searches = searches + greatest(coalesce(p_searches, 0), 0),
         spent_usd = spent_usd + greatest(coalesce(p_searches, 0), 0) * 0.0015 where id = 1;
end $$;

create or replace function public.lead_registry_esearch_release(p_secret text, p_filing text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_esearch set locked_at = null, tries = greatest(tries - 1, 0) where filing = p_filing and status = 'pending';
end $$;
