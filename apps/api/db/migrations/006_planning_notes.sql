-- Migration 006: add planning_notes to menus for vendor constraints injected into AI prompts
ALTER TABLE menus ADD COLUMN IF NOT EXISTS planning_notes TEXT;
