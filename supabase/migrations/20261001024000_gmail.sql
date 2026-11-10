-- Gmail: each staff member can connect their own Google Workspace mailbox. The refresh token is stored
-- encrypted with a key only the server has (derived from the Google client secret), so a row read
-- through the API is useless on its own.
create table public.google_accounts (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  email text not null,
  token_enc text not null,
  scopes text,
  connected_at timestamptz not null default now()
);
alter table public.google_accounts enable row level security;
create policy "own google account" on public.google_accounts for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());

-- Gmail thread of a sent or received email, so replies can be matched to the same conversation.
alter table public.activities add column if not exists external_thread_id text;
