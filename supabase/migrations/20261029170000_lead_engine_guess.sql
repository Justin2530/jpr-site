-- Lead Engine: businesses with their own website but no email on it (usually just a contact form) get the
-- common addresses at their domain tried (info@, office@, contact@, sales@, the owner's first name@), each
-- checked by Bouncer; the first one Bouncer calls deliverable is kept, with email_source 'guessed'. Nothing
-- is sent. Where Bright Data is on, a business with a Facebook page waits for that first (it's cheaper).

alter table public.lead_businesses
  add column if not exists guess_status text,            -- null = not tried, 'found', 'none'
  add column if not exists guess_locked_at timestamptz,
  add column if not exists guess_checks int not null default 0;

create or replace function public.leads_claim_guess(p_secret text, p_limit int, p_wait_fb boolean)
returns table (id uuid, domain text, owner_name text, search_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with c as (
    select b.id from public.lead_businesses b
     where b.primary_email is null and b.domain is not null and b.excluded_reason is null
       and not public.lead_shared_host(b.domain)
       and b.enrich_status = 'done' and b.guess_status is null
       and (not p_wait_fb or b.facebook_url is null or b.fb_status in ('none', 'failed'))
       and (b.guess_locked_at is null or b.guess_locked_at < now() - interval '10 minutes')
     order by b.created_at
     limit least(greatest(p_limit, 1), 50)
     for update skip locked
  )
  update public.lead_businesses b set guess_locked_at = now()
    from c where b.id = c.id
  returning b.id, b.domain, b.owner_name, b.first_search_id;
end; $$;

-- Worker: what the tries found (p_email null = none of them). p_checks = Bouncer checks spent.
create or replace function public.leads_save_guess(p_secret text, p_id uuid, p_email text, p_reason text, p_checks int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses b
     set guess_status = case when p_email is null then 'none' else 'found' end,
         guess_checks = b.guess_checks + coalesce(p_checks, 0),
         guess_locked_at = null,
         primary_email = coalesce(b.primary_email, p_email),
         emails = case when p_email is not null and b.primary_email is null then array_append(coalesce(b.emails, '{}'), p_email) else b.emails end,
         email_source = case when p_email is not null and b.primary_email is null then 'guessed' else b.email_source end,
         email_status = case when p_email is not null and b.primary_email is null then 'mx_ok' else b.email_status end,
         email_verification = case when p_email is not null and b.primary_email is null then 'deliverable' else b.email_verification end,
         email_verify_reason = case when p_email is not null and b.primary_email is null then left(p_reason, 200) else b.email_verify_reason end,
         email_verified_at = case when p_email is not null and b.primary_email is null then now() else b.email_verified_at end,
         updated_at = now()
   where b.id = p_id;
end; $$;

-- Worker: a try that broke (Bouncer down): let it go back in the queue.
create or replace function public.leads_guess_failed(p_secret text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses set guess_locked_at = null where id = p_id;
end; $$;

revoke execute on function public.leads_claim_guess(text, int, boolean) from public;
revoke execute on function public.leads_save_guess(text, uuid, text, text, int) from public;
revoke execute on function public.leads_guess_failed(text, uuid) from public;
grant execute on function public.leads_claim_guess(text, int, boolean) to anon, authenticated;
grant execute on function public.leads_save_guess(text, uuid, text, text, int) to anon, authenticated;
grant execute on function public.leads_guess_failed(text, uuid) to anon, authenticated;
