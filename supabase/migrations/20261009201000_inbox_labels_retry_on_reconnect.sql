-- Threads Gmail refused (before label permission was granted) are retried right after Gmail is reconnected,
-- not an hour later.
create or replace function public.inbox_label_due(p_secret text, p_staff uuid)
returns table (thread_id text, want text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  select l.thread_id, s.want
    from public.inbox_labels l
    cross join lateral (select public.inbox_label_want(l.kind, l.from_email, l.from_name) as want) s
   where l.staff_id = p_staff
     and l.state is distinct from s.want and l.state is distinct from 'skip'
     and (l.tried_at is null or l.tried_at < now() - interval '1 hour'
          or l.tried_at < (select g.connected_at from public.google_accounts g where g.staff_id = p_staff))
   order by l.created_at
   limit 40;
end $$;
