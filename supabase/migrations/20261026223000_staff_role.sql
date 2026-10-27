-- Staff logins upload progress pictures for projects in app_user_projects.
-- Client multi-project links stay on that same table.

alter table public.app_users drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check check (role in ('admin', 'client', 'staff'));

comment on table public.app_user_projects is
  'Projects a client or staff login can open. Admins are not linked here. Clients view those projects. Staff upload progress pictures for those projects.';

comment on column public.app_users.project_id is
  'First assigned project. The full set for a client or staff login is public.app_user_projects.';

comment on column public.app_users.role is
  'admin uses the office tracker. client views assigned projects. staff uploads progress pictures for assigned projects.';
