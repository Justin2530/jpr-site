-- Jarvis, Justin's chief of staff agent (2026-11-12). He texts or calls it from his cell on the main line, or
-- talks to it in the Command Center. It reads everything and, after Justin says "confirm", acts as Justin.
-- Everything here is additive: three new tables and secret-gated functions for the app's server code.

create table if not exists public.jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('text', 'voice', 'app')),
  role text not null check (role in ('jp', 'jarvis')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_messages_at on public.jarvis_messages (created_at desc);

-- An action Jarvis proposed. Nothing runs until Justin confirms; the app runs it, not the model.
create table if not exists public.jarvis_actions (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('text', 'voice', 'app')),
  summary text not null,
  action jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled', 'replaced', 'expired')),
  result text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists jarvis_actions_at on public.jarvis_actions (created_at desc);

create table if not exists public.jarvis_calls (
  id uuid primary key default gen_random_uuid(),
  call_sid text,
  live_session_id text,
  status text not null default 'in_progress' check (status in ('in_progress', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  watch_note jsonb not null default '{}'::jsonb
);

alter table public.jarvis_messages enable row level security;
alter table public.jarvis_actions enable row level security;
alter table public.jarvis_calls enable row level security;
create policy "owner read" on public.jarvis_messages for select to authenticated using (public.is_owner());
create policy "owner read" on public.jarvis_actions for select to authenticated using (public.is_owner());
create policy "owner read" on public.jarvis_calls for select to authenticated using (public.is_owner());

-- The SQL with its quoted text taken out, so a note that says "drop" or "delete" isn't mistaken for a command.
create or replace function public.jarvis_strip(p_sql text) returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(p_sql, '''([^'']|'''')*''', '''''', 'g') $$;

-- What Jarvis may never touch: keys, tokens and system schemas. Checked on the SQL without its quoted text;
-- dollar quoting is refused outright so nothing can hide behind it.
create or replace function public.jarvis_sql_blocked(p_sql text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_sql ~ '\$[A-Za-z_0-9]*\$' or public.jarvis_strip(p_sql) ~* '(integration_secrets|google_accounts|push_subscriptions|staff_invites|vault\.|auth\.|storage\.|pg_catalog|pg_authid|pg_shadow|pg_read|pg_ls|pg_sleep|pg_terminate|pg_cancel|lo_import|lo_export|dblink|\mcopy\M|set_config|set\s+role|session_authorization|\mreset\M)'
      or public.jarvis_strip(p_sql) ~ ';\s*\S';
$$;

-- Read anything (except the blocked list). It switches its transaction to read-only before running the SQL
-- (Postgres allows going read-only at any point, never back), so nothing it runs can change data.
create or replace function public.jarvis_read(p_secret text, p_sql text) returns jsonb
language plpgsql volatile security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare out jsonb; q text := regexp_replace(p_sql, ';\s*$', '');
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  perform set_config('transaction_read_only', 'on', true);
  if q !~* '^\s*(select|with)\M' then raise exception 'Only SELECT queries here.'; end if;
  if public.jarvis_sql_blocked(q) then raise exception 'That table or command is off limits.'; end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 200) t', q) into out;
  return out;
end $$;

-- Make a change as Justin (the owner), after he confirmed it. INSERT, UPDATE, or SELECT of one of the app's
-- own functions (like set_job_automation). No deletes, no schema changes: those stay with the app's buttons.
create or replace function public.jarvis_write(p_secret text, p_sql text) returns jsonb
language plpgsql volatile security definer
set search_path = public
set statement_timeout = '15s'
as $$
declare
  out jsonb; n bigint; q text := regexp_replace(p_sql, ';\s*$', '');
  owner uuid := (select s.id from public.staff s where s.role = 'owner' and s.active order by s.created_at limit 1);
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if q !~* '^\s*(insert|update|select|with)\M' then raise exception 'Only INSERT, UPDATE or SELECT here.'; end if;
  if public.jarvis_strip(q) ~* '\m(delete|drop|truncate|alter|grant|revoke|create|comment|vacuum|policy|execute)\M' then
    raise exception 'Deletes and schema changes stay with the Command Center buttons.';
  end if;
  if public.jarvis_sql_blocked(q) then raise exception 'That table or command is off limits.'; end if;
  -- Act as Justin, so the app's own functions (is_staff checks, triggers) treat it as his click.
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  if q ~* '^\s*select\M' or (q ~* '^\s*with\M' and public.jarvis_strip(q) !~* '\m(insert|update)\M') then
    execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', q) into out;
  elsif public.jarvis_strip(q) ~* '\mreturning\M' then
    execute format('with t as (%s) select coalesce(jsonb_agg(t), ''[]''::jsonb) from t', q) into out;
  else
    execute q;
    get diagnostics n = row_count;
    out := jsonb_build_object('rows_changed', n);
  end if;
  return out;
end $$;

-- The map Jarvis reads the database with: tables, views and their columns, plus the app's functions.
create or replace function public.jarvis_schema(p_secret text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare t text; f text; e text;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select string_agg(line, E'\n' order by line) into t from (
    select c.table_name || '(' || string_agg(c.column_name || ' ' || c.udt_name, ', ' order by c.ordinal_position) || ')' as line
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name not in ('integration_secrets', 'google_accounts', 'push_subscriptions', 'staff_invites', 'lead_spend', 'label_backfill')
       and c.table_name !~ '^jarvis_'
     group by c.table_name) x;
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', E'\n' order by p.proname) into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_function_identity_arguments(p.oid) !~ 'p_secret'
     and p.proname !~ '^(jarvis_|is_staff|is_owner|can_access|handle_|tg_|trg_)';
  select string_agg(ty.typname || ': ' || vals, E'\n' order by ty.typname) into e from (
    select t2.typname, string_agg(en.enumlabel, ', ' order by en.enumsortorder) vals, t2.oid
      from pg_type t2 join pg_enum en on en.enumtypid = t2.oid join pg_namespace n2 on n2.oid = t2.typnamespace
     where n2.nspname = 'public' group by t2.typname, t2.oid) ty;
  return 'TABLES AND VIEWS:' || E'\n' || coalesce(t, '') || E'\n\nENUM VALUES:\n' || coalesce(e, '') || E'\n\nFUNCTIONS (call with SELECT in a change):\n' || coalesce(f, '');
end $$;

create or replace function public.jarvis_log(p_secret text, p_channel text, p_role text, p_content text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.jarvis_messages (channel, role, content) values (p_channel, p_role, left(p_content, 8000));
end $$;

-- The running conversation, across text, calls and the Command Center, oldest first.
create or replace function public.jarvis_recent(p_secret text, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'channel', m.channel, 'role', m.role, 'content', m.content) order by m.created_at)
    from (select * from public.jarvis_messages where created_at > now() - interval '3 days' order by created_at desc limit p_limit) m), '[]'::jsonb);
end $$;

create or replace function public.jarvis_propose(p_secret text, p_channel text, p_summary text, p_action jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare id uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.jarvis_actions set status = 'replaced', decided_at = now() where status = 'pending';
  insert into public.jarvis_actions (channel, summary, action) values (p_channel, p_summary, p_action) returning jarvis_actions.id into id;
  return id;
end $$;

-- The one action waiting on Justin's confirm, if any (they lapse after 30 minutes).
create or replace function public.jarvis_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.jarvis_actions set status = 'expired', decided_at = now()
   where status = 'pending' and created_at < now() - interval '30 minutes';
  return (select to_jsonb(a) from public.jarvis_actions a where a.status = 'pending' order by a.created_at desc limit 1);
end $$;

-- Claim a pending action to run it (only once), or close it out.
create or replace function public.jarvis_decide(p_secret text, p_id uuid, p_status text, p_result text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if p_status = 'running' then
    update public.jarvis_actions set status = 'done', decided_at = now(), result = 'running'
     where id = p_id and status = 'pending';
  else
    update public.jarvis_actions set status = p_status, decided_at = coalesce(decided_at, now()), result = p_result where id = p_id;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.jarvis_call_open(p_secret text, p_sid text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare id uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.jarvis_calls (call_sid) values (p_sid) returning jarvis_calls.id into id;
  return id;
end $$;

create or replace function public.jarvis_call_get(p_secret text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select to_jsonb(c) from public.jarvis_calls c where c.id = p_id);
end $$;

create or replace function public.jarvis_call_update(p_secret text, p_id uuid, p_session text default null, p_ended boolean default false, p_note jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.jarvis_calls set
    live_session_id = coalesce(p_session, live_session_id),
    status = case when p_ended then 'ended' else status end,
    ended_at = case when p_ended then coalesce(ended_at, now()) else ended_at end,
    watch_note = case when p_note is null then watch_note else watch_note || p_note end
   where id = p_id;
end $$;

grant execute on function public.jarvis_read(text, text), public.jarvis_write(text, text), public.jarvis_schema(text),
  public.jarvis_log(text, text, text, text), public.jarvis_recent(text, int), public.jarvis_propose(text, text, text, jsonb),
  public.jarvis_pending(text), public.jarvis_decide(text, uuid, text, text), public.jarvis_call_open(text, text),
  public.jarvis_call_get(text, uuid), public.jarvis_call_update(text, uuid, text, boolean, jsonb)
  to anon, authenticated;
