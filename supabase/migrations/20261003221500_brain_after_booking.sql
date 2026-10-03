-- The brain keeps handling a candidate's replies after a call is booked: "sounds good" needs nothing,
-- a new time moves the booking, and "never mind" cancels it.

create or replace function public.brain_job_for(p_candidate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.candidate_job_id
    from public.pursuits p join public.candidate_jobs cj on cj.id = p.candidate_job_id
   where cj.candidate_id = p_candidate and p.purpose = 'screening' and p.started_at > now() - interval '30 days'
     and cj.stage in ('contacting', 'conversation')
     and not exists (select 1 from public.screening_runs r where r.candidate_job_id = p.candidate_job_id
                      and r.status in ('in_progress', 'completed'))
   order by p.started_at desc limit 1;
$$;

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
  -- Anything claimed that no longer has a job in screening goes back to normal handling.
  update public.activities set brain_status = null
   where brain_status = 'working' and candidate_id is not null and public.brain_job_for(candidate_id) is null;
  return out;
end $$;

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
    -- A new time replaces any call already booked for this job.
    update public.screening_runs set status = 'cancelled' where candidate_job_id = cj.id and status = 'scheduled';
    update public.action_items set status = 'done', resolved_at = now()
     where kind = 'screening' and status = 'open' and candidate_job_id = cj.id;
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
    update public.screening_runs set status = 'cancelled' where candidate_job_id = cj.id and status = 'scheduled';
    update public.action_items set status = 'done', resolved_at = now()
     where kind = 'screening' and status = 'open' and candidate_job_id = cj.id;
  end if;

  if intent in ('book_call', 'not_interested', 'ask_time', 'acknowledged') then
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
