import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.js';

// Load environment variables
dotenv.config();

const router = express.Router();

// Zoho configuration
const ZOHO_CONFIG = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  accessToken: process.env.ZOHO_ACCESS_TOKEN,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  baseUrlCRM: 'https://www.zohoapis.com/crm/v8',
  baseUrlWorkdrive: 'https://www.zohoapis.com/workdrive/api/v1',
  authUrl: 'https://accounts.zoho.com/oauth/v2/token'
};

// Function to refresh access token
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

// Function to make authenticated API calls with automatic token refresh
const makeZohoAPICall = async (url, method = 'GET', data = null, retryCount = 0) => {
  try {
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    // If unauthorized and we haven't retried yet, refresh token and retry
    if (error.response?.status === 401 && retryCount === 0) {
      console.log('Access token expired, refreshing...');
      const newToken = await refreshAccessToken();
      ZOHO_CONFIG.accessToken = newToken;
      
      // Retry the request with new token
      return makeZohoAPICall(url, method, data, 1);
    }
    
    throw error;
  }
};

// Test Zoho connection
router.get('/test-connection', async (req, res) => {
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

// Get CRM modules
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

// Get Workdrive team folders
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

// === PROTECTED ROUTES (MUST COME BEFORE CATCH-ALL) ===

// Get module metadata to understand field structure
router.get('/crm/module-metadata/:module', authenticateToken, async (req, res) => {
  try {
    const { module } = req.params;
    
    console.log(`Fetching metadata for module: ${module} for user: ${req.user.email || req.user.sub}`);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/settings/modules/${module}`);
    
    res.json({
      status: 'success',
      module: module,
      metadata: response.modules?.[0] || response,
      userInfo: {
        cognitoUserId: req.user.sub,
        email: req.user.email || 'not available in access token'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching ${req.params.module} metadata:`, error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: `Failed to fetch ${req.params.module} metadata`,
      error: error.response?.data || error.message
    });
  }
});

// Use COQL Query API for Multi-Select-Lookup fields (Protected)
router.get('/crm/query-contacts', authenticateToken, async (req, res) => {
  try {
    const { email, cognitoUserId } = req.query;
    
    // Use authenticated user's info if not provided in query
    const userEmail = email || req.user.email;
    const userCognitoId = cognitoUserId || req.user.sub;
    
    if (!userEmail && !userCognitoId) {
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token or query parameters'
      });
    }
    
    console.log('Using COQL Query API to fetch contact with Multi-Select-Lookup fields...');
    console.log('Authenticated user:', { email: req.user.email, sub: req.user.sub });
    console.log('Search parameters:', { email: userEmail, cognitoUserId: userCognitoId });
    
    // Build COQL query based on available parameters
    let whereClause;
    let searchField;
    
    if (userEmail) {
      whereClause = `Email = '${userEmail.replace(/'/g, "''")}'`;
      searchField = 'email';
    } else {
      whereClause = `Single_Line_1 = '${userCognitoId.replace(/'/g, "''")}'`;
      searchField = 'cognito_user_id';
    }
    
    // COQL query to get contact with specific fields including Multi-Select-Lookup
    const coqlQuery = {
      select_query: `select id, Email, First_Name, Last_Name, Full_Name, Single_Line_1, Owner, Phone, Fax, Mailing_Street, Mailing_City, Mailing_State, Mailing_Zip, Mailing_Country, WorkDrive_Link, EIN_Number from Contacts where (${whereClause}) limit 1`
    };
    
    console.log('COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    // Use the Query API endpoint
    const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
    const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
    
    console.log('COQL Response keys:', Object.keys(response));
    console.log('COQL Response data length:', response.data?.length || 0);
    
    if (response.data && response.data.length > 0) {
      const contact = response.data[0];
      console.log('Contact fields from COQL:', Object.keys(contact));
      
      // Look for account-related fields
      const accountFields = Object.keys(contact).filter(field => 
        field.toLowerCase().includes('account') || 
        field.toLowerCase().includes('connected') ||
        field.toLowerCase().includes('related')
      );
      
      console.log('Account-related fields found:', accountFields);
      
      // Process any found account fields
      const accountData = {};
      for (const field of accountFields) {
        accountData[field] = contact[field];
        console.log(`Field "${field}" value:`, contact[field]);
      }
      
      res.json({
        status: 'success',
        message: 'Contact data retrieved using COQL Query API',
        userInfo: {
          cognitoUserId: req.user.sub,
          email: req.user.email || 'not available in access token',
          username: req.user.username,
          given_name: req.user.given_name,
          family_name: req.user.family_name
        },
        searchMethod: searchField,
        searchQuery: userEmail || userCognitoId,
        contactData: contact,
        accountFields: accountFields,
        accountData: accountData,
        allFields: Object.keys(contact),
        isProtectedRoute: true,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        status: 'error',
        message: 'Contact not found using COQL Query API',
        searchQuery: userEmail || userCognitoId,
        userInfo: {
          cognitoUserId: req.user.sub,
          email: req.user.email || 'not available in access token'
        }
      });
    }
    
  } catch (error) {
    console.error('COQL Query API error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to query contact using COQL',
      error: error.response?.data || error.message,
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email || 'not available in access token'
      }
    });
  }
});

// Test COQL with specific field names for Connected Accounts (Protected)
router.get('/crm/test-connected-accounts', authenticateToken, async (req, res) => {
  try {
    // Use authenticated user's email instead of hardcoded test email
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    
    if (!userEmail && !cognitoUserId) {
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }
    
    console.log('Testing COQL with specific field names for Connected Accounts...');
    console.log('Authenticated user:', { email: userEmail, sub: cognitoUserId });
    
    // Try different possible field names for Connected Accounts
    const possibleFieldNames = [
      'Connected_Accounts',
      'Connected Accounts', 
      'connected_accounts',
      'ConnectedAccounts',
      'Account_Name',
      'Related_Accounts',
      'Accounts'
    ];
    
    const results = {};
    
    // Build where clause based on available user info
    let whereClause;
    if (userEmail) {
      whereClause = `Email = '${userEmail.replace(/'/g, "''")}'`;
    } else {
      whereClause = `Single_Line_1 = '${cognitoUserId.replace(/'/g, "''")}'`;
    }
    
    for (const fieldName of possibleFieldNames) {
      try {
        console.log(`Testing field: ${fieldName}`);
        
        // COQL query with specific field
        const coqlQuery = {
          select_query: `select ${fieldName} from Contacts where (${whereClause}) limit 1`
        };
        
        console.log(`COQL Query for ${fieldName}:`, JSON.stringify(coqlQuery, null, 2));
        
        const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
        const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
        
        if (response.data && response.data.length > 0) {
          results[fieldName] = {
            success: true,
            value: response.data[0][fieldName],
            dataType: typeof response.data[0][fieldName],
            isArray: Array.isArray(response.data[0][fieldName])
          };
          console.log(`✓ Field "${fieldName}" found:`, response.data[0][fieldName]);
        } else {
          results[fieldName] = {
            success: false,
            error: 'No data returned'
          };
          console.log(`✗ Field "${fieldName}" not found or no data`);
        }
      } catch (fieldError) {
        results[fieldName] = {
          success: false,
          error: fieldError.response?.data || fieldError.message
        };
        console.log(`✗ Field "${fieldName}" error:`, fieldError.response?.data || fieldError.message);
      }
    }
    
    // Also try to get all fields to see what's available
    try {
      console.log('Testing with all fields (*) to see complete field list...');
      const allFieldsQuery = {
        select_query: `select * from Contacts where (${whereClause}) limit 1`
      };
      
      const allFieldsUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
      const allFieldsResponse = await makeZohoAPICall(allFieldsUrl, 'POST', allFieldsQuery);
      
      if (allFieldsResponse.data && allFieldsResponse.data.length > 0) {
        const allFields = Object.keys(allFieldsResponse.data[0]);
        results.allFields = {
          success: true,
          fields: allFields,
          accountRelatedFields: allFields.filter(field => 
            field.toLowerCase().includes('account') || 
            field.toLowerCase().includes('connected') ||
            field.toLowerCase().includes('related')
          )
        };
        console.log('✓ All fields retrieved:', allFields);
        console.log('✓ Account-related fields:', results.allFields.accountRelatedFields);
      }
    } catch (allFieldsError) {
      results.allFields = {
        success: false,
        error: allFieldsError.response?.data || allFieldsError.message
      };
      console.log('✗ All fields query error:', allFieldsError.response?.data || allFieldsError.message);
    }
    
    res.json({
      status: 'success',
      message: 'COQL field testing completed',
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: userEmail || 'not available in access token',
        username: req.user.username,
        given_name: req.user.given_name,
        family_name: req.user.family_name
      },
      searchQuery: userEmail || cognitoUserId,
      results: results,
      isProtectedRoute: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('COQL field testing error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to test COQL fields',
      error: error.response?.data || error.message,
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email || 'not available in access token'
      }
    });
  }
});

// Protected route: Get user's connected accounts from linking module
router.get('/crm/my-connected-accounts-linking', authenticateToken, async (req, res) => {
  console.log('\n=== CONNECTED ACCOUNTS LINKING ROUTE DEBUGGING START ===');
  console.log('1. Route hit: /crm/my-connected-accounts-linking with authenticateToken middleware');
  console.log('2. User object from token:', JSON.stringify(req.user, null, 2));
  
  try {
    // Extract user info from authenticated token  
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    
    console.log('3. Extracted user email:', userEmail);
    console.log('3a. Extracted cognito user ID:', cognitoUserId);
    
    if (!userEmail && !cognitoUserId) {
      console.log('4. ERROR: Neither email nor Cognito User ID found in token');
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }
    
    console.log('5. Querying Accounts_X_Contacts linking module...');
    
    // Build COQL query to find account relationships for this user
    let whereClause;
    let searchField;
    
    if (userEmail) {
      whereClause = `Email = '${userEmail.replace(/'/g, "''")}'`;
      searchField = 'email';
      console.log('6. Using email search for ID token');
    } else {
      // For access tokens, we need to get the email from the contact first
      console.log('6. Using Cognito User ID, need to get email from contact first');
      
      // First get the contact to find the email
      const contactQuery = {
        select_query: `select Email from Contacts where Single_Line_1 = '${cognitoUserId.replace(/'/g, "''")}' limit 1`
      };
      
      const contactUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
      const contactResponse = await makeZohoAPICall(contactUrl, 'POST', contactQuery);
      
      if (!contactResponse.data || contactResponse.data.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Contact not found for Cognito User ID',
          searchQuery: cognitoUserId
        });
      }
      
      const contactEmail = contactResponse.data[0].Email;
      if (!contactEmail) {
        return res.status(404).json({
          status: 'error',
          message: 'Contact found but no email available',
          searchQuery: cognitoUserId
        });
      }
      
      whereClause = `Email = '${contactEmail.replace(/'/g, "''")}'`;
      searchField = 'cognito_user_id';
      console.log('6a. Found contact email:', contactEmail);
    }
    
    // Query the Accounts_X_Contacts linking module
    const coqlQuery = {
      select_query: `select Name, Email, Owner, Modified_Time from Accounts_X_Contacts where (${whereClause}) limit 50`
    };
    
    console.log('7. COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
    const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
    
    console.log('8. COQL Response received. Data length:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No connected accounts found in linking module',
        searchQuery: userEmail || cognitoUserId,
        userInfo: {
          cognitoUserId: cognitoUserId,
          email: userEmail || 'retrieved from contact'
        }
      });
    }
    
    const relationships = response.data;
    console.log('9. Found relationships:', relationships.length);
    
    // Process the relationships to get account details
    const connectedAccounts = [];
    
    for (const relationship of relationships) {
      try {
        console.log(`10. Processing relationship: ${relationship.Name}`);
        
        // The Name field might contain account information
        // Let's also try to get more details if possible
        const accountData = {
          relationshipId: relationship.id,
          relationshipName: relationship.Name,
          contactEmail: relationship.Email,
          owner: relationship.Owner,
          modifiedTime: relationship.Modified_Time,
          // Try to extract account info from the relationship name
          accountName: relationship.Name,
          accountType: 'Connected Account' // Default type
        };
        
        connectedAccounts.push(accountData);
        console.log(`11. Added account: ${accountData.accountName}`);
        
      } catch (accountError) {
        console.log(`Error processing account relationship:`, accountError.response?.data || accountError.message);
      }
    }
    
    const finalResponse = {
      status: 'success',
      message: 'Connected accounts retrieved from linking module',
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: userEmail || 'retrieved from contact',
        username: req.user.username,
        given_name: req.user.given_name,
        family_name: req.user.family_name
      },
      searchMethod: searchField,
      searchQuery: userEmail || cognitoUserId,
      totalRelationships: relationships.length,
      connectedAccounts: connectedAccounts,
      rawRelationships: relationships, // Include raw data for debugging
      isProtectedRoute: true,
      timestamp: new Date().toISOString()
    };
    
    console.log('12. Final response prepared:', JSON.stringify(finalResponse, null, 2));
    console.log('=== CONNECTED ACCOUNTS LINKING ROUTE DEBUGGING END ===\n');
    
    res.json(finalResponse);

  } catch (error) {
    console.log('\n=== CONNECTED ACCOUNTS LINKING ROUTE ERROR DEBUGGING ===');
    console.error('ERROR in connected accounts linking route:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
      console.error('Error response data:', error.response.data);
    }
    
    if (error.request) {
      console.error('Error request:', error.request);
    }
    
    console.log('=== CONNECTED ACCOUNTS LINKING ROUTE ERROR DEBUGGING END ===\n');
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get connected accounts from linking module',
      searchQuery: req.user?.email || req.user?.sub,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      },
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email
      }
    });
  }
});

// Protected route: Get logged-in user's CRM contact data using COQL
router.get('/crm/my-contact-coql', authenticateToken, async (req, res) => {
  console.log('\n=== COQL PROTECTED ROUTE DEBUGGING START ===');
  console.log('1. Route hit: /crm/my-contact-coql with authenticateToken middleware');
  console.log('2. User object from token:', JSON.stringify(req.user, null, 2));
  
  try {
    // Extract user info from authenticated token  
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    
    console.log('3. Extracted user email:', userEmail);
    console.log('3a. Extracted cognito user ID:', cognitoUserId);
    
    // Build COQL query based on available parameters
    let whereClause;
    let searchField;
    
    if (userEmail) {
      whereClause = `Email = '${userEmail.replace(/'/g, "''")}'`;
      searchField = 'email';
      console.log('4. Using email search for ID token');
    } else if (cognitoUserId) {
      whereClause = `Single_Line_1 = '${cognitoUserId.replace(/'/g, "''")}'`;
      searchField = 'cognito_user_id';
      console.log('4. Using Cognito User ID search for access token');
    } else {
      console.log('4. ERROR: Neither email nor Cognito User ID found in token');
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }
    
    console.log('5. Building COQL query...');
    
    // COQL query to get contact with specific fields including Multi-Select-Lookup
    const coqlQuery = {
      select_query: `select id, Email, First_Name, Last_Name, Full_Name, Single_Line_1, Owner, Phone, Fax, Mailing_Street, Mailing_City, Mailing_State, Mailing_Zip, Mailing_Country, WorkDrive_Link, EIN_Number from Contacts where (${whereClause}) limit 1`
    };
    
    console.log('6. COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    // Use the Query API endpoint
    const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
    const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
    
    console.log('7. COQL Response received. Data length:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Contact not found using COQL Query API',
        searchQuery: userEmail || cognitoUserId
      });
    }
    
    const contact = response.data[0];
    console.log('8. Contact fields from COQL:', Object.keys(contact));
    
    // Look for account-related fields
    const accountFields = Object.keys(contact).filter(field => 
      field.toLowerCase().includes('account') || 
      field.toLowerCase().includes('connected') ||
      field.toLowerCase().includes('related')
    );
    
    console.log('9. Account-related fields found:', accountFields);
    
    // Process any found account fields
    const accountData = {};
    for (const field of accountFields) {
      accountData[field] = contact[field];
      console.log(`10. Field "${field}" value:`, contact[field]);
    }
    
    const finalResponse = {
      status: 'success',
      message: 'User contact data retrieved successfully using COQL (protected route)',
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: userEmail || 'not available in access token',
        username: req.user.username,
        given_name: req.user.given_name,
        family_name: req.user.family_name
      },
      searchMethod: searchField,
      searchQuery: userEmail || cognitoUserId,
      contactData: contact,
      accountFields: accountFields,
      accountData: accountData,
      allFields: Object.keys(contact),
      isProtectedRoute: true,
      timestamp: new Date().toISOString()
    };
    
    console.log('11. Final response prepared:', JSON.stringify(finalResponse, null, 2));
    console.log('=== COQL PROTECTED ROUTE DEBUGGING END ===\n');
    
    res.json(finalResponse);

  } catch (error) {
    console.log('\n=== COQL PROTECTED ROUTE ERROR DEBUGGING ===');
    console.error('ERROR in COQL protected route:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
      console.error('Error response data:', error.response.data);
    }
    
    if (error.request) {
      console.error('Error request:', error.request);
    }
    
    console.log('=== COQL PROTECTED ROUTE ERROR DEBUGGING END ===\n');
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user contact data using COQL (protected route)',
      searchQuery: req.user?.email || req.user?.sub,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      },
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email
      }
    });
  }
});

// Protected route: Get logged-in user's CRM contact data
router.get('/crm/my-contact', authenticateToken, async (req, res) => {
  console.log('\n=== PROTECTED ROUTE DEBUGGING START ===');
  console.log('1. Route hit: /crm/my-contact with authenticateToken middleware');
  console.log('2. Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('3. User object from token:', JSON.stringify(req.user, null, 2));
  
  try {
    // Extract user info from authenticated token  
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    
    console.log('4. Extracted user email:', userEmail);
    console.log('4a. Extracted cognito user ID:', cognitoUserId);
    
    // For access tokens, we don't have email but we have the Cognito User ID
    // We can search by Single_Line_1 field which contains the Cognito User ID
    let searchCriteria;
    let searchField;
    
    if (userEmail) {
      // Use email if available (ID token)
      searchCriteria = `(Email:equals:${encodeURIComponent(userEmail)})`;
      searchField = 'email';
      console.log('5. Using email search for ID token');
    } else if (cognitoUserId) {
      // Use Cognito User ID if email not available (access token)
      searchCriteria = `(Single_Line_1:equals:${encodeURIComponent(cognitoUserId)})`;
      searchField = 'cognito_user_id';
      console.log('5. Using Cognito User ID search for access token');
    } else {
      console.log('5. ERROR: Neither email nor Cognito User ID found in token');
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }

    console.log('6. Making Zoho API call with automatic token refresh...');
    
    // Use makeZohoAPICall for automatic token refresh
    const directZohoUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=${searchCriteria}`;
    console.log('7. TESTING: Zoho URL:', directZohoUrl);
    console.log('8. TESTING: Search field:', searchField);
    console.log('9. TESTING: Using access token ending in:', ZOHO_CONFIG.accessToken?.slice(-10));
    
    const responseData = await makeZohoAPICall(directZohoUrl);
    
    console.log('10. TESTING: Zoho API call successful!');
    
    // Transform the response into our protected route format
    const finalResponse = {
      status: 'success',
      message: 'User contact data retrieved successfully (protected route)',
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: userEmail || 'not available in access token',
        username: req.user.username,
        given_name: req.user.given_name,
        family_name: req.user.family_name
      },
      searchMethod: searchField,
      searchQuery: userEmail || cognitoUserId,
      data: responseData.data || [],
      info: responseData.info || {},
      contactData: responseData.data && responseData.data.length > 0 ? responseData.data[0] : null,
      workdriveFolder: responseData.data && responseData.data.length > 0 ? responseData.data[0].WorkDrive_Link : null,
      isProtectedRoute: true,
      timestamp: new Date().toISOString()
    };
    
    console.log('9. Final response prepared:', JSON.stringify(finalResponse, null, 2));
    console.log('=== PROTECTED ROUTE DEBUGGING END ===\n');
    
    res.json(finalResponse);

  } catch (error) {
    console.log('\n=== PROTECTED ROUTE ERROR DEBUGGING ===');
    console.error('ERROR in protected route:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
      console.error('Error response data:', error.response.data);
    }
    
    if (error.request) {
      console.error('Error request:', error.request);
    }
    
    console.log('=== PROTECTED ROUTE ERROR DEBUGGING END ===\n');
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user contact data (protected route)',
      searchQuery: req.user?.email,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      },
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email
      }
    });
  }
});

// Simple test route
router.get('/crm/my-contact-test', authenticateToken, async (req, res) => {
  console.log('TEST ROUTE HIT - DEBUGGING IS WORKING!');
  res.json({ message: 'Test route working', user: req.user.email });
});

// Protected route: Browse files in a specific folder
router.get('/workdrive/browse/:folderId', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    const { folderId } = req.params;
    
    // Use email if available (ID token), otherwise use Cognito User ID (access token)
    const userIdentifier = userEmail || cognitoUserId;
    
    if (!userIdentifier) {
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }

    if (!folderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Folder ID is required'
      });
    }

    // Verify user has access to their Workdrive folder (security check)
    const { folderId: userMainFolderId, contactData } = await getUserWorkdriveFolderId(userIdentifier);
    
    console.log(`Browsing folder: ${folderId} for user: ${contactData.Full_Name}`);

    // Get files from the specified folder
    const browseUrl = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/files`;
    const browseResponse = await makeZohoAPICall(browseUrl);
    
    res.json({
      status: 'success',
      message: 'Folder contents retrieved successfully',
      userInfo: {
        cognitoUserId: cognitoUserId,
        contactName: contactData.Full_Name,
        contactId: contactData.id
      },
      folderInfo: {
        requestedFolderId: folderId,
        userMainFolderId: userMainFolderId
      },
      files: browseResponse.data || [],
      totalFiles: browseResponse.data?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error browsing folder:', error.response?.data || error.message);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to browse folder contents',
      folderId: req.params.folderId,
      error: error.response?.data || error.message
    });
  }
});

// Diagnostic route: Check Zoho API permissions and configuration
router.get('/workdrive/diagnostics', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const cognitoUserId = req.user.sub;
    
    // Use email if available (ID token), otherwise use Cognito User ID (access token)
    const userIdentifier = userEmail || cognitoUserId;
    
    if (!userIdentifier) {
      return res.status(400).json({
        status: 'error',
        message: 'User identification not found in token'
      });
    }

    // Get user's Workdrive folder ID from their CRM contact
    const { folderId, contactData } = await getUserWorkdriveFolderId(userIdentifier);
    
    console.log(`Running WorkDrive diagnostics for user: ${contactData.Full_Name}`);

    const diagnostics = {
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: userEmail || 'Not available in access token',
        contactName: contactData.Full_Name
      },
      workdriveConfig: {
        baseUrl: ZOHO_CONFIG.baseUrlWorkdrive,
        userFolderId: folderId,
        userFolderLink: contactData.WorkDrive_Link
      },
      apiEndpoints: {
        listFiles: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/files`,
        downloadFile: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/{fileId}/download`,
        uploadFile: `${ZOHO_CONFIG.baseUrlWorkdrive}/upload`,
        createFolder: `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/folder`
      },
      testResults: {}
    };

    // Test 1: List files (this usually works)
    try {
      const listResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/files`);
      diagnostics.testResults.listFiles = {
        status: 'success',
        fileCount: listResponse.data?.length || 0,
        message: 'File listing is available'
      };
    } catch (listError) {
      diagnostics.testResults.listFiles = {
        status: 'error',
        error: listError.response?.data || listError.message,
        message: 'File listing failed'
      };
    }

    // Test 2: Check if we can get file info (instead of direct download)
    if (diagnostics.testResults.listFiles.status === 'success' && diagnostics.testResults.listFiles.fileCount > 0) {
      try {
        // Get the first file's info for testing
        const filesResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/files`);
        if (filesResponse.data && filesResponse.data.length > 0) {
          const firstFileId = filesResponse.data[0].id;
          const fileInfoResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/files/${firstFileId}`);
          diagnostics.testResults.fileInfo = {
            status: 'success',
            testedFileId: firstFileId,
            message: 'File metadata retrieval is available'
          };
        }
      } catch (infoError) {
        diagnostics.testResults.fileInfo = {
          status: 'error',
          error: infoError.response?.data || infoError.message,
          message: 'File metadata retrieval failed'
        };
      }
    }

    // Test 3: Check download capability (will likely fail with F6016)
    try {
      // Just test the endpoint structure, don't actually download
      const downloadTestUrl = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/test/download`;
      diagnostics.testResults.downloadCapability = {
        status: 'not_tested',
        message: 'Download test skipped to avoid F6016 error',
        expectedError: 'F6016 - URL Rule is not configured',
        workaround: 'Use file info and direct WorkDrive URLs instead'
      };
    } catch (downloadError) {
      diagnostics.testResults.downloadCapability = {
        status: 'error',
        error: downloadError.response?.data || downloadError.message
      };
    }

    res.json({
      status: 'success',
      message: 'WorkDrive diagnostics completed',
      diagnostics: diagnostics,
      recommendations: {
        workingFeatures: [
          'File listing and browsing',
          'File metadata retrieval',
          'Direct WorkDrive URL access'
        ],
        limitedFeatures: [
          'Direct file downloads via API',
          'Folder creation via API',
          'File uploads via API'
        ],
        solutions: [
          'Use direct WorkDrive URLs for file access',
          'Implement client-side download using WorkDrive web interface',
          'Contact Zoho administrator to configure additional API permissions'
        ]
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error running diagnostics:', error.response?.data || error.message);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to run WorkDrive diagnostics',
      error: error.response?.data || error.message
    });
  }
});

// === TEST ENDPOINTS (NO AUTH REQUIRED) ===

// Test Accounts module COQL query without authentication
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

// Test specific contact's connected accounts without authentication
router.get('/test/connected-accounts/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log(`=== TESTING CONNECTED ACCOUNTS FOR EMAIL: ${email} ===`);
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }
    
    // Query the linking module for this specific contact
    const coqlQuery = {
      select_query: `select Accounts.Account_Name, Accounts.Account_Type, Accounts.Phone, Accounts.TIN, Accounts.Client_ID, Accounts.Tag, Contacts.Email, Contacts.Full_Name from Accounts_X_Contacts where Contacts.Email = '${email.replace(/'/g, "''")}' limit 50`
    };
    
    console.log('COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    const queryUrl = `${ZOHO_CONFIG.baseUrlCRM}/coql`;
    const response = await makeZohoAPICall(queryUrl, 'POST', coqlQuery);
    
    console.log('COQL Response received. Data length:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No connected accounts found for this email',
        searchEmail: email,
        totalRelationships: 0,
        relationships: [],
        coqlQuery: coqlQuery
      });
    }
    
    const relationships = response.data;
    const connectedAccounts = relationships.map(relationship => ({
      accountName: relationship.Accounts?.Account_Name || 'Unknown Account',
      accountType: relationship.Accounts?.Account_Type || 'Unknown Type',
      accountPhone: relationship.Accounts?.Phone,
      accountTIN: relationship.Accounts?.TIN,
      accountClientID: relationship.Accounts?.Client_ID,
      accountTag: relationship.Accounts?.Tag,
      contactEmail: relationship.Contacts?.Email,
      contactFullName: relationship.Contacts?.Full_Name
    }));
    
    res.json({
      status: 'success',
      message: 'Connected accounts found',
      searchEmail: email,
      totalRelationships: relationships.length,
      connectedAccounts: connectedAccounts,
      rawRelationships: relationships,
      coqlQuery: coqlQuery,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Test connected accounts error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Test connected accounts failed',
      searchEmail: req.params.email,
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

// Test route to specifically look for Connected_Accounts field (hardcoded email)
router.get('/test/connected-accounts-omer', async (req, res) => {
  try {
    const testEmail = 'omer@it4u.dev';
    
    console.log(`=== TESTING CONNECTED_ACCOUNTS FIELD FOR: ${testEmail} ===`);
    
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
        connectedAccountsField: null,
        timestamp: new Date().toISOString()
      });
    }
    
    const contactData = response.data[0];
    
    // Look for Connected_Accounts field specifically
    const connectedAccountsField = contactData.Connected_Accounts || contactData.Connected_Accounts || contactData.connected_accounts || contactData['Connected Accounts'];
    
    // Also look for any field that might contain "connected" or "account"
    const connectedRelatedFields = Object.keys(contactData).filter(field => 
      field.toLowerCase().includes('connected') || 
      field.toLowerCase().includes('account') ||
      field.toLowerCase().includes('related')
    );
    
    // Get the values of these fields
    const connectedFieldValues = {};
    connectedRelatedFields.forEach(field => {
      connectedFieldValues[field] = contactData[field];
    });
    
    res.json({
      status: 'success',
      message: 'Connected_Accounts field analysis completed',
      searchEmail: testEmail,
      contactId: contactData.id,
      contactName: contactData.Full_Name || contactData.Name,
      connectedAccountsField: {
        value: connectedAccountsField,
        fieldType: typeof connectedAccountsField,
        isArray: Array.isArray(connectedAccountsField),
        isNull: connectedAccountsField === null,
        isUndefined: connectedAccountsField === undefined
      },
      connectedRelatedFields: connectedRelatedFields,
      connectedFieldValues: connectedFieldValues,
      allFields: Object.keys(contactData),
      fullContactData: contactData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Test Connected_Accounts error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Test Connected_Accounts failed',
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

// Test route to find all accounts linked to a specific contact
router.get('/test/linked-accounts/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log(`=== FINDING LINKED ACCOUNTS FOR CONTACT: ${email} ===`);
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }
    
    // Step 1: Find the contact by email
    console.log('Step 1: Finding contact by email...');
    const contactSearchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:equals:${encodeURIComponent(email)})`;
    
    const contactResponse = await makeZohoAPICall(contactSearchUrl);
    
    if (!contactResponse.data || contactResponse.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'Contact not found',
        searchEmail: email,
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    const contact = contactResponse.data[0];
    console.log('Contact found:', { id: contact.id, name: contact.Full_Name, email: contact.Email });
    
    // Step 2: Get the Connected_Accounts field values (these are junction table record IDs)
    const connectedAccountsIds = contact.Connected_Accounts;
    
    if (!connectedAccountsIds || connectedAccountsIds.length === 0) {
      return res.json({
        status: 'success',
        message: 'No linked accounts found',
        searchEmail: email,
        contact: {
          id: contact.id,
          name: contact.Full_Name,
          email: contact.Email
        },
        connectedAccountsIds: [],
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('Connected Accounts IDs found:', connectedAccountsIds);
    
    // Step 3: Query the junction table to get account details
    console.log('Step 2: Querying junction table for account details...');
    
    // Build COQL query to get junction records with account details
    const junctionIds = connectedAccountsIds.map(id => `'${id}'`).join(',');
    const coqlQuery = {
      select_query: `select id, Shareholder_List, Connected_Accounts, Created_Time, Modified_Time from Accounts_X_Contacts where id in (${junctionIds})`
    };
    
    console.log('COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    const junctionResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('Junction records found:', junctionResponse.data?.length || 0);
    
    // Step 4: Extract account IDs and get full account details
    const accountIds = [];
    const junctionRecords = junctionResponse.data || [];
    
    junctionRecords.forEach(record => {
      if (record.Shareholder_List && record.Shareholder_List.id) {
        accountIds.push(record.Shareholder_List.id);
      }
    });
    
    console.log('Account IDs extracted:', accountIds);
    
    if (accountIds.length === 0) {
      return res.json({
        status: 'success',
        message: 'No account details found in junction table',
        searchEmail: email,
        contact: {
          id: contact.id,
          name: contact.Full_Name,
          email: contact.Email
        },
        connectedAccountsIds: connectedAccountsIds,
        junctionRecords: junctionRecords,
        accountIds: [],
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Step 5: Get full account details
    console.log('Step 3: Getting full account details...');
    const accountIdsString = accountIds.map(id => `'${id}'`).join(',');
    const accountQuery = {
      select_query: `select id, Account_Name, Account_Number, Account_Type, Industry, Billing_Street, Billing_City, Billing_State, Billing_Code, Billing_Country, Phone, Fax, Website, Description, Owner, Created_Time, Modified_Time from Accounts where id in (${accountIdsString})`
    };
    
    console.log('Account COQL Query:', JSON.stringify(accountQuery, null, 2));
    
    const accountsResponse = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', accountQuery);
    
    console.log('Full account details retrieved:', accountsResponse.data?.length || 0);
    
    res.json({
      status: 'success',
      message: 'Linked accounts retrieved successfully',
      searchEmail: email,
      contact: {
        id: contact.id,
        name: contact.Full_Name,
        email: contact.Email,
        connectedAccountsField: contact.Connected_Accounts
      },
      relationshipAnalysis: {
        connectedAccountsIds: connectedAccountsIds,
        junctionRecordsFound: junctionRecords.length,
        accountIdsExtracted: accountIds,
        fullAccountsRetrieved: accountsResponse.data?.length || 0
      },
      junctionRecords: junctionRecords.map(record => ({
        junctionId: record.id,
        accountId: record.Shareholder_List?.id,
        contactId: record.Connected_Accounts?.id,
        createdTime: record.Created_Time,
        modifiedTime: record.Modified_Time
      })),
      linkedAccounts: accountsResponse.data || [],
      rawData: {
        contactResponse: contactResponse,
        junctionResponse: junctionResponse,
        accountsResponse: accountsResponse
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Linked accounts error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get linked accounts',
      searchEmail: req.params.email,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Test route to find linked accounts using COQL with linking module
router.get('/test/linked-accounts-coql/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log(`=== FINDING LINKED ACCOUNTS VIA COQL FOR: ${email} ===`);
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }
    
    // COQL query using correct lookup field names
    const coqlQuery = {
      select_query: `select id, Connected_Accounts.Account_Name, Shareholder_List.Full_Name from Accounts_X_Contacts where Connected_Accounts is not null limit 10`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('COQL Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No records found in linking module',
        searchEmail: email,
        coqlQuery: coqlQuery.select_query,
        linkedAccounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Process the results
    const linkedAccounts = response.data.map(record => ({
      relationshipId: record.id,
      accountName: record.account_name
    }));
    
    res.json({
      status: 'success',
      message: 'Linking module records retrieved successfully',
      searchEmail: email,
      coqlQuery: coqlQuery.select_query,
      totalRecords: response.data.length,
      linkedAccounts: linkedAccounts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Linked accounts COQL error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get linked accounts via COQL',
      searchEmail: req.params.email,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Alternative approach: Query all relationships in the linking module
router.get('/test/all-relationships', async (req, res) => {
  try {
    console.log('=== GETTING ALL RELATIONSHIPS IN ACCOUNTS_X_CONTACTS ===');
    
    // Get all records from the linking module to see what relationships exist
    const coqlQuery = {
      select_query: `select id, Shareholder_List.Account_Name as account_name, Connected_Accounts.Email as contact_email, Connected_Accounts.Full_Name as contact_name, Created_Time, Modified_Time from Accounts_X_Contacts limit 50`
    };
    
    console.log('COQL Query:', JSON.stringify(coqlQuery, null, 2));
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('COQL Response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No relationships found in linking module',
        totalRelationships: 0,
        relationships: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Group by contact email to see which contacts have relationships
    const relationshipsByContact = {};
    response.data.forEach(record => {
      const contactEmail = record.contact_email;
      if (!relationshipsByContact[contactEmail]) {
        relationshipsByContact[contactEmail] = [];
      }
      relationshipsByContact[contactEmail].push({
        relationshipId: record.id,
        accountName: record.account_name,
        contactName: record.contact_name,
        createdTime: record.Created_Time,
        modifiedTime: record.Modified_Time
      });
    });
    
    res.json({
      status: 'success',
      message: 'All relationships retrieved successfully',
      totalRelationships: response.data.length,
      uniqueContacts: Object.keys(relationshipsByContact).length,
      relationshipsByContact: relationshipsByContact,
      allRelationships: response.data,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('All relationships error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get all relationships',
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

export default router;