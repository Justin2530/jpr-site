-- Justin 2026-10-09: no stage should come from old Recruiterflow data. Imported job links (assigned before the
-- Sept 30 import, with an "Imported from Recruiterflow" activity) go back to Sourced for his review; the two real
-- placements stay Placed.
create or replace function public.reset_recruiterflow_stages() returns integer
language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  update public.candidate_jobs cj set stage = 'sourced'
  where cj.assigned_at < '2026-09-30'
    and cj.stage not in ('sourced', 'placed')
    and exists (select 1 from public.activities a where a.candidate_id = cj.candidate_id and a.summary ilike 'Imported from Recruiterflow%');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.reset_recruiterflow_stages() from public, anon, authenticated;
select public.reset_recruiterflow_stages();
