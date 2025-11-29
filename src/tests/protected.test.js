// src/tests/protected.test.js
import { jest, describe, it, expect, afterEach } from '@jest/globals';

// Define mocks outside factory
const mockAuthMiddleware = {
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      sub: 'mock-sub',
      username: 'mock-username',
      email: 'mock@example.com',
    };
    next();
  }),
  adminAuth: jest.fn((req, res, next) => next()),
};

const mockDb = {
  __esModule: true,
  default: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    many: jest.fn(),
  },
  pgp: {
    helpers: {
      insert: jest.fn(),
      update: jest.fn(),
      ColumnSet: jest.fn(),
    },
    as: {
      format: jest.fn(),
      value: jest.fn(),
    }
  }
};

// Mock modules
jest.unstable_mockModule('../middleware/auth.js', () => mockAuthMiddleware);
jest.unstable_mockModule('../adapter/pgsql.js', () => mockDb);

// Dynamic imports
const { default: app } = await import('../app.js');
const { default: request } = await import('supertest');

describe('Protected Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Reset default implementation
    mockAuthMiddleware.authenticateToken.mockImplementation((req, res, next) => {
      req.user = {
        sub: 'mock-sub',
        username: 'mock-username',
        email: 'mock@example.com',
      };
      next();
    });
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
      mockAuthMiddleware.authenticateToken.mockImplementationOnce((req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app).get('/api/profile');
      expect(res.statusCode).toEqual(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });
});
