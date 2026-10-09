-- One switch per level, Justin 2026-10-09: master > job > candidate (on that job). The candidate's switch covers
-- everything automatic for them on that job: outreach before screening, and client follow-ups and interview
-- scheduling after. Each switch can only be turned on while the one above it is on.
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

create or replace function public.outreach_allowed(p_cj uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.automation_allowed(p_cj);
$$;

create or replace function public.set_outreach(p_candidate_job_id uuid, p_on boolean, p_purpose text default 'screening')
returns text language plpgsql security definer set search_path = '' as $$
declare mkt uuid; added timestamptz; cfg public.automation_settings; job_on boolean; stg public.pipeline_stage; p public.pursuits;
begin
  select j.market_id, c.created_at, j.automation_pilot, cj.stage into mkt, added, job_on, stg
    from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
   where cj.id = p_candidate_job_id;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if not p_on then
    update public.candidate_jobs set automate = false where id = p_candidate_job_id;
    perform public.automation_sync(null, p_candidate_job_id);
    return 'off';
  end if;

  select * into cfg from public.automation_settings;
  if not coalesce(cfg.automated_recruiting, false) or cfg.eligible_after_v1 is null then return 'master_off'; end if;
  if not job_on then return 'job_off'; end if;
  if added < cfg.eligible_after_v1 then return 'existing'; end if;
  update public.candidate_jobs set automate = true where id = p_candidate_job_id;
  perform public.automation_sync(null, p_candidate_job_id);
  -- Turned on by hand after the last outreach round ended (they replied, or it ran out): start it over,
  -- but only while they're still before screening.
  select * into p from public.pursuits where candidate_job_id = p_candidate_job_id and purpose = p_purpose and status = 'active';
  if p.id is null and stg in ('applied', 'sourced', 'assigned', 'contacting', 'conversation', 'couldnt_contact')
     and public.outreach_allowed(p_candidate_job_id) then
    perform public.start_pursuit(p_candidate_job_id, p_purpose);
  end if;
  return 'on';
end $$;

create or replace function public.set_job_automation(p_job uuid, p_on boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare mkt uuid;
begin
  select market_id into mkt from public.jobs where id = p_job;
  if mkt is null or not public.can_access_market(mkt) then raise exception 'not allowed'; end if;
  if p_on and not coalesce((select automated_recruiting from public.automation_settings), false) then
    raise exception 'Turn on automated recruiting in Settings first.';
  end if;
  update public.jobs set automation_pilot = p_on where id = p_job;
  return public.automation_sync(p_job, null);
end $$;
