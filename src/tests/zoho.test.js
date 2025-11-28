
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import zohoRoutes from '../routes/zoho.js';
import { mockZohoResponses } from './mocks/zohoMocks.js';

mockZohoResponses();

jest.mock('../middleware/auth.js', () => ({
  authenticateToken: (req, res, next) => {
    req.user = global.mockUser;
    next();
  }
}));

const app = express();
app.use(bodyParser.json());
app.use('/zoho', zohoRoutes);

describe('Zoho API Routes', () => {

  test('GET /zoho/crm/my-contact - returns user contact info', async () => {
    const res = await request(app)
      .get('/zoho/crm/my-contact')
      .set('Authorization', `Bearer ${global.mockUserToken}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.userInfo.email).toBe(global.mockUser.email);
  });

  test('POST /zoho/create-account - creates account with full fields', async () => {
    const accountData = {
      accountName: 'Test Company LLC',
      accountType: 'Client',
      billingStreet: '123 Main St',
      billingCity: 'Karachi',
      billingState: 'Sindh',
      billingCode: '75500',
      billingCountry: 'Pakistan',
      website: 'https://testcompany.com',
      phone: '+922112345678',
      industry: 'Technology',
      description: 'Test account description'
    };

    const userData = {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: '+923001234567',
      title: 'Manager'
    };

    const res = await request(app)
      .post('/zoho/create-account')
      .send({ accountData, userData })
      .set('Authorization', `Bearer ${global.mockUserToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.accountId).toBeDefined();
    expect(res.body.contactId).toBeDefined();
  });

  test('POST /zoho/accounts-details - fetches multiple accounts', async () => {
    const res = await request(app)
      .post('/zoho/accounts-details')
      .send({ accountIds: ['acc123', 'acc456'] })
      .set('Authorization', `Bearer ${global.mockUserToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.accounts.length).toBeGreaterThan(0);
  });

  test('GET /zoho/test/linked-accounts-coql/:email - linked accounts via COQL', async () => {
    const res = await request(app)
      .get('/zoho/test/linked-accounts-coql/test@example.com')
      .set('Authorization', `Bearer ${global.mockUserToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].id).toBeDefined();
  });

  test('GET /zoho/workdrive/folder/:folderId/contents - fetch folder contents', async () => {
    const res = await request(app)
      .get('/zoho/workdrive/folder/folder123/contents')
      .set('Authorization', `Bearer ${global.mockUserToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.files[0].name).toBe('Invoice.pdf');
  });

});
