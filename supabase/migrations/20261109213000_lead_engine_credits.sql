-- Lead Engine fixes after Justin's first full run (2026-11-09).
-- 1. Bouncer ran out of credits mid-run and each tick still counted a try on the emails it had claimed, so 408
--    emails hit the 3-try limit and would never be checked. A hold now gives the try back, and those are reset.
-- 2. "Serper credits used" read at most 1,000 spend rows; it's now summed in the database.

create or replace function public.leads_verify_release(p_secret text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_businesses set verify_locked_at = null, verify_attempts = greatest(verify_attempts - 1, 0) where id = p_id;
end $$;
revoke execute on function public.leads_verify_release(text, uuid) from public;
grant execute on function public.leads_verify_release(text, uuid) to anon, authenticated;

update public.lead_businesses set verify_attempts = 0, verify_locked_at = null
 where primary_email is not null and email_verification is null and verify_attempts > 0;

create or replace function public.lead_credits_used(p_service text)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(units), 0) from public.lead_spend where service = p_service
$$;
grant execute on function public.lead_credits_used(text) to authenticated;
