-- Correspondence history: each call, text or email keeps its full content, not just a one-line summary.
alter table public.activities add column body text;
alter table public.activities add column direction text check (direction in ('in', 'out'));
alter table public.activities add column duration_seconds integer;
