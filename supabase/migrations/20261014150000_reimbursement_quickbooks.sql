-- Reimbursement (yes/no plus who to pay) and QuickBooks status.
-- The client share does not render these columns.

alter table public.expenses
  add column if not exists is_reimbursement boolean not null default false;

alter table public.expenses
  add column if not exists reimbursement_name text;

alter table public.expenses
  add column if not exists qb_status boolean not null default false;

comment on column public.expenses.is_reimbursement is
  'True when this receipt is a reimbursement. Default is no.';

comment on column public.expenses.reimbursement_name is
  'Who to reimburse. Empty when no note was written.';

comment on column public.expenses.qb_status is
  'True when this expense has been entered in QuickBooks.';

drop view if exists public.v_expense_rows;

create view public.v_expense_rows
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
  e.qb_status
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;

grant select on public.v_expense_rows to authenticated;
grant all on public.v_expense_rows to service_role;
revoke all on public.v_expense_rows from anon;
