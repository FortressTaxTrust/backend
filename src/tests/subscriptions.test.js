// src/tests/subscriptions.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

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

const mockSubscriptionsApi = {
  create: jest.fn(),
  cancel: jest.fn(),
};
const mockCustomersApi = {
  create: jest.fn(),
};
const mockCardsApi = {
  create: jest.fn(),
};

const MockSquareClient = jest.fn(() => ({
  subscriptions: mockSubscriptionsApi,
  customers: mockCustomersApi,
  cards: mockCardsApi,
}));

const mockSquare = {
  __esModule: true,
  SquareClient: MockSquareClient,
  SquareEnvironment: { Sandbox: 'sandbox' },
  WebhooksHelper: {
    verifySignature: jest.fn().mockResolvedValue(true),
  },
};

// Mock modules
jest.unstable_mockModule('../adapter/pgsql.js', () => mockDb);
jest.unstable_mockModule('square', () => mockSquare);

// Dynamic imports
const { default: app } = await import('../app.js');
const { default: db } = await import('../adapter/pgsql.js');
const { default: request } = await import('supertest');

describe('Subscription Routes', () => {

  beforeEach(() => {
    jest.clearAllMocks();
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
        customer: { id: 'sq-customer-id' },
      });
      mockSubscriptionsApi.create.mockResolvedValue({
        subscription: { id: 'sq-sub-id', status: 'active' },
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
        customer: { id: 'sq-customer-id' },
      });
      mockCardsApi.create.mockResolvedValue({
        card: { id: 'card-id' },
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
