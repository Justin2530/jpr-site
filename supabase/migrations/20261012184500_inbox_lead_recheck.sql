-- Justin 2026-10-12: the inbox agent labeled 78 threads "Potential client" (now "Lead") and most were salespeople
-- pitching him. Each one is read again once under the stricter rule; those that aren't real leads lose the label
-- (state 'skip', which the labeler leaves alone).
alter table public.inbox_labels add column if not exists rechecked_at timestamptz;

create or replace function public.inbox_lead_recheck_list(p_secret text, p_staff uuid)
returns table (thread_id text, gmail_id text)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select l.thread_id, l.gmail_id from public.inbox_labels l
   where l.staff_id = p_staff and l.state = 'prospect' and l.rechecked_at is null
   order by l.created_at desc limit 10;
end $fn$;

create or replace function public.inbox_lead_recheck_done(p_secret text, p_staff uuid, p_thread text, p_keep boolean)
returns void
language plpgsql security definer set search_path to '' as $fn$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.inbox_labels set rechecked_at = now(), state = case when p_keep then state else 'skip' end
   where staff_id = p_staff and thread_id = p_thread;
end $fn$;

revoke execute on function public.inbox_lead_recheck_list(text, uuid) from public;
revoke execute on function public.inbox_lead_recheck_done(text, uuid, text, boolean) from public;
grant execute on function public.inbox_lead_recheck_list(text, uuid) to anon, authenticated;
grant execute on function public.inbox_lead_recheck_done(text, uuid, text, boolean) to anon, authenticated;
