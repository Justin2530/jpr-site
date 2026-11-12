-- Server-side removal of test records Justin asks to be cleared (he can't see Supabase approval boxes, so
-- deletes go through the app). Only the app's server holds the automation secret. Rows are removed one by
-- one by key, from a short list of tables whose rows nothing else depends on. Additive: creates a function only.
create or replace function public.delete_test_records(p_secret text, p_table text, p_keys text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  key_col text;
  n integer;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  key_col := case p_table
    when 'action_items' then 'id'
    when 'activities' then 'id'
    when 'jarvis_messages' then 'id'
    when 'jarvis_actions' then 'id'
    when 'conversation_states' then 'who'
  end;
  if key_col is null then raise exception 'table % is not allowed', p_table; end if;
  if coalesce(array_length(p_keys, 1), 0) = 0 or array_length(p_keys, 1) > 50 then raise exception 'give 1 to 50 keys'; end if;
  execute format('delete from public.%I where %I::text = any($1)', p_table, key_col) using p_keys;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.delete_test_records(text, text, text[]) from public;
grant execute on function public.delete_test_records(text, text, text[]) to anon, authenticated;
