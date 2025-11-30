import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import db from '../adapter/pgsql.js';

const router = express.Router();

// Protected route that requires authentication
router.get('/profile', authenticateToken, async (req, res) => {
  console.log('\n=== Protected Route Access ===');
  console.log('Request headers:', req.headers);
  console.log('Authenticated user:', req.user);
  console.log('Request path:', req.path);
  console.log('Request method:', req.method);

  try {
    let userData = null;
    const cognitoId = req.user?.sub;

    if (cognitoId) {
      // Find the user's data and their latest active subscription
      userData = await db.oneOrNone(
        `SELECT 
           u.*, 
           us.id as user_subscription_id, us.status as subscription_status, us.start_date, us.end_date,
           s.name as plan_name, s.price as plan_price
         FROM users u
         LEFT JOIN user_subscription us ON us.user_id = u.id AND us.status = 'active'
         LEFT JOIN subscription s ON us.subscription_id = s.id
         WHERE u.cognito_id = $1
         ORDER BY us.created_at DESC
         LIMIT 1`,
        [cognitoId]
      );
    }

    const response = {
      message: 'Protected route accessed successfully',
      user: req.user,
      user_data: userData,
      timestamp: new Date().toISOString()
    };
    console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error in protected route:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

export const protectedRouter = router; 