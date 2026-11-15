import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiLightLimiter, aiHeavyLimiter } from '../middleware/rateLimits.js';
import { checkConflicts, clearConflictsForItem } from '../services/conflicts.js';
import { checkDRICompliance } from '../services/compliance.js';
import { generateMenuPdf, generateOrderListPdf } from '../services/pdf.js';
import { generateMenuProposal, generateRDSummary, generateMenuEdits, generateConflictSuggestions, generateMenuNarrative, explainNutritionGaps } from '../services/ai.js';
import { repeatCycleFor, MAX_REPEAT_CYCLE_DAYS } from '../services/repeatCycles.js';

const router = Router();

const LOCKED = ['SUBMITTED', 'APPROVED', 'PUBLISHED'];

// Returns all Mon–Fri dates in the given year/month as YYYY-MM-DD strings.
function weekdayDates(year, month) {
  const dates = [];
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

async function loadMenu(res, id) {
  const [menu] = await sql`SELECT * FROM menus WHERE id = ${id}`;
  if (!menu) { res.status(404).json({ error: 'Menu not found' }); return null; }
  return menu;
}

// POST /api/menus  [NUTRITION_MANAGER, ADMIN]
// Body: { year, month }. Creates DRAFT menu and auto-populates all weekday MenuDay rows.
router.post('/', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { year, month } = req.body;
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year and month (1–12) are required' });
    }

    const [menu] = await sql`
      INSERT INTO menus (year, month, created_by)
      VALUES (${year}, ${month}, ${req.user.id})
      RETURNING *
    `;

    const rows = weekdayDates(Number(year), Number(month)).map(d => ({
      menu_id: menu.id,
      service_date: d,
    }));
    const days = await sql`INSERT INTO menu_days ${sql(rows)} RETURNING *`;
    days.sort((a, b) => (a.service_date > b.service_date ? 1 : -1));

    res.status(201).json({ ...menu, days });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `A menu for ${req.body.year}-${req.body.month} already exists` });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create menu' });
  }
});

// GET /api/menus  [NUTRITION_MANAGER, DIETITIAN, ADMIN]
// Optional filters: ?year=2026&month=6&status=DRAFT
router.get('/', requireAuth('NUTRITION_MANAGER', 'DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const { year, month, status } = req.query;
    const menus = await sql`
      SELECT * FROM menus
      WHERE TRUE
        ${year   ? sql`AND year  = ${Number(year)}`         : sql``}
        ${month  ? sql`AND month = ${Number(month)}`        : sql``}
        ${status ? sql`AND status = ${status}::menu_status` : sql``}
      ORDER BY year DESC, month DESC
    `;
    res.json(menus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch menus' });
  }
});

// GET /api/menus/:id
// Returns menu with all days and their items nested.
router.get('/:id', async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    const days = await sql`
      SELECT * FROM menu_days WHERE menu_id = ${menu.id} ORDER BY service_date
    `;

    const items = days.length > 0
      ? await sql`
          SELECT mdi.*, r.name AS recipe_name, r.category, r.protein_group
          FROM menu_day_items mdi
          JOIN recipes r ON r.id = mdi.recipe_id
          WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
          ORDER BY mdi.sort_order
        `
      : [];

    const byDay = {};
    for (const item of items) {
      (byDay[item.menu_day_id] ??= []).push(item);
    }

    const conflicts = days.length > 0
      ? await sql`
          SELECT * FROM conflicts
          WHERE menu_id = ${menu.id} AND resolved = false
        `
      : [];
    const conflictsByDay = {};
    for (const c of conflicts) {
      (conflictsByDay[c.menu_day_id] ??= []).push(c);
    }

    res.json({
      ...menu,
      days: days.map(d => ({
        ...d,
        items: byDay[d.id] ?? [],
        conflicts: conflictsByDay[d.id] ?? [],
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// POST /api/menus/:id/days/:dayId/items  [NUTRITION_MANAGER, ADMIN]
// Body: { recipe_id, meal_type, sort_order?, is_substitution?, substitution_reason?, notes? }
// Runs conflict detection and returns the new item with any conflicts found.
router.post('/:id/days/:dayId/items', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (LOCKED.includes(menu.status)) {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be edited` });
    }

    const { recipe_id, meal_type, sort_order = 0, is_substitution = false, substitution_reason, notes } = req.body;
    if (!recipe_id || !meal_type) {
      return res.status(400).json({ error: 'recipe_id and meal_type are required' });
    }

    const [item] = await sql`
      INSERT INTO menu_day_items
        (menu_day_id, recipe_id, meal_type, sort_order, is_substitution, substitution_reason, notes)
      VALUES
        (${req.params.dayId}, ${recipe_id}, ${meal_type}::meal_type, ${sort_order},
         ${is_substitution}, ${substitution_reason ?? null}, ${notes ?? null})
      RETURNING *
    `;

    const conflicts = await checkConflicts(menu.id, req.params.dayId, item.id);
    res.status(201).json({ ...item, conflicts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add menu item' });
  }
});

// DELETE /api/menus/:id/items  [NUTRITION_MANAGER, ADMIN]
// Clears ALL items from every day in a DRAFT menu. Also wipes all conflicts.
router.delete('/:id/items', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'DRAFT') {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be cleared` });
    }

    const days = await sql`SELECT id FROM menu_days WHERE menu_id = ${req.params.id}`;
    const dayIds = days.map(d => d.id);

    let cleared = 0;
    if (dayIds.length > 0) {
      const result = await sql`
        DELETE FROM menu_day_items WHERE menu_day_id = ANY(${dayIds})
      `;
      cleared = result.count;
    }

    await sql`DELETE FROM conflicts WHERE menu_id = ${req.params.id}`;

    res.json({ cleared });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear menu' });
  }
});

// DELETE /api/menus/:id/days/:dayId/items/:itemId  [NUTRITION_MANAGER, ADMIN]
router.delete('/:id/days/:dayId/items/:itemId', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (LOCKED.includes(menu.status)) {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be edited` });
    }

    await clearConflictsForItem(req.params.itemId);
    const result = await sql`
      DELETE FROM menu_day_items
      WHERE id = ${req.params.itemId} AND menu_day_id = ${req.params.dayId}
    `;
    if (result.count === 0) return res.status(404).json({ error: 'Item not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

// PATCH /api/menus/:id/days/:dayId  [NUTRITION_MANAGER, ADMIN]
// Body: { is_holiday?, holiday_note?, notes? }
router.patch('/:id/days/:dayId', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (LOCKED.includes(menu.status)) {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be edited` });
    }

    const { is_holiday, holiday_note, notes } = req.body;

    const [day] = await sql`
      UPDATE menu_days SET
        is_holiday   = COALESCE(${is_holiday   ?? null}, is_holiday),
        holiday_note = COALESCE(${holiday_note ?? null}, holiday_note),
        notes        = COALESCE(${notes        ?? null}, notes)
      WHERE id = ${req.params.dayId} AND menu_id = ${req.params.id}
      RETURNING *
    `;
    if (!day) return res.status(404).json({ error: 'Menu day not found' });
    res.json(day);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update menu day' });
  }
});

// PATCH /api/menus/:id  [NUTRITION_MANAGER, ADMIN]
// Body: { planning_notes }. Updates vendor constraints / planning notes on a DRAFT menu.
router.patch('/:id', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (LOCKED.includes(menu.status)) {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be edited` });
    }
    const { planning_notes } = req.body;
    const [updated] = await sql`
      UPDATE menus
      SET planning_notes = ${planning_notes ?? null}, updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update menu' });
  }
});

// DELETE /api/menus/:id/items  [NUTRITION_MANAGER, ADMIN]
// Removes all items from every day of a DRAFT menu.
router.delete('/:id/items', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (LOCKED.includes(menu.status)) {
      return res.status(403).json({ error: `Menu is ${menu.status} and cannot be edited` });
    }
    await sql`
      DELETE FROM menu_day_items
      WHERE menu_day_id IN (SELECT id FROM menu_days WHERE menu_id = ${req.params.id})
    `;
    await sql`DELETE FROM conflicts WHERE menu_id = ${req.params.id}`;
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear menu items' });
  }
});

// POST /api/menus/:id/submit  [NUTRITION_MANAGER, ADMIN]
// Transitions DRAFT → SUBMITTED. Requires every non-holiday day to have at least one HOT item.
router.post('/:id/submit', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'DRAFT') {
      return res.status(400).json({ error: `Menu is already ${menu.status}` });
    }

    // Completeness check: every non-holiday weekday must have at least one HOT item.
    const days = await sql`
      SELECT md.id, md.service_date, md.is_holiday
      FROM menu_days md
      WHERE md.menu_id = ${req.params.id} AND md.is_holiday = false
    `;
    const itemCounts = days.length > 0 ? await sql`
      SELECT mdi.menu_day_id, COUNT(*) AS cnt
      FROM menu_day_items mdi
      WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
        AND mdi.meal_type = 'HOT'
      GROUP BY mdi.menu_day_id
    ` : [];
    const coveredDays = new Set(itemCounts.map(r => r.menu_day_id));
    const missingDays = days.filter(d => !coveredDays.has(d.id));
    if (missingDays.length > 0) {
      return res.status(400).json({
        error: 'Menu is incomplete',
        missing_hot_items: missingDays.map(d => d.service_date),
      });
    }

    const [updated] = await sql`
      UPDATE menus
      SET status = 'SUBMITTED', submitted_at = NOW(), submitted_by = ${req.user.id}, updated_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit menu' });
  }
});

// POST /api/menus/:id/approve  [DIETITIAN, ADMIN]
// Transitions SUBMITTED → APPROVED.
router.post('/:id/approve', requireAuth('DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Menu must be SUBMITTED to approve' });
    }
    if (menu.submitted_by && menu.submitted_by === req.user.id) {
      return res.status(403).json({ error: 'You cannot approve a menu you submitted' });
    }
    const [updated] = await sql`
      UPDATE menus
      SET status = 'APPROVED', approved_by = ${req.user.id}, approved_at = NOW(), updated_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to approve menu' });
  }
});

// POST /api/menus/:id/reject  [DIETITIAN, ADMIN]
// Transitions SUBMITTED → DRAFT. Body: { rd_notes }
router.post('/:id/reject', requireAuth('DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Menu must be SUBMITTED to reject' });
    }
    const { rd_notes } = req.body;
    const [updated] = await sql`
      UPDATE menus SET status = 'DRAFT', rd_notes = ${rd_notes ?? null}, updated_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reject menu' });
  }
});

// GET /api/menus/:id/days/:dayId/nutrition
// Single-day nutrition totals + DRI compliance + per-nutrient top contributor.
router.get('/:id/days/:dayId/nutrition', async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    const [day] = await sql`
      SELECT id, service_date, is_holiday FROM menu_days
      WHERE id = ${req.params.dayId} AND menu_id = ${menu.id}
    `;
    if (!day) return res.status(404).json({ error: 'Menu day not found' });

    const items = await sql`
      SELECT mdi.recipe_id, r.name AS recipe_name
      FROM menu_day_items mdi
      JOIN recipes r ON r.id = mdi.recipe_id
      WHERE mdi.menu_day_id = ${day.id}
    `;

    const recipeIds = [...new Set(items.map(i => i.recipe_id))];
    const profiles = recipeIds.length > 0
      ? await sql`SELECT * FROM nutrition_profiles WHERE recipe_id = ANY(${recipeIds})`
      : [];
    const byRecipe = Object.fromEntries(profiles.map(p => [p.recipe_id, p]));

    const KEYS = ['calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
                  'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg'];

    const totals = Object.fromEntries(KEYS.map(k => [k, 0]));
    const topByKey = {}; // nutrient key -> { recipe_name, value }
    const missing = [];

    for (const item of items) {
      const p = byRecipe[item.recipe_id];
      if (!p) { missing.push(item.recipe_name); continue; }
      for (const k of KEYS) {
        const v = Number(p[k] ?? 0);
        totals[k] += v;
        if (v > 0 && (!topByKey[k] || v > topByKey[k].value)) {
          topByKey[k] = { recipe_name: item.recipe_name, value: v };
        }
      }
    }

    const top_contributors = Object.fromEntries(
      KEYS.map(k => [k, topByKey[k]?.recipe_name ?? null])
    );

    res.json({
      menu_day_id: day.id,
      service_date: day.service_date,
      is_holiday: day.is_holiday,
      items_count: items.length,
      unlinked_count: missing.length,
      recipes_without_nutrition: missing,
      totals,
      compliance: checkDRICompliance(totals),
      top_contributors,
    });
  } catch (err) {
    console.error('Day nutrition failed:', err);
    res.status(500).json({ error: 'Failed to load day nutrition' });
  }
});

// GET /api/menus/:id/nutrition
// Per-day nutrition totals + DRI compliance for the month, plus monthly averages.
router.get('/:id/nutrition', async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    const days = await sql`
      SELECT md.id, md.service_date, md.is_holiday FROM menu_days md
      WHERE md.menu_id = ${menu.id} ORDER BY md.service_date
    `;

    const items = days.length > 0
      ? await sql`
          SELECT mdi.menu_day_id, mdi.recipe_id, r.name AS recipe_name
          FROM menu_day_items mdi
          JOIN recipes r ON r.id = mdi.recipe_id
          WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
        `
      : [];

    const recipeIds = [...new Set(items.map(i => i.recipe_id))];
    const profiles = recipeIds.length > 0
      ? await sql`SELECT * FROM nutrition_profiles WHERE recipe_id = ANY(${recipeIds})`
      : [];
    const byRecipe = Object.fromEntries(profiles.map(p => [p.recipe_id, p]));

    const KEYS = ['calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
                  'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg'];

    const itemsByDay = {};
    for (const item of items) (itemsByDay[item.menu_day_id] ??= []).push(item);

    const dayResults = days.map(day => {
      const dayItems = itemsByDay[day.id] ?? [];
      const totals = Object.fromEntries(KEYS.map(k => [k, 0]));
      const missing = [];

      for (const item of dayItems) {
        const p = byRecipe[item.recipe_id];
        if (!p) { missing.push(item.recipe_name); continue; }
        for (const k of KEYS) totals[k] += Number(p[k] ?? 0);
      }

      return {
        menu_day_id: day.id,
        service_date: day.service_date,
        is_holiday: day.is_holiday,
        totals,
        compliance: checkDRICompliance(totals),
        recipes_without_nutrition: missing,
      };
    });

    // Monthly average across non-holiday days with items
    const activeDays = dayResults.filter(d => !d.is_holiday && Object.values(d.totals).some(v => v > 0));
    const avgTotals = Object.fromEntries(KEYS.map(k => [k, 0]));
    if (activeDays.length > 0) {
      for (const d of activeDays)
        for (const k of KEYS) avgTotals[k] += d.totals[k];
      for (const k of KEYS)
        avgTotals[k] = Math.round((avgTotals[k] / activeDays.length) * 100) / 100;
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      menu_id: menu.id,
      year: menu.year,
      month: menu.month,
      days: dayResults,
      monthly_average: avgTotals,
      monthly_compliance: checkDRICompliance(avgTotals),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to calculate menu nutrition' });
  }
});
// GET /api/menus/:id/nutrition/explain
// Calls Claude to explain flagged DRI gaps and suggest specific recipe fixes.
// [NUTRITION_MANAGER, DIETITIAN, ADMIN] — every call spends Claude tokens, so it is
// authenticated and rate-limited per user. Claude call may take 5-15 s.
router.get('/:id/nutrition/explain', requireAuth('NUTRITION_MANAGER', 'DIETITIAN', 'ADMIN'), aiLightLimiter, async (req, res) => {
  try {
    const result = await explainNutritionGaps(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    // Surface friendly errors to the UI (no data, all compliant, etc.)
    if (err.message.includes('No nutrition data') ||
        err.message.includes('All nutrients') ||
        err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[nutrition/explain]', err);
    res.status(500).json({ error: 'Failed to generate nutrition explanation' });
  }
});

// GET /api/menus/:id/export/pdf
// Only PUBLISHED menus. Streams a calendar PDF.
router.get('/:id/export/pdf', async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'PUBLISHED') {
      return res.status(403).json({ error: 'Only PUBLISHED menus can be exported' });
    }

    const days = await sql`
      SELECT md.* FROM menu_days md WHERE md.menu_id = ${menu.id} ORDER BY md.service_date
    `;
    const items = days.length > 0
      ? await sql`
          SELECT mdi.*, r.name AS recipe_name
          FROM menu_day_items mdi
          JOIN recipes r ON r.id = mdi.recipe_id
          WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
          ORDER BY mdi.sort_order
        `
      : [];

    const byDay = {};
    for (const item of items) (byDay[item.menu_day_id] ??= []).push(item);
    const fullMenu = { ...menu, days: days.map(d => ({ ...d, items: byDay[d.id] ?? [] })) };

    generateMenuPdf(fullMenu, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});
// GET /api/menus/published/current  [no auth — kitchen staff landing page]
// Returns the most recent PUBLISHED menu (full detail with days + items).
router.get('/published/current', async (req, res) => {
  try {
    const [menu] = await sql`
      SELECT * FROM menus WHERE status = 'PUBLISHED'
      ORDER BY year DESC, month DESC LIMIT 1
    `;
    if (!menu) return res.status(404).json({ error: 'No published menu found' });

    const days = await sql`
      SELECT * FROM menu_days WHERE menu_id = ${menu.id} ORDER BY service_date
    `;
    const items = days.length > 0
      ? await sql`
          SELECT mdi.*, r.name AS recipe_name, r.category, r.protein_group, r.servings
          FROM menu_day_items mdi
          JOIN recipes r ON r.id = mdi.recipe_id
          WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
          ORDER BY mdi.sort_order
        `
      : [];

    const byDay = {};
    for (const item of items) (byDay[item.menu_day_id] ??= []).push(item);

    res.set('Cache-Control', 'no-store');
    res.json({
      ...menu,
      days: days.map(d => ({ ...d, items: byDay[d.id] ?? [] })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch published menu' });
  }
});

// POST /api/menus/:id/publish  [NUTRITION_MANAGER, ADMIN]
// Transitions APPROVED → PUBLISHED.
router.post('/:id/publish', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Menu must be APPROVED to publish' });
    }
    const [updated] = await sql`
      UPDATE menus
      SET status = 'PUBLISHED', updated_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to publish menu' });
  }
});

// POST /api/menus/:id/archive  [ADMIN]
// Transitions PUBLISHED → ARCHIVED.
router.post('/:id/archive', requireAuth('ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'PUBLISHED') {
      return res.status(400).json({ error: 'Menu must be PUBLISHED to archive' });
    }
    const [updated] = await sql`
      UPDATE menus
      SET status = 'ARCHIVED', updated_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to archive menu' });
  }
});

// GET /api/menus/:id/review-summary  [DIETITIAN, ADMIN]
// Calls Claude to generate an AI-powered review summary for the RD.
router.get('/:id/review-summary', requireAuth('DIETITIAN', 'ADMIN'), aiLightLimiter, async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    // Load days with items
    const days = await sql`
      SELECT md.id, md.service_date, md.is_holiday FROM menu_days md
      WHERE md.menu_id = ${menu.id} ORDER BY md.service_date
    `;

    const items = days.length > 0
      ? await sql`
          SELECT mdi.*, r.name AS recipe_name, r.protein_group
          FROM menu_day_items mdi
          JOIN recipes r ON r.id = mdi.recipe_id
          WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
          ORDER BY mdi.sort_order
        `
      : [];

    const byDay = {};
    for (const item of items) (byDay[item.menu_day_id] ??= []).push(item);
    const daysWithItems = days.map(d => ({ ...d, items: byDay[d.id] ?? [] }));

    // Compute nutrition totals per day
    const recipeIds = [...new Set(items.map(i => i.recipe_id))];
    const profiles = recipeIds.length > 0
      ? await sql`SELECT * FROM nutrition_profiles WHERE recipe_id = ANY(${recipeIds})`
      : [];
    const byRecipe = Object.fromEntries(profiles.map(p => [p.recipe_id, p]));

    const KEYS = ['calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
                  'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg'];

    const nutritionDays = days.map(day => {
      const dayItems = byDay[day.id] ?? [];
      const totals = Object.fromEntries(KEYS.map(k => [k, 0]));
      for (const item of dayItems) {
        const p = byRecipe[item.recipe_id];
        if (p) for (const k of KEYS) totals[k] += Number(p[k] ?? 0);
      }
      return {
        ...day,
        totals,
        compliance: checkDRICompliance(totals),
      };
    });

    // Load unresolved conflicts
    const conflicts = await sql`
      SELECT * FROM conflicts
      WHERE menu_id = ${menu.id} AND resolved = false
    `;

    const summary = await generateRDSummary({
      menu,
      days: daysWithItems,
      nutritionDays,
      conflicts,
    });

    res.set('Cache-Control', 'no-store');
    res.json(summary);
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate review summary' });
  }
});

// POST /api/menus/:id/days/:dayId/suggestions  [NUTRITION_MANAGER, ADMIN]
// Body: { conflict_id }
// Returns AI substitution suggestions to resolve a specific conflict. No DB writes.
router.post('/:id/days/:dayId/suggestions', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiLightLimiter, async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    const { conflict_id } = req.body;
    if (!conflict_id) return res.status(400).json({ error: 'conflict_id is required' });

    // Load the conflict
    const [conflict] = await sql`
      SELECT * FROM conflicts WHERE id = ${conflict_id} AND menu_id = ${req.params.id}
    `;
    if (!conflict) return res.status(404).json({ error: 'Conflict not found' });

    // Load the day's current items with protein group + category
    const dayItems = await sql`
      SELECT mdi.id, mdi.recipe_id, mdi.meal_type,
             r.name AS recipe_name, r.protein_group, r.category
      FROM menu_day_items mdi
      JOIN recipes r ON r.id = mdi.recipe_id
      WHERE mdi.menu_day_id = ${req.params.dayId}
      ORDER BY mdi.sort_order
    `;

    // Load all active recipes with nutrition hints
    const recipes = await sql`
      SELECT r.id, r.name, r.category, r.protein_group,
             np.sodium_mg, np.fiber_g
      FROM recipes r
      LEFT JOIN nutrition_profiles np ON np.recipe_id = r.id
      WHERE r.is_active = true
      ORDER BY r.category, r.name
    `;

    // Build set of recently used recipe IDs — exclude any recipe used within
    // its own category's repeat cycle of this day, so suggested swaps don't
    // create a fresh repeat. The query is bounded by the longest cycle, then
    // filtered per-category in JS.
    const [day] = await sql`SELECT service_date FROM menu_days WHERE id = ${req.params.dayId}`;
    const recentItems = day ? await sql`
      SELECT mdi.recipe_id, r.category,
             MIN(ABS(md.service_date - ${day.service_date}::date)) AS day_gap
      FROM menu_day_items mdi
      JOIN menu_days md ON md.id = mdi.menu_day_id
      JOIN recipes   r  ON r.id  = mdi.recipe_id
      WHERE md.menu_id = ${req.params.id}
        AND md.id != ${req.params.dayId}
        AND ABS(md.service_date - ${day.service_date}::date) <= ${MAX_REPEAT_CYCLE_DAYS}
      GROUP BY mdi.recipe_id, r.category
    ` : [];
    const recentlyUsedIds = new Set(
      recentItems
        .filter(r => Number(r.day_gap) <= repeatCycleFor(r.category))
        .map(r => r.recipe_id)
    );

    const suggestions = await generateConflictSuggestions({
      conflict,
      dayItems,
      recipes,
      recentlyUsedIds,
    });

    res.json(suggestions);
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// POST /api/menus/:id/edit  [NUTRITION_MANAGER, ADMIN]
// Body: { instruction: string }
// Returns a proposed diff WITHOUT applying it. Client applies individually.
router.post('/:id/edit', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Menu must be DRAFT to use natural language editing' });
    }
    const { instruction } = req.body;
    if (!instruction?.trim()) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    const diff = await generateMenuEdits(req.params.id, instruction.trim());
    res.json(diff); // { summary, changes: [...] }
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate menu edits' });
  }
});

// POST /api/menus/:id/generate-narrative  [NUTRITION_MANAGER, ADMIN]
// Calls Claude (Haiku) to write a friendly client-facing menu intro.
// Saves to client_narrative on the menu record. Returns { narrative }.
router.post('/:id/generate-narrative', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;

    const days = await sql`
      SELECT md.id, md.service_date, md.is_holiday, md.holiday_note,
             COALESCE(
               json_agg(json_build_object('meal_type', mdi.meal_type, 'recipe_name', r.name)
                        ORDER BY mdi.sort_order)
               FILTER (WHERE mdi.id IS NOT NULL), '[]'
             ) AS items
      FROM menu_days md
      LEFT JOIN menu_day_items mdi ON mdi.menu_day_id = md.id
      LEFT JOIN recipes r ON r.id = mdi.recipe_id
      WHERE md.menu_id = ${menu.id}
      GROUP BY md.id ORDER BY md.service_date
    `;

    const narrative = await generateMenuNarrative(menu, days);

    await sql`UPDATE menus SET client_narrative = ${narrative}, updated_at = NOW() WHERE id = ${menu.id}`;

    res.json({ narrative });
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate narrative' });
  }
});

// PATCH /api/menus/:id/narrative  [NUTRITION_MANAGER, ADMIN]
// Save an edited narrative directly.
router.patch('/:id/narrative', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { narrative } = req.body;
    await sql`UPDATE menus SET client_narrative = ${narrative ?? null}, updated_at = NOW() WHERE id = ${req.params.id}`;
    res.json({ narrative });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save narrative' });
  }
});

// ---------------------------------------------------------------------------
// ORDER LIST helpers
// ---------------------------------------------------------------------------

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Group menu_days rows into Mon–Fri calendar weeks.
// Returns an array of arrays, each inner array being one week's days (sorted).
function groupDaysByWeek(days) {
  const sorted = [...days].sort((a, b) => {
    const da = toDateStr(a.service_date), db = toDateStr(b.service_date);
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const weekMap = new Map();
  for (const day of sorted) {
    const ds = toDateStr(day.service_date);
    const date = new Date(ds + 'T12:00:00Z');
    const dow = date.getUTCDay(); // 1=Mon … 5=Fri
    const mon = new Date(date);
    mon.setUTCDate(date.getUTCDate() - (dow - 1));
    const key = mon.toISOString().slice(0, 10);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key).push(day);
  }
  return [...weekMap.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, w]) => w);
}

async function buildOrderListData(menu, weekNum, defaultServings) {
  const allDays = await sql`SELECT * FROM menu_days WHERE menu_id = ${menu.id} ORDER BY service_date`;
  const weekGroups = groupDaysByWeek(allDays);
  if (weekNum < 1 || weekNum > weekGroups.length) {
    return { error: `Week ${weekNum} does not exist — menu has ${weekGroups.length} week(s)`, status: 400 };
  }

  const weekDays = weekGroups[weekNum - 1];
  const activeDays = weekDays.filter(d => !d.is_holiday);

  if (activeDays.length === 0) {
    return { week: weekNum, total_weeks: weekGroups.length, days: [], gfs_items: [], other_items: [], untagged_items: [] };
  }

  const dayIds = activeDays.map(d => d.id);
  const items = await sql`
    SELECT mdi.menu_day_id, mdi.recipe_id, r.name AS recipe_name
    FROM menu_day_items mdi
    JOIN recipes r ON r.id = mdi.recipe_id
    WHERE mdi.menu_day_id = ANY(${dayIds})
  `;

  const recipeIds = [...new Set(items.map(i => i.recipe_id))];
  const ingredients = recipeIds.length > 0
    ? await sql`
        SELECT ri.ingredient_name, ri.quantity_per_100_svgs, ri.unit,
               ri.vendor, ri.gfs_product_code, ri.case_size, ri.order_unit,
               ri.recipe_id, r.name AS recipe_name
        FROM recipe_ingredients ri
        JOIN recipes r ON r.id = ri.recipe_id
        WHERE ri.recipe_id = ANY(${recipeIds})
        ORDER BY ri.ingredient_name
      `
    : [];

  // Map: day id → servings for that day (+ planned overrun buffer)
  const servingsByDay = Object.fromEntries(
    activeDays.map(d => {
      const base       = d.estimated_servings ?? defaultServings;
      const multiplier = 1 + (Number(d.planned_overrun_pct ?? 0) / 100);
      return [d.id, Math.ceil(base * multiplier)];
    })
  );

  // Which days use which recipe?
  const recipeUsages = {};
  for (const item of items) {
    (recipeUsages[item.recipe_id] ??= []).push({
      day_id: item.menu_day_id,
      recipe_name: item.recipe_name,
      servings: servingsByDay[item.menu_day_id] ?? defaultServings,
    });
  }

  // Consolidate ingredients
  const consolidated = {};
  for (const ing of ingredients) {
    const usages = recipeUsages[ing.recipe_id] ?? [];
    for (const usage of usages) {
      const qty = (Number(ing.quantity_per_100_svgs) / 100) * usage.servings;
      const key = `${ing.ingredient_name}|${ing.unit}|${ing.vendor ?? ''}`;
      if (!consolidated[key]) {
        consolidated[key] = {
          ingredient_name: ing.ingredient_name,
          unit: ing.unit,
          vendor: ing.vendor || null,
          gfs_product_code: ing.gfs_product_code || null,
          case_size: ing.case_size || null,
          order_unit: ing.order_unit || null,
          total_quantity: 0,
          recipes: new Set(),
        };
      }
      consolidated[key].total_quantity += qty;
      consolidated[key].recipes.add(ing.recipe_name);
    }
  }

  const allItems = Object.values(consolidated)
    .map(item => ({
      ...item,
      total_quantity: Math.round(item.total_quantity * 100) / 100,
      recipes: [...item.recipes].sort(),
    }))
    .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

  return {
    week: weekNum,
    total_weeks: weekGroups.length,
    menu_year: menu.year,
    menu_month: menu.month,
    default_servings: defaultServings,
    days: activeDays.map(d => {
      const base       = d.estimated_servings ?? defaultServings;
      const overrunPct = Number(d.planned_overrun_pct ?? 0);
      return {
        id: d.id,
        service_date:        toDateStr(d.service_date),
        estimated_servings:  base,
        planned_overrun_pct: overrunPct,
        planned_servings:    Math.ceil(base * (1 + overrunPct / 100)),
      };
    }),
    gfs_items:      allItems.filter(i => i.vendor === 'GFS'),
    other_items:    allItems.filter(i => i.vendor && i.vendor !== 'GFS'),
    untagged_items: allItems.filter(i => !i.vendor),
  };
}

// PATCH /api/menus/:id/days/:dayId/servings  [NUTRITION_MANAGER, ADMIN]
// Updates estimated_servings on a menu day — allowed on any non-ARCHIVED menu.
router.patch('/:id/days/:dayId/servings', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status === 'ARCHIVED') {
      return res.status(403).json({ error: 'Archived menus cannot be modified' });
    }
    const { estimated_servings } = req.body;
    if (!estimated_servings || Number(estimated_servings) < 1) {
      return res.status(400).json({ error: 'estimated_servings must be a positive integer' });
    }
    const [day] = await sql`
      UPDATE menu_days SET estimated_servings = ${Number(estimated_servings)}
      WHERE id = ${req.params.dayId} AND menu_id = ${req.params.id}
      RETURNING *
    `;
    if (!day) return res.status(404).json({ error: 'Menu day not found' });
    res.json(day);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update estimated servings' });
  }
});

// PATCH /api/menus/:id/days/:dayId/actuals  [NUTRITION_MANAGER, ADMIN, KITCHEN_STAFF]
// Updates post-service actual counts and/or planned overrun % on a menu day.
router.patch('/:id/days/:dayId/actuals', requireAuth('NUTRITION_MANAGER', 'ADMIN', 'KITCHEN_STAFF'), async (req, res) => {
  try {
    const { actual_prepared, actual_served, planned_overrun_pct } = req.body;

    const [day] = await sql`
      UPDATE menu_days SET
        actual_prepared     = COALESCE(${actual_prepared     ?? null}::int,     actual_prepared),
        actual_served       = COALESCE(${actual_served       ?? null}::int,     actual_served),
        planned_overrun_pct = COALESCE(${planned_overrun_pct ?? null}::decimal, planned_overrun_pct)
      WHERE id = ${req.params.dayId} AND menu_id = ${req.params.id}
      RETURNING *
    `;
    if (!day) return res.status(404).json({ error: 'Menu day not found' });
    res.json(day);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update actuals' });
  }
});

// GET /api/menus/:id/order-list?week=1&default_servings=100  [NUTRITION_MANAGER, ADMIN]
// Returns consolidated ingredient order list for one Mon–Fri week.
router.get('/:id/order-list', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (!['APPROVED', 'PUBLISHED'].includes(menu.status)) {
      return res.status(400).json({ error: 'Order list is only available for APPROVED or PUBLISHED menus' });
    }
    const weekNum        = Math.max(1, parseInt(req.query.week ?? '1', 10));
    const defaultServings = Math.max(1, parseInt(req.query.default_servings ?? '100', 10));
    const result = await buildOrderListData(menu, weekNum, defaultServings);
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate order list' });
  }
});

// GET /api/menus/:id/order-list/export?week=1&format=csv|pdf&default_servings=100
// Streams a CSV or PDF order sheet.
router.get('/:id/order-list/export', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (!['APPROVED', 'PUBLISHED'].includes(menu.status)) {
      return res.status(400).json({ error: 'Order list export requires APPROVED or PUBLISHED menu' });
    }

    const weekNum        = Math.max(1, parseInt(req.query.week ?? '1', 10));
    const defaultServings = Math.max(1, parseInt(req.query.default_servings ?? '100', 10));
    const format         = req.query.format === 'pdf' ? 'pdf' : 'csv';

    const data = await buildOrderListData(menu, weekNum, defaultServings);
    if (data.error) return res.status(data.status ?? 400).json({ error: data.error });

    const MONTH_NAMES = ['','January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    const label = `${MONTH_NAMES[menu.month]} ${menu.year} — Week ${weekNum}`;
    const filename = `order-list-${menu.year}-${String(menu.month).padStart(2,'0')}-week${weekNum}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

      const rows = [];
      rows.push(`COA Menu Planner — Order List — ${label}`);
      rows.push(`Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`);
      rows.push('');

      const writeSection = (title, items) => {
        if (items.length === 0) return;
        rows.push(title);
        rows.push('Ingredient,Total Quantity,Unit,GFS Product Code,Case Size,Order Unit,Used In Recipes');
        for (const i of items) {
          const recipes = `"${i.recipes.join(', ')}"`;
          rows.push(`"${i.ingredient_name}",${i.total_quantity},"${i.unit}","${i.gfs_product_code ?? ''}","${i.case_size ?? ''}","${i.order_unit ?? ''}",${recipes}`);
        }
        rows.push('');
      };

      writeSection('GFS ITEMS', data.gfs_items);
      writeSection('OTHER VENDOR ITEMS', data.other_items);
      writeSection('UNTAGGED INGREDIENTS (needs vendor assignment)', data.untagged_items);

      return res.send(rows.join('\r\n'));
    }

    // PDF
    generateOrderListPdf(data, label, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export order list' });
  }
});

// ---------------------------------------------------------------------------

// POST /api/menus/:id/generate  [NUTRITION_MANAGER, ADMIN]
// Calls Claude to generate a menu proposal. Returns proposal without modifying the menu.
router.post('/:id/generate', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    const menu = await loadMenu(res, req.params.id);
    if (!menu) return;
    if (menu.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Menu must be DRAFT to generate a proposal' });
    }

    const proposal = await generateMenuProposal(req.params.id);

    const [saved] = await sql`
      INSERT INTO menu_proposals (menu_id, proposal, created_by)
      VALUES (${req.params.id}, ${sql.json(proposal)}, ${req.user.id})
      RETURNING id, created_at
    `;

    res.json({ proposal_id: saved.id, created_at: saved.created_at, ...proposal });
  } catch (err) {
    if (err.message.includes('ANTHROPIC_API_KEY')) {
      console.error('[generate] ANTHROPIC_API_KEY not set:', err.message);
      return res.status(503).json({ error: err.message });
    }
    console.error('Menu proposal generation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to generate menu proposal' });
  }
});

export default router;
