import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/frozen-stock?available_only=1
// Returns frozen stock log. Optional ?available_only=1 filters to unused entries.
router.get('/', requireAuth('NUTRITION_MANAGER', 'ADMIN', 'KITCHEN_STAFF'), async (req, res) => {
  try {
    const availableOnly = req.query.available_only === '1';
    const stock = await sql`
      SELECT
        fs.*,
        r.name     AS recipe_name,
        r.category AS recipe_category,
        md.service_date AS source_service_date
      FROM frozen_stock fs
      JOIN recipes r   ON r.id  = fs.recipe_id
      LEFT JOIN menu_days md ON md.id = fs.menu_day_id
      ${availableOnly ? sql`WHERE fs.used_date IS NULL` : sql``}
      ORDER BY fs.prepared_date DESC, fs.created_at DESC
    `;
    res.json(stock);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch frozen stock' });
  }
});

// GET /api/frozen-stock/report
// Monthly overrun report aggregated by recipe, sorted by month desc then overrun desc.
router.get('/report', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const report = await sql`
      SELECT
        r.id                                              AS recipe_id,
        r.name                                            AS recipe_name,
        r.category                                        AS recipe_category,
        DATE_TRUNC('month', fs.prepared_date)::date      AS month,
        SUM(fs.servings)::int                             AS total_overrun_servings,
        COUNT(*)::int                                     AS entries
      FROM frozen_stock fs
      JOIN recipes r ON r.id = fs.recipe_id
      GROUP BY r.id, r.name, r.category, DATE_TRUNC('month', fs.prepared_date)
      ORDER BY month DESC, total_overrun_servings DESC
    `;
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch overrun report' });
  }
});

// POST /api/frozen-stock  [NUTRITION_MANAGER, ADMIN, KITCHEN_STAFF]
// Body: { recipe_id, menu_day_id?, servings, prepared_date, notes? }
router.post('/', requireAuth('NUTRITION_MANAGER', 'ADMIN', 'KITCHEN_STAFF'), async (req, res) => {
  try {
    const { recipe_id, menu_day_id, servings, prepared_date, notes } = req.body;
    if (!recipe_id) return res.status(400).json({ error: 'recipe_id is required' });
    if (!servings || Number(servings) < 1) return res.status(400).json({ error: 'servings must be a positive integer' });
    if (!prepared_date) return res.status(400).json({ error: 'prepared_date is required' });

    const [entry] = await sql`
      INSERT INTO frozen_stock (recipe_id, menu_day_id, servings, prepared_date, notes, created_by)
      VALUES (${recipe_id}, ${menu_day_id ?? null}, ${Number(servings)}, ${prepared_date},
              ${notes ?? null}, ${req.user.id})
      RETURNING *
    `;
    res.status(201).json(entry);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'recipe_id or menu_day_id not found' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create frozen stock entry' });
  }
});

// PATCH /api/frozen-stock/:id  [NUTRITION_MANAGER, ADMIN, KITCHEN_STAFF]
// Body: { servings?, used_date?, notes? }
router.patch('/:id', requireAuth('NUTRITION_MANAGER', 'ADMIN', 'KITCHEN_STAFF'), async (req, res) => {
  try {
    const { servings, used_date, notes } = req.body;

    const [entry] = await sql`
      UPDATE frozen_stock SET
        servings   = COALESCE(${servings  ?? null}::int,  servings),
        used_date  = COALESCE(${used_date ?? null}::date, used_date),
        notes      = COALESCE(${notes     ?? null},       notes),
        updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!entry) return res.status(404).json({ error: 'Frozen stock entry not found' });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update frozen stock entry' });
  }
});

// DELETE /api/frozen-stock/:id  [NUTRITION_MANAGER, ADMIN]
router.delete('/:id', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const [entry] = await sql`DELETE FROM frozen_stock WHERE id = ${req.params.id} RETURNING id`;
    if (!entry) return res.status(404).json({ error: 'Frozen stock entry not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete frozen stock entry' });
  }
});

export default router;
