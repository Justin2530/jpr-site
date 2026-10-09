-- Deleting a candidate: the inbox's "already read" marks and call logs point at them without cascading.
-- Owner-only helper the app calls right before deleting, so those records stay but let go of the person.
-- (A reply draft still waiting for someone keeps them from being deleted; send or skip it first.)
create or replace function public.release_candidates(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can delete candidates.'; end if;
  update public.inbox_triaged set candidate_id = null where candidate_id = any(p_ids);
  update public.reception_calls set candidate_id = null where candidate_id = any(p_ids);
end $$;
revoke all on function public.release_candidates(uuid[]) from public;
grant execute on function public.release_candidates(uuid[]) to authenticated;
