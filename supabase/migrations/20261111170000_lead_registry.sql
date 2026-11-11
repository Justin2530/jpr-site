-- PA business registry list for JPR Local (Justin, 2026-11-11): every registered business in our counties,
-- cleaned of junk, with free employee counts (PPP loans, retirement plan filings) and Google research.
create table if not exists public.lead_registry (
  filing text primary key,
  name text not null,
  entity_type text,
  registered_on date,
  industry text,
  priority int,
  county text,
  city text,
  address text,
  zip text,
  contact text,
  contact_title text,
  other_officers text,
  removed_reason text,
  ppp_jobs int,
  ppp_naics text,
  plan_people int,
  website text,
  phone text,
  rating numeric,
  reviews int,
  category text,
  closed boolean,
  maps_address text,
  research jsonb,
  employees_est int,
  size_guess text,
  research_attempts int not null default 0,
  research_locked_at timestamptz,
  researched_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_registry_todo on public.lead_registry (priority, filing) where researched_at is null and removed_reason is null;
alter table public.lead_registry enable row level security;
create policy "owner all" on public.lead_registry for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Bulk load from the one-time data job (2026-11-11). Applied with a secret check, then patched in the database
-- to a fixed passphrase that stopped working at 2026-11-11 18:30 UTC.
create or replace function public.lead_registry_import(p_secret text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.integration_secret_ok('registry_import', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.lead_registry (filing, name, entity_type, registered_on, industry, priority, county, city, address, zip,
    contact, contact_title, other_officers, removed_reason, ppp_jobs, ppp_naics, plan_people)
  select r.filing, r.name, r.entity_type, r.registered_on, r.industry, r.priority, r.county, r.city, r.address, r.zip,
    r.contact, r.contact_title, r.other_officers, r.removed_reason, r.ppp_jobs, r.ppp_naics, r.plan_people
  from jsonb_to_recordset(p_rows) as r(filing text, name text, entity_type text, registered_on date, industry text, priority int,
    county text, city text, address text, zip text, contact text, contact_title text, other_officers text, removed_reason text,
    ppp_jobs int, ppp_naics text, plan_people int)
  on conflict (filing) do update set name = excluded.name, entity_type = excluded.entity_type, registered_on = excluded.registered_on,
    industry = excluded.industry, priority = excluded.priority, county = excluded.county, city = excluded.city,
    address = excluded.address, zip = excluded.zip, contact = excluded.contact, contact_title = excluded.contact_title,
    other_officers = excluded.other_officers, removed_reason = excluded.removed_reason, ppp_jobs = excluded.ppp_jobs,
    ppp_naics = excluded.ppp_naics, plan_people = excluded.plan_people;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.lead_registry_import(text, jsonb) from public;
grant execute on function public.lead_registry_import(text, jsonb) to anon, authenticated;

-- Research worker: claim a batch (best fit first), save, or give back.
create or replace function public.lead_registry_claim(p_secret text, p_limit int)
returns setof public.lead_registry language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  update public.lead_registry r set research_locked_at = now(), research_attempts = r.research_attempts + 1
  where r.filing in (
    select filing from public.lead_registry
    where researched_at is null and removed_reason is null and research_attempts < 3
      and (research_locked_at is null or research_locked_at < now() - interval '10 minutes')
    order by priority, filing limit p_limit for update skip locked)
  returning r.*;
end $$;

create or replace function public.lead_registry_save(p_secret text, p_filing text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry set
    website = p_data->>'website', phone = p_data->>'phone', rating = (p_data->>'rating')::numeric,
    reviews = (p_data->>'reviews')::int, category = p_data->>'category', closed = (p_data->>'closed')::boolean,
    maps_address = p_data->>'maps_address', research = p_data->'research', employees_est = (p_data->>'employees_est')::int,
    size_guess = p_data->>'size_guess', researched_at = now(), research_locked_at = null
  where filing = p_filing;
end $$;

create or replace function public.lead_registry_release(p_secret text, p_filing text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry set research_locked_at = null, research_attempts = greatest(research_attempts - 1, 0) where filing = p_filing;
end $$;

revoke execute on function public.lead_registry_claim(text, int) from public;
revoke execute on function public.lead_registry_save(text, text, jsonb) from public;
revoke execute on function public.lead_registry_release(text, text) from public;
grant execute on function public.lead_registry_claim(text, int) to anon, authenticated;
grant execute on function public.lead_registry_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.lead_registry_release(text, text) to anon, authenticated;
