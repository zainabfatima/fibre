-- Job-site progress photos, stored apart from receipts.
-- Path in the progress-pictures bucket: {project_id}/{picture_id}.jpg

create table public.progress_pictures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  category_id integer not null references public.categories (id),
  file_path text not null,
  created_at timestamptz not null default now(),
  constraint progress_pictures_file_path_not_blank check (length(btrim(file_path)) > 0)
);

comment on table public.progress_pictures is
  'Camera photos of job progress. Private file path: {project_id}/{picture_id}.jpg in the progress-pictures bucket.';

create index progress_pictures_project_category_created_idx
  on public.progress_pictures (project_id, category_id, created_at);

alter table public.progress_pictures enable row level security;

create policy progress_pictures_authenticated_all
  on public.progress_pictures
  for all
  to authenticated
  using (public.has_company_access())
  with check (public.has_company_access());

grant select, insert, update, delete on public.progress_pictures to authenticated;
grant all on public.progress_pictures to service_role;
revoke all on public.progress_pictures from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'progress-pictures',
  'progress-pictures',
  false,
  20971520,
  array['image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists progress_pictures_select on storage.objects;
create policy progress_pictures_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'progress-pictures' and public.has_company_access());

drop policy if exists progress_pictures_insert on storage.objects;
create policy progress_pictures_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'progress-pictures' and public.has_company_access());

drop policy if exists progress_pictures_delete on storage.objects;
create policy progress_pictures_delete
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'progress-pictures' and public.has_company_access());
