-- System default budget for every project, plus a per-project hand override.
-- A new budget sheet replaces default_budget only. Rows with budget_override
-- stay as the amount entered by hand on that project.

alter table public.categories
  add column if not exists default_budget numeric(12, 2);

alter table public.categories
  drop constraint if exists categories_default_budget_nonnegative;

alter table public.categories
  add constraint categories_default_budget_nonnegative
  check (default_budget is null or default_budget >= 0);

comment on column public.categories.default_budget is
  'System default budget for this category on every project, unless that project has a hand override.';

alter table public.project_budgets
  add column if not exists budget_override boolean not null default true;

comment on column public.project_budgets.budget_override is
  'True when this amount was set by hand for this project and should not follow a later default budget sheet.';

-- Existing rows were entered on a project, so they stay overrides.
update public.project_budgets
set budget_override = true
where budget_override is distinct from true;

create or replace function public.replace_category_default_budgets(entries jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception 'Budget entries must be a list';
  end if;

  update public.categories
  set default_budget = null;

  update public.categories c
  set default_budget = entry.amount::numeric(12, 2)
  from jsonb_to_recordset(entries) as entry(category_id int, amount text)
  where c.id = entry.category_id
    and entry.amount ~ '^[0-9]+(\.[0-9]{1,2})?$'
    and entry.amount::numeric(12, 2) >= 0;
end;
$$;

grant execute on function public.replace_category_default_budgets(jsonb) to authenticated, service_role;

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
  'Every category for every project. budget is the hand override when budget_override is true, otherwise the system default (or 0). total_spent includes every expense. variance is that budget minus spent.';
