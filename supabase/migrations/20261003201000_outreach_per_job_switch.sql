-- Automated recruiting can be switched on or off for each candidate on each job. Off pauses the
-- schedule where it is (paused_at); on resumes it, shifted by however long it was paused, or starts a
-- fresh one after an earlier run stopped or finished. The master switch on Phone & email still sits
-- above this, and candidates added before it was first turned on still never enter automation.

alter table public.pursuits add column if not exists paused_at timestamptz;

-- A new pursuit can start again after an earlier one stopped or finished; only a live one blocks it.
create or replace function public.start_pursuit(p_candidate_job_id uuid, p_purpose text default 'screening') returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid; mkt uuid; added timestamptz; cfg public.automation_settings;
begin
  select * into cfg from public.automation_settings;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after is null then return null; end if;
  select j.market_id, c.created_at into mkt, added
    from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
   where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if added < cfg.eligible_after then return null; end if;  -- existing candidates are never automated
  if exists (select 1 from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active') then
    return null;
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

-- The per-job switch. Returns 'on' or 'off', or why it couldn't turn on: 'master_off', 'existing', 'unavailable'.
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
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after is null then return 'master_off'; end if;
  if added < cfg.eligible_after then return 'existing'; end if;

  if p.id is not null then
    if p.paused_at is not null then
      update public.pursuit_steps
         set due_at = public.next_send_time(greatest(due_at + (now() - p.paused_at), now()))
       where pursuit_id = p.id and status = 'pending';
      update public.pursuits set paused_at = null where id = p.id;
    end if;
    return 'on';
  end if;
  pid := public.start_pursuit(p_candidate_job_id, p_purpose);
  return case when pid is null then 'unavailable' else 'on' end;
end $$;
revoke execute on function public.set_outreach(uuid, boolean, text) from public, anon;
grant execute on function public.set_outreach(uuid, boolean, text) to authenticated;

-- Paused outreach sends nothing.
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
       and cand.created_at >= (select eligible_after from public.automation_settings)
       and (ps.status = 'pending' or (ps.status = 'sending' and ps.claimed_at < now() - interval '10 minutes'))
     order by ps.due_at limit 20 for update of ps skip locked),
  claimed as (
    update public.pursuit_steps ps set status = 'sending', claimed_at = now() from due where ps.id = due.id returning ps.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'step_id', c.id, 'channel', c.channel, 'subject', c.subject, 'body', c.body, 'step_no', c.step_no,
      'candidate_job_id', cj.id, 'candidate_id', cand.id, 'job_id', j.id, 'company_id', j.company_id, 'market_id', j.market_id,
      'full_name', cand.full_name, 'phone', cand.phone, 'email', cand.email, 'sms_opted_out', cand.sms_opted_out_at is not null,
      'text_consent', cand.contact_consent,
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
