-- Each expense keeps its own paid / unpaid mark.
-- The invoice file is shared: every expense with the same number opens that one upload.
-- An expense can be moved to a different invoice number.

alter table public.expenses
  add column billing_status text not null default 'unpaid';

alter table public.expenses
  add constraint expenses_billing_status_check
  check (billing_status in ('unpaid', 'paid', 'partial'));

comment on column public.expenses.billing_status is
  'Set by hand on the expense row: unpaid, paid, or partial. Independent of other expenses on the same invoice.';

drop trigger if exists expenses_prevent_invoice_relink on public.expenses;

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
  e.billing_status
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;
