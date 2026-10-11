-- Deleting Cheri Peace failed: a phone-call log pointed at one of her What needs me items, which goes with her.
-- Release those links too (and any reply draft filed on such an item) before the candidate is deleted.
create or replace function public.release_candidates(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can delete candidates.'; end if;
  update public.inbox_triaged set candidate_id = null where candidate_id = any(p_ids);
  update public.reception_calls set candidate_id = null where candidate_id = any(p_ids);
  update public.reception_calls set action_item_id = null
   where action_item_id in (select id from public.action_items where candidate_id = any(p_ids)
                             or candidate_job_id in (select id from public.candidate_jobs where candidate_id = any(p_ids)));
  update public.inbox_drafts set action_item_id = null
   where action_item_id in (select id from public.action_items where candidate_id = any(p_ids)
                             or candidate_job_id in (select id from public.candidate_jobs where candidate_id = any(p_ids)));
end $$;
