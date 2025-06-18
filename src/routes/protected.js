import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Protected route that requires authentication
router.get('/profile', authenticateToken, (req, res) => {
  console.log('\n=== Protected Route Access ===');
  console.log('Request headers:', req.headers);
  console.log('Authenticated user:', req.user);
  console.log('Request path:', req.path);
  console.log('Request method:', req.method);
  
  try {
    const response = {
      message: 'Protected route accessed successfully',
      user: req.user,
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