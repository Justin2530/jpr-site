-- Deleting jobs from the Jobs list (Justin 2026-10-11). Before a job goes, keep its texts, emails and calls
-- (they stay on the person's record, just no longer tied to the job) and let go of links that would block the delete.
create or replace function public.release_jobs(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can delete jobs.'; end if;
  update public.activities set job_id = null, candidate_job_id = null
   where job_id = any(p_ids) or candidate_job_id in (select id from public.candidate_jobs where job_id = any(p_ids));
  update public.inbox_drafts set candidate_job_id = null
   where candidate_job_id in (select id from public.candidate_jobs where job_id = any(p_ids));
  update public.inbox_drafts set action_item_id = null
   where action_item_id in (select id from public.action_items where job_id = any(p_ids)
                             or candidate_job_id in (select id from public.candidate_jobs where job_id = any(p_ids)));
  update public.reception_calls set action_item_id = null
   where action_item_id in (select id from public.action_items where job_id = any(p_ids)
                             or candidate_job_id in (select id from public.candidate_jobs where job_id = any(p_ids)));
end $$;
revoke execute on function public.release_jobs(uuid[]) from public, anon;
grant execute on function public.release_jobs(uuid[]) to authenticated;
