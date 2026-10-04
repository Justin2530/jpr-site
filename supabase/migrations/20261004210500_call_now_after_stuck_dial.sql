-- "Call now" works again after a dial that never connected to the assistant (no live session a few
-- minutes after dialing); that stuck call is closed out as failed first.
create or replace function public.screening_call_now(p_candidate_job_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mkt uuid; rid uuid;
begin
  select j.market_id into mkt from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.screening_runs where candidate_job_id = p_candidate_job_id and status = 'in_progress'
              and ((live_session_id is not null and coalesce(dial_started_at, created_at) > now() - interval '30 minutes')
                   or coalesce(dial_started_at, created_at) > now() - interval '3 minutes')) then
    raise exception 'A call is already in progress.';
  end if;
  update public.screening_runs set status = 'failed', process_note = coalesce(process_note, 'The call never connected to the AI assistant.')
   where candidate_job_id = p_candidate_job_id and status = 'in_progress';
  update public.screening_runs set status = 'cancelled' where candidate_job_id = p_candidate_job_id and status = 'scheduled';
  update public.action_items set status = 'done', resolved_at = now()
   where kind = 'screening' and status = 'open' and candidate_job_id = p_candidate_job_id;
  insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
  values (p_candidate_job_id, 'scheduled', 'phone', now(), 'Started by hand from the Command Center')
  returning id into rid;
  return rid;
end $$;
revoke execute on function public.screening_call_now(uuid) from public, anon;
grant execute on function public.screening_call_now(uuid) to authenticated;
