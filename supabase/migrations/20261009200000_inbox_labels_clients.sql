-- Client labels too (Justin 2026-10-09): four labels in all. "Client" for mail from a current client (a
-- contact at a client company, or anyone at that company's own email domain), "Potential client" for a
-- business that might hire JPR (contacts at prospects, and mail the inbox watcher reads as a hiring lead).
alter table public.inbox_labels add column if not exists kind text not null default 'candidate'; -- or 'business'

create or replace function public.inbox_label_want(p_kind text, p_email text, p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_kind = 'business' then
      case when exists (
             select 1 from public.contacts ct join public.companies co on co.id = ct.company_id
              where co.status = 'client'
                and (lower(trim(ct.email)) = lower(trim(p_email))
                     or (split_part(lower(trim(ct.email)), '@', 2) = split_part(lower(trim(p_email)), '@', 2)
                         and split_part(lower(trim(p_email)), '@', 2) not in ('gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com',
                           'outlook.com', 'icloud.com', 'comcast.net', 'verizon.net', 'msn.com', 'live.com', 'att.net', 'me.com'))))
           then 'client' else 'prospect' end
    else public.inbox_label_state(p_email, p_name)
  end
$$;

create or replace function public.inbox_label_put(p_secret text, p_staff uuid, p_thread text, p_gmail text, p_from text, p_name text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.inbox_labels (staff_id, thread_id, gmail_id, from_email, from_name, kind)
  values (p_staff, p_thread, p_gmail, lower(trim(p_from)), coalesce(p_name, ''), case when p_kind = 'business' then 'business' else 'candidate' end)
  on conflict (staff_id, thread_id) do nothing;
end $$;

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
     and (l.tried_at is null or l.tried_at < now() - interval '1 hour')
   order by l.created_at
   limit 40;
end $$;

revoke all on function public.inbox_label_put(text, uuid, text, text, text, text, text), public.inbox_label_want(text, text, text) from public;
grant execute on function public.inbox_label_put(text, uuid, text, text, text, text, text) to anon, authenticated;
