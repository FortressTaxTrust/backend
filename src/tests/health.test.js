// src/tests/health.test.js
import { jest, describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';

describe('GET /health', () => {
  it('should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('OK');
  });
});
