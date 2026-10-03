-- What a company is called in everyday emails ("ALKAB", not "ALKAB Machine & Welding Co, LLC").
alter table public.companies add column if not exists short_name text;
