-- Migration 002: add is_active to users, add holiday fields to menu_days
-- Run after 001_initial_schema.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE menu_days
  ADD COLUMN IF NOT EXISTS is_holiday   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS holiday_note TEXT;
