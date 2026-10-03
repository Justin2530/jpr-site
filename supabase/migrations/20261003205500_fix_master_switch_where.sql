-- The API roles run with safe-update on, which rejects an UPDATE with no WHERE clause even on a
-- one-row table. Name the row.
create or replace function public.set_automated_recruiting(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings
     set automated_recruiting = p_on,
         eligible_after = case when p_on then coalesce(eligible_after, now()) else eligible_after end,
         changed_at = now(), changed_by = auth.uid()
   where id;
end $$;
