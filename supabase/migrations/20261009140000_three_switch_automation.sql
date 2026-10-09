-- Automated recruiting runs for a candidate on a job only when all three switches are on:
-- the master (Settings), the job's own switch (jobs.automation_pilot, now always required, off by default),
-- and the candidate's switch on that job (candidate_jobs.automate). Plus the existing rules: added after
-- automation was first turned on, and the candidate's own pause not set.
-- Turning any switch off pauses outreach where it is; turning it back on picks it up again.

alter table public.candidate_jobs add column if not exists automate boolean not null default false;
update public.candidate_jobs cj set automate = true
 where exists (select 1 from public.pursuits p where p.candidate_job_id = cj.id and p.purpose = 'screening'
                and p.status = 'active' and p.paused_at is null);

create or replace function public.automation_allowed(p_cj uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.automated_recruiting and s.eligible_after_v1 is not null and c.created_at >= s.eligible_after_v1
           and c.automation_paused_at is null and j.automation_pilot and cj.automate
      from public.automation_settings s
      cross join public.candidate_jobs cj
      join public.candidates c on c.id = cj.candidate_id
      join public.jobs j on j.id = cj.job_id
     where cj.id = p_cj), false);
$$;

-- Bring outreach in line with the switches: resume or start where all are on, pause where any is off.
create or replace function public.automation_sync(p_job uuid default null, p_cj uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select cj.id, cj.stage, p.id pid, p.paused_at
      from public.candidate_jobs cj
      join public.jobs j on j.id = cj.job_id
      left join public.pursuits p on p.candidate_job_id = cj.id and p.purpose = 'screening' and p.status = 'active'
     where (p_job is null or cj.job_id = p_job) and (p_cj is null or cj.id = p_cj)
       and (cj.automate or p.id is not null)
       and public.can_access_market(j.market_id)
  loop
    if public.automation_allowed(r.id) then
      if r.pid is not null and r.paused_at is not null then
        update public.pursuit_steps
           set due_at = public.next_send_time(greatest(due_at + (now() - r.paused_at), now()), channel)
         where pursuit_id = r.pid and status = 'pending';
        update public.pursuits set paused_at = null where id = r.pid;
        n := n + 1;
      elsif r.pid is null and r.stage in ('applied', 'sourced', 'assigned', 'contacting', 'couldnt_contact') then
        if public.start_pursuit(r.id, 'screening') is not null then n := n + 1; end if;
      end if;
    elsif r.pid is not null and r.paused_at is null then
      update public.pursuits set paused_at = now() where id = r.pid;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.automation_sync(uuid, uuid) from public, anon;
grant execute on function public.automation_sync(uuid, uuid) to authenticated;

-- The candidate's switch on one job. Always settable; it only runs once the master and the job are on too.
create or replace function public.set_outreach(p_candidate_job_id uuid, p_on boolean, p_purpose text default 'screening')
returns text language plpgsql security definer set search_path = '' as $$
declare mkt uuid; added timestamptz; cfg public.automation_settings; job_on boolean; p public.pursuits;
begin
  select j.market_id, c.created_at, j.automation_pilot into mkt, added, job_on
    from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
   where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  update public.candidate_jobs set automate = p_on where id = p_candidate_job_id;
  perform public.automation_sync(null, p_candidate_job_id);
  if not p_on then return 'off'; end if;

  select * into cfg from public.automation_settings;
  if cfg.eligible_after_v1 is not null and added < cfg.eligible_after_v1 then return 'existing'; end if;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after_v1 is null then return 'master_off'; end if;
  if not job_on then return 'job_off'; end if;
  select * into p from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active';
  -- Turned on by hand after the last round ended (they replied, or it ran out): start the schedule over.
  if p.id is null and public.automation_allowed(p_candidate_job_id) then
    perform public.start_pursuit(p_candidate_job_id, p_purpose);
    select * into p from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active';
  end if;
  return case when p.id is not null and p.paused_at is null then 'on' else 'unavailable' end;
end $$;

-- The job's switch.
create or replace function public.set_job_automation(p_job uuid, p_on boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare mkt uuid;
begin
  select market_id into mkt from public.jobs where id = p_job;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  update public.jobs set automation_pilot = p_on where id = p_job;
  return public.automation_sync(p_job, null);
end $$;
revoke execute on function public.set_job_automation(uuid, boolean) from public, anon;
grant execute on function public.set_job_automation(uuid, boolean) to authenticated;

-- The master switch now also pauses and resumes everything in place.
create or replace function public.set_automated_recruiting(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings
     set automated_recruiting = p_on,
         eligible_after = case when p_on then coalesce(eligible_after, now()) else eligible_after end,
         eligible_after_v1 = case when p_on then coalesce(eligible_after_v1, now()) else eligible_after_v1 end,
         changed_at = now(), changed_by = auth.uid()
   where id;
  perform public.automation_sync(null, null);
end $$;

-- Belt and braces: nothing sends, replies or dials for a candidate whose switches aren't all on.
do $do$
declare d text; before text;
begin
  select pg_get_functiondef('public.automation_due'::regproc) into d; before := d;
  d := replace(d, 'where p.status = ''active'' and p.paused_at is null and ps.due_at <= now()',
                  'where p.status = ''active'' and p.paused_at is null and ps.due_at <= now() and public.automation_allowed(cj.id)');
  if d = before then raise exception 'automation_due: pattern not found'; end if;
  execute d;

  select pg_get_functiondef('public.screening_due'::regproc) into d; before := d;
  d := replace(d, '((auto_on and ai_on) or by_hand)', '((auto_on and ai_on and public.automation_allowed(candidate_job_id)) or by_hand)');
  if d = before then raise exception 'screening_due: pattern not found'; end if;
  execute d;

  select pg_get_functiondef('public.brain_pending'::regproc) into d; before := d;
  d := replace(d, '  with claimed as (',
                  '  update public.activities set brain_status = null
   where brain_status = ''pending'' and not public.automation_allowed(public.brain_job_for(candidate_id));
  with claimed as (');
  if d = before then raise exception 'brain_pending: pattern not found'; end if;
  execute d;
end $do$;
