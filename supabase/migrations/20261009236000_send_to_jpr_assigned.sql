-- Justin 2026-10-09: "the system was supposed to be automaticly assigning them". Send to JPR now puts people on
-- the job it picks as Assigned (his own add counts as his assign). Today's Send to JPR people still at Sourced
-- move to Assigned. David Burnham's ACME link is left alone (Justin is removing it).
create or replace function public.send_to_jpr_assigned_2026_10_09() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.candidate_jobs set stage = 'assigned'
   where stage = 'sourced'
     and id in ('e999ab08-e198-4bfb-a8c5-aae3be5e9b2b', '6ff0f90b-2181-4ab9-bf18-26de3020bfc0',
                '6106471a-af58-4307-a0a7-dab234fadc61', 'bd356112-a340-4b03-9034-10ceb883045f');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_to_jpr_assigned_2026_10_09() from public, anon, authenticated;
select public.send_to_jpr_assigned_2026_10_09();
