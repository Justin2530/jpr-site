-- Staff can remove unsent reply drafts, so taking someone off a job (or deleting them) isn't blocked by one.
create policy "staff remove" on public.inbox_drafts for delete to authenticated using (public.is_staff());
