-- Office and client logins. Passwords are stored as a scrypt hash plus an
-- encrypted copy so an existing login can be emailed again. The encryption key
-- stays in PASSWORD_BOX_KEY and is not stored here.

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  login_id text not null,
  email text,
  password_hash text,
  password_encrypted text,
  role text not null default 'client',
  status text not null default 'pending',
  project_id uuid references public.projects (id) on delete set null,
  requested_project_name text,
  requested_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_login_id_key unique (login_id),
  constraint app_users_login_id_not_blank check (char_length(trim(login_id)) > 0),
  constraint app_users_role_check check (role in ('admin', 'client')),
  constraint app_users_status_check check (status in ('pending', 'active', 'rejected')),
  constraint app_users_active_password check (
    status <> 'active' or (password_hash is not null and password_encrypted is not null)
  )
);

create unique index app_users_email_key
  on public.app_users (lower(email))
  where email is not null;

create table public.app_sessions (
  token text primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index app_sessions_user_id_idx on public.app_sessions (user_id);

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.app_sessions from anon, authenticated;
grant all on table public.app_users to service_role;
grant all on table public.app_sessions to service_role;

insert into public.app_users (login_id, email, password_hash, password_encrypted, role, status)
values (
  'fibre',
  'admin@fibreconstruction.com',
  'scrypt$a11ac30d5ce2ccc225133cb43b75c969$82015cb501757f69679d2296171ca6e638d6ae1822ee641e5985fcd05ff0a148',
  '4c2abd789b6d5eeba5be2215.beb673a1e202ff925c9fc510d21be66a.7891e0aa3d',
  'admin',
  'active'
)
on conflict (login_id) do update set
  password_hash = excluded.password_hash,
  password_encrypted = excluded.password_encrypted,
  email = excluded.email,
  role = 'admin',
  status = 'active',
  project_id = null;
