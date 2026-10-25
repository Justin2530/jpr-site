-- Phase 4: the AI screening call. At the booked time the engine dials the candidate from the business
-- number; when a person answers, Twilio hands the call to OpenAI's GPT-Live voice agent. After the call
-- the recording is transcribed, the answers are filed against the job's screening questions, and a
-- submission draft waits for Justin's Send. Voicemail or no answer gets a text asking for a better time.

alter table public.screening_runs add column if not exists call_sid text;
alter table public.screening_runs add column if not exists live_session_id text;
alter table public.screening_runs add column if not exists answered_by text;
alter table public.screening_runs add column if not exists dial_started_at timestamptz;
alter table public.screening_runs add column if not exists call_outcome text;   -- what the agent said when it hung up
alter table public.screening_runs add column if not exists outcome_note text;
alter table public.screening_runs add column if not exists process_state text;  -- pending | working | done | failed
alter table public.screening_runs add column if not exists process_note text;
alter table public.screening_runs add column if not exists process_claimed_at timestamptz;
create index if not exists screening_runs_due on public.screening_runs (scheduled_for) where status = 'scheduled';

-- Everything the voice agent and the note-taker may know about one call. Internal job notes stay out.
create or replace function public.screening_context(p_run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'run_id', r.id, 'candidate_job_id', cj.id, 'stage', cj.stage, 'status', r.status,
    'call_sid', r.call_sid, 'live_session_id', r.live_session_id,
    'candidate_id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email,
    'sms_opted_out', c.sms_opted_out_at is not null,
    'current_title', c.current_title, 'current_employer', c.current_employer, 'city', c.city, 'state', c.state,
    'candidate_notes', left(c.notes, 2000),
    'resume', (select left(x.text_content, 8000) from public.resumes x where x.candidate_id = c.id and x.text_content is not null
                order by x.created_at desc limit 1),
    'job_id', j.id, 'job_title', j.title, 'location', j.location, 'compensation', j.compensation, 'schedule', j.schedule,
    'job_description', left(coalesce(nullif(j.candidate_description, ''), j.description), 6000),
    'company', coalesce(nullif(co.short_name, ''), co.name), 'company_id', co.id, 'market_id', j.market_id,
    'hiring_contact_id', j.hiring_contact_id,
    'hiring_contact', (select ct.full_name from public.contacts ct where ct.id = j.hiring_contact_id),
    'goals', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'question', g.prompt, 'required', g.required) order by g.sort), '[]'::jsonb)
                from public.screening_goals g where g.job_id = j.id),
    'history', (select coalesce(jsonb_agg(h order by h.at), '[]'::jsonb) from (
                  select x.occurred_at at, x.kind, x.direction, left(coalesce(x.body, x.summary), 600) text
                    from public.activities x
                   where x.candidate_id = c.id and x.kind in ('text', 'email', 'call')
                   order by x.occurred_at desc limit 10) h),
    'sender_staff_id', coalesce(p.started_by, cj.assigned_by)
  )
  from public.screening_runs r
  join public.candidate_jobs cj on cj.id = r.candidate_job_id
  join public.candidates c on c.id = cj.candidate_id
  join public.jobs j on j.id = cj.job_id
  join public.companies co on co.id = j.company_id
  left join lateral (select started_by from public.pursuits where candidate_job_id = cj.id order by started_at desc limit 1) p on true
  where r.id = p_run;
$$;
revoke execute on function public.screening_context(uuid) from public, anon, authenticated;

create or replace function public.screening_get(p_secret text, p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return public.screening_context(p_run);
end $$;
revoke execute on function public.screening_get(text, uuid) from public, anon, authenticated;
grant execute on function public.screening_get(text, uuid) to anon, authenticated;

-- Calls whose time has come (within the last 15 minutes, so a stale booking never rings late), claimed
-- so only one tick dials each. Needs the master switch on.
create or replace function public.screening_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return '[]'::jsonb; end if;
  with claimed as (
    update public.screening_runs r set status = 'in_progress', dial_started_at = now()
     where r.id in (select id from public.screening_runs
                     where status = 'scheduled' and channel = 'phone'
                       and scheduled_for <= now() and scheduled_for > now() - interval '15 minutes'
                     order by scheduled_for limit 3 for update skip locked)
    returning r.id)
  select coalesce(jsonb_agg(public.screening_context(id)), '[]'::jsonb) into out from claimed;
  return out;
end $$;
revoke execute on function public.screening_due(text) from public, anon, authenticated;
grant execute on function public.screening_due(text) to anon, authenticated;

-- "Call now" from the job tab: book a call for right now (owner or the market's staff), and the next
-- tick dials it.
create or replace function public.screening_call_now(p_candidate_job_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mkt uuid; rid uuid;
begin
  select j.market_id into mkt from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.screening_runs where candidate_job_id = p_candidate_job_id and status = 'in_progress'
              and coalesce(dial_started_at, created_at) > now() - interval '30 minutes') then
    raise exception 'A call is already in progress.';
  end if;
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

-- Small state changes during a call: Twilio's call id, OpenAI's session id, who answered, and how it ended.
-- p jsonb keys (all optional): call_sid, live_session_id, answered_by, call_outcome, outcome_note,
-- status, process_state, process_note, duration_seconds, started, ended,
-- log_text {body, sid, phone} (a text the app just sent, to log on their history).
create or replace function public.screening_update(p_secret text, p_run uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.screening_runs set
    call_sid = coalesce(p->>'call_sid', call_sid),
    live_session_id = coalesce(p->>'live_session_id', live_session_id),
    answered_by = coalesce(p->>'answered_by', answered_by),
    call_outcome = coalesce(p->>'call_outcome', call_outcome),
    outcome_note = coalesce(p->>'outcome_note', outcome_note),
    status = coalesce((p->>'status')::public.screening_status, status),
    process_state = coalesce(p->>'process_state', process_state),
    process_note = coalesce(p->>'process_note', process_note),
    duration_seconds = coalesce((p->>'duration_seconds')::int, duration_seconds),
    started_at = case when (p->>'started')::boolean then coalesce(started_at, now()) else started_at end,
    ended_at = case when (p->>'ended')::boolean then coalesce(ended_at, now()) else ended_at end
  where id = p_run;
  if p ? 'log_text' then
    ctx := public.screening_context(p_run);
    insert into public.activities (kind, direction, summary, body, candidate_id, candidate_job_id, job_id, company_id, market_id,
                                   external_id, external_status, phone_number)
    values ('text', 'out', 'Automatic text to ' || (ctx->>'full_name'), p->'log_text'->>'body',
            (ctx->>'candidate_id')::uuid, (ctx->>'candidate_job_id')::uuid, (ctx->>'job_id')::uuid,
            (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid,
            nullif(p->'log_text'->>'sid', ''), 'sent', nullif(p->'log_text'->>'phone', ''))
    on conflict (external_id) where external_id is not null do nothing;
  end if;
end $$;
revoke execute on function public.screening_update(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.screening_update(text, uuid, jsonb) to anon, authenticated;

-- When OpenAI's webhook can't name the call from its SIP headers: the one call Twilio connected in the
-- last few minutes that has no voice session yet.
create or replace function public.screening_awaiting_agent(p_secret text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare rid uuid; n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select count(*), min(id::text)::uuid into n, rid from public.screening_runs
   where status = 'in_progress' and live_session_id is null and answered_by is not null
     and dial_started_at > now() - interval '5 minutes';
  return case when n = 1 then rid end;
end $$;
revoke execute on function public.screening_awaiting_agent(text) from public, anon, authenticated;
grant execute on function public.screening_awaiting_agent(text) to anon, authenticated;

-- One finished call waiting to be turned into notes (reclaimed after 10 minutes if a pass died).
create or replace function public.screening_to_process(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.screening_runs set process_state = 'working', process_claimed_at = now()
   where id = (select id from public.screening_runs
                where process_state = 'pending' or (process_state = 'working' and process_claimed_at < now() - interval '10 minutes')
                order by ended_at nulls first limit 1 for update skip locked)
  returning id into rid;
  if rid is null then return null; end if;
  return public.screening_context(rid);
end $$;
revoke execute on function public.screening_to_process(text) from public, anon, authenticated;
grant execute on function public.screening_to_process(text) to anon, authenticated;

-- File what the call produced. p keys: summary, transcript (array of {who, text, at}), candidate_questions,
-- concerns, unresolved (text arrays), facts (array of {goal_id?, label, value}), outcome
-- (interested | not_interested | callback | incomplete), callback_at_local ('YYYY-MM-DD HH24:MI' ET),
-- submission {subject, body} (only when interested).
create or replace function public.screening_complete(p_secret text, p_run uuid, p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; cj_id uuid; f jsonb; i int := 0; outcome text := coalesce(p->>'outcome', 'incomplete'); who text;
  at_ts timestamptz; mins int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  ctx := public.screening_context(p_run);
  if ctx is null then return 'missing'; end if;
  cj_id := (ctx->>'candidate_job_id')::uuid;
  who := ctx->>'full_name';

  update public.screening_runs set
    status = 'completed', process_state = 'done', process_note = null, ended_at = coalesce(ended_at, now()),
    summary = p->>'summary',
    transcript = coalesce(p->'transcript', '[]'::jsonb),
    candidate_questions = coalesce(array(select jsonb_array_elements_text(p->'candidate_questions')), '{}'),
    concerns = coalesce(array(select jsonb_array_elements_text(p->'concerns')), '{}'),
    unresolved = coalesce(array(select jsonb_array_elements_text(p->'unresolved')), '{}')
  where id = p_run;

  for f in select value from jsonb_array_elements(coalesce(p->'facts', '[]'::jsonb)) loop
    i := i + 1;
    if coalesce(f->>'value', '') = '' then continue; end if;
    insert into public.screening_facts (candidate_job_id, run_id, goal_id, label, value, source, sort)
    values (cj_id, p_run,
            (select g.id from public.screening_goals g where g.id::text = f->>'goal_id' and g.job_id = (ctx->>'job_id')::uuid),
            left(coalesce(f->>'label', 'Note'), 200), left(f->>'value', 2000), 'ai_call', i);
  end loop;

  select duration_seconds / 60 into mins from public.screening_runs where id = p_run;
  insert into public.activities (kind, direction, summary, body, duration_seconds, candidate_id, candidate_job_id, job_id, company_id, market_id)
  values ('call', 'out', 'AI screening call with ' || who || coalesce(' (' || nullif(mins, 0) || ' min)', ''), p->>'summary',
          (select duration_seconds from public.screening_runs where id = p_run),
          (ctx->>'candidate_id')::uuid, cj_id, (ctx->>'job_id')::uuid, (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid);

  if outcome = 'interested' then
    if coalesce(p->'submission'->>'body', '') <> ''
       and not exists (select 1 from public.submissions s where s.candidate_job_id = cj_id and s.status in ('draft', 'sent')) then
      insert into public.submissions (candidate_job_id, run_id, status, subject, body, to_contact_ids, drafted_by)
      values (cj_id, p_run, 'draft', p->'submission'->>'subject', p->'submission'->>'body',
              case when ctx->>'hiring_contact_id' is not null then array[(ctx->>'hiring_contact_id')::uuid] else '{}'::uuid[] end,
              'ai');
    end if;
    update public.candidate_jobs set stage = 'ready_to_submit'
     where id = cj_id and stage in ('applied', 'assigned', 'contacting', 'conversation');
  elsif outcome = 'not_interested' then
    update public.candidate_jobs set stage = 'passed'
     where id = cj_id and stage in ('applied', 'assigned', 'contacting', 'conversation');
  elsif outcome = 'callback' and coalesce(p->>'callback_at_local', '') ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then
    at_ts := (p->>'callback_at_local')::timestamp at time zone 'America/New_York';
    if at_ts > now() then
      insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
      values (cj_id, 'scheduled', 'phone', at_ts, 'Call back: ' || coalesce(p->>'summary', ''));
    end if;
  else
    -- Hung up early or couldn't finish: the one case after a call that needs Justin.
    insert into public.action_items (kind, title, detail, priority, candidate_id, candidate_job_id, job_id, company_id, market_id)
    values ('task', 'Screening call with ' || who || ' didn''t finish', coalesce(p->>'summary', ''), 2,
            (ctx->>'candidate_id')::uuid, cj_id, (ctx->>'job_id')::uuid, (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid);
  end if;
  return outcome;
end $$;
revoke execute on function public.screening_complete(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.screening_complete(text, uuid, jsonb) to anon, authenticated;
