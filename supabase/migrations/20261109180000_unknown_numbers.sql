-- Texts and calls from numbers not on file (Justin 2026-11-09: a text from someone he'd reached out to
-- reached his phone but not Messages). Messages now lists them under "Not on file yet"; once he adds the
-- person as a contact or candidate, their earlier texts and calls from that number attach to the record.

create or replace function public.link_phone_activities()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text := public.phone_key(new.phone);
begin
  if length(coalesce(k, '')) <> 10 then return new; end if;
  if tg_op = 'UPDATE' and public.phone_key(old.phone) is not distinct from k then return new; end if;
  if tg_table_name = 'contacts' then
    update public.activities a set contact_id = new.id, company_id = coalesce(a.company_id, new.company_id)
     where a.candidate_id is null and a.contact_id is null and a.kind in ('text', 'call')
       and public.phone_key(a.phone_number) = k;
    update public.action_items i set contact_id = new.id
     where i.candidate_id is null and i.contact_id is null and i.status = 'open'
       and i.title ~ ' from \+?1?[0-9]{10}$' and public.phone_key(substring(i.title from '[0-9+]+$')) = k;
  else
    update public.activities a set candidate_id = new.id
     where a.candidate_id is null and a.contact_id is null and a.kind in ('text', 'call')
       and public.phone_key(a.phone_number) = k;
    update public.action_items i set candidate_id = new.id
     where i.candidate_id is null and i.contact_id is null and i.status = 'open'
       and i.title ~ ' from \+?1?[0-9]{10}$' and public.phone_key(substring(i.title from '[0-9+]+$')) = k;
  end if;
  return new;
end $$;

create trigger contacts_link_phone after insert or update of phone on public.contacts
  for each row execute function public.link_phone_activities();
create trigger candidates_link_phone after insert or update of phone on public.candidates
  for each row execute function public.link_phone_activities();
