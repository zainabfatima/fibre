-- Expenses the client paid directly are entered like money received,
-- not flagged on a receipt. The builder fee applies to those amounts,
-- and the amounts themselves are subtracted from the project total.

create table public.client_paid_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  paid_date date not null,
  amount numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint client_paid_expenses_amount_positive check (amount > 0)
);

comment on table public.client_paid_expenses is
  'Amounts the client paid directly. The builder fee applies to them, and the amounts are subtracted from the project total.';

create index client_paid_expenses_project_date_idx
  on public.client_paid_expenses (project_id, paid_date desc);

alter table public.client_paid_expenses enable row level security;

create policy client_paid_expenses_authenticated_all
  on public.client_paid_expenses
  for all
  to authenticated
  using (public.has_company_access())
  with check (public.has_company_access());

grant select, insert, update, delete on public.client_paid_expenses to authenticated;
grant all on public.client_paid_expenses to service_role;
revoke all on public.client_paid_expenses from anon;

alter table public.client_paid_expenses replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'client_paid_expenses'
    ) then
      alter publication supabase_realtime add table public.client_paid_expenses;
    end if;
  end if;
end;
$$;

create or replace view public.v_project_category_totals
with (security_invoker = true) as
select
  p.id as project_id,
  c.id as category_id,
  c.code,
  c.name,
  c.sort_order,
  c.is_active,
  coalesce(sum(e.amount), 0)::numeric(12, 2) as total_spent,
  coalesce(pb.budget_amount, c.default_budget, 0)::numeric(12, 2) as budget,
  (
    coalesce(pb.budget_amount, c.default_budget, 0) - coalesce(sum(e.amount), 0)
  )::numeric(12, 2) as variance,
  count(e.id)::integer as receipt_count
from public.projects p
cross join public.categories c
left join public.project_budgets pb
  on pb.project_id = p.id
  and pb.category_id = c.id
  and pb.budget_override
left join public.expenses e
  on e.project_id = p.id
  and e.category_id = c.id
group by
  p.id,
  c.id,
  c.code,
  c.name,
  c.sort_order,
  c.is_active,
  c.default_budget,
  pb.budget_amount;

comment on view public.v_project_category_totals is
  'Every category for every project. budget is the hand override when budget_override is true, otherwise the system default (or 0). variance is that budget minus spent.';

create or replace view public.v_project_summary
with (security_invoker = true) as
with expense_totals as (
  select
    e.project_id,
    coalesce(sum(e.amount), 0)::numeric(12, 2) as total_spent,
    coalesce(
      sum(e.amount) filter (
        where e.invoice_id is not null
          and i.status is distinct from 'void'
      ),
      0
    )::numeric(12, 2) as total_invoiced,
    coalesce(
      sum(e.amount) filter (
        where e.invoice_id is null
      ),
      0
    )::numeric(12, 2) as total_not_invoiced,
    count(*)::integer as receipt_count,
    count(*) filter (where e.verification_status = 'needs_review')::integer
      as needs_review_count
  from public.expenses e
  left join public.invoices i on i.id = e.invoice_id
  group by e.project_id
),
client_paid as (
  select
    project_id,
    coalesce(sum(amount), 0)::numeric(12, 2) as client_paid_total
  from public.client_paid_expenses
  group by project_id
),
invoice_totals as (
  select
    project_id,
    coalesce(
      sum(amount_paid) filter (where status <> 'void'),
      0
    )::numeric(12, 2) as total_paid,
    coalesce(
      sum(greatest(total_amount - amount_paid, 0)) filter (
        where status in ('pending', 'partially_paid')
      ),
      0
    )::numeric(12, 2) as total_pending
  from public.invoices
  group by project_id
)
select
  p.id as project_id,
  p.name,
  p.address,
  p.client_name,
  p.client_email,
  p.status,
  p.builder_fee_percent,
  p.retainage_percent,
  coalesce(et.total_spent, 0)::numeric(12, 2) as total_spent,
  coalesce(et.total_invoiced, 0)::numeric(12, 2) as total_invoiced,
  coalesce(et.total_not_invoiced, 0)::numeric(12, 2) as total_not_invoiced,
  coalesce(it.total_paid, 0)::numeric(12, 2) as total_paid,
  coalesce(it.total_pending, 0)::numeric(12, 2) as total_pending,
  coalesce(et.receipt_count, 0)::integer as receipt_count,
  coalesce(et.needs_review_count, 0)::integer as needs_review_count,
  round(
    (coalesce(et.total_spent, 0) + coalesce(cp.client_paid_total, 0)) * p.builder_fee_percent / 100,
    2
  )::numeric(12, 2) as builder_fee_amount,
  coalesce(cp.client_paid_total, 0)::numeric(12, 2) as client_paid_total
from public.projects p
left join expense_totals et on et.project_id = p.id
left join invoice_totals it on it.project_id = p.id
left join client_paid cp on cp.project_id = p.id;

comment on view public.v_project_summary is
  'Per project. total_spent is every expense. client_paid_total is amounts entered as paid by the client. builder_fee_amount is the project percent of total_spent plus client_paid_total.';
