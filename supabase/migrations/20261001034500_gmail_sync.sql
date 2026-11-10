-- When this mailbox was last checked for replies from candidates and contacts.
alter table public.google_accounts add column if not exists last_synced_at timestamptz;
