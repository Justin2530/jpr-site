-- Lead Engine (Sales > Lead Engine): business lists for JPR Local, JPR USA and JPR AI email campaigns.
-- Searches run Google Maps (Serper) per county x keyword in the background; each business is found once
-- (by its Google place id), then its website is read for emails, the PA registry for an owner name, and a
-- rough size score stands in for "5+ employees". Leads stay out of Companies until Justin adds one.
-- Owner-only tables; the background worker only reaches them through the secret-checked functions below.

create type public.lead_line as enum ('local', 'usa', 'ai');
create type public.lead_search_status as enum ('queued', 'running', 'paused', 'done', 'canceled');
create type public.lead_task_status as enum ('queued', 'running', 'done', 'failed', 'canceled');
create type public.lead_status as enum ('prospect', 'contacted', 'replied', 'customer', 'not_interested', 'do_not_contact');

create table public.lead_searches (
  id uuid primary key default gen_random_uuid(),
  line public.lead_line not null,
  name text not null,
  keywords text[] not null,
  areas jsonb not null,            -- [{"state":"PA","county":"Jefferson County"}]
  max_pages int not null default 2 check (max_pages between 1 and 3),
  status public.lead_search_status not null default 'queued',
  task_count int not null default 0,
  max_credits int not null default 0,
  credits_used int not null default 0,
  found_count int not null default 0,
  new_count int not null default 0,
  failed_count int not null default 0,
  error text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.lead_search_tasks (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.lead_searches(id) on delete cascade,
  state text not null,
  county text not null,
  keyword text not null,
  page int not null default 1,
  status public.lead_task_status not null default 'queued',
  attempts int not null default 0,
  results int,
  new_results int,
  error text,
  locked_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (search_id, state, county, keyword, page)
);
create index lead_search_tasks_queue on public.lead_search_tasks (status, created_at) where status in ('queued', 'running');

create table public.lead_businesses (
  id uuid primary key default gen_random_uuid(),
  place_key text not null unique,  -- Google cid / place id, or name|address when Google gives neither
  name text not null,
  category text,
  address text,
  city text,
  county text,                     -- the county searched
  state text,
  zip text,
  phone text,
  website text,
  domain text,
  facebook_url text,
  rating numeric,
  review_count int,
  lat double precision,
  lng double precision,
  owner_name text,
  owner_title text,
  emails text[] not null default '{}',
  primary_email text,
  email_status text,               -- 'mx_ok' (domain takes mail), 'no_mx', or null when no email found
  enrich_status text not null default 'pending' check (enrich_status in ('pending', 'running', 'done', 'failed')),
  enrich_attempts int not null default 0,
  enrich_locked_at timestamptz,
  enriched_at timestamptz,
  enrich_error text,
  size_score int not null default 0,
  company_id uuid references public.companies(id) on delete set null,
  excluded_reason text,            -- e.g. 'Active client': never exported
  first_search_id uuid references public.lead_searches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_businesses_enrich on public.lead_businesses (created_at) where enrich_status in ('pending', 'running');
create index lead_businesses_domain on public.lead_businesses (domain);

-- One row per business per line of business, so JPR Local, USA and AI keep their own lists and statuses.
create table public.lead_list_members (
  business_id uuid not null references public.lead_businesses(id) on delete cascade,
  line public.lead_line not null,
  status public.lead_status not null default 'prospect',
  search_id uuid references public.lead_searches(id) on delete set null,
  exported_at timestamptz,
  status_changed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  primary key (business_id, line)
);
create index lead_list_members_line on public.lead_list_members (line, status);

alter table public.lead_searches enable row level security;
alter table public.lead_search_tasks enable row level security;
alter table public.lead_businesses enable row level security;
alter table public.lead_list_members enable row level security;
create policy "owner all" on public.lead_searches for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner all" on public.lead_search_tasks for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner all" on public.lead_businesses for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner all" on public.lead_list_members for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- "ACME Machine & Welding Co, LLC" and "Acme Machine and Welding" both become "acme machine welding".
create or replace function public.lead_norm_name(p text) returns text
language sql immutable set search_path = '' as $$
  select array_to_string(array(
    select w from regexp_split_to_table(lower(coalesce(p, '')), '[^a-z0-9]+') with ordinality as x(w, i)
     where w <> '' and w not in ('llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd',
                                 'limited', 'the', 'and', 'of', 'pc', 'llp', 'pllc')
     order by i), ' ')
$$;

-- "https://www.Acme.com/contact" -> "acme.com"
create or replace function public.lead_domain(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z]+://', ''), '^www\.|[/?#:].*$', '', 'g'), '')
$$;

-- A rough guess at "5+ employees" from what Google shows: reviews, a website, and the kind of business.
create or replace function public.lead_size_score(p_reviews int, p_website text, p_category text) returns int
language sql immutable set search_path = '' as $$
  select greatest(0, least(100,
    case when coalesce(p_reviews, 0) >= 150 then 45 when p_reviews >= 60 then 35 when p_reviews >= 25 then 25
         when p_reviews >= 10 then 15 when p_reviews >= 3 then 5 else 0 end
    + case when coalesce(p_website, '') <> '' then 15 else 0 end
    + case when coalesce(p_category, '') ~* '\m(manufactur|machin|fabricat|weld|construct|contractor|excavat|paving|trucking|freight|logistic|warehouse|distribut|hospital|nursing|medical|clinic|dental|dentist|physician|health|rehab|assisted living|home care|pharmacy|bank|credit union|insurance|accounting|law firm|attorney|school|college|hotel|dealer|grocery|supermarket|engineer|plant|mill|lumber|oil|gas|mining|steel|plastic|foundry|printing|packaging|restaurant|hvac|plumb|electric|roofing|veterinar|nonprofit|manufacturer)' then 25 else 0 end
    - case when coalesce(p_category, '') ~* '\m(barber|salon|nail|tattoo|massage|photograph|handyman|personal trainer|food truck|atm|post office|storage|church|park|vending|real estate agent)' then 20 else 0 end))
$$;

-- Which company on file a lead is (by website domain, a contact's work email domain, or the same name).
create or replace function public.lead_match_company(p_name text, p_domain text)
returns table (company_id uuid, status public.company_status)
language sql stable security definer set search_path = '' as $$
  select c.id, c.status from public.companies c
  where (p_domain is not null and (
           public.lead_domain(c.website) = p_domain
           or exists (select 1 from public.contacts k where k.company_id = c.id
                      and lower(split_part(k.email, '@', 2)) = p_domain)))
     or (public.lead_norm_name(p_name) <> '' and public.lead_norm_name(c.name) = public.lead_norm_name(p_name))
     or (public.lead_norm_name(p_name) <> '' and public.lead_norm_name(c.short_name) = public.lead_norm_name(p_name))
  order by (c.status = 'client') desc
  limit 1
$$;
revoke execute on function public.lead_match_company(text, text) from public, anon, authenticated;

-- Re-check every lead against Companies (a prospect may have become a client since it was found).
create or replace function public.leads_recheck_companies(p_secret text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (public.is_owner() or public.integration_secret_ok('automation', p_secret)) then raise exception 'not allowed'; end if;
  with m as (
    select b.id, x.company_id, x.status from public.lead_businesses b
    left join lateral public.lead_match_company(b.name, b.domain) x on true
  )
  update public.lead_businesses b
     set company_id = coalesce(m.company_id, b.company_id),
         excluded_reason = case when m.status = 'client' then 'Active client'
                                when b.excluded_reason = 'Active client' then null else b.excluded_reason end,
         updated_at = now()
    from m
   where m.id = b.id
     and (b.company_id is distinct from coalesce(m.company_id, b.company_id)
          or b.excluded_reason is distinct from case when m.status = 'client' then 'Active client'
                                                     when b.excluded_reason = 'Active client' then null else b.excluded_reason end);
  get diagnostics n = row_count;
  return n;
end; $$;
revoke execute on function public.leads_recheck_companies(text) from public;
grant execute on function public.leads_recheck_companies(text) to anon, authenticated;

-- Worker: claim the next Google Maps search (one county x keyword x page). Skips paused or canceled searches
-- and takes back a claim that has sat for 10 minutes (a run that died).
create or replace function public.leads_claim_task(p_secret text)
returns table (id uuid, search_id uuid, state text, county text, keyword text, page int, attempts int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare t public.lead_search_tasks;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select k.* into t from public.lead_search_tasks k
    join public.lead_searches s on s.id = k.search_id
   where s.status in ('queued', 'running')
     and (k.status = 'queued' or (k.status = 'running' and k.locked_at < now() - interval '10 minutes'))
   order by s.created_at, k.page, k.created_at
   limit 1
   for update of k skip locked;
  if not found then return; end if;
  update public.lead_search_tasks set status = 'running', locked_at = now(), attempts = attempts + 1 where lead_search_tasks.id = t.id;
  update public.lead_searches set status = 'running', started_at = coalesce(started_at, now())
   where lead_searches.id = t.search_id and lead_searches.status = 'queued';
  return query select t.id, t.search_id, t.state, t.county, t.keyword, t.page, t.attempts + 1;
end; $$;

-- Worker: save one search's results. p_places: [{key,name,category,address,city,state,zip,phone,website,
-- rating,reviews,lat,lng}]. p_error set = the call failed (retried up to 3 times). p_full = Google had a
-- full page, so the next page is queued (up to the search's max) when this page still found someone new.
create or replace function public.leads_save_task(p_secret text, p_task uuid, p_places jsonb, p_full boolean, p_error text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.lead_search_tasks;
  s public.lead_searches;
  p jsonb;
  bid uuid;
  inserted boolean;
  m record;
  n_found int := 0;
  n_new int := 0;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into t from public.lead_search_tasks where id = p_task for update;
  if not found or t.status <> 'running' then return jsonb_build_object('skipped', true); end if;
  select * into s from public.lead_searches where id = t.search_id for update;

  if p_error is not null then
    update public.lead_search_tasks
       set status = case when t.attempts >= 3 then 'failed'::public.lead_task_status else 'queued' end,
           error = left(p_error, 500), locked_at = null,
           done_at = case when t.attempts >= 3 then now() end
     where id = t.id;
    -- A rejected call (bad key, no credits) costs nothing; anything that reached Google may have.
    if t.attempts >= 3 then
      update public.lead_searches set failed_count = failed_count + 1, error = left(p_error, 500) where id = s.id;
    end if;
  else
    for p in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
      continue when coalesce(p->>'key', '') = '' or coalesce(p->>'name', '') = '';
      n_found := n_found + 1;
      insert into public.lead_businesses as b
        (place_key, name, category, address, city, county, state, zip, phone, website, domain, rating, review_count,
         lat, lng, size_score, first_search_id)
      values (p->>'key', p->>'name', p->>'category', p->>'address', p->>'city', t.county,
              coalesce(nullif(p->>'state', ''), t.state), p->>'zip', p->>'phone', p->>'website',
              public.lead_domain(p->>'website'), (p->>'rating')::numeric, (p->>'reviews')::int,
              (p->>'lat')::double precision, (p->>'lng')::double precision,
              public.lead_size_score((p->>'reviews')::int, p->>'website', p->>'category'), s.id)
      on conflict (place_key) do update set
        rating = coalesce(excluded.rating, b.rating),
        review_count = coalesce(excluded.review_count, b.review_count),
        phone = coalesce(b.phone, excluded.phone),
        website = coalesce(b.website, excluded.website),
        domain = coalesce(b.domain, excluded.domain),
        category = coalesce(b.category, excluded.category),
        -- a website Google didn't have before gets read for emails
        enrich_status = case when b.website is null and excluded.website is not null then 'pending' else b.enrich_status end,
        enrich_attempts = case when b.website is null and excluded.website is not null then 0 else b.enrich_attempts end,
        size_score = public.lead_size_score(coalesce(excluded.review_count, b.review_count),
                                            coalesce(b.website, excluded.website), coalesce(b.category, excluded.category)),
        updated_at = now()
      returning b.id, (xmax = 0) into bid, inserted;

      if inserted then
        select * into m from public.lead_match_company(p->>'name', public.lead_domain(p->>'website'));
        if m.company_id is not null then
          update public.lead_businesses
             set company_id = m.company_id, excluded_reason = case when m.status = 'client' then 'Active client' end
           where id = bid;
        end if;
      end if;

      insert into public.lead_list_members (business_id, line, search_id) values (bid, s.line, s.id)
      on conflict (business_id, line) do nothing;
      if found then n_new := n_new + 1; end if;
    end loop;

    update public.lead_search_tasks
       set status = 'done', results = n_found, new_results = n_new, error = null, locked_at = null, done_at = now()
     where id = t.id;
    update public.lead_searches
       set credits_used = credits_used + 1, found_count = found_count + n_found, new_count = new_count + n_new
     where id = s.id;
    if p_full and n_new > 0 and t.page < s.max_pages and s.status in ('queued', 'running') then
      insert into public.lead_search_tasks (search_id, state, county, keyword, page)
      values (s.id, t.state, t.county, t.keyword, t.page + 1)
      on conflict do nothing;
    end if;
  end if;

  -- Finished when nothing is left to run.
  update public.lead_searches
     set status = 'done', finished_at = now()
   where id = s.id and status in ('queued', 'running')
     and not exists (select 1 from public.lead_search_tasks k where k.search_id = s.id and k.status in ('queued', 'running'));
  return jsonb_build_object('found', n_found, 'new', n_new);
end; $$;

-- Worker: claim businesses whose website still needs reading (or that have no website: owner lookup only).
create or replace function public.leads_claim_enrich(p_secret text, p_limit int)
returns table (id uuid, name text, website text, domain text, state text, county text, city text, zip text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with c as (
    select b.id from public.lead_businesses b
     where (b.enrich_status = 'pending' or (b.enrich_status = 'running' and b.enrich_locked_at < now() - interval '10 minutes'))
       and b.excluded_reason is null
     order by b.created_at
     limit least(greatest(p_limit, 1), 50)
     for update skip locked
  )
  update public.lead_businesses b
     set enrich_status = 'running', enrich_locked_at = now(), enrich_attempts = b.enrich_attempts + 1
    from c where b.id = c.id
  returning b.id, b.name, b.website, b.domain, b.state, b.county, b.city, b.zip;
end; $$;

-- Worker: save what the website and the PA registry gave. p_error set = try again later (3 tries).
create or replace function public.leads_save_enrich(p_secret text, p_id uuid, p_emails text[], p_primary text,
  p_email_status text, p_facebook text, p_owner_name text, p_owner_title text, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses b set
    emails = case when p_error is null then coalesce(p_emails, '{}') else b.emails end,
    primary_email = case when p_error is null then p_primary else b.primary_email end,
    email_status = case when p_error is null then p_email_status else b.email_status end,
    facebook_url = coalesce(p_facebook, b.facebook_url),
    owner_name = coalesce(p_owner_name, b.owner_name),
    owner_title = case when p_owner_name is not null then p_owner_title else b.owner_title end,
    enrich_status = case when p_error is null then 'done' when b.enrich_attempts >= 3 then 'failed' else 'pending' end,
    enrich_error = left(p_error, 500),
    enriched_at = case when p_error is null then now() else b.enriched_at end,
    enrich_locked_at = null,
    updated_at = now()
  where b.id = p_id and b.enrich_status = 'running';
end; $$;

revoke execute on function public.leads_claim_task(text) from public;
revoke execute on function public.leads_save_task(text, uuid, jsonb, boolean, text) from public;
revoke execute on function public.leads_claim_enrich(text, int) from public;
revoke execute on function public.leads_save_enrich(text, uuid, text[], text, text, text, text, text, text) from public;
grant execute on function public.leads_claim_task(text) to anon, authenticated;
grant execute on function public.leads_save_task(text, uuid, jsonb, boolean, text) to anon, authenticated;
grant execute on function public.leads_claim_enrich(text, int) to anon, authenticated;
grant execute on function public.leads_save_enrich(text, uuid, text[], text, text, text, text, text, text) to anon, authenticated;

-- The Lead Engine's own timer, every 2 minutes, at /api/leads/tick next to the automation tick.
select cron.schedule('jpr-leads-tick', '*/2 * * * *', $cron$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'automation_tick_url'),
                   '/api/automation/tick', '/api/leads/tick'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-jpr-automation', (select decrypted_secret from vault.decrypted_secrets where name = 'automation_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$cron$);
