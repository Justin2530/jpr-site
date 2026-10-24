-- Lead Engine, matched to WellThree's: Bouncer email verification, Facebook-page emails through Bright Data,
-- spend per service (cost per verified lead), a stop-after-N limit per search, email source, and an
-- exported/campaign record per list. All additive.

alter table public.lead_businesses
  add column if not exists email_source text,            -- 'website', 'contact page' or 'facebook'
  add column if not exists email_verification text,      -- Bouncer: deliverable / risky / undeliverable / unknown
  add column if not exists email_verify_reason text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists verify_attempts int not null default 0,
  add column if not exists verify_locked_at timestamptz,
  add column if not exists fb_status text,               -- null (not needed) / pending / running / complete / failed / none
  add column if not exists fb_snapshot_id text,
  add column if not exists fb_attempts int not null default 0,
  add column if not exists fb_checked_at timestamptz;
create index if not exists lead_businesses_verify on public.lead_businesses (created_at)
  where primary_email is not null and email_verification is null;
create index if not exists lead_businesses_fb on public.lead_businesses (fb_status) where fb_status in ('pending', 'running');

alter table public.lead_list_members add column if not exists campaign text;
alter table public.lead_searches
  add column if not exists target_count int check (target_count is null or target_count > 0),
  add column if not exists spend_usd numeric not null default 0;

create table if not exists public.lead_spend (
  id bigserial primary key,
  service text not null check (service in ('serper', 'bouncer', 'brightdata')),
  units int not null,
  cost_usd numeric not null,
  search_id uuid references public.lead_searches(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_spend_created on public.lead_spend (created_at);
alter table public.lead_spend enable row level security;
create policy "owner read" on public.lead_spend for select to authenticated using (public.is_owner());

-- Worker: record what a paid call cost (searches log themselves in leads_save_task).
create or replace function public.leads_log_spend(p_secret text, p_service text, p_units int, p_cost numeric, p_search uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if coalesce(p_units, 0) <= 0 then return; end if;
  insert into public.lead_spend (service, units, cost_usd, search_id) values (p_service, p_units, coalesce(p_cost, 0), p_search);
  if p_search is not null then
    update public.lead_searches set spend_usd = spend_usd + coalesce(p_cost, 0) where id = p_search;
  end if;
end; $$;

-- Worker: emails waiting for a Bouncer check (one try per tick, three in all).
create or replace function public.leads_claim_verify(p_secret text, p_limit int)
returns table (id uuid, email text, search_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with c as (
    select b.id from public.lead_businesses b
     where b.primary_email is not null and b.email_verification is null and b.excluded_reason is null
       and b.verify_attempts < 3
       and (b.verify_locked_at is null or b.verify_locked_at < now() - interval '10 minutes')
     order by b.created_at
     limit least(greatest(p_limit, 1), 100)
     for update skip locked
  )
  update public.lead_businesses b set verify_locked_at = now(), verify_attempts = b.verify_attempts + 1
    from c where b.id = c.id
  returning b.id, b.primary_email, b.first_search_id;
end; $$;

create or replace function public.leads_save_verify(p_secret text, p_id uuid, p_email text, p_result text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses
     set email_verification = p_result, email_verify_reason = left(p_reason, 200), email_verified_at = now(),
         verify_locked_at = null, updated_at = now()
   where id = p_id and primary_email = p_email;  -- the email may have changed since it was claimed
end; $$;

-- Worker: release a claim that failed (the try still counts).
create or replace function public.leads_verify_failed(p_secret text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses set verify_locked_at = null where id = p_id;
end; $$;

-- Worker: businesses with a Facebook page and no email from their website, for Bright Data.
create or replace function public.leads_claim_fb(p_secret text, p_limit int)
returns table (id uuid, facebook_url text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with c as (
    select b.id from public.lead_businesses b
     where b.facebook_url is not null and b.primary_email is null and b.excluded_reason is null
       and b.enrich_status in ('done', 'failed')
       and (b.fb_status is null or (b.fb_status = 'running' and b.fb_checked_at < now() - interval '30 minutes' and b.fb_attempts < 3))
     order by b.created_at
     limit least(greatest(p_limit, 1), 100)
     for update skip locked
  )
  update public.lead_businesses b set fb_status = 'running', fb_checked_at = now(), fb_attempts = b.fb_attempts + 1
    from c where b.id = c.id
  returning b.id, b.facebook_url;
end; $$;

-- Worker: the Bright Data job those businesses went into (or null = the trigger failed: try again later).
create or replace function public.leads_fb_started(p_secret text, p_ids uuid[], p_snapshot text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses
     set fb_snapshot_id = p_snapshot,
         fb_status = case when p_snapshot is null then (case when fb_attempts >= 3 then 'failed' else null end) else 'pending' end,
         fb_checked_at = now()
   where id = any(p_ids);
end; $$;

-- Worker: Bright Data jobs still out.
create or replace function public.leads_fb_snapshots(p_secret text)
returns table (snapshot_id text, started_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select b.fb_snapshot_id, min(b.fb_checked_at) from public.lead_businesses b
   where b.fb_status = 'pending' and b.fb_snapshot_id is not null group by b.fb_snapshot_id limit 10;
end; $$;

-- Worker: what came back for one Facebook page (p_emails empty = the page shows none).
create or replace function public.leads_fb_save(p_secret text, p_snapshot text, p_url text, p_emails text[], p_primary text)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses b
     set fb_status = case when p_primary is null then 'none' else 'complete' end,
         emails = case when p_primary is null then b.emails else (select array(select distinct unnest(b.emails || p_emails))) end,
         primary_email = coalesce(b.primary_email, p_primary),
         email_source = case when b.primary_email is null and p_primary is not null then 'facebook' else b.email_source end,
         email_status = case when b.primary_email is null and p_primary is not null then null else b.email_status end,
         fb_checked_at = now(), updated_at = now()
   where b.fb_snapshot_id = p_snapshot and b.fb_status = 'pending'
     and rtrim(lower(regexp_replace(b.facebook_url, '^https?://(www\.|m\.)?', '')), '/') = rtrim(lower(regexp_replace(p_url, '^https?://(www\.|m\.)?', '')), '/');
  get diagnostics n = row_count;
  return n;
end; $$;

-- Worker: a Bright Data job is finished; any page it didn't return counts as "none" (or failed).
create or replace function public.leads_fb_close(p_secret text, p_snapshot text, p_failed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses
     set fb_status = case when p_failed and fb_attempts < 3 then null when p_failed then 'failed' else 'none' end,
         fb_snapshot_id = case when p_failed and fb_attempts < 3 then null else fb_snapshot_id end,
         fb_checked_at = now()
   where fb_snapshot_id = p_snapshot and fb_status = 'pending';
end; $$;

-- Worker: set the domain check for an email that came from Facebook (website emails get it at enrich time).
create or replace function public.leads_set_email_status(p_secret text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses set email_status = p_status, updated_at = now() where id = p_id;
end; $$;

-- Worker: Facebook emails still missing the free domain check.
create or replace function public.leads_needs_mx(p_secret text, p_limit int)
returns table (id uuid, email text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select b.id, b.primary_email from public.lead_businesses b
   where b.primary_email is not null and b.email_status is null limit least(greatest(p_limit, 1), 100);
end; $$;

-- Website emails: remember where each primary email came from.
create or replace function public.leads_save_enrich(p_secret text, p_id uuid, p_emails text[], p_primary text,
  p_email_status text, p_facebook text, p_owner_name text, p_owner_title text, p_error text, p_source text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses b set
    emails = case when p_error is null then coalesce(p_emails, '{}') else b.emails end,
    primary_email = case when p_error is null then p_primary else b.primary_email end,
    email_source = case when p_error is null then (case when p_primary is null then null else p_source end) else b.email_source end,
    email_status = case when p_error is null then p_email_status else b.email_status end,
    email_verification = case when p_error is null and p_primary is distinct from b.primary_email then null else b.email_verification end,
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

revoke execute on function public.leads_log_spend(text, text, int, numeric, uuid) from public;
revoke execute on function public.leads_claim_verify(text, int) from public;
revoke execute on function public.leads_save_verify(text, uuid, text, text, text) from public;
revoke execute on function public.leads_verify_failed(text, uuid) from public;
revoke execute on function public.leads_claim_fb(text, int) from public;
revoke execute on function public.leads_fb_started(text, uuid[], text) from public;
revoke execute on function public.leads_fb_snapshots(text) from public;
revoke execute on function public.leads_fb_save(text, text, text, text[], text) from public;
revoke execute on function public.leads_fb_close(text, text, boolean) from public;
revoke execute on function public.leads_set_email_status(text, uuid, text) from public;
revoke execute on function public.leads_needs_mx(text, int) from public;
revoke execute on function public.leads_save_enrich(text, uuid, text[], text, text, text, text, text, text, text) from public;
grant execute on function public.leads_log_spend(text, text, int, numeric, uuid) to anon, authenticated;
grant execute on function public.leads_claim_verify(text, int) to anon, authenticated;
grant execute on function public.leads_save_verify(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.leads_verify_failed(text, uuid) to anon, authenticated;
grant execute on function public.leads_claim_fb(text, int) to anon, authenticated;
grant execute on function public.leads_fb_started(text, uuid[], text) to anon, authenticated;
grant execute on function public.leads_fb_snapshots(text) to anon, authenticated;
grant execute on function public.leads_fb_save(text, text, text, text[], text) to anon, authenticated;
grant execute on function public.leads_fb_close(text, text, boolean) to anon, authenticated;
grant execute on function public.leads_set_email_status(text, uuid, text) to anon, authenticated;
grant execute on function public.leads_needs_mx(text, int) to anon, authenticated;
grant execute on function public.leads_save_enrich(text, uuid, text[], text, text, text, text, text, text, text) to anon, authenticated;

-- Each Serper credit a search uses is logged as spend ($50 per 50,000 = $0.001), and a search with a
-- stop-after-N limit ends once it has found that many new businesses.
create or replace function public.lead_searches_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.credits_used > old.credits_used then
    new.spend_usd := new.spend_usd + (new.credits_used - old.credits_used) * 0.001;
    insert into public.lead_spend (service, units, cost_usd, search_id)
    values ('serper', new.credits_used - old.credits_used, (new.credits_used - old.credits_used) * 0.001, new.id);
  end if;
  if new.target_count is not null and new.new_count >= new.target_count and new.status in ('queued', 'running') then
    new.status := 'done';
    new.finished_at := now();
    update public.lead_search_tasks set status = 'canceled' where search_id = new.id and status = 'queued';
  end if;
  return new;
end; $$;
create trigger lead_searches_progress before update on public.lead_searches
  for each row execute function public.lead_searches_progress();
