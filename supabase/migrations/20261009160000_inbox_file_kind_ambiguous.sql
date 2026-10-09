-- inbox_file's "kind" variable clashed with activities.kind in the Applied/Sourced log update,
-- so any email that put a new person on a job failed and was retried every minute.
do $$
declare def text;
begin
  select pg_get_functiondef('public.inbox_file(text, jsonb)'::regprocedure) into def;
  if position('update public.activities set summary = case when relay' in def) = 0 then
    raise exception 'inbox_file pattern not found';
  end if;
  def := replace(def, 'update public.activities set summary = case when relay', 'update public.activities a set summary = case when relay');
  def := replace(def, 'where candidate_job_id = cj and kind = ''assigned''', 'where a.candidate_job_id = cj and a.kind = ''assigned''');
  execute def;
end $$;
