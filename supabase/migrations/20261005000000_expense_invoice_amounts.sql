-- Invoice amount is the sum of the linked expenses.
-- Builder fee and retainage are no longer applied.
-- Category and project totals include every expense, not only verified rows.

create or replace function public.recalculate_invoice(target uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  spent numeric(12, 2);
begin
  if target is null
     or current_setting('app.skip_invoice_refresh', true) = 'on' then
    return;
  end if;

  select coalesce(sum(e.amount), 0)
    into spent
  from public.expenses e
  where e.invoice_id = target;

  update public.invoices
  set
    subtotal = spent,
    builder_fee = 0,
    retainage = 0,
    total_amount = spent
  where id = target
    and (
      subtotal is distinct from spent
      or builder_fee is distinct from 0
      or retainage is distinct from 0
      or total_amount is distinct from spent
    );
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
  pb.budget_amount as budget,
  (
    case
      when pb.budget_amount is null then null
      else pb.budget_amount - coalesce(sum(e.amount), 0)
    end
  )::numeric(12, 2) as variance,
  count(e.id)::integer as receipt_count
from public.projects p
cross join public.categories c
left join public.project_budgets pb
  on pb.project_id = p.id
  and pb.category_id = c.id
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
  pb.budget_amount;

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
      sum(e.amount) filter (where e.invoice_id is null),
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
  0::numeric(12, 2) as builder_fee_amount
from public.projects p
left join expense_totals et on et.project_id = p.id
left join invoice_totals it on it.project_id = p.id;

select public.recalculate_invoice(id) from public.invoices;
