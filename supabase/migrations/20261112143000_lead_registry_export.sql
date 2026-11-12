-- Feed for Justin's live Google Sheet of the lead list (2026-11-12). A random key (only its hash is stored, row
-- 'registry_export' in integration_secrets, created with his OK) stands in for his login; valid 60 days from
-- when it was made.
create or replace function public.lead_registry_export(p_token text, p_all boolean, p_offset int, p_limit int)
returns setof public.lead_registry language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.integration_secrets s
    where s.name = 'registry_export' and s.created_at > now() - interval '60 days'
      and s.secret_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  ) then raise exception 'link expired'; end if;
  return query
  select * from public.lead_registry r
  where r.removed_reason is null and r.researched_at is not null
    and (p_all or (r.size_guess = '4+' and coalesce(r.closed, false) = false))
  order by r.employees_est desc nulls last, r.name
  offset p_offset limit least(p_limit, 1000);
end $$;
revoke execute on function public.lead_registry_export(text, boolean, int, int) from public;
grant execute on function public.lead_registry_export(text, boolean, int, int) to anon, authenticated;
