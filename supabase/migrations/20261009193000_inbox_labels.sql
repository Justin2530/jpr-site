-- Gmail labels for potential candidates (Justin 2026-10-09): the inbox watcher never adds people; it marks
-- each candidate email thread "Candidate - Needs adding" or "Candidate - In system" so he can spot them in
-- a busy inbox. Whether someone is in the system is worked out live, so the label flips by itself when he
-- adds them (or back, if they are removed).
create table if not exists public.inbox_labels (
  staff_id uuid not null references public.staff(id),
  thread_id text not null,
  gmail_id text,
  from_email text not null,
  from_name text not null default '',
  state text, -- the label Gmail has now: 'needs', 'in', null before it's been labeled, 'skip' for mail that's gone
  tried_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (staff_id, thread_id)
);
alter table public.inbox_labels enable row level security;
create index if not exists inbox_labels_gmail on public.inbox_labels (gmail_id);

-- First and last name, lower case, ignoring middle names, initials and "via Indeed".
create or replace function public.name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case when array_length(w, 1) >= 2 then w[1] || ' ' || w[array_length(w, 1)] end
    from (select regexp_split_to_array(trim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '\s+via\s+indeed.*$', ''), '[^a-z'' -]+', ' ', 'g')), '\s+') w) x
$$;

-- Is this sender a candidate on file? Same email, their Indeed relay address, or the one candidate with that name.
create or replace function public.inbox_label_state(p_email text, p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.candidates c
                            where lower(trim(c.email)) = lower(trim(p_email)) or lower(c.indeed_relay) = lower(trim(p_email)))
                or (select count(*) from public.candidates c where public.name_key(c.full_name) = public.name_key(p_name)
                     and public.name_key(p_name) is not null) = 1
              then 'in' else 'needs' end
$$;

create or replace function public.inbox_label_put(p_secret text, p_staff uuid, p_thread text, p_gmail text, p_from text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.inbox_labels (staff_id, thread_id, gmail_id, from_email, from_name)
  values (p_staff, p_thread, p_gmail, lower(trim(p_from)), coalesce(p_name, ''))
  on conflict (staff_id, thread_id) do nothing;
end $$;

-- Threads whose Gmail label is missing or out of date, with the label they should have. A thread Gmail
-- refused is retried after an hour (e.g. until Gmail is reconnected with label permission).
create or replace function public.inbox_label_due(p_secret text, p_staff uuid)
returns table (thread_id text, want text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  select l.thread_id, s.want
    from public.inbox_labels l
    cross join lateral (select public.inbox_label_state(l.from_email, l.from_name) as want) s
   where l.staff_id = p_staff
     and l.state is distinct from s.want and l.state is distinct from 'skip'
     and (l.tried_at is null or l.tried_at < now() - interval '1 hour')
   order by l.created_at
   limit 40;
end $$;

create or replace function public.inbox_label_done(p_secret text, p_staff uuid, p_thread text, p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.inbox_labels l
     set state = coalesce(p_state, l.state), tried_at = case when p_state is null then now() else null end
   where l.staff_id = p_staff and l.thread_id = p_thread;
end $$;

-- Candidate emails the watcher read before labels existed, so they can be labeled too.
create or replace function public.inbox_label_backlog(p_secret text)
returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  select t.gmail_id from public.inbox_triaged t
   where t.kind in ('interested', 'message', 'job_seeker')
     and not exists (select 1 from public.inbox_labels l where l.gmail_id = t.gmail_id)
   order by t.created_at limit 10;
end $$;

revoke all on function public.inbox_label_put(text, uuid, text, text, text, text), public.inbox_label_due(text, uuid),
  public.inbox_label_done(text, uuid, text, text), public.inbox_label_backlog(text), public.inbox_label_state(text, text) from public;
grant execute on function public.inbox_label_put(text, uuid, text, text, text, text), public.inbox_label_due(text, uuid),
  public.inbox_label_done(text, uuid, text, text), public.inbox_label_backlog(text) to anon, authenticated;
