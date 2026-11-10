-- Calls, texts, emails and reminders can be tied to a specific client contact.
alter table public.activities add column contact_id uuid references public.contacts (id) on delete set null;
alter table public.action_items add column contact_id uuid references public.contacts (id) on delete cascade;
create index activities_contact_idx on public.activities (contact_id, occurred_at desc);
