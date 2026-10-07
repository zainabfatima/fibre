-- Hosted Postgres rejects an update that has no WHERE clause.
-- Clearing defaults still has to touch every category, so the filter matches all ids.

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
  set default_budget = null
  where id is not null;

  update public.categories c
  set default_budget = entry.amount::numeric(12, 2)
  from jsonb_to_recordset(entries) as entry(category_id int, amount text)
  where c.id = entry.category_id
    and entry.amount ~ '^[0-9]+(\.[0-9]{1,2})?$'
    and entry.amount::numeric(12, 2) >= 0;
end;
$$;
