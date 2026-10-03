-- Send hours by channel (Justin, 2026-10-03: business hours were only ever meant for the first cold call).
-- Emails go out whenever they're due. Texts go any day, 8am to 9pm Eastern (the federal quiet hours for
-- texting). Calls keep the old Monday-Saturday 9am-7pm window (the one-argument next_send_time).
create or replace function public.next_send_time(t timestamptz, p_channel text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare l timestamp := t at time zone 'America/New_York';
begin
  if p_channel = 'email' then return t; end if;
  if p_channel <> 'sms' then return public.next_send_time(t); end if;
  if l::time < time '08:00' then l := date_trunc('day', l) + interval '8 hours';
  elsif l::time >= time '21:00' then l := date_trunc('day', l) + interval '1 day 8 hours';
  end if;
  return l at time zone 'America/New_York';
end $$;

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
  select pid, s.step_no, s.channel, s.subject, s.body, public.next_send_time(now() + s.day_offset * interval '1 day', s.channel)
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
         set due_at = public.next_send_time(greatest(due_at + (now() - p.paused_at), now()), channel)
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

