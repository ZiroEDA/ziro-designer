-- Ziro Designer, Supabase Storage for project file blobs.
-- Run once in the Supabase SQL editor. This keeps large files OUT of Postgres
-- (storing blobs in the DB is what filled it and made it unhealthy); the
-- `projects` table then holds only metadata + the file list.
--
-- Objects are laid out as  <user_id>/<project_id>/<filename>.gz  and each user
-- can only touch their own folder (first path segment == their uid).
-- After running this, set  VITE_SUPABASE_STORAGE_BUCKET=projects  in the app env.

-- Create the private bucket (or make it in Dashboard → Storage → New bucket).
insert into storage.buckets (id, name, public)
values ('projects', 'projects', false)
on conflict (id) do nothing;

drop policy if exists "proj_files_select_own" on storage.objects;
drop policy if exists "proj_files_insert_own" on storage.objects;
drop policy if exists "proj_files_update_own" on storage.objects;
drop policy if exists "proj_files_delete_own" on storage.objects;

create policy "proj_files_select_own" on storage.objects for select
  using (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "proj_files_insert_own" on storage.objects for insert
  with check (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "proj_files_update_own" on storage.objects for update
  using (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "proj_files_delete_own" on storage.objects for delete
  using (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);
