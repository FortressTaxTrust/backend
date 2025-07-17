import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration - hardcoded to avoid environment variable issues
const AWS_REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_ad1psldfI';
const CLIENT_ID = 'cabkj0egcqag1v4f9siu3j6gh';

console.log('Auth Middleware Configuration:', {
  AWS_REGION,
  USER_POOL_ID,
  CLIENT_ID,
  jwksUri: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
});

// Initialize JWKS client with caching
const client = jwksClient({
  jwksUri: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
  cacheMaxAge: 24 * 60 * 60 * 1000 // 24 hours
});

// Cache for signing keys
const keyCache = new Map();

// Function to get signing key with caching
const getSigningKey = async (kid) => {
  // Check cache first
  if (keyCache.has(kid)) {
    console.log('Using cached signing key for kid:', kid);
    return keyCache.get(kid);
  }

  try {
    const key = await new Promise((resolve, reject) => {
      client.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(key);
      });
    });

    const signingKey = key.getPublicKey();
    // Cache the key
    keyCache.set(kid, signingKey);
    console.log('Cached new signing key for kid:', kid);
    return signingKey;
  } catch (error) {
    console.error('Error fetching signing key:', error);
    throw new Error('Failed to get signing key');
  }
};

// Token validation function
const validateToken = (token, signingKey) => {
  const options = {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`,
    // Remove audience validation as Cognito tokens may have different audiences
    ignoreExpiration: false
  };

  try {
    console.log('Validating token with options:', {
      issuer: options.issuer,
      algorithms: options.algorithms
    });
    
    const decoded = jwt.verify(token, signingKey, options);
    console.log('Token decoded successfully:', {
      sub: decoded.sub,
      email: decoded.email,
      given_name: decoded.given_name,
      family_name: decoded.family_name,
      scope: decoded.scope
    });
    return decoded;
  } catch (error) {
    console.error('Token validation error:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
};

export const authenticateToken = async (req, res, next) => {
  console.log('\n=== Starting Token Verification ===');
  
  // Get token from Authorization header
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No valid authorization header'
    });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No token provided'
    });
  }

  try {
    // Decode token without verification
    const decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken?.header?.kid) {
      throw new Error('Invalid token format');
    }

    // Get signing key
    const signingKey = await getSigningKey(decodedToken.header.kid);

    // Validate token
    const decoded = validateToken(token, signingKey);

    // Extract user information from the token
    req.user = {
      sub: decoded.sub,
      email: decoded.email,
      username: decoded['cognito:username'] || decoded.username,
      given_name: decoded.given_name,
      family_name: decoded.family_name,
      groups: decoded['cognito:groups'] || [],
      scope: decoded.scope,
      email_verified: decoded.email_verified,
      phone_number: decoded.phone_number,
      phone_number_verified: decoded.phone_number_verified
    };

    console.log('Token verified successfully for user:', {
      sub: req.user.sub,
      email: req.user.email,
      given_name: req.user.given_name,
      family_name: req.user.family_name
    });
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    
    const statusCode = error.message === 'Token has expired' ? 401 : 403;
    return res.status(statusCode).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
}; 