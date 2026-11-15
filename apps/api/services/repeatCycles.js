// Per-category recipe repeat cycle, in calendar days. A recipe should not
// reappear within this many days of a prior use. These are tunable defaults —
// a future Nutrition Manager settings UI will allow per-program overrides.
//
// Repeat tolerance scales with how many options a category has and how
// noticeable repetition is: entrees are the most memorable part of a meal,
// while breads and fruit have small recipe pools where a strict cycle is
// impossible to satisfy.
export const REPEAT_CYCLE_DAYS = {
  HOT_ENTREE:  21,
  COLD_ENTREE: 21,
  SIDE:        10,
  DESSERT:     10,
  FRUIT:        7,
  BREAD:        5,
};

// Fallback for any category not listed above.
export const DEFAULT_REPEAT_CYCLE_DAYS = 21;

// Longest cycle — bounds "recently used" lookups before per-category filtering.
export const MAX_REPEAT_CYCLE_DAYS = Math.max(
  DEFAULT_REPEAT_CYCLE_DAYS,
  ...Object.values(REPEAT_CYCLE_DAYS),
);

// Repeat cycle (in days) for a recipe category, with a safe default.
export function repeatCycleFor(category) {
  return REPEAT_CYCLE_DAYS[category] ?? DEFAULT_REPEAT_CYCLE_DAYS;
}

// Categories subject to the same-week variety rule: the same recipe should
// not appear 3 or more times within one Mon–Fri service week. These are the
// small-pool categories where short cycles alone are not enough to prevent
// a recipe dominating a single week.
export const WEEKLY_REPEAT_CATEGORIES = ['FRUIT', 'BREAD'];
