-- JPR resumes: a clean copy of the candidate's resume with JPR's logo and colors, same words. Kept as its own
-- file next to the original, which is never changed.
alter table public.resumes add column if not exists branded_from uuid; -- the original resume's id
alter table public.resumes add column if not exists brand_check text;  -- the word-for-word check result
