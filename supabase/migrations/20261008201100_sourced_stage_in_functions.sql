-- Treat Sourced like Applied everywhere a function lists the early stages.
do $do$
declare f text; d text;
begin
  foreach f in array array['screening_complete', 'pursuit_stop_on_stage', 'start_pursuit', 'reception_route', 'inbox_file'] loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f;
    d := replace(d, '(''applied'', ', '(''applied'', ''sourced'', ');
    if f = 'inbox_file' then
      -- Someone answering Justin's Indeed message is Sourced; anyone else who writes in has Applied.
      d := replace(d, 'values (cand, job.id, ''applied'', case when relay',
                      'values (cand, job.id, (case when relay and kind = ''interested'' then ''sourced'' else ''applied'' end)::public.pipeline_stage, case when relay');
      d := replace(d, 'summary = ''Applied to '' || job.title',
                      'summary = case when relay and kind = ''interested'' then ''Sourced for '' else ''Applied to '' end || job.title');
    end if;
    execute d;
  end loop;
end $do$;
