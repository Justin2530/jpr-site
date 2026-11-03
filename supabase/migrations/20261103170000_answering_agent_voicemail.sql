-- Answering agent: a caller who'd rather just leave a voicemail gets handed to a real beep (the
-- watcher marks the call, hangs up the AI leg, and /api/reception/ended plays the tone). Calling
-- candidates get pay, schedule and location for the jobs they're in process for (never the client's
-- name). And each non-candidate message or voicemail is passed on to Justin's cell.

alter table public.reception_calls
  add column if not exists voicemail_requested boolean not null default false,
  add column if not exists cell_alerted_at timestamptz;

create or replace function public.reception_update(p_secret text, p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.reception_calls set
    live_session_id = coalesce(p->>'live_session_id', live_session_id),
    started_at = case when (p->>'started')::boolean then coalesce(started_at, now()) else started_at end,
    ended_at = case when (p->>'ended')::boolean then coalesce(ended_at, now()) else ended_at end,
    duration_seconds = coalesce((p->>'duration_seconds')::int, duration_seconds),
    status = coalesce(p->>'status', status),
    process_state = coalesce(p->>'process_state', process_state),
    process_note = coalesce(p->>'process_note', process_note),
    voicemail_requested = voicemail_requested or coalesce((p->>'voicemail')::boolean, false),
    cell_alerted_at = case when (p->>'cell_alerted')::boolean then coalesce(cell_alerted_at, now()) else cell_alerted_at end
  where id = p_id;
end $$;

create or replace function public.reception_get(p_secret text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select r.context || jsonb_build_object('id', r.id, 'status', r.status, 'live_session_id', r.live_session_id,
                                                 'started_at', r.started_at, 'ended_at', r.ended_at, 'call_sid', r.call_sid,
                                                 'voicemail_requested', r.voicemail_requested,
                                                 'cell_alerted_at', r.cell_alerted_at)
            from public.reception_calls r where r.id = p_id);
end $$;

-- The watcher, mid-call, when the assistant hands the caller to voicemail (same session check as the report).
create or replace function public.reception_mark_voicemail(p_id uuid, p_session text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_session is null or length(p_session) < 20 then return false; end if;
  update public.reception_calls set voicemail_requested = true
   where id = p_id and live_session_id = p_session and ended_at is null and started_at > now() - interval '1 hour';
  return found;
end $$;
revoke execute on function public.reception_mark_voicemail(uuid, text) from public;
grant execute on function public.reception_mark_voicemail(uuid, text) to anon, authenticated;

create or replace function public.reception_open(p_secret text, p_sid text, p_from text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k text := public.phone_key(p_from);
  cand public.candidates; con record; ctx jsonb; rid uuid; mkt uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if length(k) = 10 then
    select * into cand from public.candidates c where public.phone_key(c.phone) = k order by c.updated_at desc limit 1;
    select ct.id, ct.full_name, co.name as company, co.market_id into con
      from public.contacts ct left join public.companies co on co.id = ct.company_id
     where public.phone_key(ct.phone) = k order by ct.created_at desc limit 1;
  end if;
  mkt := coalesce(cand.source_market_id, con.market_id, (select m.id from public.markets m order by m.created_at limit 1));
  ctx := jsonb_build_object(
    'from', p_from,
    'owner', length(k) = 10 and exists (select 1 from public.staff s where s.role = 'owner' and s.active and public.phone_key(s.phone) = k),
    'candidate_name', cand.full_name,
    'contact_name', con.full_name,
    'contact_company', con.company,
    'candidate_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('title', j.title, 'stage', x.stage, 'location', j.location,
                                          'pay', j.compensation, 'schedule', j.schedule))
        from public.candidate_jobs x join public.jobs j on j.id = x.job_id
       where x.candidate_id = cand.id and x.stage not in ('placed', 'passed', 'withdrawn', 'couldnt_contact')), '[]'::jsonb),
    'public_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('title', j.title, 'location', j.location, 'pay', j.compensation, 'schedule', j.schedule,
                                          'about', left(coalesce(nullif(j.candidate_description, ''), j.description), 600))
                       order by j.priority nulls last, j.opened_on desc nulls last)
        from public.jobs j where j.status = 'open' and j.visibility = 'public'), '[]'::jsonb));
  insert into public.reception_calls (call_sid, from_number, candidate_id, contact_id, market_id, context)
  values (nullif(p_sid, ''), p_from, cand.id, con.id, mkt, ctx)
  on conflict (call_sid) do update set context = excluded.context
  returning id into rid;
  return ctx || jsonb_build_object('id', rid);
end $$;

-- Same as before, except a call that ended in a voicemail keeps the voicemail on its activity.
create or replace function public.reception_complete(p_secret text, p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reception_calls; item uuid; who text;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into r from public.reception_calls where id = p_id;
  who := coalesce(nullif(p->>'caller_name', ''), r.context->>'candidate_name', r.context->>'contact_name', r.from_number, 'unknown caller');
  if coalesce((p->>'needs_callback')::boolean, true) then
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, market_id)
    values ('task', 'Call back ' || who || coalesce(' (' || nullif(p->>'company', '') || ')', ''),
            coalesce(p->>'summary', '') || coalesce(E'\nNumber: ' || coalesce(nullif(p->>'callback_number', ''), r.from_number), '')
              || coalesce(E'\nBest time: ' || nullif(p->>'best_time', ''), ''),
            least(greatest(coalesce((p->>'priority')::int, 2), 1), 3), r.candidate_id, r.contact_id, r.market_id)
    returning id into item;
  end if;
  update public.reception_calls set status = 'completed', process_state = 'done', process_note = null,
         notes = p - 'transcript', transcript = p->'transcript', summary = p->>'summary', action_item_id = item
   where id = p_id;
  update public.activities set summary = 'Call from ' || who || ' (answered by the AI assistant)',
         body = p->>'summary', external_status = 'completed', duration_seconds = r.duration_seconds
   where external_id = r.call_sid and summary not like 'Voicemail from %';
  if r.candidate_id is null and r.contact_id is null and nullif(p->>'caller_name', '') is not null then
    perform public.link_caller_calls(c.id) from public.candidates c
     where lower(trim(c.full_name)) = lower(trim(p->>'caller_name')) limit 1;
  end if;
end $$;

-- For passing a voicemail on to Justin's cell: who left it and whether they're a candidate.
create or replace function public.twilio_voicemail_info(p_secret text, p_sid text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.activities%rowtype;
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then raise exception 'unauthorized'; end if;
  select * into a from public.activities where external_id = p_sid and kind = 'call' and direction = 'in';
  if not found then return null; end if;
  return jsonb_build_object(
    'who', coalesce(substring(a.summary from '^Voicemail from (.*)$'), substring(a.summary from '^Call from (.*)$')),
    'number', a.phone_number,
    'candidate', a.candidate_id is not null,
    'client_contact', a.contact_id is not null);
end $$;
revoke execute on function public.twilio_voicemail_info(text, text) from public;
grant execute on function public.twilio_voicemail_info(text, text) to anon, authenticated;
