-- A caller the answering agent couldn't place (new number) who gives their name, and a candidate with that exact
-- name (the only one), belong together: link the call, its activity and call-back task, and save the number.
-- Runs both ways: when the call is written up, and when the inbox watcher adds the candidate later.
create or replace function public.link_caller_calls(p_cand uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; nm text;
begin
  select lower(trim(full_name)) into nm from public.candidates where id = p_cand;
  if nm is null or nm = '' or position(' ' in nm) = 0 then return 0; end if;
  -- Only when the name is unique among candidates, so a common name never gets the wrong person's calls.
  if (select count(*) from public.candidates where lower(trim(full_name)) = nm) <> 1 then return 0; end if;
  for r in
    select rc.* from public.reception_calls rc
     where rc.candidate_id is null and rc.contact_id is null and rc.created_at > now() - interval '30 days'
       and lower(trim(rc.notes->>'caller_name')) = nm
  loop
    update public.reception_calls set candidate_id = p_cand where id = r.id;
    update public.activities set candidate_id = p_cand where external_id = r.call_sid and candidate_id is null;
    update public.action_items set candidate_id = p_cand where id = r.action_item_id and candidate_id is null;
    update public.candidates set phone = coalesce(nullif(r.notes->>'callback_number', ''), r.from_number)
     where id = p_cand and phone is null;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.link_caller_calls(uuid) from public, anon, authenticated;

do $do$
declare d text; before text;
begin
  -- After a call is written up: a new number that named an existing candidate gets linked to them.
  select pg_get_functiondef('public.reception_complete'::regproc) into d; before := d;
  d := regexp_replace(d, 'end \$function\$\s*$',
    '  if r.candidate_id is null and r.contact_id is null and nullif(p->>''caller_name'', '''') is not null then
    perform public.link_caller_calls(c.id) from public.candidates c
     where lower(trim(c.full_name)) = lower(trim(p->>''caller_name'')) limit 1;
  end if;
end $function$
');
  if d = before then raise exception 'reception_complete: pattern not found'; end if;
  execute d;

  -- When the inbox watcher adds someone, pick up any earlier call from them.
  select pg_get_functiondef('public.inbox_file'::regproc) into d; before := d;
  d := replace(d, '  update public.inbox_triaged set candidate_id = cand where gmail_id = p->>''gmail_id'';',
                  '  update public.inbox_triaged set candidate_id = cand where gmail_id = p->>''gmail_id'';
  perform public.link_caller_calls(cand);');
  if d = before then raise exception 'inbox_file: pattern not found'; end if;
  execute d;
end $do$;
