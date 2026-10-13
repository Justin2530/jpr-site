-- A client often answers a submission by phone or in a new email thread, so client_replied_at stayed empty even
-- after the candidate moved to Interviewing (Aaron Jackson, 2026-10-13). Moving past Submitted now counts as the
-- client's answer, so every screen reads the submission as answered.
create or replace function public.submission_answered_on_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage in ('interviewing', 'offer', 'placed') and old.stage is distinct from new.stage then
    update public.submissions set client_replied_at = now()
     where candidate_job_id = new.id and status = 'sent' and client_replied_at is null;
  end if;
  return new;
end $$;
revoke execute on function public.submission_answered_on_stage() from public, anon, authenticated;
create trigger candidate_jobs_submission_answered after update of stage on public.candidate_jobs
  for each row execute function public.submission_answered_on_stage();
