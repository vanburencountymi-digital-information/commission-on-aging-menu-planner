import sql from '../db/client.js';
import { repeatCycleFor, WEEKLY_REPEAT_CATEGORIES } from './repeatCycles.js';

// Run all conflict rules against a newly inserted menu_day_item.
// Persists any violations to the conflicts table and returns them.
export async function checkConflicts(menuId, menuDayId, menuDayItemId) {
  const [item] = await sql`
    SELECT mdi.id, mdi.recipe_id, r.protein_group, r.category, r.name AS recipe_name,
           md.service_date
    FROM menu_day_items mdi
    JOIN recipes r  ON r.id  = mdi.recipe_id
    JOIN menu_days md ON md.id = mdi.menu_day_id
    WHERE mdi.id = ${menuDayItemId}
  `;
  if (!item) return [];

  const violations = [];

  // Rule 1 — Same protein group appears in any two entrees (HOT or COLD) on the same day (ERROR)
  if (item.category === 'HOT_ENTREE' || item.category === 'COLD_ENTREE') {
    const clash = await sql`
      SELECT mdi.id FROM menu_day_items mdi
      JOIN recipes r ON r.id = mdi.recipe_id
      WHERE mdi.menu_day_id = ${menuDayId}
        AND mdi.id != ${menuDayItemId}
        AND r.protein_group = ${item.protein_group}
        AND r.category IN ('HOT_ENTREE', 'COLD_ENTREE')
      LIMIT 1
    `;
    if (clash.length > 0) {
      violations.push({
        severity: 'ERROR',
        conflict_type: 'PROTEIN_CONFLICT',
        description: `${item.protein_group} protein appears in more than one entree on the same day.`,
      });
    }
  }

  // Rule 2 — Fish more than 2× in the same Mon–Fri week (WARNING)
  if (item.protein_group === 'FISH') {
    const d = new Date((item.service_date instanceof Date ? item.service_date.toISOString() : String(item.service_date)).slice(0, 10) + 'T00:00:00Z');
    const dow = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);

    const [{ cnt }] = await sql`
      SELECT COUNT(*) AS cnt FROM menu_day_items mdi
      JOIN recipes   r  ON r.id  = mdi.recipe_id
      JOIN menu_days md ON md.id = mdi.menu_day_id
      WHERE md.menu_id = ${menuId}
        AND mdi.id != ${menuDayItemId}
        AND r.protein_group = 'FISH'
        AND md.service_date BETWEEN ${monday.toISOString().slice(0, 10)}
                                AND ${friday.toISOString().slice(0, 10)}
    `;
    if (Number(cnt) >= 2) {
      violations.push({
        severity: 'WARNING',
        conflict_type: 'FISH_FREQUENCY',
        description: `Fish appears more than twice in the week of ${monday.toISOString().slice(0, 10)}.`,
      });
    }
  }

  // Rule 3 — Same recipe within its category's repeat cycle (WARNING)
  const d = new Date((item.service_date instanceof Date ? item.service_date.toISOString() : String(item.service_date)).slice(0, 10) + 'T00:00:00Z');
  const cycleDays = repeatCycleFor(item.category);
  const winStart = new Date(d);
  winStart.setUTCDate(d.getUTCDate() - cycleDays);
  const winEnd = new Date(d);
  winEnd.setUTCDate(d.getUTCDate() + cycleDays);

  const repeat = await sql`
    SELECT md.service_date FROM menu_day_items mdi
    JOIN menu_days md ON md.id = mdi.menu_day_id
    WHERE mdi.recipe_id = ${item.recipe_id}
      AND mdi.id != ${menuDayItemId}
      AND md.service_date BETWEEN ${winStart.toISOString().slice(0, 10)}
                              AND ${winEnd.toISOString().slice(0, 10)}
    LIMIT 1
  `;
  if (repeat.length > 0) {
    violations.push({
      severity: 'WARNING',
      conflict_type: 'RECIPE_REPEAT',
      description: `"${item.recipe_name}" also appears on ${repeat[0].service_date}, within the ${cycleDays}-day repeat window for ${item.category}.`,
    });
  }

  // Rule 4 — Same fruit or bread 3+ times in one Mon–Fri week (WARNING)
  if (WEEKLY_REPEAT_CATEGORIES.includes(item.category)) {
    const dow = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);

    const [{ cnt }] = await sql`
      SELECT COUNT(*) AS cnt FROM menu_day_items mdi
      JOIN menu_days md ON md.id = mdi.menu_day_id
      WHERE md.menu_id = ${menuId}
        AND mdi.id != ${menuDayItemId}
        AND mdi.recipe_id = ${item.recipe_id}
        AND md.service_date BETWEEN ${monday.toISOString().slice(0, 10)}
                                AND ${friday.toISOString().slice(0, 10)}
    `;
    // cnt counts the OTHER copies; >= 2 others means this is the 3rd+ in the week.
    if (Number(cnt) >= 2) {
      violations.push({
        severity: 'WARNING',
        conflict_type: 'WEEKLY_REPEAT',
        description: `"${item.recipe_name}" appears 3 or more times in the week of ${monday.toISOString().slice(0, 10)}.`,
      });
    }
  }

  if (violations.length === 0) return [];

  const saved = [];
  for (const v of violations) {
    const [conflict] = await sql`
      INSERT INTO conflicts
        (menu_id, menu_day_id, menu_day_item_id, severity, conflict_type, description)
      VALUES
        (${menuId}, ${menuDayId}, ${menuDayItemId},
         ${v.severity}::conflict_severity, ${v.conflict_type}, ${v.description})
      RETURNING *
    `;
    saved.push(conflict);
  }
  return saved;
}

export async function clearConflictsForItem(menuDayItemId) {
  await sql`DELETE FROM conflicts WHERE menu_day_item_id = ${menuDayItemId}`;
}
