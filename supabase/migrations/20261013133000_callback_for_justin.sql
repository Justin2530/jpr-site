-- Timothy Cox (2026-10-13) asked on the AI call to talk with Justin himself at 4pm, and the callback was booked as
-- another AI call. When they asked for Justin, the callback is now a reminder for Justin to call, not an AI call.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.screening_complete(text, uuid, jsonb)'::regprocedure);
  if position('wants_justin' in d) = 0 then
    d := replace(d,
$a$    if at_ts > now() then
      insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
      values (cj_id, 'scheduled', 'phone', at_ts, 'Call back: ' || coalesce(p->>'summary', ''));
    end if;$a$,
$b$    if at_ts > now() and coalesce((p->>'wants_justin')::boolean, false) then
      insert into public.action_items (kind, title, detail, priority, due_on, candidate_id, candidate_job_id, job_id, company_id, market_id)
      values ('task', 'Call ' || who || ' · ' || to_char(at_ts at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'),
              'They asked to talk with you directly. ' || coalesce(p->>'summary', ''), 1, (at_ts at time zone 'America/New_York')::date,
              (ctx->>'candidate_id')::uuid, cj_id, (ctx->>'job_id')::uuid, (ctx->>'company_id')::uuid, (ctx->>'market_id')::uuid);
    elsif at_ts > now() then
      insert into public.screening_runs (candidate_job_id, status, channel, scheduled_for, summary)
      values (cj_id, 'scheduled', 'phone', at_ts, 'Call back: ' || coalesce(p->>'summary', ''));
    end if;$b$);
    if position('wants_justin' in d) = 0 then raise exception 'screening_complete callback block not found'; end if;
    execute d;
  end if;
end $mig$;
