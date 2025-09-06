import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.js';
import jwksClient from 'jwks-rsa';

dotenv.config();

const router = express.Router();

// Zoho configuration
const ZOHO_CONFIG = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  accessToken: process.env.ZOHO_ACCESS_TOKEN,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  baseUrlCRM: 'https://www.zohoapis.com/crm/v8',
  baseUrlWorkdrive: 'https://workdrive.zoho.com/api/v1',
  authUrl: 'https://accounts.zoho.com/oauth/v2/token'
};

// Function to zoho refresh access token
const refreshAccessToken = async () => {
  try {
    console.log('=== REFRESH TOKEN DEBUG ===');
    console.log('Refresh URL:', ZOHO_CONFIG.authUrl);
    console.log('Client ID:', ZOHO_CONFIG.clientId ? 'Present' : 'Missing');
    console.log('Client Secret:', ZOHO_CONFIG.clientSecret ? 'Present' : 'Missing');
    console.log('Refresh Token:', ZOHO_CONFIG.refreshToken ? 'Present' : 'Missing');
    console.log('Current Access Token (last 10 chars):', ZOHO_CONFIG.accessToken?.slice(-10));
    
    const response = await axios.post(ZOHO_CONFIG.authUrl, null, {
      params: {
        refresh_token: ZOHO_CONFIG.refreshToken,
        client_id: ZOHO_CONFIG.clientId,
        client_secret: ZOHO_CONFIG.clientSecret,
        grant_type: 'refresh_token'
      }
    });

    console.log('Refresh response status:', response.status);
    console.log('New access token (last 10 chars):', response.data.access_token?.slice(-10));
    console.log('Response data keys:', Object.keys(response.data));
    console.log('Full response data:', JSON.stringify(response.data, null, 2));
    console.log('=== END REFRESH TOKEN DEBUG ===');
    
    // Update the in-memory token
    ZOHO_CONFIG.accessToken = response.data.access_token;
    
    return response.data.access_token;
  } catch (error) {
    console.error('=== REFRESH TOKEN ERROR ===');
    console.error('Error refreshing token:', error.response?.data || error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error headers:', error.response?.headers);
    console.error('=== END REFRESH TOKEN ERROR ===');
    throw new Error('Failed to refresh access token');
  }
};

// Function to make Zoho API calls with token refresh
const makeZohoAPICall = async (url, method = 'GET', data = null) => {
  try {
    // Check if access token is expired (simple check - in production you'd want to check the actual expiry)
    if (!ZOHO_CONFIG.accessToken) {
      console.log('Access token expired, refreshing...');
      await refreshAccessToken();
    }

    const config = {
      method,
      url,
      headers: {
        'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (data && method !== 'GET') {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.log("error" , error)
    if (error.response?.status === 500) {
      console.log('Access token expired, refreshing...');
      await refreshAccessToken();
      
      // Retry the request with new token
      const config = {
        method,
        url,
        headers: {
          'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
          'Content-Type': 'application/json'
        }
      };

      if (data && method !== 'GET') {
        config.data = data;
      }

      const retryResponse = await axios(config);
      return retryResponse.data;
    }
    throw error;
  }
};

// Test Zoho connection
router.get('/test-zoho-connection', async (req, res) => {
  try {
    console.log('Testing Zoho API connection...');
    
    // Test CRM connection by getting user info
    const crmResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/users?type=CurrentUser`);
    
    // Test Workdrive connection by getting team info
    const workdriveResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/users/me`);

    res.json({
      status: 'success',
      message: 'Successfully connected to Zoho APIs',
      connections: {
        crm: {
          status: 'connected',
          user: crmResponse.users?.[0]?.full_name || 'Unknown',
          email: crmResponse.users?.[0]?.email || 'Unknown'
        },
        workdrive: {
          status: 'connected',
          user: workdriveResponse.data?.display_name || 'Unknown',
          email: workdriveResponse.data?.email_id || 'Unknown'
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Zoho connection test failed:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to connect to Zoho APIs',
      error: error.response?.data || error.message,
      details: {
        hasClientId: !!ZOHO_CONFIG.clientId,
        hasClientSecret: !!ZOHO_CONFIG.clientSecret,
        hasAccessToken: !!ZOHO_CONFIG.accessToken,
        hasRefreshToken: !!ZOHO_CONFIG.refreshToken
      }
    });
  }
});

// Get zoho CRM modules
router.get('/crm/modules', async (req, res) => {
  try {
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/settings/modules`);
    
    res.json({
      status: 'success',
      data: response.modules,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching CRM modules:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch CRM modules',
      error: error.response?.data || error.message
    });
  }
});

// Get zoho Workdrive team folders
router.get('/workdrive/folders', async (req, res) => {
  try {
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/files`);
    
    res.json({
      status: 'success',
      data: response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching Workdrive folders:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch Workdrive folders',
      error: error.response?.data || error.message
    });
  }
});

// Test AWS Cognito connection
router.get('/cognito-status', async (req, res) => {
  try {
    const client = jwksClient({
      jwksUri: `https://cognito-idp.${process.env.NEXT_PUBLIC_AWS_REGION}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5
    });

    // Test JWKS connection
    const keys = await client.getSigningKeys();
    
    res.json({
      status: 'success',
      message: 'Successfully connected to AWS Cognito',
      config: {
        region: process.env.NEXT_PUBLIC_AWS_REGION,
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
        clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
        availableKeys: keys.length
      }
    });
  } catch (error) {
    console.error('AWS Cognito connection test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to connect to AWS Cognito',
      error: error.message
    });
  }
});

// Test token verification
router.post('/verify-token', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    message: 'Token is valid',
    user: req.user
  });
});

// Get all contacts to check for Cognito IDs
router.get('/contacts-with-cognito', async (req, res) => {
  try {
    console.log('=== GETTING ALL CONTACTS TO CHECK FOR COGNITO IDS ===');
    
    // Get all contacts (limit 100) and check which ones have Cognito IDs
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts?fields=id,Full_Name,First_Name,Last_Name,Email,Phone,Single_Line_1,Created_Time&per_page=100`;
    
    console.log('Search URL:', searchUrl);
    
    const response = await makeZohoAPICall(searchUrl);
    
    console.log('Search Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No contacts found',
        totalRecords: 0,
        contacts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Filter contacts that have Cognito IDs
    const contactsWithCognito = response.data.filter(contact => contact.Single_Line_1 && contact.Single_Line_1.trim() !== '');
    
    // Process the results
    const contacts = contactsWithCognito.map(contact => ({
      contactId: contact.id,
      fullName: contact.Full_Name,
      firstName: contact.First_Name,
      lastName: contact.Last_Name,
      email: contact.Email,
      phone: contact.Phone,
      cognitoId: contact.Single_Line_1,
      createdTime: contact.Created_Time
    }));
    
    res.json({
      status: 'success',
      message: 'Contacts with Cognito IDs found',
      totalRecords: contactsWithCognito.length,
      totalContactsChecked: response.data.length,
      contacts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Contacts with Cognito IDs search error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to find contacts with Cognito IDs', 
      error: error.response?.data || error.message,
      errorDetails: error
    });
  }
});

// Find contact by Cognito ID
router.get('/contact-by-cognito/:cognitoId', async (req, res) => {
  try {
    const { cognitoId } = req.params;
    
    console.log(`=== FINDING CONTACT BY COGNITO ID: ${cognitoId} ===`);
    
    if (!cognitoId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cognito ID parameter is required'
      });
    }
    
    // Search for contact with the specific Cognito ID
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Single_Line_1:equals:${encodeURIComponent(cognitoId)})`;
    
    console.log('Search URL:', searchUrl);
    
    const response = await makeZohoAPICall(searchUrl);
    
    console.log('Search Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No contact found for this Cognito ID',
        searchCognitoId: cognitoId,
        totalRecords: 0,
        contacts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Process the results
    const contacts = response.data.map(contact => ({
      contactId: contact.id,
      fullName: contact.Full_Name,
      firstName: contact.First_Name,
      lastName: contact.Last_Name,
      email: contact.Email,
      phone: contact.Phone,
      cognitoId: contact.Single_Line_1,
      connectedAccounts: contact.Connected_Accounts,
      createdTime: contact.Created_Time,
      modifiedTime: contact.Modified_Time
    }));
    
    res.json({
      status: 'success',
      message: 'Contact found successfully by Cognito ID',
      searchCognitoId: cognitoId,
      totalRecords: response.data.length,
      contacts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Contact by Cognito ID search error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to find contact by Cognito ID', 
      searchCognitoId: req.params.cognitoId, 
      error: error.response?.data || error.message,
      errorDetails: error
    });
  }
});

// Find linked accounts by Cognito ID
router.get('/linked-accounts-by-cognito/:cognitoId', async (req, res) => {
  try {
    const { cognitoId } = req.params;
    
    console.log(`=== FINDING LINKED ACCOUNTS BY COGNITO ID: ${cognitoId} ===`);
    
    if (!cognitoId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cognito ID parameter is required'
      });
    }
    
    // COQL query to find accounts linked to the contact with specific Cognito ID
    const coqlQuery = {
      select_query: `select id, Connected_Accounts.Account_Name, Connected_Accounts.Account_Number, Connected_Accounts.Account_Type, Connected_Accounts.Industry, Shareholder_List.Full_Name, Shareholder_List.Email, Shareholder_List.Phone, Shareholder_List.Single_Line_1 from Accounts_X_Contacts where Shareholder_List.Single_Line_1 = '${cognitoId}'`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('COQL Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No linked accounts found for this Cognito ID',
        searchCognitoId: cognitoId,
        coqlQuery: coqlQuery.select_query,
        totalRecords: 0,
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Process the results
    const linkedAccounts = response.data.map(record => ({
      relationshipId: record.id,
      accountName: record['Connected_Accounts.Account_Name'],
      accountNumber: record['Connected_Accounts.Account_Number'],
      accountType: record['Connected_Accounts.Account_Type'],
      industry: record['Connected_Accounts.Industry'],
      contactName: record['Shareholder_List.Full_Name'],
      contactEmail: record['Shareholder_List.Email'],
      contactPhone: record['Shareholder_List.Phone'],
      cognitoId: record['Shareholder_List.Single_Line_1']
    }));
    
    res.json({
      status: 'success',
      message: 'Linked accounts found successfully by Cognito ID',
      searchCognitoId: cognitoId,
      coqlQuery: coqlQuery.select_query,
      totalRecords: response.data.length,
      linkedAccounts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Linked accounts by Cognito ID COQL error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to get linked accounts by Cognito ID via COQL', 
      searchCognitoId: req.params.cognitoId, 
      error: error.response?.data || error.message,
      errorDetails: error
    });
  }
});

// Test route to find linked accounts using COQL with Shareholder_List filter
router.get('/test/linked-accounts-coql-shareholder/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log(`=== FINDING LINKED ACCOUNTS VIA COQL (Shareholder_List) FOR: ${email} ===`);
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }
    // COQL query filtering on Shareholder_List
    const coqlQuery = {
      select_query: `select id, Connected_Accounts.Account_Name, Shareholder_List.Full_Name from Accounts_X_Contacts where Shareholder_List is not null limit 10`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    res.json({ status: 'success', searchEmail: email, coqlQuery: coqlQuery.select_query, response });
  } catch (error) {
    console.error('Linked accounts COQL (Shareholder_List) error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to get linked accounts via COQL (Shareholder_List)', searchEmail: req.params.email, error });
  }
});

// Test route to find linked accounts for a specific email using COQL
router.get('/test/linked-accounts-by-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log(`=== FINDING LINKED ACCOUNTS FOR SPECIFIC EMAIL: ${email} ===`);
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }
    
    // COQL query to find accounts linked to the specific contact email
    const coqlQuery = {
      select_query: `select id, Connected_Accounts.Account_Name, Connected_Accounts.Account_Number, Connected_Accounts.Account_Type, Connected_Accounts.Industry, Shareholder_List.Full_Name, Shareholder_List.Email, Shareholder_List.Phone from Accounts_X_Contacts where Shareholder_List.Email = '${email}'`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('COQL Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No linked accounts found for this email',
        searchEmail: email,
        coqlQuery: coqlQuery.select_query,
        totalRecords: 0,
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Process the results
    const linkedAccounts = response.data.map(record => ({
      relationshipId: record.id,
      accountName: record['Connected_Accounts.Account_Name'],
      accountNumber: record['Connected_Accounts.Account_Number'],
      accountType: record['Connected_Accounts.Account_Type'],
      industry: record['Connected_Accounts.Industry'],
      contactName: record['Shareholder_List.Full_Name'],
      contactEmail: record['Shareholder_List.Email'],
      contactPhone: record['Shareholder_List.Phone']
    }));
    
    res.json({
      status: 'success',
      message: 'Linked accounts found successfully',
      searchEmail: email,
      coqlQuery: coqlQuery.select_query,
      totalRecords: response.data.length,
      linkedAccounts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Linked accounts by email COQL error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to get linked accounts by email via COQL', 
      searchEmail: req.params.email, 
      error: error.response?.data || error.message,
      errorDetails: error
    });
  }
});

// Test Accounts module COQL query without authentication(add pagination)
router.get('/test/accounts', async (req, res) => {
  try {
    console.log('=== TESTING ACCOUNTS COQL QUERY ===');
    
    // Simple query to get account details
    const coqlQuery = {
      select_query: `select Account_Name, Account_Type, Phone, TIN, Client_ID, Tag from Accounts where Account_Name is not null limit 10`
    };
    
    console.log('COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
    const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
    
    console.log('COQL Response received. Data length:', response.data?.length || 0);
    
    res.json({
      status: 'success',
      message: 'Accounts query successful',
      coqlQuery: coqlQuery,
      totalAccounts: response.data?.length || 0,
      accounts: response.data || [],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Accounts query error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Accounts query failed',
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Test route to get all fields for specific contact (hardcoded email)
router.get('/test/contact-omer', async (req, res) => {
  try {
    const testEmail = 'omer@it4u.dev';
    
    console.log(`=== TESTING CONTACT DATA FOR: ${testEmail} ===`);
    
    // Use Zoho's search API to find contact by email
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:equals:${encodeURIComponent(testEmail)})`;
    
    console.log('Search URL:', searchUrl);
    
    const response = await makeZohoAPICall(searchUrl);
    
    console.log('Search Response received. Data length:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'Contact not found',
        searchEmail: testEmail,
        data: [],
        info: response.info || {},
        timestamp: new Date().toISOString()
      });
    }
    
    const contactData = response.data[0];
    
    res.json({
      status: 'success',
      message: 'Contact data retrieved successfully',
      searchEmail: testEmail,
      contactData: contactData,
      allFields: Object.keys(contactData),
      fieldCount: Object.keys(contactData).length,
      info: response.info || {},
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Test contact data error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Test contact data failed',
      searchEmail: 'omer@it4u.dev',
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Comprehensive Fields Metadata API test route
router.get('/test/fields-metadata-comprehensive/:module', async (req, res) => {
  try {
    const { module } = req.params;
    const { type, include } = req.query;
    
    console.log(`=== COMPREHENSIVE FIELD METADATA FOR MODULE: ${module} ===`);
    console.log('Query parameters:', { type, include });
    
    if (!module) {
      return res.status(400).json({
        status: 'error',
        message: 'Module parameter is required'
      });
    }
    
    // Build URL with optional parameters
    let metadataUrl = `${ZOHO_CONFIG.baseUrlCRM}/settings/fields?module=${encodeURIComponent(module)}`;
    
    if (type) {
      metadataUrl += `&type=${encodeURIComponent(type)}`;
    }
    
    if (include) {
      metadataUrl += `&include=${encodeURIComponent(include)}`;
    }
    
    console.log('Metadata URL:', metadataUrl);
    
    const response = await makeZohoAPICall(metadataUrl);
    
    console.log('Metadata Response received. Fields count:', response.fields?.length || 0);
    
    if (!response.fields || response.fields.length === 0) {
      return res.json({
        status: 'success',
        message: 'No fields found for this module',
        module: module,
        queryParams: { type, include },
        fields: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Comprehensive field analysis
    const fieldAnalysis = {
      totalFields: response.fields.length,
      byDataType: {},
      byCustomField: { custom: 0, default: 0 },
      byVisibility: { visible: 0, hidden: 0 },
      byReadOnly: { readOnly: 0, editable: 0 },
      byMandatory: { mandatory: 0, optional: 0 },
      bySystemMandatory: { systemMandatory: 0, notSystemMandatory: 0 },
      bySearchable: { searchable: 0, notSearchable: 0 },
      bySortable: { sortable: 0, notSortable: 0 },
      byMassUpdate: { massUpdate: 0, notMassUpdate: 0 },
      byWebhook: { webhook: 0, notWebhook: 0 },
      byVirtualField: { virtual: 0, notVirtual: 0 },
      byBusinessCard: { businessCard: 0, notBusinessCard: 0 },
      byColourCode: { colourCode: 0, notColourCode: 0 }
    };
    
    // Analyze each field
    response.fields.forEach(field => {
      // Data type analysis
      const dataType = field.data_type || 'unknown';
      fieldAnalysis.byDataType[dataType] = (fieldAnalysis.byDataType[dataType] || 0) + 1;
      
      // Custom field analysis
      if (field.custom_field) {
        fieldAnalysis.byCustomField.custom++;
      } else {
        fieldAnalysis.byCustomField.default++;
      }
      
      // Visibility analysis
      if (field.visible) {
        fieldAnalysis.byVisibility.visible++;
      } else {
        fieldAnalysis.byVisibility.hidden++;
      }
      
      // Read-only analysis
      if (field.read_only) {
        fieldAnalysis.byReadOnly.readOnly++;
      } else {
        fieldAnalysis.byReadOnly.editable++;
      }
      
      // Mandatory analysis
      if (field.mandatory) {
        fieldAnalysis.byMandatory.mandatory++;
      } else {
        fieldAnalysis.byMandatory.optional++;
      }
      
      // System mandatory analysis
      if (field.system_mandatory) {
        fieldAnalysis.bySystemMandatory.systemMandatory++;
      } else {
        fieldAnalysis.bySystemMandatory.notSystemMandatory++;
      }
      
      // Searchable analysis
      if (field.searchable) {
        fieldAnalysis.bySearchable.searchable++;
      } else {
        fieldAnalysis.bySearchable.notSearchable++;
      }
      
      // Sortable analysis
      if (field.sortable) {
        fieldAnalysis.bySortable.sortable++;
      } else {
        fieldAnalysis.bySortable.notSortable++;
      }
      
      // Mass update analysis
      if (field.mass_update) {
        fieldAnalysis.byMassUpdate.massUpdate++;
      } else {
        fieldAnalysis.byMassUpdate.notMassUpdate++;
      }
      
      // Webhook analysis
      if (field.webhook) {
        fieldAnalysis.byWebhook.webhook++;
      } else {
        fieldAnalysis.byWebhook.notWebhook++;
      }
      
      // Virtual field analysis
      if (field.virtual_field) {
        fieldAnalysis.byVirtualField.virtual++;
      } else {
        fieldAnalysis.byVirtualField.notVirtual++;
      }
      
      // Business card analysis
      if (field.businesscard_supported) {
        fieldAnalysis.byBusinessCard.businessCard++;
      } else {
        fieldAnalysis.byBusinessCard.notBusinessCard++;
      }
      
      // Colour code analysis
      if (field.enable_colour_code) {
        fieldAnalysis.byColourCode.colourCode++;
      } else {
        fieldAnalysis.byColourCode.notColourCode++;
      }
    });
    
    // Filter for specific field types we're interested in
    const multiSelectLookupFields = response.fields.filter(field => 
      field.data_type === 'multiselectlookup'
    );
    
    const lookupFields = response.fields.filter(field => 
      field.data_type === 'lookup'
    );
    
    const accountRelatedFields = response.fields.filter(field => 
      field.display_label?.toLowerCase().includes('account') ||
      field.api_name?.toLowerCase().includes('account') ||
      field.display_label?.toLowerCase().includes('connected') ||
      field.api_name?.toLowerCase().includes('connected')
    );
    
    const formulaFields = response.fields.filter(field => 
      field.data_type === 'formula'
    );
    
    const picklistFields = response.fields.filter(field => 
      field.data_type === 'picklist' || field.data_type === 'multiselectpicklist'
    );
    
    const autoNumberFields = response.fields.filter(field => 
      field.data_type === 'autonumber'
    );
    
    const rollupSummaryFields = response.fields.filter(field => 
      field.data_type === 'rollup_summary'
    );
    
    res.json({
      status: 'success',
      message: 'Comprehensive field metadata retrieved successfully',
      module: module,
      queryParams: { type, include },
      fieldAnalysis: fieldAnalysis,
      specificFieldTypes: {
        multiSelectLookupFields: {
          count: multiSelectLookupFields.length,
          fields: multiSelectLookupFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            multiselectlookup: field.multiselectlookup,
            mandatory: field.mandatory,
            read_only: field.read_only,
            visible: field.visible
          }))
        },
        lookupFields: {
          count: lookupFields.length,
          fields: lookupFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            lookup: field.lookup,
            mandatory: field.mandatory,
            read_only: field.read_only,
            visible: field.visible
          }))
        },
        accountRelatedFields: {
          count: accountRelatedFields.length,
          fields: accountRelatedFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            data_type: field.data_type,
            mandatory: field.mandatory,
            read_only: field.read_only,
            visible: field.visible
          }))
        },
        formulaFields: {
          count: formulaFields.length,
          fields: formulaFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            formula: field.formula,
            read_only: field.read_only
          }))
        },
        picklistFields: {
          count: picklistFields.length,
          fields: picklistFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            data_type: field.data_type,
            pick_list_values: field.pick_list_values,
            pick_list_values_sorted_lexically: field.pick_list_values_sorted_lexically
          }))
        },
        autoNumberFields: {
          count: autoNumberFields.length,
          fields: autoNumberFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            auto_number: field.auto_number,
            read_only: field.read_only
          }))
        },
        rollupSummaryFields: {
          count: rollupSummaryFields.length,
          fields: rollupSummaryFields.map(field => ({
            api_name: field.api_name,
            display_label: field.display_label,
            rollup_summary: field.rollup_summary,
            read_only: field.read_only
          }))
        }
      },
      allFields: response.fields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        field_label: field.field_label,
        data_type: field.data_type,
        json_type: field.json_type,
        mandatory: field.mandatory,
        unique: field.unique,
        system_mandatory: field.system_mandatory,
        read_only: field.read_only,
        field_read_only: field.field_read_only,
        visible: field.visible,
        custom_field: field.custom_field,
        length: field.length,
        decimal_place: field.decimal_place,
        searchable: field.searchable,
        sortable: field.sortable,
        mass_update: field.mass_update,
        webhook: field.webhook,
        virtual_field: field.virtual_field,
        businesscard_supported: field.businesscard_supported,
        enable_colour_code: field.enable_colour_code,
        quick_sequence_number: field.quick_sequence_number,
        display_type: field.display_type,
        created_source: field.created_source,
        tooltip: field.tooltip,
        crypt: field.crypt,
        textarea: field.textarea,
        pick_list_values: field.pick_list_values,
        pick_list_values_sorted_lexically: field.pick_list_values_sorted_lexically,
        multiselectlookup: field.multiselectlookup,
        multiuserlookup: field.multiuserlookup,
        lookup: field.lookup,
        subform: field.subform,
        formula: field.formula,
        auto_number: field.auto_number,
        rollup_summary: field.rollup_summary,
        history_tracking: field.history_tracking,
        wizard: field.wizard,
        profiles: field.profiles,
        sharing_properties: field.sharing_properties,
        operation_type: field.operation_type,
        associated_module: field.associated_module,
        private: field.private
      })),
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Comprehensive field metadata error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get comprehensive field metadata',
      module: req.params.module,
      queryParams: req.query,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Get field metadata for any module
router.get('/test/fields-metadata/:module', async (req, res) => {
  try {
    const { module } = req.params;
    
    console.log(`=== GETTING FIELD METADATA FOR MODULE: ${module} ===`);
    
    if (!module) {
      return res.status(400).json({
        status: 'error',
        message: 'Module parameter is required'
      });
    }
    
    // Get field metadata using Zoho CRM v8 API
    const metadataUrl = `${ZOHO_CONFIG.baseUrlCRM}/settings/fields?module=${encodeURIComponent(module)}`;
    
    console.log('Metadata URL:', metadataUrl);
    
    const response = await makeZohoAPICall(metadataUrl);
    
    console.log('Metadata Response received. Fields count:', response.fields?.length || 0);
    
    if (!response.fields || response.fields.length === 0) {
      return res.json({
        status: 'success',
        message: 'No fields found for this module',
        module: module,
        fields: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Filter for specific field types we're interested in
    const multiSelectLookupFields = response.fields.filter(field => 
      field.data_type === 'multiselectlookup'
    );
    
    const lookupFields = response.fields.filter(field => 
      field.data_type === 'lookup'
    );
    
    const accountRelatedFields = response.fields.filter(field => 
      field.display_label?.toLowerCase().includes('account') ||
      field.api_name?.toLowerCase().includes('account') ||
      field.display_label?.toLowerCase().includes('connected') ||
      field.api_name?.toLowerCase().includes('connected')
    );
    
    res.json({
      status: 'success',
      message: 'Field metadata retrieved successfully',
      module: module,
      totalFields: response.fields.length,
      multiSelectLookupFields: multiSelectLookupFields,
      lookupFields: lookupFields,
      accountRelatedFields: accountRelatedFields,
      allFields: response.fields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        data_type: field.data_type,
        mandatory: field.mandatory,
        unique: field.unique,
        system_mandatory: field.system_mandatory,
        read_only: field.read_only,
        length: field.length,
        decimal_place: field.decimal_place,
        pick_list_values: field.pick_list_values,
        multiselectlookup: field.multiselectlookup,
        lookup: field.lookup
      })),
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Field metadata error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get field metadata',
      module: req.params.module,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Test route to get linking module fields metadata
router.get('/test/linking-module-fields/:linkingModule', async (req, res) => {
  try {
    const { linkingModule } = req.params;
    const { type, include } = req.query;
    
    console.log(`=== GETTING LINKING MODULE FIELDS: ${linkingModule} ===`);
    console.log('Query parameters:', { type, include });
    
    if (!linkingModule) {
      return res.status(400).json({
        status: 'error',
        message: 'Linking module parameter is required'
      });
    }
    
    // Build URL with optional parameters
    let metadataUrl = `${ZOHO_CONFIG.baseUrlCRM}/settings/fields?module=${encodeURIComponent(linkingModule)}`;
    
    if (type) {
      metadataUrl += `&type=${encodeURIComponent(type)}`;
    }
    
    if (include) {
      metadataUrl += `&include=${encodeURIComponent(include)}`;
    }
    
    console.log('Metadata URL:', metadataUrl);
    
    const response = await makeZohoAPICall(metadataUrl);
    
    console.log('Linking module fields response received. Fields count:', response.fields?.length || 0);
    
    if (!response.fields || response.fields.length === 0) {
      return res.json({
        status: 'success',
        message: 'No fields found for this linking module',
        linkingModule: linkingModule,
        queryParams: { type, include },
        fields: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Find lookup fields (these represent the connected modules)
    const lookupFields = response.fields.filter(field => 
      field.data_type === 'lookup'
    );
    
    // Find other important field types
    const systemFields = response.fields.filter(field => 
      field.data_type === 'system' || field.api_name === 'id' || field.api_name === 'Created_Time' || field.api_name === 'Modified_Time'
    );
    
    const customFields = response.fields.filter(field => 
      field.custom_field === true
    );
    
    const mandatoryFields = response.fields.filter(field => 
      field.mandatory === true || field.system_mandatory === true
    );
    
    res.json({
      status: 'success',
      message: 'Linking module fields metadata retrieved successfully',
      linkingModule: linkingModule,
      queryParams: { type, include },
      fieldAnalysis: {
        totalFields: response.fields.length,
        lookupFields: lookupFields.length,
        systemFields: systemFields.length,
        customFields: customFields.length,
        mandatoryFields: mandatoryFields.length
      },
      lookupFields: {
        count: lookupFields.length,
        description: 'These fields represent the connected modules in the linking table',
        fields: lookupFields.map(field => ({
          api_name: field.api_name,
          display_label: field.display_label,
          lookup: field.lookup,
          mandatory: field.mandatory,
          read_only: field.read_only,
          visible: field.visible,
          system_mandatory: field.system_mandatory,
          id: field.id
        }))
      },
      systemFields: {
        count: systemFields.length,
        description: 'System fields like ID, Created_Time, Modified_Time',
        fields: systemFields.map(field => ({
          api_name: field.api_name,
          display_label: field.display_label,
          data_type: field.data_type,
          read_only: field.read_only
        }))
      },
      customFields: {
        count: customFields.length,
        description: 'Custom fields added to the linking module',
        fields: customFields.map(field => ({
          api_name: field.api_name,
          display_label: field.display_label,
          data_type: field.data_type,
          mandatory: field.mandatory,
          read_only: field.read_only
        }))
      },
      mandatoryFields: {
        count: mandatoryFields.length,
        description: 'Fields that are required (mandatory or system mandatory)',
        fields: mandatoryFields.map(field => ({
          api_name: field.api_name,
          display_label: field.display_label,
          data_type: field.data_type,
          mandatory: field.mandatory,
          system_mandatory: field.system_mandatory
        }))
      },
      allFields: response.fields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        field_label: field.field_label,
        data_type: field.data_type,
        json_type: field.json_type,
        mandatory: field.mandatory,
        system_mandatory: field.system_mandatory,
        read_only: field.read_only,
        visible: field.visible,
        custom_field: field.custom_field,
        length: field.length,
        searchable: field.searchable,
        sortable: field.sortable,
        mass_update: field.mass_update,
        lookup: field.lookup,
        id: field.id
      })),
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Linking module fields error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get linking module fields metadata',
      linkingModule: req.params.linkingModule,
      queryParams: req.query,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Test route to get Contacts module field metadata
router.get('/test/contacts-fields', async (req, res) => {
  try {
    console.log('=== GETTING CONTACTS MODULE FIELD METADATA ===');
    
    const metadataUrl = `${ZOHO_CONFIG.baseUrlCRM}/settings/fields?module=Contacts`;
    
    console.log('Metadata URL:', metadataUrl);
    
    const response = await makeZohoAPICall(metadataUrl);
    
    console.log('Contacts metadata response received. Fields count:', response.fields?.length || 0);
    
    if (!response.fields || response.fields.length === 0) {
      return res.json({
        status: 'success',
        message: 'No fields found for Contacts module',
        fields: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Find email-related fields
    const emailFields = response.fields.filter(field => 
      field.api_name?.toLowerCase().includes('email') ||
      field.display_label?.toLowerCase().includes('email')
    );
    
    // Find name-related fields
    const nameFields = response.fields.filter(field => 
      field.api_name?.toLowerCase().includes('name') ||
      field.display_label?.toLowerCase().includes('name')
    );
    
    res.json({
      status: 'success',
      message: 'Contacts field metadata retrieved successfully',
      totalFields: response.fields.length,
      emailFields: emailFields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        data_type: field.data_type
      })),
      nameFields: nameFields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        data_type: field.data_type
      })),
      allFields: response.fields.map(field => ({
        api_name: field.api_name,
        display_label: field.display_label,
        data_type: field.data_type
      })),
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Contacts fields error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get Contacts field metadata',
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Get specific field metadata by field ID
router.get('/test/field-metadata/:module/:fieldId', async (req, res) => {
  try {
    const { module, fieldId } = req.params;
    
    console.log(`=== GETTING SPECIFIC FIELD METADATA ===`);
    console.log('Module:', module);
    console.log('Field ID:', fieldId);
    
    if (!module || !fieldId) {
      return res.status(400).json({
        status: 'error',
        message: 'Both module and fieldId parameters are required'
      });
    }
    
    // Get specific field metadata using Zoho CRM API
    const metadataUrl = `${ZOHO_CONFIG.baseUrlCRM}/settings/fields/${encodeURIComponent(fieldId)}?module=${encodeURIComponent(module)}`;
    
    console.log('Metadata URL:', metadataUrl);
    
    const response = await makeZohoAPICall(metadataUrl);
    
    console.log('Field metadata response received');
    
    res.json({
      status: 'success',
      message: 'Specific field metadata retrieved successfully',
      module: module,
      fieldId: fieldId,
      fieldMetadata: response.fields?.[0] || response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Specific field metadata error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get specific field metadata',
      module: req.params.module,
      fieldId: req.params.fieldId,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});
// Route to check current token scopes and permissions
router.get('/token-info', async (req, res) => {
  try {
    console.log('=== TOKEN INFO DEBUG ===');
    console.log('Current access token (last 10 chars):', ZOHO_CONFIG.accessToken?.slice(-10));
    
    // Try to get user info from CRM to test token
    const crmUserResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/users?type=CurrentUser`);
    
    // Try to get user info from WorkDrive to test token
    let workdriveUserResponse = null;
    try {
      workdriveUserResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/users/me`, 'GET', null, 0, true);
    } catch (workdriveError) {
      console.log('WorkDrive user info failed:', workdriveError.response?.data || workdriveError.message);
    }
    
    res.json({
      status: 'success',
      tokenInfo: {
        hasAccessToken: !!ZOHO_CONFIG.accessToken,
        tokenLength: ZOHO_CONFIG.accessToken?.length || 0,
        last10Chars: ZOHO_CONFIG.accessToken?.slice(-10) || 'N/A'
      },
      crmAccess: {
        status: 'success',
        user: crmUserResponse.users?.[0]?.full_name || 'Unknown',
        email: crmUserResponse.users?.[0]?.email || 'Unknown'
      },
      workdriveAccess: workdriveUserResponse ? {
        status: 'success',
        user: workdriveUserResponse.data?.display_name || 'Unknown',
        email: workdriveUserResponse.data?.email_id || 'Unknown'
      } : {
        status: 'failed',
        error: 'WorkDrive API access failed'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Token info error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get token info',
      error: error.response?.data || error.message
    });
  }
});

// Test WorkDrive API connection and available endpoints
router.get('/workdrive-connection-test', async (req, res) => {
  try {
    console.log('=== TESTING WORKDRIVE API CONNECTION ===');
    
    // Test different WorkDrive API endpoints to see which ones work
    const endpoints = [
      { name: 'users/me', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/users/me` },
      { name: 'files', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files` },
      { name: 'folders', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/folders` },
      { name: 'teams', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/teams` },
      { name: 'root', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/` }
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Testing endpoint: ${endpoint.name}`);
        const response = await makeZohoAPICall(endpoint.url);
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          status: 'success',
          response: response
        });
      } catch (error) {
        console.log(`Endpoint ${endpoint.name} failed:`, error.response?.data || error.message);
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          status: 'failed',
          error: error.response?.data || error.message,
          statusCode: error.response?.status
        });
      }
    }
    
    // Try to get user info specifically
    let userInfo = null;
    try {
      userInfo = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/users/me`);
    } catch (error) {
      console.log('User info failed:', error.response?.data || error.message);
    }
    
    res.json({
      status: 'success',
      message: 'WorkDrive API connection test completed',
      baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
      tokenInfo: {
        hasAccessToken: !!ZOHO_CONFIG.accessToken,
        tokenLength: ZOHO_CONFIG.accessToken?.length || 0,
        last10Chars: ZOHO_CONFIG.accessToken?.slice(-10) || 'N/A'
      },
      userInfo: userInfo ? {
        status: 'success',
        data: userInfo.data || userInfo
      } : {
        status: 'failed',
        error: 'Could not retrieve user info'
      },
      endpointTests: results,
      summary: {
        totalEndpoints: endpoints.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive connection test error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive API connection test failed',
      error: error.response?.data || error.message,
      baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
      tokenInfo: {
        hasAccessToken: !!ZOHO_CONFIG.accessToken,
        tokenLength: ZOHO_CONFIG.accessToken?.length || 0,
        last10Chars: ZOHO_CONFIG.accessToken?.slice(-10) || 'N/A'
      }
    });
  }
});

// Test specific WorkDrive folder access
router.get('/workdrive-folder-test/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    
    console.log(`=== TESTING WORKDRIVE FOLDER ACCESS: ${folderId} ===`);
    
    if (!folderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Folder ID is required'
      });
    }
    
    // Test different folder-related endpoints
    const folderEndpoints = [
      { name: 'folder_info', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/folders/${folderId}` },
      { name: 'folder_files', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/folders/${folderId}/files` },
      { name: 'files_by_folder', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?folder_id=${folderId}` },
      { name: 'folder_contents', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/folders/${folderId}/contents` }
    ];
    
    const results = [];
    
    for (const endpoint of folderEndpoints) {
      try {
        console.log(`Testing folder endpoint: ${endpoint.name}`);
        const response = await makeZohoAPICall(endpoint.url);
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          status: 'success',
          response: response
        });
      } catch (error) {
        console.log(`Folder endpoint ${endpoint.name} failed:`, error.response?.data || error.message);
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          status: 'failed',
          error: error.response?.data || error.message,
          statusCode: error.response?.status
        });
      }
    }
    
    res.json({
      status: 'success',
      message: 'WorkDrive folder access test completed',
      folderId: folderId,
      baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
      endpointTests: results,
      summary: {
        totalEndpoints: folderEndpoints.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive folder test error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive folder access test failed',
      folderId: req.params.folderId,
      error: error.response?.data || error.message
    });
  }
});

// Comprehensive WorkDrive API exploration
router.get('/workdrive-api-exploration', async (req, res) => {
  try {
    console.log('=== COMPREHENSIVE WORKDRIVE API EXPLORATION ===');
    
    // Test various API structures and parameters
    const testCases = [
      // Basic endpoints
      { name: 'files_basic', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files` },
      { name: 'files_with_limit', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?limit=10` },
      { name: 'files_with_page', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?page=1` },
      { name: 'files_with_per_page', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?per_page=10` },
      
      // Different parameter names for folder filtering
      { name: 'files_folder_param', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?folder=${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'files_parent_param', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?parent=${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'files_parent_id_param', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?parent_id=${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'files_folderid_param', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files?folderid=${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      
      // Different endpoint structures
      { name: 'files_in_folder', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/in/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'files_of_folder', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/of/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'files_from_folder', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/from/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      
      // Alternative folder endpoints
      { name: 'folder_as_file', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}` },
      { name: 'folder_children', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}/children` },
      { name: 'folder_items', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${encodeURIComponent('5k0jk278f238a6f054b9287912d05f64dc31e')}/items` },
      
      // Team and workspace related
      { name: 'teams', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/teams` },
      { name: 'workspaces', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/workspaces` },
      { name: 'spaces', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/spaces` },
      
      // User related
      { name: 'user_files', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/users/me/files` },
      { name: 'user_folders', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/users/me/folders` },
      
      // Root level
      { name: 'root_files', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/root` },
      { name: 'root_children', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/root/children` }
    ];
    
    const results = [];
    
    for (const testCase of testCases) {
      try {
        console.log(`Testing: ${testCase.name}`);
        const response = await makeZohoAPICall(testCase.url);
        results.push({
          testCase: testCase.name,
          url: testCase.url,
          status: 'success',
          response: response,
          dataLength: response.data?.length || 0,
          hasData: !!response.data
        });
      } catch (error) {
        console.log(`${testCase.name} failed:`, error.response?.data || error.message);
        results.push({
          testCase: testCase.name,
          url: testCase.url,
          status: 'failed',
          error: error.response?.data || error.message,
          statusCode: error.response?.status
        });
      }
    }
    
    // Analyze results
    const successfulTests = results.filter(r => r.status === 'success');
    const failedTests = results.filter(r => r.status === 'failed');
    
    // Find tests that returned data
    const testsWithData = successfulTests.filter(r => r.hasData && r.dataLength > 0);
    
    res.json({
      status: 'success',
      message: 'WorkDrive API exploration completed',
      baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
      summary: {
        totalTests: testCases.length,
        successful: successfulTests.length,
        failed: failedTests.length,
        testsWithData: testsWithData.length
      },
      successfulTests: successfulTests,
      testsWithData: testsWithData,
      failedTests: failedTests,
      recommendations: testsWithData.length > 0 ? [
        'Found working endpoints that return data!',
        'Check the successfulTests array for working API calls.',
        'Use the testsWithData array to see which endpoints return actual file/folder data.'
      ] : [
        'No endpoints returned data.',
        'All endpoints either failed or returned empty responses.',
        'May need different authentication or API version.'
      ],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive API exploration error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive API exploration failed',
      error: error.response?.data || error.message
    });
  }
});

// Simple WorkDrive files test - get all files and analyze structure
router.get('/workdrive-files-analysis', async (req, res) => {
  try {
    console.log('=== WORKDRIVE FILES ANALYSIS ===');
    
    // Try to get all files without any parameters
    const filesUrl = `${ZOHO_CONFIG.baseUrlWorkdrive}/files`;
    console.log('Files URL:', filesUrl);
    
    const response = await makeZohoAPICall(filesUrl);
    
    console.log('Files response received');
    console.log('Response structure:', Object.keys(response));
    console.log('Data length:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No files found in WorkDrive',
        responseStructure: Object.keys(response),
        data: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Analyze the first few files to understand the structure
    const sampleFiles = response.data.slice(0, 5);
    const fileAnalysis = sampleFiles.map((file, index) => ({
      index: index + 1,
      fileId: file.id,
      fileName: file.name || file.file_name || file.display_name,
      fileType: file.type || file.file_type || file.mime_type,
      isFolder: file.is_folder || file.folder || file.type === 'folder',
      parentId: file.parent_id || file.parent || file.folder_id,
      path: file.path || file.full_path,
      size: file.size || file.file_size,
      createdTime: file.created_time || file.created_at,
      modifiedTime: file.modified_time || file.updated_at,
      allKeys: Object.keys(file)
    }));
    
    // Look for files that might be in our target folder
    const targetFolderId = '5k0jk278f238a6f054b9287912d05f64dc31e';
    const filesInTargetFolder = response.data.filter(file => 
      file.parent_id === targetFolderId || 
      file.parent === targetFolderId || 
      file.folder_id === targetFolderId
    );
    
    // Count by type
    const typeCounts = {};
    response.data.forEach(file => {
      const type = file.type || file.file_type || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    
    res.json({
      status: 'success',
      message: 'WorkDrive files analysis completed',
      summary: {
        totalFiles: response.data.length,
        filesInTargetFolder: filesInTargetFolder.length,
        targetFolderId: targetFolderId,
        typeCounts: typeCounts
      },
      responseStructure: Object.keys(response),
      sampleFiles: fileAnalysis,
      filesInTargetFolder: filesInTargetFolder.map(file => ({
        fileId: file.id,
        fileName: file.name || file.file_name || file.display_name,
        fileType: file.type || file.file_type,
        isFolder: file.is_folder || file.folder,
        parentId: file.parent_id || file.parent || file.folder_id,
        allKeys: Object.keys(file)
      })),
      allFiles: response.data.map(file => ({
        fileId: file.id,
        fileName: file.name || file.file_name || file.display_name,
        fileType: file.type || file.file_type,
        isFolder: file.is_folder || file.folder,
        parentId: file.parent_id || file.parent || file.folder_id
      })),
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive files analysis error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive files analysis failed',
      error: error.response?.data || error.message,
      statusCode: error.response?.status
    });
  }
});

// WorkDrive API v2 exploration
router.get('/workdrive-v2-exploration', async (req, res) => {
  try {
    console.log('=== WORKDRIVE API V2 EXPLORATION ===');
    
    // Test various v2 API structures
    const v2TestCases = [
      // Basic v2 endpoints
      { name: 'v2_root', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/` },
      { name: 'v2_api_info', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/api` },
      { name: 'v2_version', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/version` },
      
      // Different file endpoint structures
      { name: 'v2_files_root', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/root` },
      { name: 'v2_files_my', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/my` },
      { name: 'v2_files_shared', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/shared` },
      { name: 'v2_files_recent', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/recent` },
      
      // Team and workspace structures
      { name: 'v2_my_teams', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/my/teams` },
      { name: 'v2_my_workspaces', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/my/workspaces` },
      { name: 'v2_my_spaces', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/my/spaces` },
      
      // User-specific endpoints
      { name: 'v2_me', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/me` },
      { name: 'v2_me_files', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/me/files` },
      { name: 'v2_me_folders', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/me/folders` },
      
      // Different authentication headers
      { name: 'v2_files_bearer', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files`, customHeaders: { 'Authorization': `Bearer ${ZOHO_CONFIG.accessToken}` } },
      { name: 'v2_files_zoho', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files`, customHeaders: { 'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}` } },
      
      // Alternative base URLs
      { name: 'v2_alt_base', url: `https://workdrive.zoho.com/api/v2/files` },
      { name: 'v2_alt_base_me', url: `https://workdrive.zoho.com/api/v2/me` },
      
      // Different API versions
      { name: 'v1_files', url: `https://www.zohoapis.com/workdrive/api/v1/files` },
      { name: 'v3_files', url: `https://www.zohoapis.com/workdrive/api/v3/files` },
      
      // JSON API format
      { name: 'v2_files_jsonapi', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/files`, customHeaders: { 'Accept': 'application/vnd.api+json' } },
      { name: 'v2_me_jsonapi', url: `${ZOHO_CONFIG.baseUrlWorkdrive}/me`, customHeaders: { 'Accept': 'application/vnd.api+json' } }
    ];
    
    const results = [];
    
    for (const testCase of v2TestCases) {
      try {
        console.log(`Testing v2: ${testCase.name}`);
        
        let config = {
          method: 'GET',
          url: testCase.url,
          headers: {
            'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
            'Content-Type': 'application/json'
          }
        };
        
        // Add custom headers if specified
        if (testCase.customHeaders) {
          config.headers = { ...config.headers, ...testCase.customHeaders };
        }
        
        const response = await axios(config);
        
        results.push({
          testCase: testCase.name,
          url: testCase.url,
          status: 'success',
          response: response.data,
          statusCode: response.status,
          dataLength: response.data?.data?.length || 0,
          hasData: !!response.data?.data
        });
      } catch (error) {
        console.log(`v2 ${testCase.name} failed:`, error.response?.data || error.message);
        results.push({
          testCase: testCase.name,
          url: testCase.url,
          status: 'failed',
          error: error.response?.data || error.message,
          statusCode: error.response?.status
        });
      }
    }
    
    // Analyze results
    const successfulTests = results.filter(r => r.status === 'success');
    const failedTests = results.filter(r => r.status === 'failed');
    const testsWithData = successfulTests.filter(r => r.hasData && r.dataLength > 0);
    
    res.json({
      status: 'success',
      message: 'WorkDrive API v2 exploration completed',
      baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
      summary: {
        totalTests: v2TestCases.length,
        successful: successfulTests.length,
        failed: failedTests.length,
        testsWithData: testsWithData.length
      },
      successfulTests: successfulTests,
      testsWithData: testsWithData,
      failedTests: failedTests,
      recommendations: testsWithData.length > 0 ? [
        'Found working v2 endpoints that return data!',
        'Check the successfulTests array for working API calls.',
        'Use the testsWithData array to see which endpoints return actual data.'
      ] : successfulTests.length > 0 ? [
        'Found working v2 endpoints but no data returned.',
        'Check the successfulTests array for working API calls.',
        'May need different parameters or authentication method.'
      ] : [
        'No v2 endpoints worked.',
        'All endpoints failed with various errors.',
        'May need different API version or authentication method.'
      ],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive v2 exploration error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive API v2 exploration failed',
      error: error.response?.data || error.message
    });
  }
});

// Test common WorkDrive API v2 patterns
router.get('/workdrive-v2-patterns', async (req, res) => {
  try {
    console.log('=== TESTING WORKDRIVE V2 PATTERNS ===');
    
    // Switch back to v2 since that worked with the token
    const v2BaseUrl = 'https://www.zohoapis.com/workdrive/api/v2';
    
    // Common v2 API patterns
    const v2Patterns = [
      // Basic patterns
      { name: 'v2_basic', url: `${v2BaseUrl}/` },
      { name: 'v2_files', url: `${v2BaseUrl}/files` },
      { name: 'v2_folders', url: `${v2BaseUrl}/folders` },
      
      // RESTful patterns
      { name: 'v2_files_list', url: `${v2BaseUrl}/files/list` },
      { name: 'v2_files_search', url: `${v2BaseUrl}/files/search` },
      { name: 'v2_files_metadata', url: `${v2BaseUrl}/files/metadata` },
      
      // Resource patterns
      { name: 'v2_resources', url: `${v2BaseUrl}/resources` },
      { name: 'v2_resources_files', url: `${v2BaseUrl}/resources/files` },
      { name: 'v2_resources_folders', url: `${v2BaseUrl}/resources/folders` },
      
      // Data patterns
      { name: 'v2_data', url: `${v2BaseUrl}/data` },
      { name: 'v2_data_files', url: `${v2BaseUrl}/data/files` },
      { name: 'v2_data_folders', url: `${v2BaseUrl}/data/folders` },
      
      // API patterns
      { name: 'v2_api', url: `${v2BaseUrl}/api` },
      { name: 'v2_api_files', url: `${v2BaseUrl}/api/files` },
      { name: 'v2_api_folders', url: `${v2BaseUrl}/api/folders` },
      
      // Different HTTP methods
      { name: 'v2_files_post', url: `${v2BaseUrl}/files`, method: 'POST' },
      { name: 'v2_files_put', url: `${v2BaseUrl}/files`, method: 'PUT' },
      
      // Query parameters
      { name: 'v2_files_with_type', url: `${v2BaseUrl}/files?type=all` },
      { name: 'v2_files_with_format', url: `${v2BaseUrl}/files?format=json` },
      { name: 'v2_files_with_version', url: `${v2BaseUrl}/files?version=2` }
    ];
    
    const results = [];
    
    for (const pattern of v2Patterns) {
      try {
        console.log(`Testing v2 pattern: ${pattern.name}`);
        
        const config = {
          method: pattern.method || 'GET',
          url: pattern.url,
          headers: {
            'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
            'Content-Type': 'application/json'
          }
        };
        
        const response = await axios(config);
        
        results.push({
          pattern: pattern.name,
          url: pattern.url,
          method: pattern.method || 'GET',
          status: 'success',
          response: response.data,
          statusCode: response.status,
          dataLength: response.data?.data?.length || 0,
          hasData: !!response.data?.data
        });
      } catch (error) {
        console.log(`v2 pattern ${pattern.name} failed:`, error.response?.data || error.message);
        results.push({
          pattern: pattern.name,
          url: pattern.url,
          method: pattern.method || 'GET',
          status: 'failed',
          error: error.response?.data || error.message,
          statusCode: error.response?.status
        });
      }
    }
    
    // Analyze results
    const successfulPatterns = results.filter(r => r.status === 'success');
    const failedPatterns = results.filter(r => r.status === 'failed');
    const patternsWithData = successfulPatterns.filter(r => r.hasData && r.dataLength > 0);
    
    res.json({
      status: 'success',
      message: 'WorkDrive v2 patterns test completed',
      baseUrl: v2BaseUrl,
      summary: {
        totalPatterns: v2Patterns.length,
        successful: successfulPatterns.length,
        failed: failedPatterns.length,
        patternsWithData: patternsWithData.length
      },
      successfulPatterns: successfulPatterns,
      patternsWithData: patternsWithData,
      failedPatterns: failedPatterns,
      recommendations: patternsWithData.length > 0 ? [
        'Found working v2 patterns that return data!',
        'Check the successfulPatterns array for working API calls.',
        'Use the patternsWithData array to see which patterns return actual data.'
      ] : successfulPatterns.length > 0 ? [
        'Found working v2 patterns but no data returned.',
        'Check the successfulPatterns array for working API calls.',
        'May need different parameters or authentication method.'
      ] : [
        'No v2 patterns worked.',
        'All patterns failed with various errors.',
        'May need different API structure or authentication method.'
      ],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('WorkDrive v2 patterns error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'WorkDrive v2 patterns test failed',
      error: error.response?.data || error.message
    });
  }
});

// Decode and display current token scopes in detail
router.get('/token-scopes-analysis', async (req, res) => {
  try {
    console.log('=== TOKEN SCOPES ANALYSIS ===');
    
    // Get current token info
    const currentToken = ZOHO_CONFIG.accessToken;
    console.log('Current token (last 10 chars):', currentToken?.slice(-10));
    
    // Test what the token can access
    const accessTests = [
      {
        name: 'CRM Users',
        url: `${ZOHO_CONFIG.baseUrlCRM}/users?type=CurrentUser`,
        expectedScope: 'ZohoCRM.users.ALL'
      },
      {
        name: 'CRM Modules',
        url: `${ZOHO_CONFIG.baseUrlCRM}/settings/modules`,
        expectedScope: 'ZohoCRM.settings.ALL'
      },
      {
        name: 'CRM Fields',
        url: `${ZOHO_CONFIG.baseUrlCRM}/settings/fields?module=Accounts`,
        expectedScope: 'ZohoCRM.settings.ALL'
      },
      {
        name: 'WorkDrive Files (zohoapis.com)',
        url: 'https://www.zohoapis.com/workdrive/api/v1/files',
        expectedScope: 'WorkDrive.files.ALL'
      },
      {
        name: 'WorkDrive Files (workdrive.zoho.com)',
        url: 'https://workdrive.zoho.com/api/v1/files',
        expectedScope: 'WorkDrive.files.ALL'
      },
      {
        name: 'WorkDrive Teams',
        url: 'https://www.zohoapis.com/workdrive/api/v1/teams',
        expectedScope: 'WorkDrive.teams.ALL'
      }
    ];
    
    const testResults = [];
    
    for (const test of accessTests) {
      try {
        console.log(`Testing access to: ${test.name}`);
        const response = await makeZohoAPICall(test.url);
        testResults.push({
          test: test.name,
          url: test.url,
          expectedScope: test.expectedScope,
          status: 'success',
          hasAccess: true,
          response: response
        });
      } catch (error) {
        console.log(`${test.name} failed:`, error.response?.data || error.message);
        testResults.push({
          test: test.name,
          url: test.url,
          expectedScope: test.expectedScope,
          status: 'failed',
          hasAccess: false,
          error: error.response?.data || error.message,
          errorCode: error.response?.data?.errors?.[0]?.id
        });
      }
    }
    
    // Analyze scopes from token refresh response (from earlier logs)
    const tokenScopes = [
      'ZohoCRM.org.ALL',
      'ZohoCRM.settings.ALL', 
      'ZohoCRM.users.ALL',
      'ZohoCRM.templates.email.READ',
      'ZohoCRM.templates.inventory.READ',
      'ZohoCRM.modules.ALL',
      'ZohoCRM.bulk.ALL',
      'ZohoCRM.notifications.ALL',
      'ZohoCRM.coql.READ',
      'WorkDrive.files.ALL'
    ];
    
    // Categorize scopes
    const crmScopes = tokenScopes.filter(scope => scope.startsWith('ZohoCRM'));
    const workdriveScopes = tokenScopes.filter(scope => scope.startsWith('WorkDrive'));
    const otherScopes = tokenScopes.filter(scope => !scope.startsWith('ZohoCRM') && !scope.startsWith('WorkDrive'));
    
    res.json({
      status: 'success',
      message: 'Token scopes analysis completed',
      tokenInfo: {
        hasToken: !!currentToken,
        tokenLength: currentToken?.length || 0,
        last10Chars: currentToken?.slice(-10) || 'N/A'
      },
      scopes: {
        all: tokenScopes,
        crm: crmScopes,
        workdrive: workdriveScopes,
        other: otherScopes,
        total: tokenScopes.length
      },
      accessTests: testResults,
      analysis: {
        crmAccess: testResults.filter(t => t.test.includes('CRM') && t.hasAccess).length,
        workdriveAccess: testResults.filter(t => t.test.includes('WorkDrive') && t.hasAccess).length,
        totalTests: testResults.length,
        successfulTests: testResults.filter(t => t.hasAccess).length,
        failedTests: testResults.filter(t => !t.hasAccess).length
      },
      recommendations: [
        `You have ${crmScopes.length} CRM scopes and ${workdriveScopes.length} WorkDrive scopes.`,
        workdriveScopes.length > 0 ? 'You have WorkDrive scopes but API access is failing.' : 'You need WorkDrive scopes for API access.',
        'Consider generating new tokens with additional WorkDrive scopes if needed.',
        'Your CRM integration is working perfectly with current scopes.'
      ],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Token scopes analysis error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Token scopes analysis failed',
      error: error.response?.data || error.message
    });
  }
});

// Test WorkDrive folder traversal
router.get('/workdrive-traversal', async (req, res) => {
  try {
    console.log('=== WORKDRIVE FOLDER TRAVERSAL TEST ===');
    
    const folderId = '5k0jk278f238a6f054b9287912d05f64dc31e';
    console.log('Testing folder ID:', folderId);
    
    // Test different WorkDrive API endpoints for folder traversal
    const tests = [
      {
        name: 'WorkDrive Root Files (zohoapis.com)',
        url: 'https://www.zohoapis.com/workdrive/api/v1/files',
        method: 'GET'
      },
      {
        name: 'WorkDrive Root Files (workdrive.zoho.com)',
        url: 'https://workdrive.zoho.com/api/v1/files',
        method: 'GET'
      },
      {
        name: 'WorkDrive Root Folders (zohoapis.com)',
        url: 'https://www.zohoapis.com/workdrive/api/v1/folders',
        method: 'GET'
      },
      {
        name: 'WorkDrive Root Folders (workdrive.zoho.com)',
        url: 'https://workdrive.zoho.com/api/v1/folders',
        method: 'GET'
      },
      {
        name: 'WorkDrive Teams (zohoapis.com)',
        url: 'https://www.zohoapis.com/workdrive/api/v1/teams',
        method: 'GET'
      },
      {
        name: 'WorkDrive Teams (workdrive.zoho.com)',
        url: 'https://workdrive.zoho.com/api/v1/teams',
        method: 'GET'
      },
      {
        name: 'WorkDrive User Info (zohoapis.com)',
        url: 'https://www.zohoapis.com/workdrive/api/v1/user',
        method: 'GET'
      },
      {
        name: 'WorkDrive User Info (workdrive.zoho.com)',
        url: 'https://workdrive.zoho.com/api/v1/user',
        method: 'GET'
      },
      {
        name: 'WorkDrive File by ID (zohoapis.com)',
        url: `https://www.zohoapis.com/workdrive/api/v1/files/${folderId}`,
        method: 'GET'
      },
      {
        name: 'WorkDrive File by ID (workdrive.zoho.com)',
        url: `https://workdrive.zoho.com/api/v1/files/${folderId}`,
        method: 'GET'
      },
      {
        name: 'WorkDrive Folder by ID (zohoapis.com)',
        url: `https://www.zohoapis.com/workdrive/api/v1/folders/${folderId}`,
        method: 'GET'
      },
      {
        name: 'WorkDrive Folder by ID (workdrive.zoho.com)',
        url: `https://workdrive.zoho.com/api/v1/folders/${folderId}`,
        method: 'GET'
      }
    ];

    const results = [];

    for (const test of tests) {
      try {
        console.log(`Testing: ${test.name}`);
        const response = await makeZohoAPICall(test.url, test.method);
        
        results.push({
          test: test.name,
          url: test.url,
          status: 'success',
          hasAccess: true,
          response: response.data || response,
          responseSize: JSON.stringify(response).length
        });
        
        console.log(`✅ ${test.name} - SUCCESS`);
      } catch (error) {
        console.log(`❌ ${test.name} - FAILED:`, error.response?.data || error.message);
        
        results.push({
          test: test.name,
          url: test.url,
          status: 'failed',
          hasAccess: false,
          error: error.response?.data || { message: error.message },
          errorCode: error.response?.data?.errors?.[0]?.id || 'UNKNOWN'
        });
      }
    }

    // Summary
    const successfulTests = results.filter(r => r.status === 'success');
    const failedTests = results.filter(r => r.status === 'failed');
    
    const summary = {
      totalTests: tests.length,
      successfulTests: successfulTests.length,
      failedTests: failedTests.length,
      successRate: `${((successfulTests.length / tests.length) * 100).toFixed(1)}%`
    };

    res.json({
      message: 'WorkDrive Folder Traversal Test Results',
      folderId: folderId,
      summary: summary,
      results: results,
      recommendations: [
        successfulTests.length > 0 ? '✅ Some WorkDrive API endpoints are working!' : '❌ No WorkDrive API endpoints are working',
        failedTests.length > 0 ? '⚠️ Some endpoints failed - check token scopes' : '🎉 All endpoints working!',
        '💡 Use the working endpoints for your folder traversal implementation'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('WorkDrive traversal test error:', error);
    res.status(500).json({
      error: 'WorkDrive traversal test failed',
      message: error.message,
      details: error.response?.data || error
    });
  }
});

// Traverse WorkDrive folder contents
router.get('/workdrive-folder-contents/:folderId', async (req, res) => {
  try {
    console.log('=== WORKDRIVE FOLDER CONTENTS TRAVERSAL ===');
    
    const folderId = req.params.folderId || '5k0jk278f238a6f054b9287912d05f64dc31e';
    console.log('Traversing folder ID:', folderId);
    
    const results = {
      folderId: folderId,
      folderInfo: null,
      subfolders: [],
      files: [],
      breadcrumbs: [],
      parentFolders: [],
      errors: []
    };

    // 1. Get folder details
    try {
      console.log('Getting folder details...');
      const folderResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}`);
      results.folderInfo = folderResponse.data || folderResponse;
      console.log('✅ Folder details retrieved');
    } catch (error) {
      console.log('❌ Folder details failed:', error.response?.data || error.message);
      results.errors.push({ type: 'folder_details', error: error.response?.data || error.message });
    }

    // 2. Get subfolders
    try {
      console.log('Getting subfolders...');
      const foldersResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}/folders`);
      results.subfolders = foldersResponse.data || foldersResponse;
      console.log('✅ Subfolders retrieved');
    } catch (error) {
      console.log('❌ Subfolders failed:', error.response?.data || error.message);
      results.errors.push({ type: 'subfolders', error: error.response?.data || error.message });
    }

    // 3. Get files
    try {
      console.log('Getting files...');
      const filesResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}/files`);
      results.files = filesResponse.data || filesResponse;
      console.log('✅ Files retrieved');
    } catch (error) {
      console.log('❌ Files failed:', error.response?.data || error.message);
      results.errors.push({ type: 'files', error: error.response?.data || error.message });
    }

    // 4. Get breadcrumbs
    try {
      console.log('Getting breadcrumbs...');
      const breadcrumbsResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}/breadcrumbs`);
      results.breadcrumbs = breadcrumbsResponse.data || breadcrumbsResponse;
      console.log('✅ Breadcrumbs retrieved');
    } catch (error) {
      console.log('❌ Breadcrumbs failed:', error.response?.data || error.message);
      results.errors.push({ type: 'breadcrumbs', error: error.response?.data || error.message });
    }

    // 5. Get parent folders
    try {
      console.log('Getting parent folders...');
      const parentResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}/parentfolders`);
      results.parentFolders = parentResponse.data || parentResponse;
      console.log('✅ Parent folders retrieved');
    } catch (error) {
      console.log('❌ Parent folders failed:', error.response?.data || error.message);
      results.errors.push({ type: 'parent_folders', error: error.response?.data || error.message });
    }

    // Summary
    const successfulOperations = 5 - results.errors.length;
    const summary = {
      totalOperations: 5,
      successfulOperations: successfulOperations,
      failedOperations: results.errors.length,
      successRate: `${((successfulOperations / 5) * 100).toFixed(1)}%`
    };

    res.json({
      message: 'WorkDrive Folder Contents Traversal Results',
      summary: summary,
      results: results,
      recommendations: [
        successfulOperations > 0 ? '✅ WorkDrive folder traversal is working!' : '❌ No folder traversal operations succeeded',
        results.errors.length > 0 ? '⚠️ Some operations failed - check specific error details' : '🎉 All operations successful!',
        '💡 Use the successful endpoints for your folder navigation implementation'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('WorkDrive folder contents traversal error:', error);
    res.status(500).json({
      error: 'WorkDrive folder contents traversal failed',
      message: error.message,
      details: error.response?.data || error
    });
  }
});

// Read/Preview file content (read-only)
router.get('/workdrive-read-file/:fileId', async (req, res) => {
  try {
    console.log('=== WORKDRIVE READ FILE (PREVIEW) ===');
    
    const fileId = req.params.fileId;
    console.log('Reading file ID:', fileId);
    
    const results = {
      fileId: fileId,
      fileInfo: null,
      previewUrl: null,
      content: null,
      errors: []
    };

    // 1. Get file details first
    try {
      console.log('Getting file details...');
      const fileResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${fileId}`);
      results.fileInfo = fileResponse.data || fileResponse;
      console.log('✅ File details retrieved');
    } catch (error) {
      console.log('❌ File details failed:', error.response?.data || error.message);
      results.errors.push({ type: 'file_details', error: error.response?.data || error.message });
    }

    // 2. Get preview URL for the file
    try {
      console.log('Getting preview URL...');
      const previewResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${fileId}/previewinfo`);
      results.previewUrl = previewResponse.data || previewResponse;
      console.log('✅ Preview URL retrieved');
    } catch (error) {
      console.log('❌ Preview URL failed:', error.response?.data || error.message);
      results.errors.push({ type: 'preview_url', error: error.response?.data || error.message });
    }

    // 3. Try to get file content for text-based files
    try {
      console.log('Getting file content...');
      const contentResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${fileId}/content`);
      results.content = contentResponse.data || contentResponse;
      console.log('✅ File content retrieved');
    } catch (error) {
      console.log('❌ File content failed:', error.response?.data || error.message);
      results.errors.push({ type: 'file_content', error: error.response?.data || error.message });
    }

    // Summary
    const successfulOperations = 3 - results.errors.length;
    const summary = {
      totalOperations: 3,
      successfulOperations: successfulOperations,
      failedOperations: results.errors.length,
      successRate: `${((successfulOperations / 3) * 100).toFixed(1)}%`
    };

    res.json({
      message: 'WorkDrive File Read/Preview Results',
      summary: summary,
      results: results,
      recommendations: [
        successfulOperations > 0 ? '✅ File reading is working!' : '❌ No file reading operations succeeded',
        results.errors.length > 0 ? '⚠️ Some operations failed - check file type and permissions' : '🎉 All operations successful!',
        '💡 Use preview URLs for displaying files in your frontend',
        '🔒 This is READ-ONLY - users cannot edit or download files'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('WorkDrive file read error:', error);
    res.status(500).json({
      error: 'WorkDrive file read failed',
      message: error.message,
      details: error.response?.data || error
    });
  }
});

// Download file (full download with edit capabilities)
router.get('/workdrive-download-file/:fileId', async (req, res) => {
  try {
    console.log('=== WORKDRIVE DOWNLOAD FILE ===');
    
    const fileId = req.params.fileId;
    console.log('Downloading file ID:', fileId);
    
    const results = {
      fileId: fileId,
      fileInfo: null,
      downloadUrl: null,
      errors: []
    };

    // 1. Get file details first
    try {
      console.log('Getting file details...');
      const fileResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${fileId}`);
      results.fileInfo = fileResponse.data || fileResponse;
      console.log('✅ File details retrieved');
    } catch (error) {
      console.log('❌ File details failed:', error.response?.data || error.message);
      results.errors.push({ type: 'file_details', error: error.response?.data || error.message });
    }

    // 2. Get download URL for the file
    try {
      console.log('Getting download URL...');
      const downloadResponse = await makeZohoAPICall(`https://www.zohoapis.com/workdrive/api/v1/files/${fileId}/download`);
      results.downloadUrl = downloadResponse.data || downloadResponse;
      console.log('✅ Download URL retrieved');
    } catch (error) {
      console.log('❌ Download URL failed:', error.response?.data || error.message);
      results.errors.push({ type: 'download_url', error: error.response?.data || error.message });
    }

    // Summary
    const successfulOperations = 2 - results.errors.length;
    const summary = {
      totalOperations: 2,
      successfulOperations: successfulOperations,
      failedOperations: results.errors.length,
      successRate: `${((successfulOperations / 2) * 100).toFixed(1)}%`
    };

    res.json({
      message: 'WorkDrive File Download Results',
      summary: summary,
      results: results,
      recommendations: [
        successfulOperations > 0 ? '✅ File download is working!' : '❌ No file download operations succeeded',
        results.errors.length > 0 ? '⚠️ Some operations failed - check file permissions' : '🎉 All operations successful!',
        '💡 Use download URLs to allow users to save files locally',
        '⚠️ DOWNLOAD ENABLES EDITING - users can modify downloaded files'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('WorkDrive file download error:', error);
    res.status(500).json({
      error: 'WorkDrive file download failed',
      message: error.message,
      details: error.response?.data || error
    });
  }
});

// Simple QR code test endpoint
router.get('/test-qr', async (req, res) => {
  try {
    const QRCode = (await import('qrcode')).default;
    const testData = 'otpauth://totp/TestApp:testuser?secret=JBSWY3DPEHPK3PXP&issuer=TestApp';
    const qrCode = await QRCode.toDataURL(testData);
    
    res.json({
      status: 'success',
      qrCode: qrCode,
      secretCode: 'JBSWY3DPEHPK3PXP',
      message: 'QR code generated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export const testRouter = router; 