import { Router } from "express";
import db from "../adapter/pgsql.js";
import { authenticateToken, adminAuth } from "../middleware/auth.js";
import PgHelper from "../utils/pgHelpers.js";
import {uploadBase64ToS3} from "../middleware/s3.js"
const router = Router();

/**
 * Get all case studies
 */
router.get('/casestudies', authenticateToken ,adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 5
    const offset = (page - 1) * limit

    const caseStudies = await db.any(
      'SELECT * FROM case_studies ORDER BY created_at DESC LIMIT $1 OFFSET $2',
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
router.get('/casestudies/:id', authenticateToken ,adminAuth,async (req, res) => {
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

/**
 * Create a new case study
 */

router.post('/casestudies/create',authenticateToken ,adminAuth, async (req, res) => {
  try {
    const { title, content, jsonData, status } = req.body;

    if (!title || !jsonData) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const caseStudyData = {
      title,
      content,
      metadata :jsonData,
      status: status || "completed",
      created_at: new Date()
    };

    const caseStudyId = await PgHelper.insert('case_studies', caseStudyData);

    res.status(201).json({ id: caseStudyId, message: 'Case study created successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/casestudies/upload/base64', authenticateToken ,adminAuth, async (req, res) => {
  try {
    const { image, filename } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Base64 image string is required.' });
    }

    const matches = image.match(/^data:(.+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      return res.status(400).json({ status : "error" , message: 'Invalid base64 image format.' });
    }
    const file = await uploadBase64ToS3(image, filename, 'case-studies')
   
   
    res.status(201).json({
      message: 'Image uploaded successfully from base64 string.',
      url: file
    });

  } catch (err) {
    console.error('Base64 upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update existing case study
 */
router.put('/casestudies/update/:id', authenticateToken, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, jsonData, status } = req.body;

    const existing = await db.oneOrNone('SELECT * FROM case_studies WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Case study not found' });

    const updateData = {
      title: title || existing.title,
      content: jsonData || existing.content,
      status: status || existing.status,
      updated_at: new Date()
    };

    await PgHelper.update('case_studies', updateData, { id });

    res.json({ message: 'Case study updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete a case study
 */
router.delete('/casestudies/delete/:id', authenticateToken, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.oneOrNone('SELECT * FROM case_studies WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Case study not found' });

    await db.none('DELETE FROM case_studies WHERE id = $1', [id]);

    res.json({ message: 'Case study deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
