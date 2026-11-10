-- Website applicants can attach a resume. The browser may only ADD a file under resumes/website/
-- (random name, resume file types, the bucket's 10MB cap). It can't list, read, replace or delete anything.
create policy "website resume upload" on storage.objects for insert to anon
  with check (bucket_id = 'resumes' and name like 'website/%' and lower(storage.extension(name)) in ('pdf', 'doc', 'docx', 'rtf', 'txt'));

-- site_application plus the uploaded resume. The file must exist, be fresh, and not belong to anyone yet.
create or replace function public.site_apply(
  p_name text, p_email text, p_phone text, p_city text, p_job uuid, p_history text, p_sms_ok boolean,
  p_resume_path text default null, p_resume_name text default null, p_trap text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  cand uuid; obj record;
  mail text := nullif(lower(left(btrim(coalesce(p_email, '')), 200)), '');
  tel text := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
begin
  if coalesce(p_trap, '') <> '' then return true; end if;
  perform public.site_application(p_name, p_email, p_phone, p_city, p_job, p_history, p_sms_ok, null);
  if p_resume_path is null or p_resume_path not like 'website/%' then return true; end if;
  select o.name, o.metadata into obj from storage.objects o
   where o.bucket_id = 'resumes' and o.name = p_resume_path and o.created_at > now() - interval '1 hour';
  if not found or exists (select 1 from public.resumes r where r.storage_path = p_resume_path) then return true; end if;
  select c.id into cand from public.candidates c
   where (mail is not null and lower(c.email) = mail) or (tel is not null and public.phone_key(c.phone) = public.phone_key(tel))
   order by c.updated_at desc limit 1;
  if cand is null then return true; end if;
  insert into public.resumes (candidate_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (cand, p_resume_path, left(coalesce(nullif(btrim(p_resume_name), ''), 'Resume'), 200),
          obj.metadata ->> 'mimetype', nullif(obj.metadata ->> 'size', '')::integer, null);
  return true;
end;
$$;
revoke execute on function public.site_apply(text, text, text, text, uuid, text, boolean, text, text, text) from public;
grant execute on function public.site_apply(text, text, text, text, uuid, text, boolean, text, text, text) to anon, authenticated;
