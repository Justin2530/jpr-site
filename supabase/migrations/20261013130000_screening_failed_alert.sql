-- Jacob Winters (2026-10-13): his booked screening call failed with "No phone number on file" even though he had
-- emailed his number, and nothing told Justin. Two fixes:
-- 1. The reply brain can save a phone number a candidate gives in a message, when none is on file.
-- 2. A screening call that can't be placed lands on What needs me.

create or replace function public.candidate_phone_fill(p_secret text, p_candidate uuid, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.candidates set phone = p_phone
   where id = p_candidate and coalesce(phone, '') = '' and p_phone ~ '^\+1[0-9]{10}$';
end $$;
revoke execute on function public.candidate_phone_fill(text, uuid, text) from public, anon, authenticated;
grant execute on function public.candidate_phone_fill(text, uuid, text) to anon, authenticated;

create or replace function public.screening_failed_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; cand uuid; j public.jobs;
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    select c.full_name, c.id into who, cand from public.candidate_jobs cj join public.candidates c on c.id = cj.candidate_id
     where cj.id = new.candidate_job_id;
    select jb.* into j from public.jobs jb join public.candidate_jobs cj on cj.job_id = jb.id where cj.id = new.candidate_job_id;
    insert into public.action_items (kind, title, detail, priority, candidate_id, candidate_job_id, job_id, company_id, market_id)
    values ('task', 'Screening call with ' || who || ' couldn''t be placed',
            coalesce(new.process_note, 'The call failed') || '. Set a new time with them.', 1,
            cand, new.candidate_job_id, j.id, j.company_id, j.market_id);
  end if;
  return new;
end $$;
revoke execute on function public.screening_failed_alert() from public, anon, authenticated;
create trigger screening_runs_failed_alert after update of status on public.screening_runs
  for each row execute function public.screening_failed_alert();

-- Calls that already failed this week with nothing booked since.
insert into public.action_items (kind, title, detail, priority, candidate_id, candidate_job_id, job_id, company_id, market_id)
select 'task', 'Screening call with ' || c.full_name || ' couldn''t be placed',
       coalesce(r.process_note, 'The call failed') || '. Set a new time with them.', 1,
       c.id, cj.id, j.id, j.company_id, j.market_id
  from public.screening_runs r join public.candidate_jobs cj on cj.id = r.candidate_job_id
  join public.candidates c on c.id = cj.candidate_id join public.jobs j on j.id = cj.job_id
 where r.status = 'failed' and r.created_at > now() - interval '7 days'
   and cj.stage not in ('passed', 'withdrawn', 'placed')
   and not exists (select 1 from public.screening_runs x where x.candidate_job_id = cj.id and x.created_at > r.created_at);
