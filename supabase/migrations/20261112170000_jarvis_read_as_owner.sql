-- Jarvis reads as Justin, so the app's own read functions that check is_staff() (like calendar_events) work too.
-- The transaction is switched to read-only first, so nothing it runs can change data.
create or replace function public.jarvis_read(p_secret text, p_sql text) returns jsonb
language plpgsql volatile security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  out jsonb; q text := regexp_replace(p_sql, ';\s*$', '');
  owner uuid := (select s.id from public.staff s where s.role = 'owner' and s.active order by s.created_at limit 1);
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  perform set_config('transaction_read_only', 'on', true);
  if q !~* '^\s*(select|with)\M' then raise exception 'Only SELECT queries here.'; end if;
  if public.jarvis_sql_blocked(q) then raise exception 'That table or command is off limits.'; end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 200) t', q) into out;
  return out;
end $$;
