// src/tests/protected.test.js
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import * as authMiddleware from '../middleware/auth.js';

// Mock the authenticateToken middleware
const mockAuthenticateToken = jest
  .spyOn(authMiddleware, 'authenticateToken')
  .mockImplementation((req, res, next) => {
    req.user = {
      sub: 'mock-sub',
      username: 'mock-username',
      email: 'mock@example.com',
    };
    next();
  });

describe('Protected Routes', () => {
  afterEach(() => {
    mockAuthenticateToken.mockClear(); // reset calls after each test
  });

  describe('GET /api/profile', () => {
    it('should return 200 and user info for a valid token', async () => {
      const res = await request(app).get('/api/profile');
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toBe('Protected route accessed successfully');
      expect(res.body.user).toEqual({
        sub: 'mock-sub',
        username: 'mock-username',
        email: 'mock@example.com',
      });
    });

    it('should return 401 for an invalid token', async () => {
      // Temporarily override the mock for this test
      mockAuthenticateToken.mockImplementationOnce((req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app).get('/api/profile');
      expect(res.statusCode).toEqual(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });
});
