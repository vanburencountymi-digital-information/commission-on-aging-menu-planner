import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { searchFoods } from '../services/usda.js';

const router = Router();

// GET /api/usda/search?q=<term>  [NUTRITION_MANAGER, ADMIN]
// Proxy to USDA FoodData Central. Returns top 10 matching foods.
router.get('/search', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: 'q is required' });

    const results = await searchFoods(q.trim());
    res.json(results);
  } catch (err) {
    if (err.message?.includes('USDA_API_KEY') || err.message?.includes('401')) {
      return res.status(503).json({ error: 'USDA service unavailable — check USDA_API_KEY' });
    }
    console.error(err);
    res.status(500).json({ error: 'USDA search failed' });
  }
});

export default router;
