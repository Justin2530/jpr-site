-- Justin 2026-10-11: "can you make devon yeany available for me to turn auto recruitng. he was in there from before
-- but this is a new converstaioon with him". Same as his own test record: only Devin Yeaney counts as added today,
-- original date kept in first_added_at. Nothing starts until Justin turns on his switch.
create or replace function public.devin_yeaney_new_2026_10_11() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.candidates set first_added_at = coalesce(first_added_at, created_at), created_at = now()
   where id = 'e49e3aa0-efdd-488f-acc6-14e5a77c4100' and full_name = 'Devin Yeaney';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.devin_yeaney_new_2026_10_11() from public, anon, authenticated;
select public.devin_yeaney_new_2026_10_11();
