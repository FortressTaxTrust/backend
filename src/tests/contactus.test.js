// src/tests/contactus.test.js
import { jest, describe, it, expect, afterEach } from '@jest/globals';

// Define mocks outside factory
const mockMailer = {
  __esModule: true,
  sendMail: jest.fn().mockResolvedValue(true),
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
jest.unstable_mockModule('../utils/mailer.js', () => mockMailer);
jest.unstable_mockModule('../adapter/pgsql.js', () => mockDb);

// Dynamic imports
const { default: app } = await import('../app.js');
const mailer = await import('../utils/mailer.js');
const { default: db } = await import('../adapter/pgsql.js');
const { default: request } = await import('supertest');

describe('Contact Us Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================= POST /contactus =================
  describe('POST /contactus', () => {
    it('should return 200 and send emails for a valid submission', async () => {
      const contactData = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        description: 'This is a test message',
        number: '1234567890',
      };

      const res = await request(app).post('/contactus').send(contactData);

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toBe('success');
      expect(mailer.sendMail).toHaveBeenCalledTimes(2);
    });

    it('should return 400 for missing required fields', async () => {
      const contactData = { email: 'test@example.com' };

      const res = await request(app).post('/contactus').send(contactData);

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('Missing required field(s)');
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('should return 500 if sending mail fails', async () => {
      mailer.sendMail.mockRejectedValueOnce(new Error('Mail sending failed'));

      const contactData = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        description: 'This is a test message',
        number: '1234567890',
      };

      const res = await request(app).post('/contactus').send(contactData);

      expect(res.statusCode).toEqual(500);
      expect(res.body.status).toBe('error');
    });
  });

  // ================= GET /contactus/testing =================
  describe('GET /contactus/testing', () => {
    it('should return 200 and a list of users', async () => {
      const mockUsers = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      db.any.mockResolvedValue(mockUsers);

      const res = await request(app).get('/contactus/testing');

      expect(res.statusCode).toEqual(200);
      expect(res.body.users).toEqual(mockUsers);
    });

    it('should return 500 if database query fails', async () => {
      db.any.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/contactus/testing');

      expect(res.statusCode).toEqual(500);
      expect(res.body.error).toBe('DB error');
    });
  });
});
