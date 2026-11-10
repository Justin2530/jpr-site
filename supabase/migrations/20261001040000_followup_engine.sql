-- Follow-up engine (phase 3). After a human assigns a candidate to a job, the app reaches out on a
-- schedule (texts and emails) until the candidate responds in any way. Outreach runs in "pursuits",
-- one per purpose (screening now, interview scheduling later); any reply stops the active ones, and a
-- later purpose starts fresh. Postgres holds the schedule; pg_cron wakes the app every minute to send.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The cadence, editable without code. {first_name} {job_title} {in_location} {signature} are filled in.
create table public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  purpose text not null default 'screening',
  step_no integer not null,
  day_offset numeric not null default 0,
  channel text not null check (channel in ('sms', 'email')),
  subject text,
  body text not null,
  active boolean not null default true,
  unique (purpose, step_no)
);

create table public.pursuits (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  purpose text not null default 'screening',
  status text not null default 'active' check (status in ('active', 'stopped', 'finished')),
  started_by uuid references public.staff (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
);
create unique index pursuits_one_active on public.pursuits (candidate_job_id, purpose) where status = 'active';

create table public.pursuit_steps (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid not null references public.pursuits (id) on delete cascade,
  step_no integer not null,
  channel text not null,
  subject text,
  body text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  claimed_at timestamptz,
  sent_at timestamptz,
  note text,
  activity_id uuid references public.activities (id) on delete set null
);
create index pursuit_steps_due on public.pursuit_steps (due_at) where status in ('pending', 'sending');

alter table public.followup_steps enable row level security;
alter table public.pursuits enable row level security;
alter table public.pursuit_steps enable row level security;
create policy "staff read cadence" on public.followup_steps for select to authenticated using (public.is_staff());
create policy "owner edits cadence" on public.followup_steps for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "market access" on public.pursuits for all to authenticated
  using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)));
create policy "market access" on public.pursuit_steps for all to authenticated
  using (exists (select 1 from public.pursuits p join public.candidate_jobs cj on cj.id = p.candidate_job_id
                 join public.jobs j on j.id = cj.job_id where p.id = pursuit_id and public.can_access_market(j.market_id)));
grant select, insert, update, delete on public.followup_steps, public.pursuits, public.pursuit_steps to authenticated;

insert into public.followup_steps (purpose, step_no, day_offset, channel, subject, body) values
('screening', 1, 0, 'sms', null,
 'Hi {first_name}, this is Justin with JPR. I''m reaching out about the {job_title} position{in_location}. Do you have a few minutes for a quick call today or tomorrow? Just text me back a good time. Reply STOP to opt out.'),
('screening', 2, 0, 'email', '{job_title} position',
 E'Hi {first_name},\n\nI''m reaching out about the {job_title} position{in_location}. I''d like to set up a quick call to go over the details and answer any questions you have.\n\nWhat''s a good time to reach you? You can reply here or call or text me at (814) 845-4341.\n\nThanks!\n\n{signature}'),
('screening', 3, 1, 'sms', null,
 'Hi {first_name}, just following up on the {job_title} position. When''s a good time for a quick call?'),
('screening', 4, 3, 'email', 'Following up: {job_title} position',
 E'Hi {first_name},\n\nJust following up on the {job_title} position{in_location}. If you''re still interested, reply here or call or text me at (814) 845-4341 and we''ll find a time to talk.\n\nThanks!\n\n{signature}'),
('screening', 5, 5, 'sms', null,
 'Hi {first_name}, I don''t want to keep bugging you about the {job_title} position. If you''re still interested, just text me back and we''ll set up a time. Thanks!');

-- Texts and emails only go out Monday to Saturday, 9am to 7pm Eastern. Anything due outside that waits.
create or replace function public.next_send_time(t timestamptz) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare l timestamp := t at time zone 'America/New_York';
begin
  loop
    if extract(isodow from l) = 7 then l := date_trunc('day', l) + interval '1 day 9 hours';
    elsif l::time < time '09:00' then l := date_trunc('day', l) + interval '9 hours';
    elsif l::time >= time '19:00' then l := date_trunc('day', l) + interval '1 day 9 hours';
    else exit;
    end if;
  end loop;
  return l at time zone 'America/New_York';
end $$;

-- Start outreach for one candidate on one job. Only the app calls this, right after a person assigns
-- the candidate (imports and other automation never do).
create or replace function public.start_pursuit(p_candidate_job_id uuid, p_purpose text default 'screening') returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid; mkt uuid;
begin
  select j.market_id into mkt from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose) then
    return null; -- this purpose already ran for this candidate and job; don't chase them twice
  end if;
  insert into public.pursuits (candidate_job_id, purpose, started_by) values (p_candidate_job_id, p_purpose, auth.uid()) returning id into pid;
  insert into public.pursuit_steps (pursuit_id, step_no, channel, subject, body, due_at)
  select pid, s.step_no, s.channel, s.subject, s.body, public.next_send_time(now() + s.day_offset * interval '1 day')
    from public.followup_steps s where s.purpose = p_purpose and s.active;
  if p_purpose = 'screening' then
    update public.candidate_jobs set stage = 'contacting' where id = p_candidate_job_id and stage in ('applied', 'assigned');
  end if;
  return pid;
end $$;
revoke execute on function public.start_pursuit(uuid, text) from public, anon;
grant execute on function public.start_pursuit(uuid, text) to authenticated;

create or replace function public.stop_pursuits(p_candidate_id uuid, p_reason text, p_candidate_job_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  with stopped as (
    update public.pursuits p set status = 'stopped', ended_at = now(), end_reason = p_reason
     where p.status = 'active'
       and p.candidate_job_id in (select cj.id from public.candidate_jobs cj
                                   where cj.candidate_id = p_candidate_id and (p_candidate_job_id is null or cj.id = p_candidate_job_id))
    returning p.id)
  select array_agg(id) into ids from stopped;
  if ids is not null then
    update public.pursuit_steps set status = 'skipped', note = 'stopped: ' || p_reason
     where pursuit_id = any (ids) and status = 'pending';
  end if;
end $$;
revoke execute on function public.stop_pursuits(uuid, text, uuid) from public, anon, authenticated;

-- Any response stops the chasing: a text, an email or a call from the candidate.
create or replace function public.pursuit_stop_on_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' and new.candidate_id is not null and new.kind in ('text', 'email', 'call') then
    perform public.stop_pursuits(new.candidate_id, 'they responded (' || new.kind || ')');
    update public.candidate_jobs set stage = 'conversation'
     where candidate_id = new.candidate_id and stage = 'contacting';
  end if;
  return new;
end $$;
create trigger activities_stop_pursuits after insert on public.activities for each row execute function public.pursuit_stop_on_reply();

-- A person moving the candidate on (or off) the job ends screening outreach for that job.
create or replace function public.pursuit_stop_on_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage and new.stage not in ('applied', 'assigned', 'contacting') then
    update public.pursuits set status = 'stopped', ended_at = now(), end_reason = 'moved to ' || new.stage
     where candidate_job_id = new.id and purpose = 'screening' and status = 'active';
    update public.pursuit_steps ps set status = 'skipped', note = 'stopped: moved to ' || new.stage
      from public.pursuits p
     where p.id = ps.pursuit_id and p.candidate_job_id = new.id and p.purpose = 'screening' and ps.status = 'pending';
  end if;
  return new;
end $$;
create trigger candidate_jobs_stop_pursuits after update of stage on public.candidate_jobs for each row execute function public.pursuit_stop_on_stage();

-- ---- The worker side: called by the app's /api/automation/tick with the automation secret ----------

-- Register (or refresh) where pg_cron should knock and with what secret. The owner's app does this
-- itself so the secret and the Vercel bypass code never pass through a person.
create or replace function public.automation_register(p_secret text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid; uid uuid;
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  insert into public.integration_secrets (name, secret_hash)
  values ('automation', encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  on conflict (name) do update set secret_hash = excluded.secret_hash;
  select id into sid from vault.secrets where name = 'automation_secret';
  if sid is null then perform vault.create_secret(p_secret, 'automation_secret');
  else perform vault.update_secret(sid, p_secret); end if;
  select id into uid from vault.secrets where name = 'automation_tick_url';
  if uid is null then perform vault.create_secret(p_url, 'automation_tick_url');
  else perform vault.update_secret(uid, p_url); end if;
  if not exists (select 1 from cron.job where jobname = 'jpr-automation-tick') then
    perform cron.schedule('jpr-automation-tick', '* * * * *', $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'automation_tick_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                     'x-jpr-automation', (select decrypted_secret from vault.decrypted_secrets where name = 'automation_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000)
    $cron$);
  end if;
end $$;
revoke execute on function public.automation_register(text, text) from public, anon;
grant execute on function public.automation_register(text, text) to authenticated;

-- Claim the steps that are due now, with everything needed to send them.
create or replace function public.automation_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  with due as (
    select ps.id from public.pursuit_steps ps join public.pursuits p on p.id = ps.pursuit_id
     where p.status = 'active' and ps.due_at <= now()
       and (ps.status = 'pending' or (ps.status = 'sending' and ps.claimed_at < now() - interval '10 minutes'))
     order by ps.due_at limit 20 for update of ps skip locked),
  claimed as (
    update public.pursuit_steps ps set status = 'sending', claimed_at = now() from due where ps.id = due.id returning ps.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'step_id', c.id, 'channel', c.channel, 'subject', c.subject, 'body', c.body, 'step_no', c.step_no,
      'candidate_job_id', cj.id, 'candidate_id', cand.id, 'job_id', j.id, 'company_id', j.company_id, 'market_id', j.market_id,
      'full_name', cand.full_name, 'phone', cand.phone, 'email', cand.email, 'sms_opted_out', cand.sms_opted_out_at is not null,
      'job_title', j.title, 'location', j.location,
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

-- Record how a step went: log what was sent on the candidate's history, and when the last step is
-- done without a reply, mark the pursuit finished and put it on What needs me.
create or replace function public.automation_step_done(p_secret text, p_step uuid, p_status text, p_note text,
  p_summary text, p_body text, p_external_id text, p_thread_id text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.pursuit_steps; pu public.pursuits; cj record; act uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into st from public.pursuit_steps where id = p_step;
  select * into pu from public.pursuits where id = st.pursuit_id;
  select c.candidate_id, c.job_id, j.company_id, j.market_id, j.title, cand.full_name into cj
    from public.candidate_jobs c join public.jobs j on j.id = c.job_id join public.candidates cand on cand.id = c.candidate_id
   where c.id = pu.candidate_job_id;
  if p_status = 'sent' then
    insert into public.activities (kind, direction, summary, body, candidate_id, job_id, candidate_job_id, market_id,
                                   external_id, external_thread_id, external_status, phone_number)
    values (case when st.channel = 'sms' then 'text' else 'email' end, 'out', p_summary, p_body, cj.candidate_id, cj.job_id, pu.candidate_job_id,
            cj.market_id, p_external_id, p_thread_id, 'sent', p_phone)
    returning id into act;
  end if;
  update public.pursuit_steps set status = p_status, sent_at = case when p_status = 'sent' then now() end,
         note = p_note, activity_id = act where id = p_step;
  if pu.status = 'active' and not exists (select 1 from public.pursuit_steps where pursuit_id = pu.id and status in ('pending', 'sending')) then
    update public.pursuits set status = 'finished', ended_at = now(), end_reason = 'no response' where id = pu.id;
    insert into public.action_items (kind, title, detail, priority, candidate_id, job_id, candidate_job_id, company_id, market_id)
    values ('task', 'No response: ' || cj.full_name,
            'Automated texts and emails about ' || cj.title || ' got no reply. Call them yourself, or move them to Passed.',
            2, cj.candidate_id, cj.job_id, pu.candidate_job_id, cj.company_id, cj.market_id);
  end if;
end $$;

revoke execute on function public.automation_due(text) from public;
revoke execute on function public.automation_step_done(text, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.automation_due(text) to anon, authenticated;
grant execute on function public.automation_step_done(text, uuid, text, text, text, text, text, text, text) to anon, authenticated;

-- ---- Gmail, checked in the background too (same rules as the in-app check) -----------------------

create or replace function public.gmail_mailboxes(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'email', email, 'token', token_enc,
                    'connected_at', connected_at, 'last_synced_at', last_synced_at)) from public.google_accounts), '[]'::jsonb);
end $$;

create or replace function public.gmail_known(p_secret text, p_ids text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((select array_agg(external_id) from public.activities where external_id = any (p_ids)), '{}');
end $$;

create or replace function public.gmail_person(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'contact', 'id', ct.id, 'name', ct.full_name, 'company_id', ct.company_id, 'market_id', co.market_id)
       from public.contacts ct left join public.companies co on co.id = ct.company_id
      where lower(trim(ct.email)) = lower(trim(p_email)) order by ct.created_at desc limit 1),
    (select jsonb_build_object('kind', 'candidate', 'id', c.id, 'name', c.full_name, 'company_id', null, 'market_id', c.source_market_id)
       from public.candidates c where lower(trim(c.email)) = lower(trim(p_email)) order by c.updated_at desc limit 1))
$$;
revoke execute on function public.gmail_person(text) from public, anon, authenticated;

-- Log messages between a mailbox and known people. Each message: id, threadId, from, fromName, to[],
-- subject, date (ms), body (reply only). Unknown senders are skipped and never stored.
create or replace function public.gmail_log(p_secret text, p_staff uuid, p_me text, p_msgs jsonb, p_synced_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare m jsonb; outgoing boolean; who jsonb; addr text; added integer := 0; act uuid; name text; summary text;
  cand uuid; subj text; s_cj uuid; s_cand uuid; s_job uuid; s_name text; s_co uuid; s_mkt uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  for m in select value from jsonb_array_elements(p_msgs) order by (value->>'date')::bigint loop
    act := null;
    outgoing := lower(m->>'from') = lower(p_me);
    who := null;
    if outgoing then
      for addr in select jsonb_array_elements_text(m->'to') loop
        who := public.gmail_person(addr);
        exit when who is not null;
      end loop;
    else
      who := public.gmail_person(m->>'from');
    end if;
    select s.candidate_job_id, cj.candidate_id, cj.job_id, cand.full_name, j.company_id, j.market_id
      into s_cj, s_cand, s_job, s_name, s_co, s_mkt
      from public.submissions s join public.candidate_jobs cj on cj.id = s.candidate_job_id
      join public.candidates cand on cand.id = cj.candidate_id join public.jobs j on j.id = cj.job_id
     where s.email_thread_id = m->>'threadId' order by s.created_at desc limit 1;
    if who is null and s_cj is null then continue; end if;
    name := coalesce(who->>'name', m->>'fromName', m->>'from');
    subj := coalesce(nullif(m->>'subject', ''), '(no subject)');
    summary := case
      when outgoing then 'Email to ' || name || ': ' || subj
      when s_cj is not null then 'Reply on ' || s_name || '''s submission from ' || name
      else 'Email from ' || name || ': ' || subj end;
    cand := case when who->>'kind' = 'candidate' then (who->>'id')::uuid else s_cand end;
    insert into public.activities (kind, direction, summary, body, occurred_at, candidate_id, contact_id, company_id, job_id,
                                   candidate_job_id, market_id, actor_id, external_id, external_thread_id, external_status)
    values ('email', case when outgoing then 'out' else 'in' end, summary, left(m->>'body', 20000),
            to_timestamp((m->>'date')::bigint / 1000.0), cand,
            case when who->>'kind' = 'contact' then (who->>'id')::uuid end,
            coalesce((who->>'company_id')::uuid, s_co), s_job, s_cj,
            coalesce((who->>'market_id')::uuid, s_mkt), case when outgoing then p_staff end,
            m->>'id', m->>'threadId', case when outgoing then 'sent' else 'received' end)
    on conflict (external_id) where external_id is not null do nothing
    returning id into act;
    if act is null then continue; end if;
    added := added + 1;
    if not outgoing then
      insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, job_id, candidate_job_id, market_id)
      values ('reply', regexp_replace(summary, ': .*$', ''), left(coalesce(nullif(m->>'subject', '') || E'\n', '') || coalesce(m->>'body', ''), 280), 1,
              cand, case when who->>'kind' = 'contact' then (who->>'id')::uuid end,
              coalesce((who->>'company_id')::uuid, s_co), s_job, s_cj,
              coalesce((who->>'market_id')::uuid, s_mkt));
    end if;
  end loop;
  update public.google_accounts set last_synced_at = p_synced_at where staff_id = p_staff;
  return added;
end $$;

revoke execute on function public.gmail_mailboxes(text), public.gmail_known(text, text[]),
  public.gmail_log(text, uuid, text, jsonb, timestamptz) from public;
grant execute on function public.gmail_mailboxes(text), public.gmail_known(text, text[]),
  public.gmail_log(text, uuid, text, jsonb, timestamptz) to anon, authenticated;
