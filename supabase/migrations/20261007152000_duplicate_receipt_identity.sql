-- Fields Claude reads to decide whether two receipts are the same charge.
-- card_last4 is only the last four digits printed on the slip.

alter table public.expenses
  add column if not exists receipt_time text;

alter table public.expenses
  add column if not exists card_last4 text;

alter table public.expenses
  add column if not exists duplicate_confirmed boolean not null default false;

alter table public.expenses
  drop constraint if exists expenses_receipt_time_check;

alter table public.expenses
  add constraint expenses_receipt_time_check
  check (receipt_time is null or receipt_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

alter table public.expenses
  drop constraint if exists expenses_card_last4_check;

alter table public.expenses
  add constraint expenses_card_last4_check
  check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

comment on column public.expenses.receipt_time is
  'Transaction time from the receipt, HH:MM, when Claude can read one.';

comment on column public.expenses.card_last4 is
  'Last four digits of the card on the receipt. The full card number is not stored.';

comment on column public.expenses.duplicate_confirmed is
  'True after someone confirms this receipt is not a duplicate, so it is not flagged again.';

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
  e.duplicate_confirmed
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;
