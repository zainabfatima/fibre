-- Replace the original 55-category list with the 58-category master list.
-- code = sort_order = position. Display as "code – name".

update public.expenses
set
  category_id = null,
  ai_suggested_category_ids = null,
  verification_status = case
    when verification_status = 'verified' then 'needs_review'
    else verification_status
  end
where category_id is not null
   or ai_suggested_category_ids is not null;

delete from public.project_budgets;
delete from public.categories;

insert into public.categories (id, code, name, sort_order, is_active, keywords)
values
  (1, 1, 'Architectural', 1, true, array['architect', 'architectural', 'blueprint', 'drawings', 'design']),
  (2, 2, 'Engineering', 2, true, array['engineer', 'structural', 'civil', 'geotechnical']),
  (3, 3, 'Legal', 3, true, array['attorney', 'lawyer', 'legal', 'closing']),
  (4, 4, 'Permits', 4, true, array['building permit', 'permit']),
  (5, 5, 'Surveying', 5, true, array['survey', 'surveyor', 'stakeout', 'boundary']),
  (6, 6, 'Insurance', 6, true, array['insurance', 'builder risk', 'liability', 'premium']),
  (7, 7, 'Site plans', 7, true, array['site plan', 'plot plan']),
  (8, 8, 'Other soft costs', 8, true, array['impact fee', 'tap fee', 'plan review', 'inspection', 'soft cost', 'application fee']),
  (9, 9, 'Temp fencing', 9, true, array['temp fence', 'temporary fence', 'silt fence', 'construction fence']),
  (10, 10, 'Temp utilities', 10, true, array['temp power', 'temporary power', 'temp water', 'power pole']),
  (11, 11, 'Equipment rental', 11, true, array['equipment rental', 'excavator rental', 'scissor lift', 'bobcat rental', 'rented']),
  (12, 12, 'Dumpsters', 12, true, array['dumpster', 'roll-off', 'rolloff', 'waste container']),
  (13, 13, 'Excavation / grading', 13, true, array['excavation', 'grading', 'dirt work', 'cut and fill']),
  (14, 14, 'Underground utilities', 14, true, array['underground', 'sewer', 'water line', 'electrical service', 'utility trench']),
  (15, 15, 'Driveway', 15, true, array['driveway', 'apron', 'concrete drive']),
  (16, 16, 'Landscaping / irrigation', 16, true, array['landscape', 'landscaping', 'sod', 'irrigation', 'plants']),
  (17, 17, 'Deck / patio', 17, true, array['deck', 'patio', 'porch slab']),
  (18, 18, 'Fencing', 18, true, array['fence', 'fencing', 'privacy fence', 'yard fence']),
  (19, 19, 'Rain gutters', 19, true, array['gutter', 'gutters', 'downspout', 'rain gutter']),
  (20, 20, 'Pressure washing', 20, true, array['pressure wash', 'power wash', 'pressure washing']),
  (21, 21, 'Exterior paint', 21, true, array['exterior paint', 'outside paint', 'exterior painter']),
  (22, 22, 'Other exterior', 22, true, array['exterior', 'outside']),
  (23, 23, 'Foundation', 23, true, array['foundation', 'footing', 'rebar', 'slab', 'stem wall']),
  (24, 24, 'Masonry / stone', 24, true, array['masonry', 'brick', 'stone', 'veneer', 'block']),
  (25, 25, 'Rough framing / lumber', 25, true, array['framing', 'framer', 'lumber', 'plywood', 'osb', 'studs', '2x4']),
  (26, 26, 'Roofing', 26, true, array['roof', 'roofing', 'shingles']),
  (27, 27, 'Siding', 27, true, array['siding', 'hardie', 'vinyl siding']),
  (28, 28, 'Windows', 28, true, array['window', 'windows', 'glazing']),
  (29, 29, 'Exterior doors', 29, true, array['exterior door', 'entry door', 'front door']),
  (30, 30, 'Garage door', 30, true, array['garage door', 'garage opener']),
  (31, 31, 'Fireplace', 31, true, array['fireplace', 'chimney', 'gas log']),
  (32, 32, 'HVAC rough / service / trim out', 32, true, array['hvac', 'heating', 'air conditioning', 'furnace', 'duct', 'trim out']),
  (33, 33, 'Plumbing rough / final fixtures', 33, true, array['plumber', 'plumbing', 'faucet', 'toilet', 'sink']),
  (34, 34, 'Electrical rough / final fixtures', 34, true, array['electrician', 'electrical', 'wiring', 'panel', 'light fixture']),
  (35, 35, 'Low voltage / security', 35, true, array['low voltage', 'security', 'alarm', 'camera', 'data', 'network']),
  (36, 36, 'Insulation', 36, true, array['insulation', 'spray foam', 'fiberglass']),
  (37, 37, 'Drywall', 37, true, array['drywall', 'sheetrock', 'gypsum', 'taping']),
  (38, 38, 'Interior doors', 38, true, array['interior door', 'prehung', 'closet door']),
  (39, 39, 'Interior trim', 39, true, array['trim', 'millwork', 'baseboard', 'casing', 'crown']),
  (40, 40, 'Flooring: tile, wood, carpet', 40, true, array['flooring', 'hardwood', 'carpet', 'lvp', 'laminate', 'floor tile']),
  (41, 41, 'Interior painting', 41, true, array['interior paint', 'painter', 'interior painting']),
  (42, 42, 'Mirrors', 42, true, array['mirror', 'mirrors']),
  (43, 43, 'Shower glass', 43, true, array['shower glass', 'shower door', 'enclosure']),
  (44, 44, 'Shower tile', 44, true, array['shower tile', 'shower wall', 'tub surround tile']),
  (45, 45, 'Tubs', 45, true, array['tub', 'bathtub', 'soaking tub']),
  (46, 46, 'Other interior', 46, true, array['interior']),
  (47, 47, 'Kitchen cabinets', 47, true, array['kitchen cabinet', 'kitchen cabinets']),
  (48, 48, 'Bathroom cabinets', 48, true, array['bathroom cabinet', 'vanity cabinet', 'bath cabinet']),
  (49, 49, 'Kitchen countertops', 49, true, array['kitchen countertop', 'kitchen quartz', 'kitchen granite']),
  (50, 50, 'Bathroom vanity tops', 50, true, array['vanity top', 'bathroom vanity', 'bath countertop']),
  (51, 51, 'Backsplash', 51, true, array['backsplash', 'kitchen tile']),
  (52, 52, 'Appliances', 52, true, array['appliance', 'refrigerator', 'dishwasher', 'range', 'microwave', 'oven']),
  (53, 53, 'Other kitchen items', 53, true, array['kitchen hardware', 'kitchen accessory']),
  (54, 54, 'Supervision', 54, true, array['supervision', 'superintendent']),
  (55, 55, 'General labor', 55, true, array['general labor', 'day labor', 'labor']),
  (56, 56, 'Cleaning', 56, true, array['cleaning', 'final clean']),
  (57, 57, 'Rough clean', 57, true, array['rough clean', 'construction clean', 'broom clean']),
  (58, 58, 'Miscellaneous', 58, true, array['miscellaneous', 'misc']);

select setval(
  pg_get_serial_sequence('public.categories', 'id'),
  (select max(id) from public.categories)
);
