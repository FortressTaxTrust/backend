// src/tests/contactus.test.js
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import * as mailer from '../utils/mailer.js';
import db from '../adapter/pgsql.js';

// Fully mock the mailer so no real SMTP connection happens
jest.mock('../utils/mailer.js', () => ({
  sendMail: jest.fn().mockResolvedValue(true),
}));

// Mock the DB
jest.mock('../adapter/pgsql.js');

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
