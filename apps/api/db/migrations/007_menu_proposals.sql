-- Migration 007: menu_proposals — stores AI-generated menu proposals before review/apply
CREATE TABLE IF NOT EXISTS menu_proposals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id     UUID        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  proposal    JSONB       NOT NULL,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_proposals_menu_id_idx ON menu_proposals(menu_id);
