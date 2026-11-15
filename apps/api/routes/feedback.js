import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { feedbackLimiter, aiHeavyLimiter } from '../middleware/rateLimits.js';
import { generateFeedbackInsights } from '../services/ai.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/feedback  [no auth — anonymous, rate-limited per IP]
// Body: { menu_id, menu_day_item_id, rating (1–5), comment? }
router.post('/', feedbackLimiter, async (req, res) => {
  try {
    const { menu_id, menu_day_item_id, rating, comment } = req.body;

    if (!menu_id || !UUID_RE.test(menu_id)) {
      return res.status(400).json({ error: 'menu_id must be a valid UUID' });
    }
    if (!menu_day_item_id || !UUID_RE.test(menu_day_item_id)) {
      return res.status(400).json({ error: 'menu_day_item_id must be a valid UUID' });
    }
    const ratingInt = parseInt(rating, 10);
    if (!Number.isInteger(ratingInt) || ratingInt < 1 || ratingInt > 5) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }

    const [record] = await sql`
      INSERT INTO client_feedback (menu_id, menu_day_item_id, rating, comment)
      VALUES (${menu_id}, ${menu_day_item_id}, ${ratingInt}, ${comment ?? null})
      RETURNING *
    `;
    res.status(201).json(record);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'menu_id or menu_day_item_id not found' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// GET /api/feedback/menu/:menuId  [NUTRITION_MANAGER, DIETITIAN, ADMIN]
// Returns feedback aggregated by menu_day_item_id.
router.get('/menu/:menuId', requireAuth('NUTRITION_MANAGER', 'DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const rows = await sql`
      SELECT
        cf.menu_day_item_id,
        mdi.recipe_id,
        r.name                                AS recipe_name,
        ROUND(AVG(cf.rating)::numeric, 2)     AS avg_rating,
        COUNT(*)::int                          AS count,
        ARRAY_AGG(cf.comment ORDER BY cf.submitted_at DESC)
          FILTER (WHERE cf.comment IS NOT NULL) AS comments
      FROM client_feedback cf
      JOIN menu_day_items mdi ON mdi.id = cf.menu_day_item_id
      JOIN recipes r           ON r.id  = mdi.recipe_id
      WHERE cf.menu_id = ${req.params.menuId}
      GROUP BY cf.menu_day_item_id, mdi.recipe_id, r.name
      ORDER BY avg_rating ASC
    `;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch menu feedback' });
  }
});

// GET /api/feedback/recipe/:recipeId/score  [any authenticated user]
// Returns rolling average rating for a recipe across all menus.
router.get('/recipe/:recipeId/score', requireAuth(), async (req, res) => {
  try {
    const [score] = await sql`
      SELECT
        mdi.recipe_id,
        ROUND(AVG(cf.rating)::numeric, 2) AS avg_rating,
        COUNT(*)::int                      AS count,
        MAX(cf.submitted_at)               AS last_rated_at
      FROM client_feedback cf
      JOIN menu_day_items mdi ON mdi.id = cf.menu_day_item_id
      WHERE mdi.recipe_id = ${req.params.recipeId}
      GROUP BY mdi.recipe_id
    `;

    if (!score) {
      return res.json({
        recipe_id: req.params.recipeId,
        avg_rating: null,
        count: 0,
        last_rated_at: null,
      });
    }
    res.json(score);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipe score' });
  }
});

// GET /api/feedback/insights  [NUTRITION_MANAGER, ADMIN]
// Calls Claude with aggregated feedback stats and returns waste/ordering recommendations.
router.get('/insights', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    // Overall data summary
    const [summary] = await sql`
      SELECT
        COUNT(DISTINCT menu_id)::int AS total_menus,
        COUNT(*)::int                AS total_ratings
      FROM client_feedback
    `;

    // Fast-path: not enough data to even call Claude
    if (summary.total_ratings < 5) {
      return res.json({
        data_quality: 'insufficient',
        data_note: `Only ${summary.total_ratings} rating(s) across ${summary.total_menus} menu(s). At least 10 ratings across 3 menus are needed for meaningful analysis.`,
        insights: [],
      });
    }

    // Per-recipe aggregates — only recipes with ≥3 ratings
    const recipeStats = await sql`
      SELECT
        r.id                                                     AS recipe_id,
        r.name                                                   AS recipe_name,
        r.category,
        r.protein_group,
        r.seasons,
        ROUND(AVG(cf.rating)::numeric, 2)                       AS avg_rating,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.rating)  AS median_rating,
        COUNT(*)::int                                            AS total_ratings,
        COUNT(DISTINCT cf.menu_id)::int                         AS menus_served,
        COUNT(CASE WHEN cf.rating <= 2 THEN 1 END)::int         AS low_ratings,
        COUNT(CASE WHEN cf.rating >= 4 THEN 1 END)::int         AS high_ratings
      FROM client_feedback cf
      JOIN menu_day_items mdi ON mdi.id = cf.menu_day_item_id
      JOIN recipes r          ON r.id  = mdi.recipe_id
      GROUP BY r.id, r.name, r.category, r.protein_group, r.seasons
      HAVING COUNT(*) >= 3
      ORDER BY avg_rating ASC
    `;

    if (recipeStats.length === 0) {
      return res.json({
        data_quality: 'insufficient',
        data_note: 'No individual recipe has 3 or more ratings yet. More feedback is needed before insights can be generated.',
        insights: [],
      });
    }

    const result = await generateFeedbackInsights(recipeStats, summary);
    res.json(result);
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate feedback insights' });
  }
});

export default router;
