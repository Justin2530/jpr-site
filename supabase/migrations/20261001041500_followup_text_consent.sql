-- Automatic texts only go to candidates with texting consent on file (the checkbox on their record),
-- so the newly approved A2P campaign isn't put at risk. Emails still go to everyone assigned.
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
