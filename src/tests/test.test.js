import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import * as authMiddleware from '../middleware/auth.js';

// Mock the authenticateToken middleware
const mockAuthenticateToken = jest.spyOn(authMiddleware, 'authenticateToken').mockImplementation((req, res, next) => {
  // Mock a user for authenticated requests
  req.user = {
    sub: 'mock-sub',
    username: 'mock-username',
    email: 'mock@example.com',
  };
  next();
});

describe('Test Routes', () => {
  describe('POST /test/verify-token', () => {
    it('should return 200 and user info for a valid token', async () => {
      const res = await request(app).post('/test/verify-token');
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toBe('Token is valid');
      expect(res.body.user).toEqual({
        sub: 'mock-sub',
        username: 'mock-username',
        email: 'mock@example.com',
      });
    });

    it('should return 401 for an invalid token', async () => {
      // Temporarily change the mock to simulate an error
      mockAuthenticateToken.mockImplementationOnce((req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app).post('/test/verify-token');
      expect(res.statusCode).toEqual(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });
});
