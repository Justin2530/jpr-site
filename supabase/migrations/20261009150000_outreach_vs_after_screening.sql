-- The candidate's switch is for outreach (the texts, emails and calls before screening). After screening,
-- client follow-ups and the interview-scheduling relay run whenever the master and the job are on and the
-- candidate isn't paused, whether the screening came from outreach or Justin's own Call now.
create or replace function public.automation_allowed(p_cj uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.automated_recruiting and s.eligible_after_v1 is not null and c.created_at >= s.eligible_after_v1
           and c.automation_paused_at is null and j.automation_pilot
      from public.automation_settings s
      cross join public.candidate_jobs cj
      join public.candidates c on c.id = cj.candidate_id
      join public.jobs j on j.id = cj.job_id
     where cj.id = p_cj), false);
$$;

create or replace function public.outreach_allowed(p_cj uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.automation_allowed(p_cj) and coalesce((select automate from public.candidate_jobs where id = p_cj), false);
$$;

do $do$
declare f text; d text; before text;
begin
  foreach f in array array['automation_due', 'automation_sync', 'set_outreach', 'start_pursuit'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    before := d;
    d := replace(d, 'public.automation_allowed(', 'public.outreach_allowed(');
    if d = before then raise exception '%: pattern not found', f; end if;
    execute d;
  end loop;
end $do$;
