-- The "brain": every reply from a candidate who is in screening outreach gets read by the AI, which
-- decides the next step (book the screening call, mark them not interested, answer, or bring Justin in).
-- The engine executes; Postgres keeps the state.

alter table public.activities add column if not exists brain_status text;  -- pending | done | escalated
alter table public.activities add column if not exists brain_note text;
alter table public.activities add column if not exists brain_claimed_at timestamptz;
alter table public.screening_runs add column if not exists scheduled_for timestamptz;
create index if not exists activities_brain_pending on public.activities (occurred_at) where brain_status in ('pending', 'working');

-- A reply is for the brain when the candidate is in screening for a job (outreach started in the last
-- 30 days) and no screening call is booked or done yet for that job.
create or replace function public.brain_job_for(p_candidate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.candidate_job_id
    from public.pursuits p join public.candidate_jobs cj on cj.id = p.candidate_job_id
   where cj.candidate_id = p_candidate and p.purpose = 'screening' and p.started_at > now() - interval '30 days'
     and cj.stage in ('contacting', 'conversation')
     and not exists (select 1 from public.screening_runs r where r.candidate_job_id = p.candidate_job_id
                      and r.status in ('scheduled', 'in_progress', 'completed'))
   order by p.started_at desc limit 1;
$$;
revoke execute on function public.brain_job_for(uuid) from public, anon, authenticated;

create or replace function public.brain_mark_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' and new.candidate_id is not null and new.kind in ('text', 'email')
     and public.brain_job_for(new.candidate_id) is not null then
    new.brain_status := 'pending';
  end if;
  return new;
end $$;
create trigger activities_brain_mark before insert on public.activities for each row execute function public.brain_mark_reply();

-- Up to 5 replies waiting for the brain, each with what it needs to decide: who, which job, and the
-- recent back-and-forth. Internal job notes and anything confidential stay out.
create or replace function public.brain_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  with claimed as (
    update public.activities a set brain_status = 'working', brain_claimed_at = now()
     where a.id in (select id from public.activities
                     where brain_status = 'pending' or (brain_status = 'working' and brain_claimed_at < now() - interval '15 minutes')
                     order by occurred_at limit 5 for update skip locked)
    returning a.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'activity_id', c.id, 'channel', c.kind, 'body', left(c.body, 4000), 'summary', c.summary,
      'thread_id', c.external_thread_id, 'from_phone', c.phone_number,
      'candidate_id', cand.id, 'full_name', cand.full_name, 'email', cand.email, 'phone', cand.phone,
      'sms_opted_out', cand.sms_opted_out_at is not null,
      'candidate_job_id', cj.id, 'stage', cj.stage,
      'job_title', j.title, 'company', coalesce(nullif(co.short_name, ''), co.name), 'location', j.location,
      'compensation', j.compensation, 'schedule', j.schedule, 'job_summary', left(coalesce(j.candidate_description, j.description), 1500),
      'sender_staff_id', coalesce(p.started_by, cj.assigned_by),
      'gmail_email', g.email, 'gmail_token', g.token_enc,
      'history', (select coalesce(jsonb_agg(h order by h.at), '[]'::jsonb) from (
                    select x.occurred_at at, x.kind, x.direction, left(coalesce(x.body, x.summary), 1200) text
                      from public.activities x
                     where x.candidate_id = cand.id and x.kind in ('text', 'email', 'call') and x.id <> c.id
                     order by x.occurred_at desc limit 8) h)
    )), '[]'::jsonb) into out
    from claimed c
    join public.candidates cand on cand.id = c.candidate_id
    join public.candidate_jobs cj on cj.id = public.brain_job_for(cand.id)
    join public.jobs j on j.id = cj.job_id
    join public.companies co on co.id = j.company_id
    left join lateral (select started_by from public.pursuits where candidate_job_id = cj.id order by started_at desc limit 1) p on true
    left join public.google_accounts g on g.staff_id = coalesce(p.started_by, cj.assigned_by);
  -- Anything claimed that no longer has a job in screening goes back to normal handling.
  update public.activities set brain_status = null
   where brain_status = 'working' and candidate_id is not null and public.brain_job_for(candidate_id) is null;
  return out;
end $$;
revoke execute on function public.brain_pending(text) from public, anon, authenticated;
grant execute on function public.brain_pending(text) to anon, authenticated;

-- Carry out the brain's decision. p_decision: intent (book_call | not_interested | needs_justin | ask_time),
-- call_at_local ('YYYY-MM-DD HH24:MI' Eastern, for book_call), summary, and the reply the app already sent
-- (reply_channel, reply_body, reply_external_id, reply_thread_id, reply_phone), if any.
create or replace function public.brain_apply(p_secret text, p_activity uuid, p_decision jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.activities; cj public.candidate_jobs; j public.jobs; who text; intent text := p_decision->>'intent';
  at_ts timestamptz; note text := coalesce(p_decision->>'summary', '');
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into a from public.activities where id = p_activity;
  if a.id is null then return 'missing'; end if;
  select * into cj from public.candidate_jobs where id = (p_decision->>'candidate_job_id')::uuid and candidate_id = a.candidate_id;
  if cj.id is null then
    update public.activities set brain_status = 'escalated', brain_note = 'no job in screening' where id = a.id;
    return 'escalated';
  end if;
  select * into j from public.jobs where id = cj.job_id;
  select full_name into who from public.candidates where id = a.candidate_id;

  -- Log what the brain sent back, as an outgoing message on their history.
  if coalesce(p_decision->>'reply_body', '') <> '' then
    insert into public.activities (kind, direction, summary, body, candidate_id, candidate_job_id, job_id, company_id, market_id,
                                   external_id, external_thread_id, external_status, phone_number)
    values (case when p_decision->>'reply_channel' = 'text' then 'text' else 'email' end, 'out',
            'Automatic reply to ' || who, p_decision->>'reply_body', a.candidate_id, cj.id, j.id, j.company_id, j.market_id,
            nullif(p_decision->>'reply_external_id', ''), nullif(p_decision->>'reply_thread_id', ''), 'sent',
            nullif(p_decision->>'reply_phone', ''))
    on conflict (external_id) where external_id is not null do nothing;
  end if;

  if intent = 'book_call' and coalesce(p_decision->>'call_at_local', '') <> '' then
    at_ts := (p_decision->>'call_at_local')::timestamp at time zone 'America/New_York';
    insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
    values (cj.id, 'scheduled', 'phone', at_ts, note);
    update public.candidate_jobs set stage = 'conversation' where id = cj.id and stage = 'contacting';
    insert into public.action_items (kind, title, detail, priority, due_on, candidate_id, candidate_job_id, job_id, company_id, market_id)
    values ('screening', 'Screening call with ' || who || ' · ' ||
              to_char(at_ts at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'),
            j.title || '. ' || note, 2, (at_ts at time zone 'America/New_York')::date,
            a.candidate_id, cj.id, j.id, j.company_id, j.market_id);
  elsif intent = 'not_interested' then
    update public.candidate_jobs set stage = 'passed' where id = cj.id;
  end if;

  if intent in ('book_call', 'not_interested', 'ask_time') then
    -- Handled: clear the "reply" item this message created.
    update public.action_items set status = 'done', resolved_at = now()
     where kind = 'reply' and status = 'open' and candidate_id = a.candidate_id and created_at >= a.occurred_at - interval '10 minutes';
    update public.activities set brain_status = 'done', brain_note = note where id = a.id;
    return 'done';
  end if;
  -- Needs Justin: keep the item, and say what the brain made of it.
  update public.action_items set title = left(who || ': ' || note, 200)
   where kind = 'reply' and status = 'open' and candidate_id = a.candidate_id and created_at >= a.occurred_at - interval '10 minutes';
  update public.activities set brain_status = 'escalated', brain_note = note where id = a.id;
  return 'escalated';
end $$;
revoke execute on function public.brain_apply(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.brain_apply(text, uuid, jsonb) to anon, authenticated;
