// middleware/auth.js
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import dotenv from 'dotenv';

dotenv.config();

/**
 * If you prefer envs, set:
 *   AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID
 * For now, keep your hardcoded fallbacks.
 */
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'us-east-1_ad1psldfI';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || 'cabkj0egcqag1v4f9siu3j6gh';

// Accept only access tokens by default (recommended for APIs).
// Flip to true if you need to allow ID tokens (e.g., for very specific endpoints).
const ALLOW_ID_TOKENS = false;

const ISSUER = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;

console.log('Auth Middleware Configuration:', {
  AWS_REGION,
  USER_POOL_ID,
  CLIENT_ID,
  issuer: ISSUER,
  jwksUri: JWKS_URI,
  allowIdTokens: ALLOW_ID_TOKENS
});

// ----- JWKS client with caching -----
const client = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
  rateLimit: true,
  jwksRequestsPerMinute: 5
});

const keyCache = new Map();

const getSigningKey = async (kid) => {
  if (!kid) throw new Error('Missing kid in token header');

  if (keyCache.has(kid)) {
    // console.log('Using cached signing key for kid:', kid);
    return keyCache.get(kid);
  }
  const key = await new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, k) => (err ? reject(err) : resolve(k)));
  });
  const signingKey = key.getPublicKey();
  keyCache.set(kid, signingKey);
  return signingKey;
};

const verifyAndDecode = (token, signingKey) => {
  // Add small clock tolerance for minor clock skew
  const options = {
    algorithms: ['RS256'],
    issuer: ISSUER,
    ignoreExpiration: false,
    clockTolerance: 60 // seconds
  };
  return jwt.verify(token, signingKey, options);
};

// Extra safety: make sure this came from your app client and is the right token type.
const assertCognitoClaims = (decoded) => {
  // Cognito sets "token_use" => "access" or "id"
  const tokenUse = decoded.token_use;
  if (tokenUse !== 'access' && tokenUse !== 'id') {
    throw new Error('Invalid token_use claim');
  }

  if (!ALLOW_ID_TOKENS && tokenUse !== 'access') {
    throw new Error('Only access tokens are allowed');
  }

  // For access tokens, "client_id" must match your app client
  if (tokenUse === 'access') {
    if (decoded.client_id !== CLIENT_ID) {
      throw new Error('Invalid client_id for access token');
    }
  }

  // For ID tokens (if allowed), "aud" must match your app client
  if (tokenUse === 'id') {
    if (decoded.aud !== CLIENT_ID) {
      throw new Error('Invalid audience for ID token');
    }
  }

  // Optional: enforce scopes for resource servers (if you use them)
  // Example: require "api/read" scope
  // if (tokenUse === 'access') {
  //   const scopes = (decoded.scope || '').split(' ');
  //   if (!scopes.includes('api/read')) {
  //     throw new Error('Insufficient scope');
  //   }
  // }
};

export const authenticateToken = async (req, res, next) => {
  try {
    // Supports "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing Bearer token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
    }

    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader?.header?.kid) {
      return res.status(403).json({ error: 'Authentication failed', message: 'Invalid token header' });
    }

    const signingKey = await getSigningKey(decodedHeader.header.kid);
    const decoded = verifyAndDecode(token, signingKey);

    // Enforce Cognito-specific claims
    assertCognitoClaims(decoded);

    // Attach useful fields
    req.user = {
      sub: decoded.sub,
      username: decoded['cognito:username'] || decoded.username,
      email: decoded.email,
      email_verified: decoded.email_verified,
      given_name: decoded.given_name,
      family_name: decoded.family_name,
      groups: decoded['cognito:groups'] || [],
      scope: decoded.scope,
      token_use: decoded.token_use
    };

    return next();
  } catch (error) {
    // Map common JWT errors to cleaner messages
    const name = error?.name || '';
    const message = error?.message || 'Token verification failed';

    if (name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Authentication failed', message: 'Token has expired' });
    }
    if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
      return res.status(403).json({ error: 'Authentication failed', message });
    }
    return res.status(403).json({ error: 'Authentication failed', message });
  }
};