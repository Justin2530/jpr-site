-- Recruiting Flow Playbook V1, step 1 (Justin, 2026-10-07): the new outreach cadence.
-- Day 0 text + email, day 1 email, day 3 AI call, day 5 email, day 8 text, day 12 AI call, day 14
-- close-the-loop email, day 16 Couldn't contact. Follow-up emails reply in the day 0 email's thread.
-- The opening line follows how the candidate came in (picked at assign). Texts go 9am to 9pm Eastern.
-- Everything here is additive: the old followup_steps table stays as it was, unused.

-- Justin, 2026-10-07: only candidates added after the V1 build can ever be automated. The cutoff starts
-- over: it is set the next time the master switch is turned on, and never moves after that.
alter table public.automation_settings add column if not exists eligible_after_v1 timestamptz;

create or replace function public.set_automated_recruiting(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings
     set automated_recruiting = p_on,
         eligible_after = case when p_on then coalesce(eligible_after, now()) else eligible_after end,
         eligible_after_v1 = case when p_on then coalesce(eligible_after_v1, now()) else eligible_after_v1 end,
         changed_at = now(), changed_by = auth.uid()
   where id;
end $$;

-- The per-job switch, with the V1 cutoff. Returns 'on' or 'off', or why it couldn't turn on.
create or replace function public.set_outreach(p_candidate_job_id uuid, p_on boolean, p_purpose text default 'screening')
returns text language plpgsql security definer set search_path = '' as $$
declare mkt uuid; added timestamptz; cfg public.automation_settings; p public.pursuits; pid uuid;
begin
  select j.market_id, c.created_at into mkt, added
    from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
   where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  select * into p from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active';

  if not p_on then
    if p.id is not null and p.paused_at is null then
      update public.pursuits set paused_at = now() where id = p.id;
    end if;
    return 'off';
  end if;

  select * into cfg from public.automation_settings;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after_v1 is null then return 'master_off'; end if;
  if added < cfg.eligible_after_v1 then return 'existing'; end if;

  if p.id is not null then
    if p.paused_at is not null then
      update public.pursuit_steps
         set due_at = public.next_send_time(greatest(due_at + (now() - p.paused_at), now()), channel)
       where pursuit_id = p.id and status = 'pending';
      update public.pursuits set paused_at = null where id = p.id;
    end if;
    return 'on';
  end if;
  pid := public.start_pursuit(p_candidate_job_id, p_purpose);
  return case when pid is null then 'unavailable' else 'on' end;
end $$;

-- How the candidate came to this job, picked at assign. Null = read it from the candidate's source.
alter table public.candidate_jobs add column if not exists outreach_source text
  check (outreach_source in ('indeed', 'applied', 'linkedin', 'referral', 'other'));

-- AI calls made as part of outreach (days 3 and 12) open differently from booked screening calls.
alter table public.screening_runs add column if not exists purpose text not null default 'screening'
  check (purpose in ('screening', 'outreach'));

alter table public.pursuit_steps add column if not exists in_thread boolean not null default false;

-- The V1 cadence, editable without code. {first_name} {job_title} {near_town} {opener} {job_details}
-- {signature} are filled in when it sends. channel 'call' books an AI call; 'close' ends the run.
create table if not exists public.cadence_steps (
  id uuid primary key default gen_random_uuid(),
  purpose text not null default 'screening',
  step_no integer not null,
  day_offset numeric not null default 0,
  channel text not null check (channel in ('sms', 'email', 'call', 'close')),
  in_thread boolean not null default false,
  subject text,
  body text not null default '',
  active boolean not null default true,
  unique (purpose, step_no)
);
alter table public.cadence_steps enable row level security;
create policy "staff read cadence" on public.cadence_steps for select to authenticated using (public.is_staff());
create policy "owner edits cadence" on public.cadence_steps for all to authenticated using (public.is_owner()) with check (public.is_owner());
grant select, insert, update, delete on public.cadence_steps to authenticated;

insert into public.cadence_steps (purpose, step_no, day_offset, channel, in_thread, subject, body) values
('screening', 1, 0, 'sms', false, null,
 'Hi {first_name}, this is Justin with JPR. {opener} When would be a good time for a quick call to go over the position? Reply STOP to opt out.'),
('screening', 2, 0, 'email', false, '{job_title}{near_town}',
 E'Hi {first_name},\n\nThis is Justin with JPR. {opener}\n\n{job_details}When would be a good time for a quick call to go over the position? You can reply here, or call or text me at (814) 845-4341.\n\nThanks!\n\n{signature}'),
('screening', 3, 1, 'email', true, null,
 E'Hi {first_name},\n\nI''m just following up to see if you''re still interested in the {job_title} position. If so, when would be a good time to hop on a quick call? If you''re no longer interested, just let me know.\n\nThanks!\n\n{signature}'),
('screening', 4, 3, 'call', false, null, ''),
('screening', 5, 5, 'email', true, null,
 E'Hey {first_name},\n\nI just wanted to follow up again on this position to see if you''re still interested. Let me know either way.\n\nThanks!\n\n{signature}'),
('screening', 6, 8, 'sms', false, null,
 'Hi {first_name}, this is Justin with JPR again. I just wanted to reach out and see if you were still interested in the {job_title} position. Let me know either way. Thanks.'),
('screening', 7, 12, 'call', false, null, ''),
('screening', 8, 14, 'email', true, null,
 E'Hey {first_name},\n\nI just wanted to reach out to you one last time regarding the {job_title} position. If I don''t hear back from you in a day or two, I''ll take you off the list of interested candidates.\n\nThanks, have a great day!\n\n{signature}'),
('screening', 9, 16, 'close', false, null, '')
on conflict (purpose, step_no) do nothing;

-- Texts: any day, 9am to 9pm Eastern (was 8am). Emails any time. Calls and the close step keep
-- Monday-Saturday 9am-7pm (the one-argument version).
create or replace function public.next_send_time(t timestamptz, p_channel text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare l timestamp := t at time zone 'America/New_York';
begin
  if p_channel = 'email' then return t; end if;
  if p_channel <> 'sms' then return public.next_send_time(t); end if;
  if l::time < time '09:00' then l := date_trunc('day', l) + interval '9 hours';
  elsif l::time >= time '21:00' then l := date_trunc('day', l) + interval '1 day 9 hours';
  end if;
  return l at time zone 'America/New_York';
end $$;

-- Start outreach from the V1 cadence.
create or replace function public.start_pursuit(p_candidate_job_id uuid, p_purpose text default 'screening') returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid; mkt uuid; added timestamptz; cfg public.automation_settings;
begin
  select * into cfg from public.automation_settings;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after_v1 is null then return null; end if;
  select j.market_id, c.created_at into mkt, added
    from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
   where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if added < cfg.eligible_after_v1 then return null; end if;  -- existing candidates are never automated
  if exists (select 1 from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active') then
    return null;
  end if;
  insert into public.pursuits (candidate_job_id, purpose, started_by) values (p_candidate_job_id, p_purpose, auth.uid()) returning id into pid;
  insert into public.pursuit_steps (pursuit_id, step_no, channel, in_thread, subject, body, due_at)
  select pid, s.step_no, s.channel, s.in_thread, s.subject, s.body, public.next_send_time(now() + s.day_offset * interval '1 day', s.channel)
    from public.cadence_steps s where s.purpose = p_purpose and s.active;
  if p_purpose = 'screening' then
    update public.candidate_jobs set stage = 'contacting' where id = p_candidate_job_id and stage in ('applied', 'assigned', 'couldnt_contact');
  end if;
  return pid;
end $$;

-- What the app needs to send a due step. Calls and the close step are handled in the database, so
-- the app gets them only to report back (automation_step_done does the work).
create or replace function public.automation_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return '[]'::jsonb; end if;
  with due as (
    select ps.id from public.pursuit_steps ps join public.pursuits p on p.id = ps.pursuit_id
      join public.candidate_jobs cj on cj.id = p.candidate_job_id join public.candidates cand on cand.id = cj.candidate_id
     where p.status = 'active' and p.paused_at is null and ps.due_at <= now()
       and cand.created_at >= (select eligible_after_v1 from public.automation_settings)
       and (ps.status = 'pending' or (ps.status = 'sending' and ps.claimed_at < now() - interval '10 minutes'))
     order by ps.due_at limit 20 for update of ps skip locked),
  claimed as (
    update public.pursuit_steps ps set status = 'sending', claimed_at = now() from due where ps.id = due.id returning ps.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'step_id', c.id, 'channel', c.channel, 'in_thread', c.in_thread, 'subject', c.subject, 'body', c.body, 'step_no', c.step_no,
      'candidate_job_id', cj.id, 'candidate_id', cand.id, 'job_id', j.id, 'company_id', j.company_id, 'market_id', j.market_id,
      'full_name', cand.full_name, 'phone', cand.phone, 'email', cand.email, 'sms_opted_out', cand.sms_opted_out_at is not null,
      'source', coalesce(cj.outreach_source, case cand.source when 'indeed' then 'indeed' when 'linkedin' then 'linkedin'
                          when 'website' then 'applied' when 'inbound' then 'applied' when 'referral' then 'referral' else 'other' end),
      'job_title', j.title, 'location', j.location, 'compensation', j.compensation, 'schedule', j.schedule,
      'job_summary', left(nullif(j.candidate_description, ''), 1500),
      -- The thread to reply in: the first email this run sent, and its subject.
      'thread_id', (select a.external_thread_id from public.pursuit_steps x join public.activities a on a.id = x.activity_id
                     where x.pursuit_id = c.pursuit_id and x.channel = 'email' and x.status = 'sent' and a.external_thread_id is not null
                     order by x.step_no limit 1),
      'thread_subject', (select regexp_replace(a.summary, '^Automatic email to [^:]*: ', '') from public.pursuit_steps x
                          join public.activities a on a.id = x.activity_id
                         where x.pursuit_id = c.pursuit_id and x.channel = 'email' and x.status = 'sent'
                         order by x.step_no limit 1),
      'sender_staff_id', coalesce(p.started_by, cj.assigned_by),
      'gmail_email', g.email, 'gmail_token', g.token_enc)), '[]'::jsonb) into out
    from claimed c
    join public.pursuits p on p.id = c.pursuit_id
    join public.candidate_jobs cj on cj.id = p.candidate_job_id
    join public.candidates cand on cand.id = cj.candidate_id
    join public.jobs j on j.id = cj.job_id
    left join public.google_accounts g on g.staff_id = coalesce(p.started_by, cj.assigned_by);
  return out;
end $$;

-- Record a step. A text or email is logged on the history. A call step books an outreach AI call
-- right now (unless a call is already booked or running). The close step moves the candidate to
-- Couldn't contact. A run that ends with no reply and no close step still lands on What needs me.
create or replace function public.automation_step_done(p_secret text, p_step uuid, p_status text, p_note text,
  p_summary text, p_body text, p_external_id text, p_thread_id text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.pursuit_steps; pu public.pursuits; cj record; act uuid; v_status text := p_status; v_note text := p_note;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into st from public.pursuit_steps where id = p_step;
  select * into pu from public.pursuits where id = st.pursuit_id;
  select c.candidate_id, c.job_id, c.stage, j.company_id, j.market_id, j.title, cand.full_name into cj
    from public.candidate_jobs c join public.jobs j on j.id = c.job_id join public.candidates cand on cand.id = c.candidate_id
   where c.id = pu.candidate_job_id;
  if st.channel = 'call' and p_status = 'sent' then
    if exists (select 1 from public.screening_runs where candidate_job_id = pu.candidate_job_id and status in ('scheduled', 'in_progress')) then
      v_status := 'skipped'; v_note := 'a call was already booked';
    else
      insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary, purpose)
      values (pu.candidate_job_id, 'scheduled', 'phone', now(), 'Outreach call (day ' || st.step_no || ' of the cadence)', 'outreach');
    end if;
  elsif st.channel = 'close' and p_status = 'sent' then
    update public.candidate_jobs set stage = 'couldnt_contact' where id = pu.candidate_job_id and stage in ('assigned', 'contacting');
  elsif p_status = 'sent' then
    insert into public.activities (kind, direction, summary, body, candidate_id, job_id, candidate_job_id, market_id,
                                   external_id, external_thread_id, external_status, phone_number)
    values (case when st.channel = 'sms' then 'text' else 'email' end, 'out', p_summary, p_body, cj.candidate_id, cj.job_id, pu.candidate_job_id,
            cj.market_id, nullif(p_external_id, ''), nullif(p_thread_id, ''), 'sent', nullif(p_phone, ''))
    returning id into act;
  end if;
  update public.pursuit_steps set status = v_status, sent_at = case when v_status = 'sent' then now() end,
         note = v_note, activity_id = act where id = p_step;
  if (select p.status from public.pursuits p where p.id = pu.id) = 'active'
     and not exists (select 1 from public.pursuit_steps where pursuit_id = pu.id and status in ('pending', 'sending')) then
    update public.pursuits set status = 'finished', ended_at = now(),
           end_reason = case when st.channel = 'close' then 'couldn''t contact' else 'no response' end
     where id = pu.id;
    if st.channel <> 'close' then
      insert into public.action_items (kind, title, detail, priority, candidate_id, job_id, candidate_job_id, company_id, market_id)
      values ('task', 'No response: ' || cj.full_name,
              'Automated outreach about ' || cj.title || ' got no reply. Call them yourself, or move them to Passed.',
              2, cj.candidate_id, cj.job_id, pu.candidate_job_id, cj.company_id, cj.market_id);
    end if;
  end if;
end $$;

-- Any response stops the chasing, including from someone already in Couldn't contact.
create or replace function public.pursuit_stop_on_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' and new.candidate_id is not null and new.kind in ('text', 'email', 'call') then
    perform public.stop_pursuits(new.candidate_id, 'they responded (' || new.kind || ')');
    update public.candidate_jobs set stage = 'conversation'
     where candidate_id = new.candidate_id and stage in ('contacting', 'couldnt_contact');
  end if;
  return new;
end $$;

-- Picking up an AI call counts as a response too: once a call is written up, outreach for that job stops.
create or replace function public.pursuit_stop_on_call() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cand uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select candidate_id into cand from public.candidate_jobs where id = new.candidate_job_id;
    perform public.stop_pursuits(cand, 'they picked up the AI call', new.candidate_job_id);
    update public.candidate_jobs set stage = 'conversation' where id = new.candidate_job_id and stage in ('contacting', 'couldnt_contact');
  end if;
  return new;
end $$;
create trigger screening_runs_stop_pursuits after update of status on public.screening_runs
  for each row execute function public.pursuit_stop_on_call();

-- The reply brain answers people in Couldn't contact too, and only while automated recruiting is on.
create or replace function public.brain_job_for(p_candidate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.candidate_job_id
    from public.pursuits p join public.candidate_jobs cj on cj.id = p.candidate_job_id
   where cj.candidate_id = p_candidate and p.purpose = 'screening' and p.started_at > now() - interval '30 days'
     and cj.stage in ('contacting', 'conversation', 'couldnt_contact')
     and not exists (select 1 from public.screening_runs r where r.candidate_job_id = p.candidate_job_id
                      and r.status in ('in_progress', 'completed'))
   order by p.started_at desc limit 1;
$$;

create or replace function public.brain_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  -- Switched off: nothing automatic goes out. Replies stay on What needs me for Justin.
  if not exists (select 1 from public.automation_settings where automated_recruiting) then
    update public.activities set brain_status = null where brain_status = 'pending';
    return '[]'::jsonb;
  end if;
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
      'booked_for', (select to_char(r.scheduled_for at time zone 'America/New_York', 'FMDay, Mon FMDD at FMHH12:MI AM')
                       from public.screening_runs r where r.candidate_job_id = cj.id and r.status = 'scheduled'
                      order by r.created_at desc limit 1),
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
  update public.activities set brain_status = null
   where brain_status = 'working' and candidate_id is not null and public.brain_job_for(candidate_id) is null;
  return out;
end $$;

-- The call's context carries its purpose, so an outreach call opens with "are you still interested?".
create or replace function public.screening_context(p_run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'run_id', r.id, 'purpose', r.purpose, 'candidate_job_id', cj.id, 'stage', cj.stage, 'status', r.status,
    'call_sid', r.call_sid, 'live_session_id', r.live_session_id, 'answered_by', r.answered_by,
    'ended_at', r.ended_at, 'dial_started_at', r.dial_started_at,
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
