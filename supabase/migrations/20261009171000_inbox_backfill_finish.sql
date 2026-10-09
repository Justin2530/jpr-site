-- The backfill window end is stored to the microsecond but read back in milliseconds, so it never
-- quite reached the end; finish within a second of it.
create or replace function public.gmail_backfill_set(p_secret text, p_staff uuid, p_from timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.google_accounts g
     set backfill_from = case when p_from >= g.backfill_to - interval '1 second' then null else p_from end,
         backfill_to = case when p_from >= g.backfill_to - interval '1 second' then null else g.backfill_to end
   where g.staff_id = p_staff;
end $$;
