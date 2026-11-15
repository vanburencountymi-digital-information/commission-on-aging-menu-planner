-- Migration 008: add client_narrative to menus
ALTER TABLE menus ADD COLUMN IF NOT EXISTS client_narrative TEXT;
