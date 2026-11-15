-- Migration 003: add usda_cache table for USDA FoodData Central responses
-- Run after 002_add_user_active_holiday_fields.sql

CREATE TABLE IF NOT EXISTS usda_cache (
  fdc_id     INTEGER PRIMARY KEY,
  nutrients  JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
