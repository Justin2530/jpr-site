-- The call engine also needs when a call ended and who answered.
create or replace function public.screening_context(p_run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'run_id', r.id, 'candidate_job_id', cj.id, 'stage', cj.stage, 'status', r.status,
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
