-- Projects can track client billing as invoices, or as dated payments received.
-- Balance for the payment style is verified expenses minus those payments.

alter table public.projects
  add column invoice_tracking boolean not null default false;

comment on column public.projects.invoice_tracking is
  'True: bill the client with invoices. False: record money received and show expenses minus that amount.';

create table public.client_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  received_date date not null,
  amount numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint client_payments_amount_positive check (amount > 0)
);

comment on table public.client_payments is
  'Money received from the client. Used when the project does not track invoices.';

create index client_payments_project_date_idx
  on public.client_payments (project_id, received_date desc);

alter table public.client_payments enable row level security;

create policy client_payments_authenticated_all
  on public.client_payments
  for all
  to authenticated
  using (public.has_company_access())
  with check (public.has_company_access());

grant select, insert, update, delete on public.client_payments to authenticated;
grant all on public.client_payments to service_role;
revoke all on public.client_payments from anon;

alter table public.client_payments replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'client_payments'
    ) then
      alter publication supabase_realtime add table public.client_payments;
    end if;
  end if;
end;
$$;
