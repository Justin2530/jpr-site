-- One row per company and place in the master lead list (Justin 2026-11-20: "i just dont want any duplicates as far as
-- compnaies/locations in my master leads sheet"). A business that is the same company at the same place as another
-- (same address and phone, same address or phone with a related name, or the same name in the same town) points at the
-- row the Sheet keeps; the Sheet folds it into that row's "Also at this location" column. Nothing is deleted.
-- Separate businesses that only share a building (malls, office blocks, hospitals) keep their own rows.
alter table public.lead_registry add column same_location_as text references public.lead_registry(filing) on delete set null;
create index lead_registry_same_location on public.lead_registry (same_location_as) where same_location_as is not null;
