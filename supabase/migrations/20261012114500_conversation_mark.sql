-- Justin 2026-10-12: "i should be able to mark conversations as done manually". His mark sticks until a new message
-- arrives (then the AI reads it again); judged_at is set far ahead so rules changes don't re-read it.
alter table public.conversation_states add column if not exists manual boolean not null default false;

create or replace function public.conversation_mark(p_who text, p_state text, p_last uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Staff only.'; end if;
  if p_state not in ('done', 'current', 'waiting') then raise exception 'Unknown state.'; end if;
  insert into public.conversation_states (who, state, reason, last_activity_id, judged_at, manual)
  values (p_who, p_state, case p_state when 'done' then 'Marked done by you.' else 'Reopened by you.' end, p_last, '2100-01-01', true)
  on conflict (who) do update set state = excluded.state, reason = excluded.reason,
    last_activity_id = excluded.last_activity_id, judged_at = excluded.judged_at, manual = true;
end $$;
revoke execute on function public.conversation_mark(text, text, uuid) from public, anon;
grant execute on function public.conversation_mark(text, text, uuid) to authenticated;

create or replace function public.conversation_state_apply(p_secret text, p_who text, p_state text, p_reason text, p_last uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.conversation_states (who, state, reason, last_activity_id, judged_at, manual)
  values (p_who, p_state, left(p_reason, 300), p_last, now(), false)
  on conflict (who) do update set state = excluded.state, reason = excluded.reason,
    last_activity_id = excluded.last_activity_id, judged_at = now(), manual = false;
end $$;
