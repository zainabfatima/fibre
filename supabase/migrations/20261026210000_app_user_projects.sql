-- A client login can be linked to more than one project.
-- app_users.project_id stays as the first assigned project for older readers.
-- The full set is this table.

create table public.app_user_projects (
  user_id uuid not null references public.app_users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

comment on table public.app_user_projects is
  'Projects a client login can open. Admins are not linked here.';

comment on column public.app_users.project_id is
  'First assigned project. The full set for a client login is public.app_user_projects.';

create index app_user_projects_project_id_idx
  on public.app_user_projects (project_id);

alter table public.app_user_projects enable row level security;

revoke all on table public.app_user_projects from anon, authenticated;
grant all on table public.app_user_projects to service_role;

insert into public.app_user_projects (user_id, project_id)
select id, project_id
from public.app_users
where project_id is not null
on conflict do nothing;
