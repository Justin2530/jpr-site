-- A resumed outreach run keeps replying in the email thread its first run started.
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
       and cand.created_at >= (select eligible_after_v1 from public.automation_settings)
       and (ps.status = 'pending' or (ps.status = 'sending' and ps.claimed_at < now() - interval '10 minutes'))
     order by ps.due_at limit 20 for update of ps skip locked),
  claimed as (
    update public.pursuit_steps ps set status = 'sending', claimed_at = now() from due where ps.id = due.id returning ps.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'step_id', c.id, 'channel', c.channel, 'in_thread', c.in_thread, 'subject', c.subject, 'body', c.body, 'step_no', c.step_no,
      'candidate_job_id', cj.id, 'candidate_id', cand.id, 'job_id', j.id, 'company_id', j.company_id, 'market_id', j.market_id,
      'full_name', cand.full_name, 'phone', cand.phone, 'email', cand.email, 'sms_opted_out', cand.sms_opted_out_at is not null,
      'source', coalesce(cj.outreach_source, case cand.source when 'indeed' then 'indeed' when 'linkedin' then 'linkedin'
                          when 'website' then 'applied' when 'inbound' then 'applied' when 'referral' then 'referral' else 'other' end),
      'job_title', j.title, 'location', j.location, 'compensation', j.compensation, 'schedule', j.schedule,
      'job_summary', left(nullif(j.candidate_description, ''), 1500),
      -- The thread to reply in: the first email this run (or the run it resumed) sent, and its subject.
      'thread_id', (select a.external_thread_id from public.pursuit_steps x join public.activities a on a.id = x.activity_id
                     where x.pursuit_id in (c.pursuit_id, p.resumed_from) and x.channel = 'email' and x.status = 'sent' and a.external_thread_id is not null
                     order by x.sent_at limit 1),
      'thread_subject', (select regexp_replace(a.summary, '^Automatic email to [^:]*: ', '') from public.pursuit_steps x
                          join public.activities a on a.id = x.activity_id
                         where x.pursuit_id in (c.pursuit_id, p.resumed_from) and x.channel = 'email' and x.status = 'sent'
                         order by x.sent_at limit 1),
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
