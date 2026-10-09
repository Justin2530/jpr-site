-- Justin 2026-10-09: "Can you turn that off just for me, nobody else, so that I can turn the automation on for
-- myself?" His own test candidate record was added before automated recruiting was switched on, so it counts as
-- "existing". Only that one record now counts as added today; its original date is kept in first_added_at.
create or replace function public.justin_test_candidate_new_2026_10_09() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.candidates set first_added_at = coalesce(first_added_at, created_at), created_at = now()
   where id = 'f4e1b237-e11d-4623-b7f0-ab9007967021' and full_name = 'Justin Peace';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.justin_test_candidate_new_2026_10_09() from public, anon, authenticated;
select public.justin_test_candidate_new_2026_10_09();
