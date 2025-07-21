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
const makeZohoAPICall = async (url, method = 'GET', data = null, retryCount = 0, isWorkDrive = false) => {
  try {
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    // Add WorkDrive specific headers if needed
    if (isWorkDrive) {
      config.headers['Accept'] = 'application/vnd.api+json';
    }

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
      return makeZohoAPICall(url, method, data, 1, isWorkDrive);
    }
    
    throw error;
  }
};

// === PROTECTED ROUTES (MUST COME BEFORE CATCH-ALL) ===

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


// === TEST ENDPOINTS (NO AUTH REQUIRED) ===


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


// Test route to find linked accounts by Cognito ID
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

    // Updated COQL query with explicit fields from Connected_Accounts
    const coqlQuery = {
      select_query: `
        SELECT 
          id, 
          Connected_Accounts.id, 
          Connected_Accounts.Account_Name, 
          Connected_Accounts.Account_Number, 
          Connected_Accounts.Account_Type, 
          Connected_Accounts.Industry, 
          Shareholder_List.Full_Name, 
          Shareholder_List.Email, 
          Shareholder_List.Phone, 
          Shareholder_List.Single_Line_1 
        FROM Accounts_X_Contacts 
        WHERE Shareholder_List.Single_Line_1 = '${cognitoId}'
      `
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

    // Map response using the flattened field names
    const linkedAccounts = response.data.map(record => ({
      relationshipId: record.id,
      accountId: record["Connected_Accounts.id"],
      accountName: record["Connected_Accounts.Account_Name"],
      accountNumber: record["Connected_Accounts.Account_Number"],
      accountType: record["Connected_Accounts.Account_Type"],
      industry: record["Connected_Accounts.Industry"],
      contactName: record["Shareholder_List.Full_Name"],
      contactEmail: record["Shareholder_List.Email"],
      contactPhone: record["Shareholder_List.Phone"],
      cognitoId: record["Shareholder_List.Single_Line_1"]
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


// Route to get full account details for linked accounts
router.get('/account-details/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    console.log(`=== GETTING FULL ACCOUNT DETAILS FOR: ${accountId} ===`);
    
    if (!accountId) {
      return res.status(400).json({
        status: 'error',
        message: 'Account ID parameter is required'
      });
    }
    
    // Get full account details using COQL
    const coqlQuery = {
      select_query: `select id, Account_Name, Account_Number, Account_Type, Industry, Billing_Street, Billing_City, Billing_State, Billing_Code, Billing_Country, Phone, Fax, Website, Description, Owner, Created_Time, Modified_Time, Tag, TIN, Client_ID, easyworkdriveforcrm__Workdrive_Folder_ID_EXT from Accounts where id = '${accountId}'`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('Account details response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'Account not found',
        searchAccountId: accountId,
        accountDetails: null,
        timestamp: new Date().toISOString()
      });
    }
    
    const accountDetails = response.data[0];
    
    res.json({
      status: 'success',
      message: 'Account details retrieved successfully',
      searchAccountId: accountId,
      accountDetails: {
        id: accountDetails.id,
        accountName: accountDetails.Account_Name,
        accountNumber: accountDetails.Account_Number,
        accountType: accountDetails.Account_Type,
        industry: accountDetails.Industry,
        billingAddress: {
          street: accountDetails.Billing_Street,
          city: accountDetails.Billing_City,
          state: accountDetails.Billing_State,
          code: accountDetails.Billing_Code,
          country: accountDetails.Billing_Country
        },
        contactInfo: {
          phone: accountDetails.Phone,
          fax: accountDetails.Fax,
          website: accountDetails.Website
        },
        description: accountDetails.Description,
        owner: accountDetails.Owner,
        tag: accountDetails.Tag,
        tin: accountDetails.TIN,
        clientId: accountDetails.Client_ID,
        workdriveFolderId: accountDetails.easyworkdriveforcrm__Workdrive_Folder_ID_EXT,
        timestamps: {
          created: accountDetails.Created_Time,
          modified: accountDetails.Modified_Time
        }
      },
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Account details error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get account details',
      searchAccountId: req.params.accountId,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Route to get multiple account details by IDs
router.post('/accounts-details', async (req, res) => {
  try {
    const { accountIds } = req.body;
    
    console.log(`=== GETTING MULTIPLE ACCOUNT DETAILS ===`);
    console.log('Account IDs:', accountIds);
    
    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Account IDs array is required'
      });
    }
    
    // Build COQL query for multiple accounts
    const accountIdsString = accountIds.map(id => `'${id}'`).join(',');
    const coqlQuery = {
      select_query: `select id, Account_Name, Account_Number, Account_Type, Industry, Billing_Street, Billing_City, Billing_State, Billing_Code, Billing_Country, Phone, Fax, Website, Description, Owner, Created_Time, Modified_Time, Tag, TIN, Client_ID, easyworkdriveforcrm__Workdrive_Folder_ID_EXT from Accounts where id in (${accountIdsString})`
    };
    
    console.log('COQL Query:', coqlQuery.select_query);
    
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    
    console.log('Multiple accounts response received. Records found:', response.data?.length || 0);
    
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No accounts found',
        requestedAccountIds: accountIds,
        accounts: [],
        timestamp: new Date().toISOString()
      });
    }
    
    // Process the results
    const accounts = response.data.map(account => ({
      id: account.id,
      accountName: account.Account_Name,
      accountNumber: account.Account_Number,
      accountType: account.Account_Type,
      industry: account.Industry,
      billingAddress: {
        street: account.Billing_Street,
        city: account.Billing_City,
        state: account.Billing_State,
        code: account.Billing_Code,
        country: account.Billing_Country
      },
      contactInfo: {
        phone: account.Phone,
        fax: account.Fax,
        website: account.Website
      },
      description: account.Description,
      owner: account.Owner,
      tag: account.Tag,
      tin: account.TIN,
      clientId: account.Client_ID,
      workdriveFolderId: account.easyworkdriveforcrm__Workdrive_Folder_ID_EXT,
      timestamps: {
        created: account.Created_Time,
        modified: account.Modified_Time
      }
    }));
    
    res.json({
      status: 'success',
      message: 'Multiple account details retrieved successfully',
      requestedAccountIds: accountIds,
      totalAccountsFound: accounts.length,
      accounts,
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Multiple accounts details error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get multiple account details',
      requestedAccountIds: req.body.accountIds,
      error: error.response?.data || error.message,
      errorDetails: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
});

// Route to get Workdrive folder links and parsed folder IDs for accounts
router.post('/accounts-workdrive-folders', async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Account IDs array is required'
      });
    }

    // Build COQL query for multiple accounts (reuse the same as /accounts-details)
    const accountIdsString = accountIds.map(id => `'${id}'`).join(',');
    const coqlQuery = {
      select_query: `select id, easyworkdriveforcrm__Workdrive_Folder_ID_EXT from Accounts where id in (${accountIdsString})`
    };

    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
    if (!response.data || response.data.length === 0) {
      return res.json({
        status: 'success',
        message: 'No accounts found',
        requestedAccountIds: accountIds,
        accounts: [],
        timestamp: new Date().toISOString()
      });
    }

    // Parse the folder ID from the link
    const accounts = response.data.map(account => {
      const link = account.easyworkdriveforcrm__Workdrive_Folder_ID_EXT;
      let folderId = null;
      if (typeof link === 'string' && link.includes('/')) {
        folderId = link.split('/').pop();
      }
      return {
        accountId: account.id,
        workdriveFolderLink: link,
        workdriveFolderId: folderId
      };
    });

    res.json({
      status: 'success',
      message: 'Workdrive folder links and IDs retrieved successfully',
      requestedAccountIds: accountIds,
      accounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Accounts Workdrive folders error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get Workdrive folder links and IDs',
      error: error.response?.data || error.message,
      errorDetails: error
    });
  }
});


// === WORKDRIVE FOLDER TRAVERSAL ROUTES ===

// 1. List contents of a WorkDrive folder by folder ID
router.get('/workdrive/folder/:folderId/contents', async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!folderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Folder ID is required'
      });
    }
    

    
    // Use the correct WorkDrive API endpoint for folder contents
    const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/files?folder_id=${folderId}`;
    const response = await makeZohoAPICall(url, 'GET', null, 0, true);
    res.json({
      status: 'success',
      folderId,
      files: response.data || [],
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('WorkDrive folder contents error:', error.response?.data || error.message);
    
    // Check for OAuth scope issues
    if (error?.response?.data?.errors?.[0]?.id === 'F7003') {
      return res.status(401).json({
        status: 'error',
        message: 'WorkDrive API access requires different OAuth scopes',
        requiredScopes: [
          'WorkDrive.Files.ALL',
          'WorkDrive.Folders.ALL'
        ],
        instructions: [
          '1. Go to https://api-console.zoho.com/',
          '2. Create a new Self-Client with WorkDrive scopes',
          '3. Generate tokens with WorkDrive permissions',
          '4. Update your environment variables with the new tokens'
        ],
        folderId: req.params.folderId,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get WorkDrive folder contents',
      error: error.response?.data || error.message
    });
  }
});

// 2. Get metadata for a WorkDrive file or folder by ID
router.get('/workdrive/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({
        status: 'error',
        message: 'File or Folder ID is required'
      });
    }
    const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${fileId}`;
    const response = await makeZohoAPICall(url, 'GET', null, 0, true);
    res.json({
      status: 'success',
      fileId,
      metadata: response.data || {},
      rawResponse: response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('WorkDrive file metadata error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get WorkDrive file/folder metadata',
      error: error.response?.data || error.message
    });
  }
});

export default router;