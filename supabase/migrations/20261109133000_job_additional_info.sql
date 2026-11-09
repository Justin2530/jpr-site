-- Additional information on a job (Justin 2026-11-09): things he wants candidates to know that may not be
-- in the job description. Set up like the screening questions, one line each. The screening call tells
-- candidates; the reply brain and the answering agent use it to answer them.

alter table public.jobs add column if not exists additional_info text[] not null default '{}';

-- Hand the lines to the agents' context functions without retyping them: each gets one extra key.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.screening_context'::regproc);
  d := replace(d, $s$'job_description', left(coalesce(nullif(j.candidate_description, ''), j.description), 6000),$s$,
                  $s$'job_description', left(coalesce(nullif(j.candidate_description, ''), j.description), 6000), 'additional_info', j.additional_info,$s$);
  if position('additional_info' in d) = 0 then raise exception 'screening_context not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.brain_pending'::regproc);
  d := replace(d, $s$'job_summary', left(coalesce(j.candidate_description, j.description), 1500),$s$,
                  $s$'job_summary', left(coalesce(j.candidate_description, j.description), 1500), 'additional_info', j.additional_info,$s$);
  if position('additional_info' in d) = 0 then raise exception 'brain_pending not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.reception_open'::regproc);
  d := replace(d, $s$'pay', j.compensation, 'schedule', j.schedule,$s$, $s$'pay', j.compensation, 'schedule', j.schedule, 'info', j.additional_info,$s$);
  d := replace(d, $s$'pay', j.compensation, 'schedule', j.schedule))$s$, $s$'pay', j.compensation, 'schedule', j.schedule, 'info', j.additional_info))$s$);
  if (length(d) - length(replace(d, $s$'info', j.additional_info$s$, ''))) / length($s$'info', j.additional_info$s$) <> 2 then
    raise exception 'reception_open not patched';
  end if;
  execute d;
end $$;
