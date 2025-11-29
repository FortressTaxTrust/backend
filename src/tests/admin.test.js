// src/tests/admin/casestudies.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Define mocks outside factory to ensure singleton
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

const mockPgHelper = {
  __esModule: true,
  default: {
    insert: jest.fn(),
    insertMany: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    raw: jest.fn(),
  }
};

const mockAuthMiddleware = {
  authenticateToken: jest.fn((req, res, next) => next()),
  adminAuth: jest.fn((req, res, next) => next()),
};

// Mock DB and helper functions
jest.unstable_mockModule('../adapter/pgsql.js', () => mockDb);
jest.unstable_mockModule('../utils/pgHelpers.js', () => mockPgHelper);
jest.unstable_mockModule('../middleware/auth.js', () => mockAuthMiddleware);

// Dynamic imports after mocks
const { default: app } = await import('../app.js');
const { default: db } = await import('../adapter/pgsql.js');
const { default: PgHelper } = await import('../utils/pgHelpers.js');
const { default: request } = await import('supertest');

describe('Admin Routes', () => {

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================= GET /admin/casestudies =================
  describe('GET /admin/casestudies', () => {
    it('should return a list of case studies', async () => {
      const mockCaseStudies = [{ id: 1, title: 'Case Study 1' }];
      db.any.mockResolvedValue(mockCaseStudies);
      db.one.mockImplementation(async (query, values, cb) => {
        const result = { count: 1 };
        return cb ? cb(result) : result;
      });

      const res = await request(app).get('/admin/casestudies');

      expect(res.statusCode).toBe(200);
      expect(res.body.caseStudies).toEqual(mockCaseStudies);
      expect(res.body.total).toBe(1);
    });

    it('should handle DB errors gracefully', async () => {
      db.any.mockRejectedValue(new Error('DB Error'));

      const res = await request(app).get('/admin/casestudies');

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  // ================= GET /admin/casestudies/:id =================
  describe('GET /admin/casestudies/:id', () => {
    it('should return a single case study', async () => {
      const mockCaseStudy = { id: 1, title: 'Case Study 1' };
      db.oneOrNone.mockResolvedValue(mockCaseStudy);

      const res = await request(app).get('/admin/casestudies/1');

      expect(res.statusCode).toBe(200);
      expect(res.body.caseStudy).toEqual(mockCaseStudy);
    });

    it('should return 404 if case study not found', async () => {
      db.oneOrNone.mockResolvedValue(null);

      const res = await request(app).get('/admin/casestudies/999');

      expect(res.statusCode).toBe(404);
    });
  });

  // ================= POST /admin/casestudies/create =================
  describe('POST /admin/casestudies/create', () => {
    it('should create a new case study', async () => {
      PgHelper.insert.mockResolvedValue(1);

      const res = await request(app)
        .post('/admin/casestudies/create')
        .send({ title: 'New Case Study', jsonData: {} });

      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(1);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/admin/casestudies/create')
        .send({});

      expect(res.statusCode).toBe(400);
    });
  });

  // ================= PUT /admin/casestudies/update/:id =================
  describe('PUT /admin/casestudies/update/:id', () => {
    it('should update an existing case study', async () => {
      db.oneOrNone.mockResolvedValue({ id: 1, title: 'Old Title' });
      PgHelper.update.mockResolvedValue(null);

      const res = await request(app)
        .put('/admin/casestudies/update/1')
        .send({ title: 'New Title' });

      expect(res.statusCode).toBe(200);
    });

    it('should return 404 if case study not found', async () => {
      db.oneOrNone.mockResolvedValue(null);

      const res = await request(app)
        .put('/admin/casestudies/update/999')
        .send({ title: 'New Title' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ================= DELETE /admin/casestudies/delete/:id =================
  describe('DELETE /admin/casestudies/delete/:id', () => {
    it('should delete a case study', async () => {
      db.oneOrNone.mockResolvedValue({ id: 1 });
      db.none.mockResolvedValue(null);

      const res = await request(app).delete('/admin/casestudies/delete/1');

      expect(res.statusCode).toBe(200);
    });

    it('should return 404 if case study not found', async () => {
      db.oneOrNone.mockResolvedValue(null);

      const res = await request(app).delete('/admin/casestudies/delete/999');

      expect(res.statusCode).toBe(404);
    });
  });
});
