// src/tests/subscriptions.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import db from '../adapter/pgsql.js';
import { SquareClient } from 'square';

// Mock the db and square client
jest.mock('../adapter/pgsql.js');
jest.mock('square');

describe('Subscription Routes', () => {
  let mockSubscriptionsApi;
  let mockCustomersApi;
  let mockCardsApi;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock APIs
    mockSubscriptionsApi = {
      create: jest.fn(),
      cancel: jest.fn(),
    };
    mockCustomersApi = {
      create: jest.fn(),
    };
    mockCardsApi = {
      create: jest.fn(),
    };

    // Mock the SquareClient constructor
    SquareClient.mockImplementation(() => ({
      subscriptions: mockSubscriptionsApi,
      customers: mockCustomersApi,
      cards: mockCardsApi,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================= POST /create-subscription =================
  describe('POST /subscriptions/square/create-subscription', () => {
    it('should create a subscription successfully', async () => {
      db.oneOrNone
        .mockResolvedValueOnce({ id: 1, email: 'test@test.com' }) // user
        .mockResolvedValueOnce({ id: 1, square_plan_id: 'plan-id' }); // subscription tier
      db.any.mockResolvedValueOnce([]); // ensureSquareCustomerForUser

      mockCustomersApi.create.mockResolvedValue({
        result: { customer: { id: 'sq-customer-id' } },
      });
      mockSubscriptionsApi.create.mockResolvedValue({
        result: { subscription: { id: 'sq-sub-id', status: 'active' } },
      });

      db.oneOrNone.mockResolvedValueOnce({ id: 'new-sub-id' }); // DB insert

      const res = await request(app)
        .post('/subscriptions/square/create-subscription')
        .send({
          user_id: 1,
          subscription_id: 1,
          card_id: 'card-id',
        });

      // Expecting 200 if route works, adjust based on your actual implementation
      expect(res.statusCode).toBe(200);
      expect(mockSubscriptionsApi.create).toHaveBeenCalled();
    });

    it('should return 400 if user_id or subscription_id are missing', async () => {
      const res = await request(app)
        .post('/subscriptions/square/create-subscription')
        .send({});
      expect(res.statusCode).toBe(400);
    });
  });

  // ================= POST /save-card =================
  describe('POST /subscriptions/square/save-card', () => {
    it('should save a card successfully', async () => {
      db.oneOrNone
        .mockResolvedValueOnce(null) // check if customer exists
        .mockResolvedValueOnce({ id: 1, email: 'test@test.com' }); // user
      mockCustomersApi.create.mockResolvedValue({
        result: { customer: { id: 'sq-customer-id' } },
      });
      mockCardsApi.create.mockResolvedValue({
        result: { card: { id: 'card-id' } },
      });
      db.none.mockResolvedValueOnce(null); // DB save

      const res = await request(app)
        .post('/subscriptions/square/save-card')
        .send({
          user_id: 1,
          source_id: 'source-id',
          card_information: {},
        });

      expect(res.statusCode).toBe(200);
      expect(mockCardsApi.create).toHaveBeenCalled();
    });
  });

  // ================= POST /cancel-subscription =================
  describe('POST /subscriptions/square/cancel-subscription', () => {
    it('should cancel a subscription immediately', async () => {
      mockSubscriptionsApi.cancel.mockResolvedValue({});
      db.none.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/subscriptions/square/cancel-subscription')
        .send({
          square_subscription_id: 'sq-sub-id',
          cancel_at_period_end: false,
        });

      expect(res.statusCode).toBe(200);
      expect(mockSubscriptionsApi.cancel).toHaveBeenCalledWith('sq-sub-id');
    });

    it('should mark a subscription to be canceled at period end', async () => {
      db.none.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/subscriptions/square/cancel-subscription')
        .send({
          square_subscription_id: 'sq-sub-id',
          cancel_at_period_end: true,
        });

      expect(res.statusCode).toBe(200);
      expect(db.none).toHaveBeenCalledWith(expect.any(String), ['sq-sub-id']);
    });
  });
});
