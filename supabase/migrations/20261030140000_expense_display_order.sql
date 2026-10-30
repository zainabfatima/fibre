-- Receipts stay in the order already on the sheet.
-- That order is newest receipt date first. New uploads continue the sequence
-- and no longer jump when the date printed on the receipt is different.

alter table public.expenses
  add column if not exists display_order bigint;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id
      order by expense_date desc nulls last, created_at asc, id
    ) as n
  from public.expenses
)
update public.expenses as expense
set display_order = ranked.n
from ranked
where expense.id = ranked.id
  and expense.display_order is null;

alter table public.expenses
  alter column display_order set not null;

create index if not exists expenses_project_display_order_idx
  on public.expenses (project_id, display_order);

create or replace function public.assign_expense_display_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.display_order is null then
    perform pg_advisory_xact_lock(hashtext('expenses.display_order'), hashtext(new.project_id::text));
    select coalesce(max(display_order), 0) + 1
      into new.display_order
      from public.expenses
      where project_id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_assign_display_order on public.expenses;

create trigger expenses_assign_display_order
before insert on public.expenses
for each row execute function public.assign_expense_display_order();

comment on column public.expenses.display_order is
  'Position on the expense sheet. Existing receipts keep the order they already had. New uploads are appended in the order they were uploaded.';

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
  e.paid_by_client,
  e.display_order
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.invoices i on i.id = e.invoice_id;

notify pgrst, 'reload schema';
