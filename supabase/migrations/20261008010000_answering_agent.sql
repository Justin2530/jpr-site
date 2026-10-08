-- The answering agent: an AI receptionist on JPR's business line, separate from the screening agent.
-- Off by default (calls keep ringing Justin); a call from Justin's own cell always reaches it, so he can
-- test it. A candidate calling back about the one job we're working them for is handed to the
-- screening agent instead, and that call runs as a normal screening.
alter table public.automation_settings add column if not exists ai_receptionist boolean not null default false;

create or replace function public.set_ai_receptionist(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings set ai_receptionist = p_on where id;
end $$;
revoke execute on function public.set_ai_receptionist(boolean) from public, anon;
grant execute on function public.set_ai_receptionist(boolean) to authenticated;

-- A screening the candidate started by calling us (the assistant greets them instead of dialing out).
alter table public.screening_runs add column if not exists inbound boolean not null default false;

create table if not exists public.reception_calls (
  id uuid primary key default gen_random_uuid(),
  call_sid text unique,
  from_number text,
  candidate_id uuid references public.candidates (id),
  contact_id uuid references public.contacts (id),
  market_id uuid references public.markets (id),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  live_session_id text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  process_state text check (process_state in ('pending', 'processing', 'done', 'failed')),
  process_attempts integer not null default 0,
  process_claimed_at timestamptz,
  process_note text,
  transcript jsonb,
  notes jsonb,
  summary text,
  watch_note jsonb,
  action_item_id uuid references public.action_items (id),
  created_at timestamptz not null default now()
);
alter table public.reception_calls enable row level security;
create policy "market access" on public.reception_calls for select to authenticated
  using (market_id is null and public.is_owner() or public.can_access_market(market_id));

-- Where an incoming call goes. owner: Justin's own cell is calling (the test line). screen_cj: the caller
-- is a candidate we're actively working for exactly one job and haven't screened yet.
create or replace function public.reception_route(p_secret text, p_from text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text := public.phone_key(p_from); cj uuid; n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if length(k) = 10 then
    select count(*), min(x.id::text)::uuid into n, cj
      from public.candidate_jobs x join public.candidates c on c.id = x.candidate_id
     where public.phone_key(c.phone) = k
       and x.stage in ('applied', 'assigned', 'contacting', 'conversation')
       and (exists (select 1 from public.pursuits p where p.candidate_job_id = x.id and p.status = 'active')
            or exists (select 1 from public.screening_runs r where r.candidate_job_id = x.id and r.status = 'scheduled'))
       and not exists (select 1 from public.screening_runs r where r.candidate_job_id = x.id and r.status = 'completed');
  end if;
  return jsonb_build_object(
    'owner', length(k) = 10 and exists (select 1 from public.staff s where s.role = 'owner' and s.active and public.phone_key(s.phone) = k),
    'receptionist_on', coalesce((select ai_receptionist from public.automation_settings), false),
    'screen_cj', case when n = 1 then cj end);
end $$;

-- Hand a calling candidate to the screening agent: a screening run that's already live.
create or replace function public.reception_start_screening(p_secret text, p_cj uuid, p_sid text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare run uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.screening_runs set status = 'cancelled', ended_at = now(),
         summary = coalesce(summary || ' ', '') || '(They called in first.)'
   where candidate_job_id = p_cj and status = 'scheduled';
  insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, dial_started_at, call_sid,
                                     answered_by, inbound, purpose, summary)
  values (p_cj, 'in_progress', 'phone', now(), now(), p_sid, 'answered', true, 'screening', 'They called in')
  returning id into run;
  return run;
end $$;

create or replace function public.screening_run_inbound(p_secret text, p_run uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((select inbound from public.screening_runs where id = p_run), false);
end $$;

-- Open a receptionist call: who's calling (as far as caller ID tells) and only what the receptionist may
-- use: the caller's own active jobs by title, and JPR's public openings. Nothing confidential.
create or replace function public.reception_open(p_secret text, p_sid text, p_from text) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
      select jsonb_agg(jsonb_build_object('title', j.title, 'stage', x.stage))
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

create or replace function public.reception_get(p_secret text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select r.context || jsonb_build_object('id', r.id, 'status', r.status, 'live_session_id', r.live_session_id,
                                                 'started_at', r.started_at, 'ended_at', r.ended_at, 'call_sid', r.call_sid)
            from public.reception_calls r where r.id = p_id);
end $$;

-- p: live_session_id, started, ended, duration_seconds, status, process_state, process_note.
create or replace function public.reception_update(p_secret text, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.reception_calls set
    live_session_id = coalesce(p->>'live_session_id', live_session_id),
    started_at = case when (p->>'started')::boolean then coalesce(started_at, now()) else started_at end,
    ended_at = case when (p->>'ended')::boolean then coalesce(ended_at, now()) else ended_at end,
    duration_seconds = coalesce((p->>'duration_seconds')::int, duration_seconds),
    status = coalesce(p->>'status', status),
    process_state = coalesce(p->>'process_state', process_state),
    process_note = coalesce(p->>'process_note', process_note)
  where id = p_id;
end $$;

-- The call watcher's diagnostics (same shape as screening_watch_report).
create or replace function public.reception_watch_report(p_id uuid, p_session text, p_note jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_session is null or length(p_session) < 20 or length(p_note::text) > 20000 then return false; end if;
  update public.reception_calls
     set watch_note = coalesce(watch_note, '{}'::jsonb) || jsonb_strip_nulls(p_note)
   where id = p_id and live_session_id = p_session and started_at > now() - interval '1 hour';
  return found;
end $$;

-- Next finished call to write up (one at a time, retried a few times).
create or replace function public.reception_to_process(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.reception_calls set process_state = 'processing', process_claimed_at = now(), process_attempts = process_attempts + 1
   where id = (select id from public.reception_calls
                where ended_at is not null and live_session_id is not null and process_attempts < 4
                  and (process_state = 'pending' or (process_state = 'processing' and process_claimed_at < now() - interval '10 minutes'))
                order by ended_at limit 1 for update skip locked)
  returning id into rid;
  if rid is null then return null; end if;
  return public.reception_get(p_secret, rid);
end $$;

-- File the write-up: on the call, on the caller's timeline, and as a "call back" task for Justin.
create or replace function public.reception_complete(p_secret text, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
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
   where external_id = r.call_sid;
end $$;
