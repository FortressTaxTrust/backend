// src/tests/health.test.js
import { jest, describe, it, expect } from '@jest/globals';

// Define mocks outside factory
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

// Mock modules to prevent side effects during app import
jest.unstable_mockModule('../adapter/pgsql.js', () => mockDb);

// Dynamic imports
const { default: app } = await import('../app.js');
const { default: request } = await import('supertest');

describe('GET /health', () => {
  it('should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('OK');
  });
});
