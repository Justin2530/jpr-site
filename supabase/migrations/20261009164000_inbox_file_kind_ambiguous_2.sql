-- The Applied/Sourced log update also read the "kind" variable inside its SET, where activities.kind
-- is in scope too; read it from the payload instead.
do $$
declare def text;
begin
  select pg_get_functiondef('public.inbox_file(text, jsonb)'::regprocedure) into def;
  if position('update public.activities a set summary = case when relay and kind = ''interested''' in def) = 0 then
    raise exception 'inbox_file pattern not found';
  end if;
  def := replace(def, 'update public.activities a set summary = case when relay and kind = ''interested''',
                      'update public.activities a set summary = case when relay and p->>''kind'' = ''interested''');
  execute def;
end $$;
