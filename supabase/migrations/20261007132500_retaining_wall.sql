-- Insert Retaining wall immediately before Foundation.
-- Existing category ids stay put, so expenses keep their category.
-- Codes and sort order from Foundation onward move up by one.
-- code = sort_order = position.

update public.categories
set
  code = code + 1000,
  sort_order = sort_order + 1000
where code >= 23;

update public.categories
set
  code = code - 999,
  sort_order = sort_order - 999
where code >= 1023;

insert into public.categories (id, code, name, sort_order, is_active, keywords)
values (
  59,
  23,
  'Retaining wall',
  23,
  true,
  array['retaining wall', 'retaining', 'block wall', 'landscape wall']
);

select setval(
  pg_get_serial_sequence('public.categories', 'id'),
  (select max(id) from public.categories)
);
