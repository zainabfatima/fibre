-- Builder fee percent is entered on the project and added to the total.
-- Client-paid expenses stay out of that total, but the fee still applies to them.
-- The percent used to default to 15 and was not applied. Start at 0 so existing totals stay put until a fee is entered.

alter table public.projects
  alter column builder_fee_percent set default 0;

update public.projects
set builder_fee_percent = 0
where builder_fee_percent = 15;

alter table public.expenses
  add column if not exists paid_by_client boolean not null default false;

comment on column public.expenses.paid_by_client is
  'True when the client paid this expense directly. The amount is left out of the project total. The builder fee percent still applies to it.';

create or replace view public.v_expense_rows
with (security_invoker = true) as
select
  e.id,
  e.project_id,
  e.category_id,
  c.code as category_code,
  c.name as category_name,
  c.sort_order as category_sort_order,
  e.vendor,
  e.expense_date,
  e.amount,
  e.receipt_number,
  e.description,
  e.payment_method,
  e.receipt_file_path,
  e.receipt_file_hash,
  e.receipt_thumbnail_path,
  e.split_group_id,
  e.invoice_id,
  i.invoice_number,
  i.invoice_date,
  i.status as invoice_record_status,
  i.total_amount as invoice_total_amount,
  i.file_path as invoice_file_path,
  case
    when e.invoice_id is null then 'not_invoiced'
    when e.billing_status = 'paid' then 'paid'
    when e.billing_status = 'partial' then 'partially_paid'
    else 'pending'
  end as invoice_status,
  e.ai_extracted,
  e.ai_suggested_category_ids,
  e.ai_confidence,
  e.verification_status,
  e.duplicate_of,
  e.created_at,
  e.updated_at,
  e.created_by,
  e.billing_status,
  e.page_count,
  e.file_type,
  e.capture_type,
  e.receipt_time,
  e.card_last4,
  e.duplicate_confirmed,
  e.original_file_path,
  e.original_file_paths,
  e.crop_corners,
  e.crop_method,
  e.needs_manual_crop,
  e.return_confirmed,
  e.is_reimbursement,
  e.reimbursement_name,
  e.qb_status,
  e.paid_by_client
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;

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
  and e.paid_by_client = false
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
  'Every category for every project. budget is the hand override when budget_override is true, otherwise the system default (or 0). total_spent excludes expenses the client paid directly. variance is that budget minus spent.';

create or replace view public.v_project_summary
with (security_invoker = true) as
with expense_totals as (
  select
    e.project_id,
    coalesce(sum(e.amount) filter (where e.paid_by_client = false), 0)::numeric(12, 2) as total_spent,
    coalesce(sum(e.amount) filter (where e.paid_by_client), 0)::numeric(12, 2) as client_paid_total,
    coalesce(
      sum(e.amount) filter (
        where e.paid_by_client = false
          and e.invoice_id is not null
          and i.status is distinct from 'void'
      ),
      0
    )::numeric(12, 2) as total_invoiced,
    coalesce(
      sum(e.amount) filter (
        where e.paid_by_client = false
          and e.invoice_id is null
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
    (coalesce(et.total_spent, 0) + coalesce(et.client_paid_total, 0)) * p.builder_fee_percent / 100,
    2
  )::numeric(12, 2) as builder_fee_amount,
  coalesce(et.client_paid_total, 0)::numeric(12, 2) as client_paid_total
from public.projects p
left join expense_totals et on et.project_id = p.id
left join invoice_totals it on it.project_id = p.id;

comment on view public.v_project_summary is
  'Per project. total_spent excludes expenses the client paid directly. client_paid_total is those amounts. builder_fee_amount is the project percent of total_spent plus client_paid_total.';
