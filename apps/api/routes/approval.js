import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/approval/queue  [DIETITIAN, ADMIN]
// All SUBMITTED menus awaiting RD review, ordered by submitted_at.
router.get('/queue', requireAuth('DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const menus = await sql`
      SELECT m.*,
             sb.name  AS submitted_by_name,
             sb.email AS submitted_by_email
      FROM menus m
      LEFT JOIN users sb ON sb.id = m.submitted_by
      WHERE m.status = 'SUBMITTED'
      ORDER BY m.submitted_at ASC NULLS LAST
    `;
    res.json(menus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch approval queue' });
  }
});

// GET /api/approval/history  [DIETITIAN, ADMIN]
// Audit log: all approved/rejected menus with approver name + timestamp.
router.get('/history', requireAuth('DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const menus = await sql`
      SELECT m.id, m.year, m.month, m.status,
             m.submitted_at, m.approved_at, m.rd_notes,
             sb.name  AS submitted_by_name,
             sb.email AS submitted_by_email,
             ab.name  AS approved_by_name,
             ab.email AS approved_by_email
      FROM menus m
      LEFT JOIN users sb ON sb.id = m.submitted_by
      LEFT JOIN users ab ON ab.id = m.approved_by
      WHERE m.approved_at IS NOT NULL OR m.status IN ('APPROVED', 'PUBLISHED', 'ARCHIVED')
      ORDER BY COALESCE(m.approved_at, m.updated_at) DESC
    `;
    res.json(menus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch approval history' });
  }
});

export default router;
