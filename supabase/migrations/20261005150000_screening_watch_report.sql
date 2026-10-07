-- The Trigger.dev call watcher reports what it saw on each call (attached, why it hung up, which
-- OpenAI events arrived) so problems can be diagnosed from the database. It only holds the publishable
-- key, so the proof it's allowed to write is knowing both the run id and that call's OpenAI session id.
alter table public.screening_runs add column if not exists watch_note jsonb;

create or replace function public.screening_watch_report(p_run uuid, p_session text, p_note jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_session is null or length(p_session) < 20 or length(p_note::text) > 20000 then return false; end if;
  update public.screening_runs
     set watch_note = coalesce(watch_note, '{}'::jsonb) || jsonb_strip_nulls(p_note)
   where id = p_run and live_session_id = p_session and started_at > now() - interval '1 hour';
  return found;
end $$;
revoke execute on function public.screening_watch_report(uuid, text, jsonb) from public;
grant execute on function public.screening_watch_report(uuid, text, jsonb) to anon, authenticated;
