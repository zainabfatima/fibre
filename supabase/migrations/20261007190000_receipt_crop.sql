-- Cropped scans keep the original photo and record how the paper was found.

alter table public.expenses
  add column if not exists original_file_path text;

alter table public.expenses
  add column if not exists original_file_paths jsonb not null default '[]'::jsonb;

alter table public.expenses
  add column if not exists crop_corners jsonb;

alter table public.expenses
  add column if not exists crop_method text;

alter table public.expenses
  add column if not exists needs_manual_crop boolean not null default false;

alter table public.expenses
  drop constraint if exists expenses_crop_method_check;

alter table public.expenses
  add constraint expenses_crop_method_check
  check (crop_method is null or crop_method in ('auto', 'fallback', 'manual', 'none'));

comment on column public.expenses.original_file_path is
  'Uncropped photo in the receipt-originals bucket.';

comment on column public.expenses.crop_corners is
  'Paper corners on the original photo, one set of four points per page.';

comment on column public.expenses.crop_method is
  'How the crop was chosen: auto, fallback, manual, or none.';

comment on column public.expenses.needs_manual_crop is
  'True when the paper edges were not confident and the full photo was kept.';

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
  e.needs_manual_crop
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;
