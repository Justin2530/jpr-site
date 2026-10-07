-- Recruiting Flow Playbook V1, steps 6 to 9 (Justin, 2026-10-07).
-- 6. A client who hasn't answered a submission in 3 business days gets one follow-up in the submission
--    thread; still nothing 2 business days later puts "call them" on What needs me.
-- 7. Interview scheduling relay between the client and the candidate, a reminder to the candidate the day
--    before, and a check-in to the client at 3pm the next business day. Anything flagged to Justin turns
--    that candidate's automation switch off until he turns it back on.
-- 8. Offers and counteroffers. No offer terms ever reach anyone without Justin's click. Accepted moves the
--    candidate to Placed, and the day before the start they get a good-luck text.
-- 9. Pilot: while "pilot only" is on (the default), automation runs only on jobs marked as the pilot.
-- Nothing here sends while the master Automated recruiting switch is off, and only candidates added after
-- the V1 cutoff are ever automated.

-- ---- The candidate's own automation switch, and the pilot -----------------------------------------------

alter table public.candidates add column if not exists automation_paused_at timestamptz;
alter table public.candidates add column if not exists automation_paused_reason text;
alter table public.automation_settings add column if not exists pilot_only boolean not null default true;
alter table public.jobs add column if not exists automation_pilot boolean not null default false;

-- Whether anything automatic may go to this candidate about this job right now.
create or replace function public.automation_allowed(p_cj uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.automated_recruiting and s.eligible_after_v1 is not null and c.created_at >= s.eligible_after_v1
           and c.automation_paused_at is null and (not s.pilot_only or j.automation_pilot)
      from public.automation_settings s
      cross join public.candidate_jobs cj
      join public.candidates c on c.id = cj.candidate_id
      join public.jobs j on j.id = cj.job_id
     where cj.id = p_cj), false);
$$;
revoke execute on function public.automation_allowed(uuid) from public, anon;
grant execute on function public.automation_allowed(uuid) to authenticated;

-- Flagging something to Justin turns the candidate's automation off: outreach pauses where it is, the
-- reply brain and the client relay leave them alone, and their messages land on What needs me.
create or replace function public.pause_candidate(p_candidate uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.candidates set automation_paused_at = now(), automation_paused_reason = left(p_reason, 300)
   where id = p_candidate and automation_paused_at is null;
  update public.pursuits set paused_at = now()
   where status = 'active' and paused_at is null
     and candidate_job_id in (select id from public.candidate_jobs where candidate_id = p_candidate);
end $$;
revoke execute on function public.pause_candidate(uuid, text) from public, anon, authenticated;

-- Justin's switch on the candidate. On picks paused outreach back up (only what the pause stopped).
create or replace function public.set_candidate_automation(p_candidate uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare since timestamptz;
begin
  if not public.is_staff() then raise exception 'not allowed'; end if;
  if not p_on then
    perform public.pause_candidate(p_candidate, 'Turned off by hand');
    return;
  end if;
  select automation_paused_at into since from public.candidates where id = p_candidate;
  if since is null then return; end if;
  update public.pursuit_steps ps
     set due_at = public.next_send_time(greatest(ps.due_at + (now() - p.paused_at), now()), ps.channel)
    from public.pursuits p
   where p.id = ps.pursuit_id and ps.status = 'pending' and p.status = 'active' and p.paused_at >= since
     and p.candidate_job_id in (select id from public.candidate_jobs where candidate_id = p_candidate);
  update public.pursuits set paused_at = null
   where status = 'active' and paused_at >= since
     and candidate_job_id in (select id from public.candidate_jobs where candidate_id = p_candidate);
  update public.candidates set automation_paused_at = null, automation_paused_reason = null where id = p_candidate;
end $$;
revoke execute on function public.set_candidate_automation(uuid, boolean) from public, anon;
grant execute on function public.set_candidate_automation(uuid, boolean) to authenticated;

-- For the reply brain, which runs with the automation secret.
create or replace function public.automation_pause_candidate(p_secret text, p_candidate uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  perform public.pause_candidate(p_candidate, p_reason);
end $$;
revoke execute on function public.automation_pause_candidate(text, uuid, text) from public, anon, authenticated;
grant execute on function public.automation_pause_candidate(text, uuid, text) to anon, authenticated;

create or replace function public.set_pilot_only(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings set pilot_only = p_on where id;
end $$;
revoke execute on function public.set_pilot_only(boolean) from public, anon;
grant execute on function public.set_pilot_only(boolean) to authenticated;

-- Outreach starts only where automation is allowed (adds the pilot and the candidate's switch).
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
  if not public.automation_allowed(p_candidate_job_id) then return null; end if;  -- pilot, or their switch is off
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

-- The reply brain only answers where automation is allowed.
create or replace function public.brain_job_for(p_candidate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.candidate_job_id
    from public.pursuits p join public.candidate_jobs cj on cj.id = p.candidate_job_id
   where cj.candidate_id = p_candidate and p.purpose = 'screening' and p.started_at > now() - interval '30 days'
     and cj.stage in ('contacting', 'conversation', 'couldnt_contact')
     and public.automation_allowed(p.candidate_job_id)
     and not exists (select 1 from public.screening_runs r where r.candidate_job_id = p.candidate_job_id
                      and r.status in ('in_progress', 'completed'))
   order by p.started_at desc limit 1;
$$;

-- ---- Business hours ------------------------------------------------------------------------------------

-- The next moment inside Monday to Friday, 9am to 5pm Eastern (t itself when it already is).
create or replace function public.business_time(t timestamptz) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare l timestamp := t at time zone 'America/New_York';
begin
  loop
    if extract(isodow from l) >= 6 then l := date_trunc('day', l) + interval '1 day 9 hours';
    elsif l::time < time '09:00' then l := date_trunc('day', l) + interval '9 hours';
    elsif l::time >= time '17:00' then l := date_trunc('day', l) + interval '1 day 9 hours';
    else exit;
    end if;
  end loop;
  return l at time zone 'America/New_York';
end $$;

-- t plus n weekdays, same time of day.
create or replace function public.add_business_days(t timestamptz, n integer) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare l timestamp := t at time zone 'America/New_York'; i integer := 0;
begin
  while i < n loop
    l := l + interval '1 day';
    if extract(isodow from l) < 6 then i := i + 1; end if;
  end loop;
  return l at time zone 'America/New_York';
end $$;

-- ---- Step 6: the client follow-up ----------------------------------------------------------------------

alter table public.submissions add column if not exists client_replied_at timestamptz;
alter table public.submissions add column if not exists client_followup_at timestamptz;
alter table public.submissions add column if not exists client_call_reminder_at timestamptz;

-- Any email in from the submission thread counts as the client replying.
create or replace function public.submission_mark_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' and new.kind = 'email' and new.external_thread_id is not null then
    update public.submissions set client_replied_at = new.occurred_at
     where email_thread_id = new.external_thread_id and client_replied_at is null and sent_at <= new.occurred_at;
  end if;
  return new;
end $$;
revoke execute on function public.submission_mark_reply() from public, anon, authenticated;
create trigger activities_submission_reply after insert on public.activities
  for each row execute function public.submission_mark_reply();

-- Who and where for one candidate on one job: the shared part of everything the relay sends.
create or replace function public.relay_context(p_cj uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'candidate_job_id', cj.id, 'stage', cj.stage, 'candidate_id', c.id, 'full_name', c.full_name,
    'phone', c.phone, 'email', c.email, 'sms_opted_out', c.sms_opted_out_at is not null,
    'job_id', j.id, 'job_title', j.title, 'location', j.location,
    'company', coalesce(nullif(co.short_name, ''), regexp_replace(co.name, '(,?\s+(llc|inc\.?|corp\.?|co\.?|ltd\.?))+\s*$', '', 'i')),
    'submission_id', s.id, 'subject', s.subject, 'thread_id', s.email_thread_id, 'sent_at', s.sent_at,
    'contact_id', (select ct.id from public.contacts ct where ct.id = any (s.to_contact_ids) order by array_position(s.to_contact_ids, ct.id) limit 1),
    'contact_name', (select ct.full_name from public.contacts ct where ct.id = any (s.to_contact_ids) order by array_position(s.to_contact_ids, ct.id) limit 1),
    'contact_emails', (select coalesce(jsonb_agg(ct.email), '[]'::jsonb) from public.contacts ct
                        where ct.id = any (s.to_contact_ids) and nullif(trim(ct.email), '') is not null),
    'gmail_email', g.email, 'gmail_token', g.token_enc)
  from public.candidate_jobs cj
  join public.candidates c on c.id = cj.candidate_id
  join public.jobs j on j.id = cj.job_id
  join public.companies co on co.id = j.company_id
  left join lateral (select * from public.submissions x where x.candidate_job_id = cj.id and x.status = 'sent'
                      order by x.sent_at desc limit 1) s on true
  left join public.google_accounts g on g.staff_id = coalesce(s.decided_by, cj.assigned_by)
  where cj.id = p_cj;
$$;
revoke execute on function public.relay_context(uuid) from public, anon, authenticated;

-- Submissions whose follow-up is due now. Claimed as they're returned so nothing sends twice.
create or replace function public.client_followups_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return '[]'::jsonb; end if;
  if public.business_time(now()) > now() then return '[]'::jsonb; end if;
  with claimed as (
    update public.submissions s set client_followup_at = now()
     where s.id in (select x.id from public.submissions x join public.candidate_jobs cj on cj.id = x.candidate_job_id
                     where x.status = 'sent' and x.email_thread_id is not null and x.client_replied_at is null
                       and x.client_followup_at is null and x.client_call_reminder_at is null and cj.stage = 'submitted'
                       and now() >= public.business_time(public.add_business_days(x.sent_at, 3))
                       and public.automation_allowed(cj.id)
                     limit 10 for update of x skip locked)
    returning s.id, s.candidate_job_id)
  select coalesce(jsonb_agg(public.relay_context(c.candidate_job_id) || jsonb_build_object('submission_id', c.id)), '[]'::jsonb)
    into out from claimed c;
  return out;
end $$;
revoke execute on function public.client_followups_due(text) from public, anon, authenticated;
grant execute on function public.client_followups_due(text) to anon, authenticated;

-- Still no answer: 2 business days after the follow-up, or 3 after the submission when automation can't
-- follow up for this candidate, Justin gets a reminder to call them. Nothing is sent.
create or replace function public.client_call_reminders(p_secret text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  for r in
    select s.id, s.sent_at, cj.id cj_id, cj.candidate_id, j.id job_id, j.title, j.company_id, j.market_id, c.full_name,
           (select ct.id from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_id,
           (select ct.full_name from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_name,
           (select ct.phone from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_phone
      from public.submissions s join public.candidate_jobs cj on cj.id = s.candidate_job_id
      join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
     where s.status = 'sent' and s.client_replied_at is null and s.client_call_reminder_at is null and cj.stage = 'submitted'
       and ((s.client_followup_at is not null and now() >= public.business_time(public.add_business_days(s.client_followup_at, 2)))
         or (s.client_followup_at is null and not public.automation_allowed(cj.id)
             and now() >= public.business_time(public.add_business_days(s.sent_at, 3))))
     for update of s skip locked
  loop
    update public.submissions set client_call_reminder_at = now() where id = r.id;
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, job_id, candidate_job_id, company_id, market_id)
    values ('task', 'Call ' || coalesce(r.contact_name, 'the client') || ' about ' || r.full_name,
            'No reply on the ' || r.title || ' submission since ' || to_char(r.sent_at at time zone 'America/New_York', 'Mon FMDD') ||
              coalesce(' · ' || r.contact_phone, '') || '.',
            1, r.candidate_id, r.contact_id, r.job_id, r.cj_id, r.company_id, r.market_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.client_call_reminders(text) from public, anon, authenticated;
grant execute on function public.client_call_reminders(text) to anon, authenticated;

-- ---- Steps 7 and 8: interviews, offers, and messages waiting on Justin ---------------------------------

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  status text not null default 'proposing' check (status in ('proposing', 'confirmed', 'done', 'cancelled')),
  waiting_on text check (waiting_on in ('candidate', 'client')),
  client_times text[] not null default '{}',  -- 'YYYY-MM-DD HH:MM' Eastern, as the client offered them
  details text,                                -- where, how, who to ask for
  rounds integer not null default 1,
  scheduled_at timestamptz,
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,
  checkin_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interviews_cj_idx on public.interviews (candidate_job_id, created_at desc);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  status text not null default 'review'
    check (status in ('review', 'confirm_asked', 'ready', 'sent', 'countered', 'accepted', 'declined', 'withdrawn')),
  waiting_on text check (waiting_on in ('justin', 'candidate', 'client')),
  clear boolean not null default false,  -- a clear, formal offer (Send offer) vs one that needs checking
  terms text not null default '',        -- the exact terms, as Justin will send them
  pay text,
  start_date date,
  source_message_id text,                -- the client's email, for any offer PDF attached to it
  rounds integer not null default 0,     -- counteroffer rounds
  sent_at timestamptz,
  decided_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offers_cj_idx on public.offers (candidate_job_id, created_at desc);

-- Offer-carrying messages (counteroffers, either way) wait here for Justin's click.
create table if not exists public.relay_messages (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  offer_id uuid references public.offers (id) on delete cascade,
  to_party text not null check (to_party in ('candidate', 'client')),
  subject text,
  body text not null,
  status text not null default 'awaiting' check (status in ('awaiting', 'sent', 'cancelled')),
  decided_by uuid references public.staff (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists relay_messages_cj_idx on public.relay_messages (candidate_job_id, created_at desc);

alter table public.placements add column if not exists start_text_sent_at timestamptz;

create trigger interviews_touch before update on public.interviews for each row execute function public.touch_updated_at();
create trigger offers_touch before update on public.offers for each row execute function public.touch_updated_at();

alter table public.interviews enable row level security;
alter table public.offers enable row level security;
alter table public.relay_messages enable row level security;
do $$
declare t text;
begin
  foreach t in array array['interviews', 'offers', 'relay_messages'] loop
    execute format($p$create policy "market access" on public.%I for all to authenticated
      using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                     where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
      with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                     where cj.id = candidate_job_id and public.can_access_market(j.market_id)))$p$, t);
  end loop;
end $$;
grant select, insert, update, delete on public.interviews, public.offers, public.relay_messages to authenticated;

-- Which job a candidate's message is about while the relay is waiting on them.
create or replace function public.relay_job_for(p_candidate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.cj from (
    select i.candidate_job_id cj, i.updated_at at from public.interviews i join public.candidate_jobs cj on cj.id = i.candidate_job_id
     where cj.candidate_id = p_candidate and cj.stage in ('submitted', 'interviewing')
       and (i.status = 'proposing' or (i.status = 'confirmed' and i.scheduled_at > now() - interval '1 day'))
    union all
    select o.candidate_job_id, o.updated_at from public.offers o join public.candidate_jobs cj on cj.id = o.candidate_job_id
     where cj.candidate_id = p_candidate and cj.stage in ('interviewing', 'offer') and o.status in ('sent', 'countered')
  ) x order by x.at desc limit 1;
$$;
revoke execute on function public.relay_job_for(uuid) from public, anon, authenticated;

-- Messages the relay should read: a client's email on a submission thread, or a candidate's text or email
-- while the relay is waiting on them. A client's email is never treated as the candidate replying.
alter table public.activities add column if not exists relay_status text;  -- pending | working | done | escalated | skipped
alter table public.activities add column if not exists relay_note text;
alter table public.activities add column if not exists relay_claimed_at timestamptz;

create or replace function public.relay_mark() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction is distinct from 'in' or new.kind not in ('text', 'email') then return new; end if;
  if new.contact_id is not null then
    new.brain_status := null;
    if new.candidate_job_id is not null
       and exists (select 1 from public.candidate_jobs where id = new.candidate_job_id and stage in ('submitted', 'interviewing', 'offer')) then
      new.relay_status := 'pending';
    end if;
  elsif new.candidate_id is not null and new.brain_status is null and public.relay_job_for(new.candidate_id) is not null then
    new.relay_status := 'pending';
  end if;
  return new;
end $$;
revoke execute on function public.relay_mark() from public, anon, authenticated;
create trigger activities_relay_mark before insert on public.activities for each row execute function public.relay_mark();

-- The messages waiting to be read, each with everything the relay needs to decide and answer.
create or replace function public.relay_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.activities; cj uuid; out jsonb := '[]'::jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  -- Switched off: nothing automatic. The messages stay on What needs me for Justin.
  if not exists (select 1 from public.automation_settings where automated_recruiting) then
    update public.activities set relay_status = null where relay_status = 'pending';
    return out;
  end if;
  for a in
    select * from public.activities
     where relay_status = 'pending' or (relay_status = 'working' and relay_claimed_at < now() - interval '15 minutes')
     order by occurred_at limit 5 for update skip locked
  loop
    cj := case when a.contact_id is not null then a.candidate_job_id else public.relay_job_for(a.candidate_id) end;
    if cj is null or not public.automation_allowed(cj) then
      update public.activities set relay_status = 'skipped' where id = a.id;
      continue;
    end if;
    update public.activities set relay_status = 'working', relay_claimed_at = now() where id = a.id;
    out := out || jsonb_build_array(public.relay_context(cj) || jsonb_build_object(
      'activity_id', a.id, 'from', case when a.contact_id is not null then 'client' else 'candidate' end,
      'channel', a.kind, 'body', left(coalesce(a.body, a.summary), 6000), 'message_id', a.external_id,
      'message_thread_id', a.external_thread_id, 'from_phone', a.phone_number,
      'interview', (select to_jsonb(i) from public.interviews i where i.candidate_job_id = cj and i.status <> 'cancelled'
                     order by i.created_at desc limit 1),
      'offer', (select to_jsonb(o) from public.offers o where o.candidate_job_id = cj and o.status not in ('accepted', 'declined', 'withdrawn')
                 order by o.created_at desc limit 1),
      'history', (select coalesce(jsonb_agg(h order by h.at), '[]'::jsonb) from (
                    select x.occurred_at at, x.kind, x.direction, case when x.contact_id is not null then 'client' else 'candidate' end who,
                           left(coalesce(x.body, x.summary), 800) text
                      from public.activities x
                     where x.candidate_job_id = cj and x.kind in ('text', 'email', 'call') and x.id <> a.id
                     order by x.occurred_at desc limit 10) h)));
  end loop;
  return out;
end $$;
revoke execute on function public.relay_pending(text) from public, anon, authenticated;
grant execute on function public.relay_pending(text) to anon, authenticated;

-- Log one message the relay sent, on the candidate's history (and the contact's, for client emails).
create or replace function public.relay_log(p_secret text, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cj record; act uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select c.id, c.candidate_id, j.id job_id, j.company_id, j.market_id into cj
    from public.candidate_jobs c join public.jobs j on j.id = c.job_id where c.id = (p->>'candidate_job_id')::uuid;
  insert into public.activities (kind, direction, summary, body, candidate_id, contact_id, candidate_job_id, job_id, company_id, market_id,
                                 external_id, external_thread_id, external_status, phone_number)
  values (p->>'kind', 'out', p->>'summary', p->>'body', cj.candidate_id, nullif(p->>'contact_id', '')::uuid, cj.id, cj.job_id,
          cj.company_id, cj.market_id, nullif(p->>'external_id', ''), nullif(p->>'thread_id', ''), 'sent', nullif(p->>'phone', ''))
  on conflict (external_id) where external_id is not null do nothing
  returning id into act;
  return act;
end $$;
revoke execute on function public.relay_log(text, jsonb) from public, anon, authenticated;
grant execute on function public.relay_log(text, jsonb) to anon, authenticated;

-- Record what the relay decided about one message, or about a scheduled step (p_activity null).
-- p: candidate_job_id, status (done | escalated), note, flag (pauses the candidate and keeps the message
-- on What needs me), stage, interview {id?, ...}, offer {id?, ...}, relay_message {...}, item {...},
-- placement_start (date), followup_failed (submission id).
create or replace function public.relay_apply(p_secret text, p_activity uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cjr record; a public.activities; iv jsonb := p->'interview'; ov jsonb := p->'offer'; rm jsonb := p->'relay_message';
  it jsonb := p->'item'; oid uuid; iid uuid; note text := coalesce(p->>'note', '');
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select c.id, c.candidate_id, j.id job_id, j.company_id, j.market_id, cand.full_name into cjr
    from public.candidate_jobs c join public.jobs j on j.id = c.job_id join public.candidates cand on cand.id = c.candidate_id
   where c.id = (p->>'candidate_job_id')::uuid;
  if cjr.id is null then raise exception 'no such candidate job'; end if;
  if p_activity is not null then select * into a from public.activities where id = p_activity; end if;

  if iv is not null then
    if iv ? 'id' then
      iid := (iv->>'id')::uuid;
      update public.interviews set
        status = coalesce(iv->>'status', status),
        waiting_on = case when iv ? 'waiting_on' then iv->>'waiting_on' else waiting_on end,
        client_times = case when iv ? 'client_times' then array(select jsonb_array_elements_text(iv->'client_times')) else client_times end,
        details = case when iv ? 'details' then nullif(iv->>'details', '') else details end,
        rounds = coalesce((iv->>'rounds')::int, rounds),
        scheduled_at = case when iv ? 'scheduled_local' then (iv->>'scheduled_local')::timestamp at time zone 'America/New_York' else scheduled_at end,
        confirmed_at = case when iv->>'status' = 'confirmed' then now() else confirmed_at end
       where id = iid and candidate_job_id = cjr.id;
    else
      update public.interviews set status = 'cancelled' where candidate_job_id = cjr.id and status = 'proposing';
      insert into public.interviews (candidate_job_id, status, waiting_on, client_times, details)
      values (cjr.id, coalesce(iv->>'status', 'proposing'), iv->>'waiting_on',
              array(select jsonb_array_elements_text(coalesce(iv->'client_times', '[]'::jsonb))), nullif(iv->>'details', ''))
      returning id into iid;
    end if;
  end if;

  if ov is not null then
    if ov ? 'id' then
      oid := (ov->>'id')::uuid;
      update public.offers set
        status = coalesce(ov->>'status', status),
        waiting_on = case when ov ? 'waiting_on' then ov->>'waiting_on' else waiting_on end,
        terms = coalesce(nullif(ov->>'terms', ''), terms),
        pay = coalesce(nullif(ov->>'pay', ''), pay),
        start_date = coalesce(nullif(ov->>'start_date', '')::date, start_date),
        rounds = coalesce((ov->>'rounds')::int, rounds)
       where id = oid and candidate_job_id = cjr.id;
    else
      update public.offers set status = 'withdrawn' where candidate_job_id = cjr.id and status in ('review', 'confirm_asked', 'ready');
      insert into public.offers (candidate_job_id, status, waiting_on, clear, terms, pay, start_date, source_message_id)
      values (cjr.id, coalesce(ov->>'status', 'review'), coalesce(ov->>'waiting_on', 'justin'), coalesce((ov->>'clear')::boolean, false),
              coalesce(ov->>'terms', ''), nullif(ov->>'pay', ''), nullif(ov->>'start_date', '')::date, nullif(ov->>'source_message_id', ''))
      returning id into oid;
    end if;
  end if;

  if rm is not null then
    insert into public.relay_messages (candidate_job_id, offer_id, to_party, subject, body)
    values (cjr.id, coalesce(nullif(rm->>'offer_id', '')::uuid, oid), rm->>'to_party', nullif(rm->>'subject', ''), rm->>'body');
  end if;

  if p ? 'stage' then
    update public.candidate_jobs set stage = (p->>'stage')::public.pipeline_stage where id = cjr.id and stage::text <> p->>'stage';
  end if;
  if p ? 'placement_start' then
    update public.placements set start_date = (p->>'placement_start')::date where candidate_job_id = cjr.id;
  end if;

  if it is not null then
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, job_id, candidate_job_id, company_id, market_id)
    values (coalesce(it->>'kind', 'task'), left(it->>'title', 200), it->>'detail', coalesce((it->>'priority')::int, 1),
            cjr.candidate_id, nullif(it->>'contact_id', '')::uuid, cjr.job_id, cjr.id, cjr.company_id, cjr.market_id);
  end if;

  if coalesce(p->>'flag', '') <> '' then
    perform public.pause_candidate(cjr.candidate_id, p->>'flag');
  end if;

  if a.id is not null then
    if p->>'status' = 'done' then
      update public.action_items set status = 'done', resolved_at = now()
       where kind = 'reply' and status = 'open' and created_at >= a.occurred_at - interval '10 minutes'
         and ((a.contact_id is not null and contact_id = a.contact_id) or (a.contact_id is null and candidate_id = a.candidate_id and contact_id is null));
    else
      update public.action_items set title = left(cjr.full_name || ': ' || note, 200)
       where kind = 'reply' and status = 'open' and created_at >= a.occurred_at - interval '10 minutes' and note <> ''
         and ((a.contact_id is not null and contact_id = a.contact_id) or (a.contact_id is null and candidate_id = a.candidate_id and contact_id is null));
    end if;
    update public.activities set relay_status = coalesce(p->>'status', 'escalated'), relay_note = note where id = a.id;
  end if;
  return coalesce(oid, iid);
end $$;
revoke execute on function public.relay_apply(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.relay_apply(text, uuid, jsonb) to anon, authenticated;

-- Scheduled relay steps that are due: the candidate's reminder the day before an interview (noon), the
-- client's check-in at 3pm the next business day after it, and the good-luck text the day before a
-- start (4pm). Each is claimed as it's returned.
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
  end if;

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
revoke execute on function public.relay_scheduled(text) from public, anon, authenticated;
grant execute on function public.relay_scheduled(text) to anon, authenticated;

-- The same context for Justin's own clicks (Send offer, Ask to confirm, approving a counteroffer), without
-- the mailbox token: those go out from his own Gmail.
create or replace function public.relay_context_staff(p_cj uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                  where cj.id = p_cj and public.can_access_market(j.market_id)) then
    raise exception 'not allowed';
  end if;
  return public.relay_context(p_cj) - 'gmail_token' - 'gmail_email';
end $$;
revoke execute on function public.relay_context_staff(uuid) from public, anon;
grant execute on function public.relay_context_staff(uuid) to authenticated;

-- A call Justin starts by hand (Call now) always dials, even while automated recruiting is off: it's his
-- click, not automation. Everything booked automatically still waits for the master switch.
alter table public.screening_runs add column if not exists by_hand boolean not null default false;

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
  insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary, by_hand)
  values (p_candidate_job_id, 'scheduled', 'phone', now(), 'Started by hand from the Command Center', true)
  returning id into rid;
  return rid;
end $$;

create or replace function public.screening_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb; auto_on boolean := exists (select 1 from public.automation_settings where automated_recruiting);
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  with claimed as (
    update public.screening_runs r set status = 'in_progress', dial_started_at = now()
     where r.id in (select id from public.screening_runs
                     where status = 'scheduled' and channel = 'phone' and (auto_on or by_hand)
                       and scheduled_for <= now() and scheduled_for > now() - interval '15 minutes'
                     order by scheduled_for limit 3 for update skip locked)
    returning r.id)
  select coalesce(jsonb_agg(public.screening_context(id)), '[]'::jsonb) into out from claimed;
  return out;
end $$;
