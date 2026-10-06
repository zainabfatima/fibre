-- Scanner metadata. Existing receipt paths stay valid.
-- New scans are stored in the receipts bucket. Thumbnails stay beside them.
-- Originals are stored only when app_settings.keep_original_photos is true.

alter table public.expenses
  add column if not exists page_count integer not null default 1;

alter table public.expenses
  add column if not exists file_type text not null default 'image';

alter table public.expenses
  drop constraint if exists expenses_file_type_check;

alter table public.expenses
  add constraint expenses_file_type_check check (file_type in ('image', 'pdf'));

alter table public.expenses
  add column if not exists capture_type text not null default 'single';

alter table public.expenses
  drop constraint if exists expenses_capture_type_check;

alter table public.expenses
  add constraint expenses_capture_type_check check (capture_type in ('single', 'long', 'multi_page'));

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings (key, value)
values ('keep_original_photos', 'false')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists app_settings_authenticated_all on public.app_settings;
create policy app_settings_authenticated_all
  on public.app_settings
  for all
  to authenticated
  using (public.has_company_access())
  with check (public.has_company_access());

grant select, insert, update, delete on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

create table if not exists public.receipt_page_hashes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  expense_id uuid not null references public.expenses (id) on delete cascade,
  page_number integer not null,
  hash text not null,
  unique (project_id, hash)
);

alter table public.receipt_page_hashes enable row level security;

drop policy if exists receipt_page_hashes_authenticated_all on public.receipt_page_hashes;
create policy receipt_page_hashes_authenticated_all
  on public.receipt_page_hashes
  for all
  to authenticated
  using (public.has_company_access())
  with check (public.has_company_access());

grant select, insert, update, delete on public.receipt_page_hashes to authenticated;
grant all on public.receipt_page_hashes to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-originals',
  'receipt-originals',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists receipt_originals_select on storage.objects;
create policy receipt_originals_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'receipt-originals' and public.has_company_access());

drop policy if exists receipt_originals_insert on storage.objects;
create policy receipt_originals_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'receipt-originals' and public.has_company_access());

drop policy if exists receipt_originals_delete on storage.objects;
create policy receipt_originals_delete
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'receipt-originals' and public.has_company_access());

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
  e.capture_type
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;
