-- Recruiting flow V1, build step 2: around a call the candidate booked.
-- 1) A text one hour before the call (skipped when they booked it less than an hour ahead, or outside 9am-9pm).
-- 2) A missed booked call gets Justin's locked text naming the time. If they don't reply within a day,
--    the outreach schedule picks up where it left off (same steps, same gaps, same email thread).

alter table public.screening_runs add column if not exists reminder_sent_at timestamptz;
alter table public.screening_runs add column if not exists resume_after timestamptz;
alter table public.screening_runs add column if not exists resumed_at timestamptz;
alter table public.pursuits add column if not exists resumed_from uuid references public.pursuits (id) on delete set null;

-- A call the candidate booked, as opposed to an outreach call or one started by hand with "Call now".
create or replace function public.screening_is_booked(r public.screening_runs) returns boolean
language sql immutable set search_path = '' as $$
  select r.purpose = 'screening' and r.scheduled_for is not null
     and coalesce(r.summary, '') not like 'Started by hand%'
     and r.scheduled_for > r.created_at + interval '5 minutes'
$$;
revoke execute on function public.screening_is_booked(public.screening_runs) from public, anon, authenticated;

-- Reminder texts due now. Claims each run so a reminder is only ever sent once.
create or replace function public.screening_reminders_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb; h int := extract(hour from now() at time zone 'America/New_York');
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return '[]'::jsonb; end if;
  if h < 9 or h >= 21 then return '[]'::jsonb; end if;
  with claimed as (
    update public.screening_runs r set reminder_sent_at = now()
     where r.id in (select x.id from public.screening_runs x
                     where x.status = 'scheduled' and x.channel = 'phone' and x.reminder_sent_at is null
                       and public.screening_is_booked(x)
                       and x.scheduled_for between now() + interval '5 minutes' and now() + interval '1 hour'
                       and x.created_at <= x.scheduled_for - interval '1 hour'
                     for update skip locked)
    returning r.id, r.scheduled_for)
  select coalesce(jsonb_agg(public.screening_context(c.id)
           || jsonb_build_object('call_time', to_char(c.scheduled_for at time zone 'America/New_York', 'FMHH12:MI'))), '[]'::jsonb)
    into out from claimed c;
  return out;
end $$;
revoke execute on function public.screening_reminders_due(text) from public, anon, authenticated;
grant execute on function public.screening_reminders_due(text) to anon, authenticated;

-- Called when a call is missed: says whether it was a booked call and at what time, and for a booked
-- call starts the one-day wait before the outreach schedule resumes.
create or replace function public.screening_missed(p_secret text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.screening_runs;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into r from public.screening_runs where id = p_run;
  if r.id is null or not public.screening_is_booked(r) then return jsonb_build_object('booked', false); end if;
  update public.screening_runs set resume_after = coalesce(resume_after, now() + interval '1 day') where id = p_run;
  return jsonb_build_object('booked', true,
    'call_time', to_char(r.scheduled_for at time zone 'America/New_York', 'FMHH12:MI'));
end $$;
revoke execute on function public.screening_missed(text, uuid) from public, anon, authenticated;
grant execute on function public.screening_missed(text, uuid) to anon, authenticated;

-- A day after a missed booked call with no word from them: pick the outreach back up where it stopped.
-- Nothing resumes if they replied, another call was booked or made, someone turned outreach off for
-- them, outreach is already running, they've moved on in the pipeline, or automated recruiting is off.
create or replace function public.pursuits_resume_due(p_secret text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; old public.pursuits; pid uuid; first_due timestamptz; n int := 0; cfg public.automation_settings;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into cfg from public.automation_settings;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after_v1 is null then return 0; end if;
  for r in
    select x.id, x.candidate_job_id, x.ended_at, x.created_at, cj.candidate_id, cj.stage, c.created_at added
      from public.screening_runs x join public.candidate_jobs cj on cj.id = x.candidate_job_id
      join public.candidates c on c.id = cj.candidate_id
     where x.resume_after <= now() and x.resumed_at is null
     for update of x skip locked
  loop
    update public.screening_runs set resumed_at = now() where id = r.id;
    continue when r.added < cfg.eligible_after_v1;
    continue when r.stage not in ('contacting', 'conversation');
    continue when exists (select 1 from public.activities a where a.candidate_id = r.candidate_id and a.direction = 'in'
                           and a.kind in ('text', 'email', 'call') and a.occurred_at > coalesce(r.ended_at, r.created_at));
    continue when exists (select 1 from public.screening_runs y where y.candidate_job_id = r.candidate_job_id
                           and y.id <> r.id and y.created_at > r.created_at);
    continue when exists (select 1 from public.pursuits p where p.candidate_job_id = r.candidate_job_id
                           and p.purpose = 'screening' and p.status = 'active');
    select * into old from public.pursuits p
     where p.candidate_job_id = r.candidate_job_id and p.purpose = 'screening' and p.status = 'stopped'
     order by p.ended_at desc limit 1;
    continue when old.id is null or old.paused_at is not null;
    select min(due_at) into first_due from public.pursuit_steps
     where pursuit_id = old.id and status = 'skipped' and note like 'stopped:%';
    continue when first_due is null;
    insert into public.pursuits (candidate_job_id, purpose, started_by, resumed_from)
    values (r.candidate_job_id, 'screening', old.started_by, coalesce(old.resumed_from, old.id)) returning id into pid;
    insert into public.pursuit_steps (pursuit_id, step_no, channel, in_thread, subject, body, due_at)
    select pid, s.step_no, s.channel, s.in_thread, s.subject, s.body,
           public.next_send_time(now() + (s.due_at - first_due), s.channel)
      from public.pursuit_steps s
     where s.pursuit_id = old.id and s.status = 'skipped' and s.note like 'stopped:%';
    update public.candidate_jobs set stage = 'contacting' where id = r.candidate_job_id and stage = 'conversation';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.pursuits_resume_due(text) from public, anon, authenticated;
grant execute on function public.pursuits_resume_due(text) to anon, authenticated;
