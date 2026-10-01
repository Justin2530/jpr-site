-- "Automated recruiting" master switch (Justin, 2026-10-01): off until he turns it on, and even then it
-- only covers candidates added after the first time it was switched on. Existing candidates never
-- fall into automation.
create table public.automation_settings (
  id boolean primary key default true check (id),
  automated_recruiting boolean not null default false,
  eligible_after timestamptz,          -- set once, the first time it's turned on; never moves
  changed_at timestamptz,
  changed_by uuid references public.staff (id) on delete set null
);
insert into public.automation_settings default values;
alter table public.automation_settings enable row level security;
create policy "staff read" on public.automation_settings for select to authenticated using (public.is_staff());
grant select on public.automation_settings to authenticated;

create or replace function public.set_automated_recruiting(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings
     set automated_recruiting = p_on,
         eligible_after = case when p_on then coalesce(eligible_after, now()) else eligible_after end,
         changed_at = now(), changed_by = auth.uid();
end $$;
revoke execute on function public.set_automated_recruiting(boolean) from public, anon;
grant execute on function public.set_automated_recruiting(boolean) to authenticated;

-- Outreach starts only when the switch is on and the candidate was added after it first went on.
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
  if exists (select 1 from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose) then
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

-- Turning the switch off pauses everything: nothing due is sent until it's back on.
create or replace function public.automation_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.automation_settings where automated_recruiting) then return '[]'::jsonb; end if;
  with due as (
    select ps.id from public.pursuit_steps ps join public.pursuits p on p.id = ps.pursuit_id
      join public.candidate_jobs cj on cj.id = p.candidate_job_id join public.candidates cand on cand.id = cj.candidate_id
     where p.status = 'active' and ps.due_at <= now()
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
