-- COA Menu Planner — Initial Schema
-- Spec: Technical Implementation Specification v1.1

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE recipe_category AS ENUM (
  'HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'
);

CREATE TYPE protein_group AS ENUM (
  'CHICKEN', 'FISH', 'BEEF', 'PORK', 'EGG', 'LEGUME', 'OTHER'
);

CREATE TYPE user_role AS ENUM (
  'NUTRITION_MANAGER', 'DIETITIAN', 'ADMIN', 'KITCHEN_STAFF'
);

CREATE TYPE menu_status AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'ARCHIVED'
);

CREATE TYPE meal_type AS ENUM ('HOT', 'COLD', 'FROZEN');

CREATE TYPE conflict_severity AS ENUM ('ERROR', 'WARNING', 'FLAG');

-- Users
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  hashed_password  TEXT NOT NULL,
  role             user_role NOT NULL DEFAULT 'KITCHEN_STAFF',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (Lucia)
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- Recipes
CREATE TABLE recipes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  category         recipe_category NOT NULL,
  base_servings    INTEGER NOT NULL DEFAULT 100,
  serving_size_oz  NUMERIC(6,2),
  serving_utensil  TEXT,
  cooking_temp_f   INTEGER,
  internal_temp_f  INTEGER,
  instructions     TEXT,
  protein_group    protein_group,
  seasons          TEXT[] NOT NULL DEFAULT '{}',
  source           TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_name ON recipes(name);
CREATE INDEX idx_recipes_category ON recipes(category);
CREATE INDEX idx_recipes_protein_group ON recipes(protein_group);
CREATE INDEX idx_recipes_is_active ON recipes(is_active);

-- Recipe ingredients
CREATE TABLE recipe_ingredients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id             UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_name       TEXT NOT NULL,
  usda_fdc_id           INTEGER,
  quantity_per_100_svgs NUMERIC NOT NULL,
  unit                  TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipe_ingredients_recipe_id ON recipe_ingredients(recipe_id);

-- Nutrition profiles (cached per recipe, per serving)
CREATE TABLE nutrition_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id          UUID NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
  calories_kcal      NUMERIC,
  protein_g          NUMERIC,
  carbohydrate_g     NUMERIC,
  fat_total_g        NUMERIC,
  sat_fat_g          NUMERIC,
  sodium_mg          NUMERIC,
  fiber_g            NUMERIC,
  calcium_mg         NUMERIC,
  vitamin_d_mcg      NUMERIC,
  vitamin_c_mg       NUMERIC,
  potassium_mg       NUMERIC,
  last_calculated_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nutrition_profiles_recipe_id ON nutrition_profiles(recipe_id);

-- Menus (monthly plans)
CREATE TABLE menus (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status      menu_status NOT NULL DEFAULT 'DRAFT',
  created_by  UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

CREATE INDEX idx_menus_status ON menus(status);
CREATE INDEX idx_menus_year_month ON menus(year, month);

-- Menu days (one per service date, Mon–Fri)
CREATE TABLE menu_days (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id      UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_days_menu_id ON menu_days(menu_id);
CREATE INDEX idx_menu_days_service_date ON menu_days(service_date);

-- Menu day items (recipes assigned to a meal slot)
CREATE TABLE menu_day_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_day_id         UUID NOT NULL REFERENCES menu_days(id) ON DELETE CASCADE,
  recipe_id           UUID NOT NULL REFERENCES recipes(id),
  meal_type           meal_type NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_substitution     BOOLEAN NOT NULL DEFAULT FALSE,
  substitution_reason TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_day_items_menu_day_id ON menu_day_items(menu_day_id);
CREATE INDEX idx_menu_day_items_recipe_id ON menu_day_items(recipe_id);

-- Client feedback
CREATE TABLE client_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id          UUID REFERENCES menus(id),
  menu_day_item_id UUID REFERENCES menu_day_items(id),
  rating           SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment          TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_client_feedback_menu_id ON client_feedback(menu_id);
CREATE INDEX idx_client_feedback_menu_day_item_id ON client_feedback(menu_day_item_id);

-- Nutrition/conflict flags (checked on every item add)
CREATE TABLE conflicts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id          UUID REFERENCES menus(id) ON DELETE CASCADE,
  menu_day_id      UUID REFERENCES menu_days(id) ON DELETE CASCADE,
  menu_day_item_id UUID REFERENCES menu_day_items(id) ON DELETE CASCADE,
  severity         conflict_severity NOT NULL,
  conflict_type    TEXT NOT NULL,
  description      TEXT NOT NULL,
  resolved         BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conflicts_menu_id ON conflicts(menu_id);
CREATE INDEX idx_conflicts_menu_day_id ON conflicts(menu_day_id);
CREATE INDEX idx_conflicts_resolved ON conflicts(resolved);
