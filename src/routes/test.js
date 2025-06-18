import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import jwksClient from 'jwks-rsa';

const router = express.Router();

// Test AWS Cognito connection
router.get('/cognito-status', async (req, res) => {
  try {
    const client = jwksClient({
      jwksUri: `https://cognito-idp.${process.env.NEXT_PUBLIC_AWS_REGION}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5
    });

    // Test JWKS connection
    const keys = await client.getSigningKeys();
    
    res.json({
      status: 'success',
      message: 'Successfully connected to AWS Cognito',
      config: {
        region: process.env.NEXT_PUBLIC_AWS_REGION,
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
        clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
        availableKeys: keys.length
      }
    });
  } catch (error) {
    console.error('AWS Cognito connection test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to connect to AWS Cognito',
      error: error.message
    });
  }
});

// Test token verification
router.post('/verify-token', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    message: 'Token is valid',
    user: req.user
  });
});

export const testRouter = router; 