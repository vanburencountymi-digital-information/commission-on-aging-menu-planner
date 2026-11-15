-- Migration 009: Add ingredient ordering fields + per-day estimated servings
-- Enables weekly ingredient order list calculation and vendor-tagged exports.

-- Per-day headcount estimate for scaling ingredient quantities
ALTER TABLE menu_days
  ADD COLUMN IF NOT EXISTS estimated_servings INTEGER;

-- Vendor / ordering metadata on each ingredient
ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS vendor            TEXT DEFAULT 'GFS',
  ADD COLUMN IF NOT EXISTS gfs_product_code  TEXT,
  ADD COLUMN IF NOT EXISTS case_size         TEXT,
  ADD COLUMN IF NOT EXISTS order_unit        TEXT;
