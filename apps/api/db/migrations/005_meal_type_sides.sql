-- Migration 005: extend meal_type enum to include non-entree meal slots.
-- ALTER TYPE ADD VALUE cannot run inside a transaction — run each statement separately.
ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'SIDE';
ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'FRUIT';
ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'BREAD';
ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'DESSERT';
