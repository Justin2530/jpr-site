-- Justin 2026-10-11: "our third eye and business brain agent should be able to look at all my conversations and
-- know based on the wording and messages if they are current or waiting on me". The minute tick has the AI read
-- each Messages conversation whose latest message changed and files its verdict here; the Messages tabs use it.
create table if not exists public.conversation_states (
  who text primary key,                 -- the conversation key, as in message_reads ('c:<id>:j<cj>', 'p:<id>:g<thread>' ...)
  state text not null check (state in ('waiting', 'current', 'done')),
  reason text,
  last_activity_id uuid,                -- the newest message the verdict was based on
  judged_at timestamptz not null default now()
);
alter table public.conversation_states enable row level security;
create policy "staff read conversation states" on public.conversation_states for select to authenticated using (public.is_staff());

-- Everything the tick needs to group and judge conversations: recent texts and emails (last 30 days) with the
-- people's names, each candidate's only open job (for untagged texts), and the verdicts already on file.
create or replace function public.conversations_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'kind', a.kind, 'direction', a.direction, 'summary', a.summary, 'body', left(a.body, 1500),
               'occurred_at', a.occurred_at, 'candidate_id', a.candidate_id, 'contact_id', a.contact_id,
               'candidate_job_id', a.candidate_job_id, 'external_thread_id', a.external_thread_id,
               'person', coalesce(ct.full_name, c.full_name), 'person_kind', case when a.contact_id is not null then 'client contact' else 'candidate' end)
             order by a.occurred_at)
        from public.activities a
        left join public.contacts ct on ct.id = a.contact_id
        left join public.candidates c on c.id = a.candidate_id
       where a.kind in ('text', 'email') and (a.candidate_id is not null or a.contact_id is not null)
         and a.occurred_at > now() - interval '30 days'), '[]'::jsonb),
    'sole', coalesce((
      select jsonb_object_agg(candidate_id, id) from (
        select candidate_id, min(id::text) as id from public.candidate_jobs
         where stage not in ('passed', 'withdrawn')
         group by candidate_id having count(*) = 1) s), '{}'::jsonb),
    'states', coalesce((select jsonb_object_agg(who, last_activity_id) from public.conversation_states), '{}'::jsonb));
end $$;
revoke execute on function public.conversations_pending(text) from public, anon, authenticated;
grant execute on function public.conversations_pending(text) to anon, authenticated;

create or replace function public.conversation_state_apply(p_secret text, p_who text, p_state text, p_reason text, p_last uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.conversation_states (who, state, reason, last_activity_id, judged_at)
  values (p_who, p_state, left(p_reason, 300), p_last, now())
  on conflict (who) do update set state = excluded.state, reason = excluded.reason,
    last_activity_id = excluded.last_activity_id, judged_at = now();
end $$;
revoke execute on function public.conversation_state_apply(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.conversation_state_apply(text, text, text, text, uuid) to anon, authenticated;

-- v2 (same day): rows also carry brain_status / relay_status (answered by the assistant), and states carry when
-- they were judged, so a rules change re-reads them. Applied as conversations_pending_v2.
