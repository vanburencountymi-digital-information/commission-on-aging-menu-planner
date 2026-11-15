-- Migration 010: Frozen meal tracking — overrun stock log, post-service actuals, planned overrun %.

-- Post-service actual counts per day (entered by kitchen staff or NM after service)
ALTER TABLE menu_days ADD COLUMN IF NOT EXISTS actual_prepared     INTEGER;
ALTER TABLE menu_days ADD COLUMN IF NOT EXISTS actual_served       INTEGER;
ALTER TABLE menu_days ADD COLUMN IF NOT EXISTS planned_overrun_pct DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Frozen stock log: tracks overrun meals that went to the freezer and when they were used
CREATE TABLE IF NOT EXISTS frozen_stock (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  menu_day_id   UUID REFERENCES menu_days(id) ON DELETE SET NULL,
  servings      INTEGER NOT NULL,
  prepared_date DATE NOT NULL,
  used_date     DATE,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frozen_stock_recipe_id  ON frozen_stock(recipe_id);
CREATE INDEX IF NOT EXISTS idx_frozen_stock_available  ON frozen_stock(used_date) WHERE used_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_frozen_stock_prepared   ON frozen_stock(prepared_date DESC);
