-- COA Menu Planner — Seed: June 2026 menu
-- Source: "June 2026 Source Menu — Recipe Seed Reference" (Linear)
-- Origin PDF: COA_Menu_Examples_2026.pdf
--
-- Full ingredient detail: Egg Salad, Brown Rice Pilaf (as documented)
-- All other recipes: stubs — ingredients to be added by Nutrition Manager
-- from GFS NetMenu export before production go-live.
--
-- Run AFTER 001_initial_schema.sql

-- ============================================================
-- HOT ENTREES (20) — stubs
-- ============================================================
INSERT INTO recipes (name, category, base_servings, protein_group, seasons, source, is_active) VALUES
  ('Lemon Baked Fish',               'HOT_ENTREE', 100, 'FISH',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Dijon Chicken Thigh',            'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Italian Sausage',                'HOT_ENTREE', 100, 'PORK',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Maple Glazed Fish',              'HOT_ENTREE', 100, 'FISH',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Citrus Glazed Turkey',           'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Hamburger Stroganoff',           'HOT_ENTREE', 100, 'BEEF',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Bourbon Pork Chop',              'HOT_ENTREE', 100, 'PORK',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Salmon Patty',                   'HOT_ENTREE', 100, 'FISH',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Chicken Marsala',                'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Pepper Steak',                   'HOT_ENTREE', 100, 'BEEF',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('BBQ Beef Sandwiches',            'HOT_ENTREE', 100, 'BEEF',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Oven Baked Fish',                'HOT_ENTREE', 100, 'FISH',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Turkey & Butternut Squash Bake', 'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Homestyle Veal',                 'HOT_ENTREE', 100, 'OTHER',   ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Tropical Pork',                  'HOT_ENTREE', 100, 'PORK',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Goulash',                        'HOT_ENTREE', 100, 'BEEF',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Mushroom Swiss Burger',          'HOT_ENTREE', 100, 'BEEF',    ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Turkey Shepherd''s Pie',         'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('BBQ Chicken',                    'HOT_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Apple Pork Chop',                'HOT_ENTREE', 100, 'PORK',    ARRAY['SUMMER'], 'GFS NetMenu', true);

-- ============================================================
-- COLD ENTREES — Fruited Chicken Salad and Tuna Salad stubs
-- ============================================================
INSERT INTO recipes (name, category, base_servings, protein_group, seasons, source, is_active) VALUES
  ('Fruited Chicken Salad', 'COLD_ENTREE', 100, 'CHICKEN', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Tuna Salad',            'COLD_ENTREE', 100, 'FISH',    ARRAY['SUMMER'], 'GFS NetMenu', true);

-- ============================================================
-- EGG SALAD — full ingredient detail (Cold Entree)
-- Source: COA_Menu_Examples_2026.pdf production recipe card
-- ============================================================
DO $$
DECLARE rid UUID;
BEGIN

INSERT INTO recipes (
  name, category, base_servings, serving_size_oz, serving_utensil,
  internal_temp_f, instructions, protein_group, seasons, source, is_active
) VALUES (
  'Egg Salad', 'COLD_ENTREE', 100, 4.0, '#8 scoop',
  41,
  '1. Wash hands. ' ||
  '2. Chop hard cooked peeled eggs. ' ||
  '3. Combine all ingredients. Mix lightly. Chill. ' ||
  'CCP: Cold foods held for later service must not exceed 41°F. ' ||
  'Serve using a #8 scoop (4 oz) or menued portion.',
  'EGG', ARRAY['SUMMER'], 'GFS NetMenu', true
) RETURNING id INTO rid;

INSERT INTO recipe_ingredients (id, recipe_id, ingredient_name, quantity_per_100_svgs, unit) VALUES
  (gen_random_uuid(), rid, 'Hard Cooked Peeled Eggs',  233,  'each'),
  (gen_random_uuid(), rid, 'Light Mayonnaise',           2.25, 'quart'),
  (gen_random_uuid(), rid, 'Mustard',                    0.25, 'cup'),
  (gen_random_uuid(), rid, 'Salt',                       2,    'tablespoon'),
  (gen_random_uuid(), rid, 'Ground White Pepper',        2,    'tablespoon'),
  (gen_random_uuid(), rid, 'Onion Powder',               0.25, 'cup');

-- ============================================================
-- BROWN RICE PILAF — full ingredient detail (Side)
-- Source: COA_Menu_Examples_2026.pdf production recipe card
-- ============================================================
INSERT INTO recipes (
  name, category, base_servings, serving_size_oz, serving_utensil,
  cooking_temp_f, internal_temp_f, instructions, protein_group, seasons, source, is_active
) VALUES (
  'Brown Rice Pilaf', 'SIDE', 100, 1.0, '1 oz portion',
  350, 135,
  '1. Wash hands. Wash all packaged produce under running water. Drain well. ' ||
  '2. Bring 1.5 qts water to boil. Add 2 oz vegetable base. Mix until dissolved. Keep hot. ' ||
  '3. Place olive oil in heated nonreactive rondeau. Add onions, garlic, bay leaf. Saute until onions are translucent. ' ||
  'Add rice and warmed stock. Bring to boil. Cover. Place in 350°F convection oven. Cook until rice is just cooked through. ' ||
  '4. Serve immediately or place on parchment-lined sheet pan. Cool. Transfer to storage container. Refrigerate until needed. ' ||
  'CCP: Final internal cooking temperature must reach minimum 135°F. ' ||
  'CCP: Hot foods held for later service must maintain minimum 135°F.',
  'OTHER', ARRAY['SUMMER'], 'GFS NetMenu', true
) RETURNING id INTO rid;

INSERT INTO recipe_ingredients (id, recipe_id, ingredient_name, quantity_per_100_svgs, unit) VALUES
  (gen_random_uuid(), rid, 'Water (Hot)',                2.25, 'quart'),
  (gen_random_uuid(), rid, 'Low-Sodium Chicken Base',    1.75, 'ounce'),
  (gen_random_uuid(), rid, 'Vegetable Oil',              1.75, 'ounce'),
  (gen_random_uuid(), rid, 'Onion Diced 1/4"',          14.5, 'ounce'),
  (gen_random_uuid(), rid, 'Celery',                     7.25, 'ounce'),
  (gen_random_uuid(), rid, 'Chopped Garlic in Water',    1.67, 'tablespoon'),
  (gen_random_uuid(), rid, 'Whole Bay Leaf',             1,    'each'),
  (gen_random_uuid(), rid, 'Parboiled Brown Rice',       3.5,  'cup');

END $$;

-- ============================================================
-- SIDES — stubs (ingredients to be added from GFS NetMenu export)
-- ============================================================
INSERT INTO recipes (name, category, base_servings, protein_group, seasons, source, is_active) VALUES
  ('Peas & Pearl Onions',        'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Cauliflower',                'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Key West Blend Vegetables',  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Broccoli',                   'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Mashed Potatoes',            'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Peppers & Onions',           'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Roasted Sweet Potato Wedges','SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Peas & Carrots',             'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Florentine Rice Pilaf',      'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Creamy Peas with Red Peppers','SIDE',100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Red Potatoes',               'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Butternut Squash',           'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Egg Noodles',                'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Scalloped Tomatoes',         'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Wax Beans',                  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Whipped Sweet Potatoes',     'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Parmesan Noodles',           'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Harvard Beets',              'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Asparagus',                  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Glazed Carrots',             'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Italian Green Beans',        'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Cole Slaw',                  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Baked Beans',                'SIDE', 100, 'LEGUME', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Parslied Potatoes',          'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Green Beans & Mushrooms',    'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Red Bliss Potatoes',         'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Whole Baby Carrots',         'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Roasted Brussels Sprouts',   'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Black Beans & Rice',         'SIDE', 100, 'LEGUME', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Collard Greens',             'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Sweet Potato Wedges',        'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Honey Glazed Carrots',       'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Oriental Blend Vegetables',  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Baked Potato',               'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Cucumbers & Tomatoes',       'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Roasted Rosemary Potatoes',  'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Capri Blend Vegetables',     'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Three Bean Salad',           'SIDE', 100, 'LEGUME', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Mixed Greens Salad',         'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Creamy Cole Slaw',           'SIDE', 100, 'OTHER',  ARRAY['SUMMER'], 'GFS NetMenu', true);

-- ============================================================
-- FRUIT — stubs
-- ============================================================
INSERT INTO recipes (name, category, base_servings, seasons, source, is_active) VALUES
  ('Watermelon',    'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Diced Pears',   'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Peaches',       'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Banana',        'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Tropical Fruit','FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Strawberries',  'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Mixed Fruit',   'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Applesauce',    'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Mixed Melon',   'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Orange',        'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Pineapple',     'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Cantaloupe',    'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Blueberries',   'FRUIT', 100, ARRAY['SUMMER'], 'GFS NetMenu', true);

-- ============================================================
-- BREAD — stubs
-- ============================================================
INSERT INTO recipes (name, category, base_servings, seasons, source, is_active) VALUES
  ('Dinner Roll',   'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Cornbread',     'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Hot Dog Bun',   'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Muffin',        'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Wheat Bread',   'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Hamburger Bun', 'BREAD', 100, ARRAY['SUMMER'], 'GFS NetMenu', true);

-- ============================================================
-- DESSERT — stubs
-- ============================================================
INSERT INTO recipes (name, category, base_servings, protein_group, seasons, source, is_active) VALUES
  ('Strawberry Shortcake', 'DESSERT', 100, 'OTHER', ARRAY['SUMMER'], 'GFS NetMenu', true),
  ('Blueberry Crisp',      'DESSERT', 100, 'OTHER', ARRAY['SUMMER'], 'GFS NetMenu', true);
