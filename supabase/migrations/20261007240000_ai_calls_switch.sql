-- AI calls get their own switch, off until the call audio is proven. With it off, automated outreach
-- still texts and emails, but its AI call steps are skipped, and a call a candidate booked becomes a
-- "call them now" item for Justin instead of an AI call. "Call now" by hand always works.
alter table public.automation_settings add column if not exists ai_calls boolean not null default false;

create or replace function public.set_ai_calls(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings set ai_calls = p_on where id;
end $$;
revoke execute on function public.set_ai_calls(boolean) from public, anon;
grant execute on function public.set_ai_calls(boolean) to authenticated;

create or replace function public.automation_step_done(p_secret text, p_step uuid, p_status text, p_note text, p_summary text,
  p_body text, p_external_id text, p_thread_id text, p_phone text) returns void
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
    if not exists (select 1 from public.automation_settings where ai_calls) then
      v_status := 'skipped'; v_note := 'AI calls are off';
    elsif exists (select 1 from public.screening_runs where candidate_job_id = pu.candidate_job_id and status in ('scheduled', 'in_progress')) then
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

create or replace function public.screening_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb; auto_on boolean; ai_on boolean;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(bool_or(automated_recruiting), false), coalesce(bool_or(ai_calls), false) into auto_on, ai_on
    from public.automation_settings;
  -- AI calls off: a call they booked is Justin's to make. Hand it over when it's due.
  if auto_on and not ai_on then
    with handed as (
      update public.screening_runs r set status = 'cancelled', ended_at = now(),
             summary = coalesce(r.summary || ' ', '') || '(AI calls are off: handed to Justin)'
       where r.status = 'scheduled' and r.channel = 'phone' and not r.by_hand and r.scheduled_for <= now()
      returning r.*)
    insert into public.action_items (kind, title, detail, priority, candidate_id, job_id, candidate_job_id, company_id, market_id)
    select 'task', 'Call ' || c.full_name || ' now',
           case when public.screening_is_booked(h)
                then 'They booked ' || to_char(h.scheduled_for at time zone 'America/New_York', 'FMHH12:MI am')
                     || ' for a call about ' || j.title || '. AI calls are off, so this one is yours.'
                else 'Outreach call about ' || j.title || '. AI calls are off, so this one is yours.' end,
           1, c.id, j.id, cj.id, j.company_id, j.market_id
      from handed h join public.candidate_jobs cj on cj.id = h.candidate_job_id
      join public.candidates c on c.id = cj.candidate_id join public.jobs j on j.id = cj.job_id;
  end if;
  with claimed as (
    update public.screening_runs r set status = 'in_progress', dial_started_at = now()
     where r.id in (select id from public.screening_runs
                     where status = 'scheduled' and channel = 'phone' and ((auto_on and ai_on) or by_hand)
                       and scheduled_for <= now() and scheduled_for > now() - interval '15 minutes'
                     order by scheduled_for limit 3 for update skip locked)
    returning r.id)
  select coalesce(jsonb_agg(public.screening_context(id)), '[]'::jsonb) into out from claimed;
  return out;
end $$;

-- The reminder text says who will call: the assistant, or Justin himself while AI calls are off.
create or replace function public.screening_reminders_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb; h int := extract(hour from now() at time zone 'America/New_York');
  ai_on boolean := exists (select 1 from public.automation_settings where ai_calls);
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
           || jsonb_build_object('call_time', to_char(c.scheduled_for at time zone 'America/New_York', 'FMHH12:MI'), 'by_ai', ai_on)), '[]'::jsonb)
    into out from claimed c;
  return out;
end $$;
