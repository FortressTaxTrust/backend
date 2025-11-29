import { Router } from "express";
import db from "../adapter/pgsql.js";
import { authenticateToken, adminAuth } from "../middleware/auth.js";
import PgHelper from "../utils/pgHelpers.js";
import { uploadBase64ToS3 } from "../middleware/s3.js";

const router = Router();

/**
 * Get all case studies
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 6
    const offset = (page - 1) * limit

    const caseStudies = await db.any(
      'SELECT id , title, content, status, created_at FROM case_studies ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    )

    const total = await db.one('SELECT COUNT(*) FROM case_studies', [], (r) => +r.count)

    res.json({ caseStudies, total })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Get single case study by ID
 */
router.get('/:id/private', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const caseStudy = await db.oneOrNone('SELECT * FROM case_studies WHERE id = $1', [id]);

    if (!caseStudy) return res.status(404).json({ error: 'Case study not found' });

    res.json({ caseStudy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    const caseStudy = await db.oneOrNone('SELECT id , title, content, status, created_at FROM case_studies WHERE id = $1', [id]);

    if (!caseStudy) return res.status(404).json({ error: 'Case study not found' });

    res.json({ caseStudy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
export default router;
