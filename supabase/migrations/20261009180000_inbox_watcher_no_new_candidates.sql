-- Justin 2026-10-09: "I don't want it adding candidates into the system because they don't have resumes
-- yet, and half of them it doesn't even know which job." The inbox watcher only files mail from people
-- already in the Command Center; he brings new people in by hand.
do $$
declare def text;
begin
  select pg_get_functiondef('public.inbox_file(text, jsonb)'::regprocedure) into def;
  if position('  if cand is null and kind = ''not_interested'' then return null; end if;' in def) = 0 then
    raise exception 'inbox_file pattern not found';
  end if;
  def := replace(def, '  if cand is null and kind = ''not_interested'' then return null; end if;',
'  -- Justin 2026-10-09: the inbox watcher never adds new people; he brings candidates in by hand.
  if cand is null then return null; end if;');
  execute def;
end $$;
