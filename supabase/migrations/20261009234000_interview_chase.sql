-- Justin 2026-10-09: when the candidate doesn't answer the interview times, chase them. No AI call ("skip
-- that part"). 4 hours after the times went to the candidate (texts wait for 9am-9pm): a second text and an
-- email. End of the next day: it lands on What needs me for Justin to call, and the client gets a short
-- "still confirming" email. Any reply from the candidate, by text, email or phone, stops it.
alter table public.interviews add column if not exists asked_candidate_at timestamptz;
alter table public.interviews add column if not exists chase_sent_at timestamptz;
alter table public.interviews add column if not exists chase_flagged_at timestamptz;

-- The clock starts each time the times go to the candidate (a new round restarts it).
create or replace function public.interview_asked_mark() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'proposing' and new.waiting_on = 'candidate'
     and (tg_op = 'INSERT' or old.waiting_on is distinct from 'candidate' or old.rounds is distinct from new.rounds) then
    new.asked_candidate_at := now();
    new.chase_sent_at := null;
    new.chase_flagged_at := null;
  end if;
  return new;
end $$;
create or replace trigger interviews_asked_mark before insert or update on public.interviews
  for each row execute function public.interview_asked_mark();

-- Whether the candidate has said anything since the times went to them.
create or replace function public.candidate_answered_since(p_cj uuid, p_since timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activities a join public.candidate_jobs cj on cj.id = p_cj
                  where a.candidate_id = cj.candidate_id and a.direction = 'in' and a.occurred_at > p_since);
$$;
revoke all on function public.candidate_answered_since(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.relay_scheduled(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; r record; h int := extract(hour from now() at time zone 'America/New_York'); d date;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return out; end if;

  if h >= 9 and h < 21 then
    for r in
      select i.* from public.interviews i
       where i.status = 'confirmed' and i.reminder_sent_at is null and i.scheduled_at > now() + interval '2 hours'
         and i.confirmed_at < i.scheduled_at - interval '1 day'
         and now() >= ((((i.scheduled_at at time zone 'America/New_York')::date - 1) + time '12:00') at time zone 'America/New_York')
         and public.automation_allowed(i.candidate_job_id)
       for update skip locked
    loop
      update public.interviews set reminder_sent_at = now() where id = r.id;
      out := out || jsonb_build_array(public.relay_context(r.candidate_job_id) || jsonb_build_object(
        'step', 'interview_reminder', 'interview', to_jsonb(r)));
    end loop;

    for r in
      select p.*, cj.candidate_id from public.placements p join public.candidate_jobs cj on cj.id = p.candidate_job_id
       where p.start_date is not null and p.start_text_sent_at is null and cj.stage = 'placed'
         and now() >= (((p.start_date - 1) + time '16:00') at time zone 'America/New_York')
         and now() < ((p.start_date + time '06:00') at time zone 'America/New_York')
         and public.automation_allowed(p.candidate_job_id)
       for update of p skip locked
    loop
      update public.placements set start_text_sent_at = now() where id = r.id;
      out := out || jsonb_build_array(public.relay_context(r.candidate_job_id) || jsonb_build_object('step', 'start_text'));
    end loop;

    -- Interview times unanswered for 4 hours: a second text and an email.
    for r in
      select i.* from public.interviews i
       where i.status = 'proposing' and i.waiting_on = 'candidate' and i.chase_sent_at is null
         and i.asked_candidate_at is not null and i.asked_candidate_at <= now() - interval '4 hours'
         and not public.candidate_answered_since(i.candidate_job_id, i.asked_candidate_at)
         and public.automation_allowed(i.candidate_job_id)
       for update skip locked
    loop
      update public.interviews set chase_sent_at = now() where id = r.id;
      out := out || jsonb_build_array(public.relay_context(r.candidate_job_id) || jsonb_build_object(
        'step', 'interview_chase', 'interview', to_jsonb(r)));
    end loop;
  end if;

  -- Still nothing by 5pm the day after: Justin calls them, and the client hears it's being confirmed.
  for r in
    select i.* from public.interviews i
     where i.status = 'proposing' and i.waiting_on = 'candidate' and i.chase_sent_at is not null and i.chase_flagged_at is null
       and now() >= ((((i.asked_candidate_at at time zone 'America/New_York')::date + 1) + time '17:00') at time zone 'America/New_York')
       and not public.candidate_answered_since(i.candidate_job_id, i.asked_candidate_at)
       and public.automation_allowed(i.candidate_job_id)
     for update skip locked
  loop
    update public.interviews set chase_flagged_at = now() where id = r.id;
    out := out || jsonb_build_array(public.relay_context(r.candidate_job_id) || jsonb_build_object(
      'step', 'interview_flag', 'interview', to_jsonb(r)));
  end loop;

  for r in
    select i.* from public.interviews i
     where i.status = 'confirmed' and i.checkin_sent_at is null and i.scheduled_at < now()
       and public.automation_allowed(i.candidate_job_id)
     for update skip locked
  loop
    d := (r.scheduled_at at time zone 'America/New_York')::date + 1;
    while extract(isodow from d) >= 6 loop d := d + 1; end loop;
    continue when now() < ((d + time '15:00') at time zone 'America/New_York') or public.business_time(now()) > now();
    update public.interviews set checkin_sent_at = now(), status = 'done' where id = r.id;
    out := out || jsonb_build_array(public.relay_context(r.candidate_job_id) || jsonb_build_object(
      'step', 'interview_checkin', 'interview', to_jsonb(r)));
  end loop;
  return out;
end $$;
