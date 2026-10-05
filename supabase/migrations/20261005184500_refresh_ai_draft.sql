-- A later screening call refreshes the AI's submission draft, as long as Justin hasn't edited or sent it
-- (before, only the first call's draft was ever kept).
create or replace function public.screening_complete(p_secret text, p_run uuid, p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; cj_id uuid; f jsonb; i int := 0; outcome text := coalesce(p->>'outcome', 'incomplete'); who text;
  at_ts timestamptz; mins int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  ctx := public.screening_context(p_run);
  if ctx is null then return 'missing'; end if;
  cj_id := (ctx->>'candidate_job_id')::uuid;
  who := ctx->>'full_name';

  update public.screening_runs set
    status = 'completed', process_state = 'done', process_note = null, ended_at = coalesce(ended_at, now()),
    summary = p->>'summary',
    transcript = coalesce(p->'transcript', '[]'::jsonb),
    candidate_questions = coalesce(array(select jsonb_array_elements_text(p->'candidate_questions')), '{}'),
    concerns = coalesce(array(select jsonb_array_elements_text(p->'concerns')), '{}'),
    unresolved = coalesce(array(select jsonb_array_elements_text(p->'unresolved')), '{}')
  where id = p_run;

  for f in select value from jsonb_array_elements(coalesce(p->'facts', '[]'::jsonb)) loop
    i := i + 1;
    if coalesce(f->>'value', '') = '' then continue; end if;
    insert into public.screening_facts (candidate_job_id, run_id, goal_id, label, value, source, sort)
    values (cj_id, p_run,
            (select g.id from public.screening_goals g where g.id::text = f->>'goal_id' and g.job_id = (ctx->>'job_id')::uuid),
            left(coalesce(f->>'label', 'Note'), 200), left(f->>'value', 2000), 'ai', i);
  end loop;

  select duration_seconds / 60 into mins from public.screening_runs where id = p_run;
  insert into public.activities (kind, direction, summary, body, duration_seconds, candidate_id, candidate_job_id, job_id, company_id, market_id)
  values ('call', 'out', 'AI screening call with ' || who || coalesce(' (' || nullif(mins, 0) || ' min)', ''), p->>'summary',
          (select duration_seconds from public.screening_runs where id = p_run),
          (ctx->>'candidate_id')::uuid, cj_id, (ctx->>'job_id')::uuid, (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid);

  if outcome = 'interested' then
    if coalesce(p->'submission'->>'body', '') <> '' then
      -- A newer call replaces an AI draft Justin hasn't touched; his edited drafts and sent ones stay.
      update public.submissions s
         set run_id = p_run, subject = p->'submission'->>'subject', body = p->'submission'->>'body',
             created_at = now(), updated_at = now()
       where s.candidate_job_id = cj_id and s.status = 'draft' and s.drafted_by = 'ai' and s.updated_at <= s.created_at;
      if not found and not exists (select 1 from public.submissions s where s.candidate_job_id = cj_id and s.status in ('draft', 'sent')) then
        insert into public.submissions (candidate_job_id, run_id, status, subject, body, to_contact_ids, drafted_by)
        values (cj_id, p_run, 'draft', p->'submission'->>'subject', p->'submission'->>'body',
                case when ctx->>'hiring_contact_id' is not null then array[(ctx->>'hiring_contact_id')::uuid] else '{}'::uuid[] end,
                'ai');
      end if;
    end if;
    update public.candidate_jobs set stage = 'ready_to_submit'
     where id = cj_id and stage in ('applied', 'assigned', 'contacting', 'conversation');
  elsif outcome = 'not_interested' then
    update public.candidate_jobs set stage = 'passed'
     where id = cj_id and stage in ('applied', 'assigned', 'contacting', 'conversation');
  elsif outcome = 'callback' and coalesce(p->>'callback_at_local', '') ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then
    at_ts := (p->>'callback_at_local')::timestamp at time zone 'America/New_York';
    if at_ts > now() then
      insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
      values (cj_id, 'scheduled', 'phone', at_ts, 'Call back: ' || coalesce(p->>'summary', ''));
    end if;
  else
    -- Hung up early or couldn't finish: the one case after a call that needs Justin.
    insert into public.action_items (kind, title, detail, priority, candidate_id, candidate_job_id, job_id, company_id, market_id)
    values ('task', 'Screening call with ' || who || ' didn''t finish', coalesce(p->>'summary', ''), 2,
            (ctx->>'candidate_id')::uuid, cj_id, (ctx->>'job_id')::uuid, (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid);
  end if;
  return outcome;
end $$;
revoke execute on function public.screening_complete(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.screening_complete(text, uuid, jsonb) to anon, authenticated;
