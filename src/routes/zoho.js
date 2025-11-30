import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.js';
import FormData from 'form-data';
import stringSimilarity from "string-similarity";
import multer from "multer";
import db from '../adapter/pgsql.js';
import PgHelper from '../utils/pgHelpers.js';

const storage = multer.memoryStorage();
const upload = multer({ storage });

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
    console.log("response.data.access_token ,", response.data.access_token)
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
const makeZohoAPICall = async (url, method = 'GET', data = null, retryCount = 0, isWorkDrive = false, headers = null, isUpload = false) => {
  try {
      const config = { method, url, headers: {} };

          config.headers['Authorization'] = `Zoho-oauthtoken ${ZOHO_CONFIG.accessToken}`;
         
          if (isUpload && data instanceof FormData) {
            config.headers = { ...config.headers, ...data.getHeaders() };
            config.data = data;
          } else {
            config.headers['Content-Type'] = 'application/json';
            if (isWorkDrive) {
              config.headers['Accept'] = 'application/vnd.api+json';
            }
            if (headers) Object.assign(config.headers, headers);
            if (data) config.data = data;
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
      return makeZohoAPICall(url, method, data, 1, isWorkDrive , headers, isUpload );
    }

    console.log('Error response data:', JSON.stringify(error.response?.data, null, 2));
    // return error
    throw error;
  }
};


export async function getFolderByName(parentId, folderName , matchFolder = true) {
   const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${parentId}/files`;
  const response = await makeZohoAPICall(url, "GET", null, 0, true);

  if (!response?.data || response.data.length === 0) return null;
    console.log("parent_id", parentId);
  const folders = response.data.filter(f => f?.attributes?.type === "folder" && f?.attributes?.name);
  if (folders.length === 0) {
    console.log("No folders found under parentId:", parentId);
    return null;
  }
  if(matchFolder){
    const bestMatch = stringSimilarity.findBestMatch(folderName.toLowerCase(), folders.map(f => f.attributes.name.toLowerCase()));
    console.log("bestMatch", bestMatch);

    const matchedFolder = folders.find(f => f.attributes.name.toLowerCase().includes(bestMatch.bestMatch.target.toLowerCase()));
    console.log("matchedFolder", matchedFolder);
    return matchedFolder || null;
  } else {
     return response.data.find(f => f?.attributes?.type === "folder" && f?.attributes?.name === folderName) || null; 
  }
  
}

// Create a folder under parent
export async function createFolder(parentId, folderName) {
  const data = {
    data: {
      type: "files",
      attributes: {
        name: folderName,
        parent_id: parentId
      }
    }
  };
  try {
    const response = await makeZohoAPICall( `${ZOHO_CONFIG.baseUrlWorkdrive}/files`,'POST',data,0,true);
    return response.data;
  } catch (err) {
    console.error('Failed to create folder:', err.response?.data || err.message);
    throw err;
  }
}

// Upload file to folder
export async function uploadFile(folderId, fileBuffer, filename, override = 'true') {

  const formData = new FormData();
  formData.append('content', fileBuffer, { filename });
  formData.append('parent_id', folderId);
  formData.append('override-name-exist', override);
  formData.append('filename', encodeURIComponent(filename));
  const headers = {
      ...formData.getHeaders(), 
  };
  const url =  `${ZOHO_CONFIG.baseUrlWorkdrive}/upload`;
  const res =  await makeZohoAPICall(url, 'POST', formData, 1, true , headers, true );
  return res;
}


export async function getWorkDrive(accountIdString){
    const coqlQuery = {
      select_query: `select id, easyworkdriveforcrm__Workdrive_Folder_ID_EXT from Accounts where id in (${accountIdString})`
    };
  const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/coql`, 'POST', coqlQuery);
  return response.data;
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
router.get('/test/linked-accounts-coql/:email',authenticateToken, async (req, res) => {
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
router.get('/linked-accounts-by-cognito/:cognitoId',authenticateToken, async (req, res) => {
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
router.get('/account-details/:accountId',authenticateToken, async (req, res) => {
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
router.post('/accounts-details', authenticateToken, async (req, res) => {
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
router.post('/accounts-workdrive-folders', authenticateToken, async (req, res) => {
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
router.get('/workdrive/folder/:folderId/contents',authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!folderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Folder ID is required'
      });
    }
    

    
    // Use the correct WorkDrive API endpoint for folder contents
    const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/files`;
    const breadcrumb = `${ZOHO_CONFIG.baseUrlWorkdrive}/files/${folderId}/breadcrumbs`;
    const response = await makeZohoAPICall(url, 'GET', null, 0, true);
    const breadcrumbResponse = await makeZohoAPICall(breadcrumb, 'GET', null, 0, true);
    let breadcrumbData = [];
    if (breadcrumbResponse.data && breadcrumbResponse.data.length > 0) {
        let foundWorkspace = false;
        breadcrumbData = breadcrumbResponse.data
          .filter(item => {
            if (item.type === "workspace") return (foundWorkspace = true), true;
            if (foundWorkspace && item.type === "folder") return !(foundWorkspace = false);
            return !foundWorkspace;
          })
          .map(item => ({
            id: item.id,
            attributes: {
              ...item.attributes,
              parent_ids: Array.isArray(item.attributes?.parent_ids)
                ? item.attributes.parent_ids.slice(3)
                : []
            },
            type: item.type,
            links: item.type
          }));

    }
    res.json({
      status: 'success',
      folderId,
      files: response.data || [],
      rawResponse: response,
      timestamp: new Date().toISOString(),
      breadcrumbData
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
router.get('/workdrive/file/:fileId',authenticateToken, async (req, res) => {
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

router.get("/workdrive/download/:fileId",authenticateToken, async (req, res) => {
  const { fileId } = req.params;
  try {
    const oneDayLater = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0].replace(/-/g, "-");
    const data = {
      data: {
        attributes: {
          resource_id: fileId,
          link_name: "User Requested File",
          link_type: "download",
          request_user_data: "false",
          allow_download: "true",
          expiration_date:oneDayLater,
          download_link: {
            download_limit: "5"
          }
        },
        type: "links"
      }
    };
    const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/links`;
    const response = await makeZohoAPICall(url, 'POST', data, 0, true);
    res.json({
      status: 'success',
      downloadUrl: response.data.attributes.download_url,
      expiration_date: response.data.attributes.expiration_date,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: "File download failed" });
  }
});

router.get("/workdrive/:fileId/preview", authenticateToken, async (req, res) => {
  const { fileId } = req.params;
  try {
    const data = {
        data: {
          attributes: {
            resource_id: fileId,
            shared_type: "publish",
            role_id: "34"
          },
          type: "permissions"
      }
    };
    const url = `${ZOHO_CONFIG.baseUrlWorkdrive}/permissions`;
    const response = await makeZohoAPICall(url, 'POST', data, 0, true);
    res.json({
      status: 'success',
      permalink: response?.data?.attributes?.permalink,
      expiration_date: response?.data?.attributes?.shared_time,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: "File Preview failed" });
  }
});


// Create a new Account in Zoho CRM
router.post("/create-account", authenticateToken, async (req, res) => {
  const errors = [];
  let accountId = null;

  try {
    const { accountData, userData } = req.body;

     if (!accountData?.accountName || !accountData?.accountType) {
      return res.status(400).json({
        status: "error",
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "Account Name and Account Type are required.",
          },
        ],
      });
    }
    const contacts = [
      ...(accountData.connectedContacts || []),
      {
        firstName: userData.given_name,
        lastName: userData.family_name || userData.given_name,
        email: userData.email,
        cognitoId: userData.username,
      },
    ].filter((c) => !!c.email);

    const duplicateContacts = [];
    for (const contact of contacts) {
      try {
        const existing = await makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:equals:${encodeURIComponent(contact.email)})`,
          "GET"
        );
        if (existing?.data?.length) {
          duplicateContacts.push(contact.email);
        }
      } catch (err) {
        if (err?.response?.status !== 204) {
          errors.push({
            code: "ZOHO_CONTACT_LOOKUP_ERROR",
            message: `Error checking contact for ${contact.email}.`,
            details: err.response?.data || err.message,
          });
        }
      }
    }

    if (duplicateContacts.length > 0) {
      return res.status(400).json({
        status: "error",
        errors: [
          {
            code: "DUPLICATE_CONTACT",
            message: `Contacts with the following emails already exist: ${duplicateContacts.join(", ")}.`,
            details: duplicateContacts,
          },
        ],
      });
    }

    try {
      const existingAccount = await makeZohoAPICall(
        `${ZOHO_CONFIG.baseUrlCRM}/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(
          accountData.accountName
        )})`,
        "GET"
      );

      if (existingAccount?.data?.length) {
        return res.status(400).json({
          status: "error",
          errors: [
            {
              code: "DUPLICATE_ACCOUNT",
              message: `An account named "${accountData.accountName}" already exists.`,
            },
          ],
        });
      }
    } catch (err) {
      if (err?.response?.status !== 204) {
        errors.push({
          code: "ZOHO_ACCOUNT_LOOKUP_ERROR",
          message: `Error checking existing account: ${accountData.accountName}.`,
          details: err.response?.data || err.message,
        });
      }
    }
    const folderId =
      process.env.WORKDRIVE_PARENT_FOLDER_ID || "l0dnwed8da556672f4f6698fb16f1662271be";
    const workdriveFolder = await createFolder(folderId, accountData.accountName);

    if (!workdriveFolder?.attributes?.permalink) {
      return res.status(500).json({
        status: "error",
        errors: [
          {
            code: "WORKDRIVE_FOLDER_ERROR",
            message: "Failed to create WorkDrive folder for this account.",
            details: workdriveFolder,
          },
        ],
      });
    }

    const workdriveLink = workdriveFolder.attributes.permalink;
    const accountPayload = {
      data: [
        {
          Owner: { id: "6791036000000558001" },
          Account_Name: accountData.accountName || "",
          Account_Type: accountData.accountType || "",
          Description: accountData.description || "",
          Client_Note: accountData.clientNote || "",
          Phone_1: accountData.phone1 || "",
          Fax: accountData.fax || "",
          Client_ID: accountData.clientId || "",
          Billing_Street: accountData.billingStreet || "",
          Billing_City: accountData.billingCity || "",
          Billing_State: accountData.billingState || "",
          Billing_Country: accountData.billingCountry || "",
          Billing_Code: accountData.billingCode || "",
          easyworkdriveforcrm__Workdrive_Folder_ID_EXT: workdriveLink,
          Workdrive_Link: workdriveLink,
          Ownership: accountData.trustee || "",
          Compliance_Officer: accountData.complianceOfficer || "",
          TIN: accountData.taxId || "",
          Date_Created: accountData.dateCreated || "",
          Trustee: accountData.trusteeName || "",
          Account_Owner: accountData.accountOwner || "",
          OpenCorp_Page: accountData.openCorpPage || "",
        },
      ],
      trigger: ["workflow"],
    };

    const accountResponse = await makeZohoAPICall(
      `${ZOHO_CONFIG.baseUrlCRM}/Accounts`,
      "POST",
      accountPayload
    );

    accountId = accountResponse?.data?.[0]?.details?.id;

    if (!accountId) {
      return res.status(500).json({
        status: "error",
        errors: [
          {
            code: "ZOHO_ACCOUNT_CREATE_ERROR",
            message: "Failed to create account in Zoho CRM.",
            details: accountResponse,
          },
        ],
      });
    }
    const contactResults = [];

    for (const contact of contacts) {
      const contactPayload = {
        data: [
          {
            Owner: { id: "6791036000000558001" },
            Account_Name: { id: accountId },
            Connected_Accounts: [
              {
                Connected_Accounts: {
                  module: "Accounts",
                  name: accountData.accountName,
                  id: accountId,
                },
              },
            ],
            Cognito_User_ID: contact.cognitoId || "",
            First_Name: contact.firstName || "",
            Last_Name: contact.lastName || "",
            Email: contact.email || "",
            Contact_Type: contact.contactType || "Prospect",
            Account_Type: contact.accountType || "Prospect",
            Single_Line_1: contact.cognitoId || "",
            Mailing_Street: accountData.billingStreet || "",
            Mailing_City: accountData.billingCity || "",
            Mailing_State: accountData.billingState || "",
            Mailing_Zip: accountData.billingCode || "",
            Mailing_Country: accountData.billingCountry || "",
          },
        ],
        trigger: ["workflow"],
      };

      try {
        const contactResponse = await makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/Contacts`,
          "POST",
          contactPayload
        );

        if (contactResponse?.data?.[0]?.details?.id) {
          contactResults.push({
            email: contact.email,
            id: contactResponse.data[0].details.id,
          });
        } else {
          errors.push({
            code: "ZOHO_CONTACT_CREATE_ERROR",
            message: `Failed to create contact: ${contact.email}.`,
            details: contactResponse,
          });
        }
      } catch (err) {
        errors.push({
          code: "ZOHO_CONTACT_CREATE_ERROR",
          message: `Zoho API error while creating contact: ${contact.email}.`,
          details: err.response?.data || err.message,
        });
      }
    }
    return res.status(errors.length ? 207 : 200).json({
      status: errors.length ? "partial_success" : "success",
      message: errors.length
        ? "Account created successfully with some contact issues."
        : "Account and contacts created successfully.",
      data: {
        accountId,
        workdriveLink,
        contacts: contactResults,
      },
      errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Server Error:", error.response?.data || error.message);
    return res.status(500).json({
      status: "error",
      errors: [
        {
          code: "SERVER_ERROR",
          message: "Unexpected server error occurred.",
          details: error.response?.data || error.message,
        },
      ],
    });
  }
});

router.post("/create/multiple-account", authenticateToken, async (req, res) => {
  const createdAccounts = [];
  const createdContacts = [];
  const createdFolders = [];
  const newDbAccounts = [];

  const { accountData: accountDatas, userData } = req.body;

  if (!Array.isArray(accountDatas) || accountDatas.length === 0) {
    return res.status(400).json({ status: "error", message: "No account data provided.", errors: [{ field: "accountDatas", message: "You must provide at least one account entry." }] });
  }

  // Helper: check local duplicates
  const getLocalDuplicates = (items, field) => {
    const map = new Map();
    const duplicates = [];
    for (const item of items) {
      const key = item[field]?.trim().toLowerCase();
      if (!key) continue;
      if (map.has(key)) duplicates.push(item[field]);
      else map.set(key, true);
    }
    return duplicates;
  };

  // Helper: check Zoho duplicates for a module and field
  const checkZohoDuplicates = async (module, field, values) => {
    const filteredValues = values.filter(v => v); // skip empty/undefined
    if (!filteredValues.length) return [];

    const results = await Promise.allSettled(
      filteredValues.map((v) =>
        makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/${module}/search?criteria=(${field}:equals:${encodeURIComponent(v.trim())})`,
          "GET"
        )
      )
    );

    const duplicates = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const value = filteredValues[i];
      if (result.status === "fulfilled" && result.value?.data?.length) duplicates.push(value);
      else if (result.status === "rejected" && result.reason?.response?.status !== 204)
        throw new Error(`Error verifying ${field} "${value}" in ${module}!`);
    }
    return duplicates;
  };

  try {
    // 1️⃣ Local duplicates check
    const localAccountNames = getLocalDuplicates(accountDatas, "accountName");
    if (localAccountNames.length)
      return res.status(400).json({
        status: "error",
        message: "Duplicate account names in request",
        errors: localAccountNames.map((name) => ({ field: "accountName", message: `Account name "${name}" appears more than once.` })),
      });

    const localAccountTins = getLocalDuplicates(accountDatas, "taxId");
    if (localAccountTins.length)
      return res.status(400).json({
        status: "error",
        message: "Duplicate TINs in request",
        errors: localAccountTins.map((tin) => ({ field: "SSN", message: `TIN/SSN "${tin}" appears more than once.` })),
      });

    const allContacts = accountDatas.flatMap(a => a.connectedContacts || []);
    const localContactEmails = getLocalDuplicates(allContacts, "email");
    if (localContactEmails.length)
      return res.status(400).json({
        status: "error",
        message: "Duplicate contact emails in request",
        errors: localContactEmails.map((email) => ({ field: "email", message: `Email "${email}" appears more than once.` })),
      });

    const localContactTins = getLocalDuplicates(allContacts, "taxId");
    if (localContactTins.length)
      return res.status(400).json({
        status: "error",
        message: "Duplicate contact TINs in request",
        errors: localContactTins.map((tin) => ({ field: "SSN", message: `TIN/SSN "${tin}" appears more than once.` })),
      });

       const dbAccountNames = await db.any(
        `SELECT account_name FROM accounts WHERE LOWER(account_name) = ANY($1)`,
        [accountDatas.map(a => a.accountName.toLowerCase())]
      );
      if (dbAccountNames.length)
        return res.status(400).json({
        status: "error",
        message: "Account exists in Database",
        errors: dbAccountNames.map(r => ({ field: "accountName", message: `"${r.account_name}" already exists in Fortress Tax and Trust` })),
      });

      const dbTINs = await db.any(
        `SELECT tin FROM accounts WHERE tin = ANY($1)`,
        [accountDatas.map(a => a.taxId)]
      );
      if (dbTINs.length)
        return res.status(400).json({
          status: "error",
          message: "Account TIN exists in Database",
          errors: dbTINs.map(r => ({ field: "TIN", message: `TIN "${r.tin}" already exists in Fortress Tax and Trust` })),
      });
    const contactsToCheck = allContacts.filter(c => c.type !== "own" && c.email).map(c => c.email.toLowerCase());

    const dbEmails = await db.any( `SELECT email FROM users WHERE LOWER(email) = ANY($1)`, [contactsToCheck]);

    // 3. If duplicates found → return error
    if (dbEmails.length) {
      return res.status(400).json({
        status: "error",
        message: "Contact already exists in Fortress Tax and Trust",
        errors: dbEmails.map(r => ({
          field: "email",
          message: `Email "${r.email}" exists in Fortress Tax and Trust`,
        })),
      });
    }
    const dbSSN = await db.any(
      `SELECT ssn FROM users WHERE ssn = ANY($1)`,
      [allContacts.map(c => c.ssn)]
    );
    if (dbSSN.length)
      return res.status(400).json({
        status: "error",
        message: "Contact SSN exists in Fortress Tax and Trust",
        errors: dbSSN.map(r => ({ field: "ssn", message: `SSN "${r.ssn}" exists in Fortress Tax and Trust` })),
    });
    // 2️⃣ Zoho duplicates check separately
    const [existingAccountNames, existingTins, existingContactEmails, existingContactTins] = await Promise.all([
      checkZohoDuplicates("Accounts", "Account_Name", accountDatas.map(a => a.accountName)),
      checkZohoDuplicates("Accounts", "TIN", accountDatas.map(a => a.taxId)),
      checkZohoDuplicates("Contacts", "Email", allContacts.map(c => c.email)),
      checkZohoDuplicates("Contacts", "EIN_Number", allContacts.map(c => c.ssn)),
    ]);
    const errors = [];
    if (existingAccountNames.length) errors.push(...existingAccountNames.map(name => ({ field: "accountName", message: `Account "${name}" already exists!` })));
    if (existingTins.length) errors.push(...existingTins.map(tin => ({ field: "TIN", message: `In Accounts SSN/TIN "${tin}" already exists!` })));
    if (existingContactEmails.length) errors.push(...existingContactEmails.map(email => ({ field: "email", message: `Contact with Email "${email}" already exists!` })));
    if (existingContactTins.length) errors.push(...existingContactTins.map(tin => ({ field: "TIN", message: `In Contacts SSN "${tin}" already exists!` })));

    if (errors.length) return res.status(400).json({ status: "error", message: "Some duplicates exist", errors });
    
    // Wrap all Zoho and DB operations in a transaction
    await db.tx(async t => {
      // Get primary user's DB record
      const userRecord = await t.oneOrNone('SELECT id FROM users WHERE cognito_id = $1', [userData.username]);

      // 3️⃣ Create Accounts & Workdrive Folders
      for (const accountData of accountDatas) {
        const folder = await createFolder(process.env.WORKDRIVE_PARENT_FOLDER_ID || "l0dnwed8da556672f4f6698fb16f1662271be", accountData.accountName);
        createdFolders.push(folder?.id);

        const accountPayload = {
          data: [{
                     Owner: { id: "6791036000000558001" },
          Account_Name: accountData.accountName,
          Account_Type: accountData.accountType || "",
          Description: accountData.description || "",
          Client_Note: accountData.clientNote || "",
          Phone_1: accountData.phone1 || "",
          Fax: accountData.fax || "",
          Billing_Street: accountData.billingStreet || "",
          Billing_City: accountData.billingCity || "",
          Billing_State: accountData.billingState || "",
          Billing_Country: accountData.billingCountry || "",
          Billing_Code: accountData.billingCode || "",
          easyworkdriveforcrm__Workdrive_Folder_ID_EXT: folder?.attributes?.permalink,
          Workdrive_Link: folder?.attributes?.permalink,
          Ownership: accountData.trustee || "",
          Compliance_Officer: accountData.complianceOfficer || "",
          TIN: accountData.taxId || "",
          Date_Created: accountData.dateCreated || "",
          Trustee: accountData.trusteeName || "",
          Account_Owner: accountData.accountOwner || "",
          OpenCorp_Page: accountData.openCorpPage || "",
        }],
        };

        const accountRes = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/Accounts`, "POST", accountPayload);
        const accountId = accountRes?.data?.[0]?.details?.id;
        if (!accountId) throw new Error(accountRes);
        createdAccounts.push({ id: accountId, accountType : accountData.accountType, name: accountData.accountName, link: folder?.attributes?.permalink || ""});
        // Save account to local DB
        const newDbAccount = await t.one(
          `INSERT INTO accounts(account_name, account_type, description, client_note, phone, fax,
            billing_street, billing_city, billing_state, billing_country, billing_code,
            work_drive_link, overseer_officer, tin, trustee, prospect_folder_link, zoho_account_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
          [
            accountData.accountName, accountData.accountType, accountData.description, accountData.clientNote, accountData.phone1, accountData.fax,
            accountData.billingStreet, accountData.billingCity, accountData.billingState, accountData.billingCountry, accountData.billingCode, 
            folder?.attributes?.permalink, accountData.complianceOfficer, accountData.taxId, accountData.trusteeName, null, accountId
          ]
        );
        newDbAccounts.push(newDbAccount);
      }

    // 4️⃣ Create Contacts
    for (const contact of allContacts) {
      const connectedAccounts = createdAccounts.map(a => ({ Connected_Accounts: { module: "Accounts", name: a.name, id: a.id } }));
      const contactPayload = {
        data: [{
          Owner: { id: "6791036000000558001" },
          Connected_Accounts: connectedAccounts,
          Single_Line_1: contact.type == 'own' ? userData?.username : "",
          First_Name: contact.firstName || "",
          Last_Name: contact.lastName || "",
          Email: contact.email || "",
          Contact_Type: contact.contactType || "Prospect",
          Mailing_Street: contact.billingStreet || "",
          Mailing_City: contact.billingCity || "",
          Mailing_Code: contact.billingCode || "",
          Mailing_State: contact.billingState || "",
          Mailing_Zip: contact.billingZip || "",
          Mailing_Country: contact.billingCountry || "",
          Secondary_Email: contact.secondaryEmail || "",
          Fax: contact.fax || "",
          EIN_Number: contact.ssn || "",
          Important_Notes: contact.importantNotes || "",
          Date_of_Birth: contact.dateOfBirth || "",
          Phone: contact.phone || "",
        }],
        trigger: ["workflow"],
      };

        const contactRes = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/Contacts`, "POST", contactPayload);
        const contactId = contactRes?.data?.[0]?.details?.id;
        if (!contactId) throw new Error(`Failed to create contact "${contact.email}"`);
        createdContacts.push({ id: contactId, email: contact.email });

        // Save contact as a new user in local DB if they don't exist
        const isRelated = ['spouse', 'child', 'dependent'].includes(contact.type);
        const relatedToUserId = isRelated ? userRecord.id : null;
        const relationshipType = isRelated ? contact.type : null;
        await t.none(`
          INSERT INTO users (
            first_name, last_name, email, phone, date_of_birth, ssn, cognito_id, secondary_email, fax,
            important_notes, mailing_street, mailing_city, mailing_state, mailing_zip, mailing_country,
            related_to_user_id, relationship_type, user_type_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15,
            $16, $17, (SELECT id FROM user_type WHERE type = $18)
          )
          ON CONFLICT (email) DO NOTHING
        `, [
          contact.firstName, contact.lastName, contact.email, contact.phone, contact.dateOfBirth || null,
          contact.ssn, `${contactId}`, contact.secondaryEmail, contact.fax, contact.importantNotes,
          contact.mailingStreet, contact.mailingCity, contact.mailingState, contact.mailingZip, contact.mailingCountry,
          relatedToUserId, relationshipType, contact.contactType?.toLowerCase() || 'prospect'
        ]);
      }

      // 5️⃣ Link primary user to all newly created accounts in local DB
      if (userRecord && newDbAccounts.length > 0) {
        const values = newDbAccounts.map(acc => ({ user_id: userRecord.id, account_id: acc.id }));
        await PgHelper.insertMany('accounts_users', values, t)
       
      }
    });

    // ✅ Success
    return res.status(200).json({
      status: "success",
      message: "All accounts and contacts created successfully.",
      data: { accounts: createdAccounts, contacts: createdContacts },
    });
  } catch (err) {
    console.error("Error creating accounts/contacts:", err);

    // Zoho Rollback
    for (const contact of createdContacts) {
      try { await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/Contacts/${contact.id}`, "DELETE"); } catch (_) {}
    }
    for (const account of createdAccounts) {
      try { await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/Accounts/${account.id}`, "DELETE"); } catch (_) {}
    }
    if (createdFolders.length) {
      const data = { data: createdFolders.map((id) => ({ attributes: { status: "51" }, id, type: "files" })) };
      try { await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlWorkdrive}/files`, "PATCH", data, 0, true); } catch (_) {}
    }

    // Handle Zoho validation errors
    const errors = [];
    if (err.response?.data?.errors) { // Zoho API errors
      err.response.data.errors.forEach(e => {
        if (Array.isArray(e.error)) e.error.forEach(subErr => errors.push({ field: subErr.details?.json_path || e.field || "server", message: subErr.message || e.message || "Unknown error", error: subErr }));
        else errors.push({ field: e.field || "server", message: e.message || "Unknown error", error: e.error || e });
      });
    } else if (err.code) { // Database errors (from pg-promise)
      errors.push({
        field: "database",
        message: `Database operation failed: ${err.message}`,
        error: {
          code: err.code, // e.g., '23505' for unique_violation
          constraint: err.constraint, // e.g., 'users_email_key'
          details: err.detail,
        }
      });
    } else {
      errors.push({ field: "server", message: err.message || "Unknown error", error: err.response?.data?.data || err });
    }

    return res.status(500).json({
      status: "error",
      message: "Failed to create accounts/contacts. All created records have been rolled back.",
      errors,
    });
  }
});


router.post("/prospect/upload/files", authenticateToken, upload.array("files"), async (req, res) => {
  try {
    const { accountName } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ status: "error", message: "Files are required" });
    }

    if (!accountName) {
      return res.status(400).json({ status: "error", message: "Account name is required" });
    }
    const parentId = process.env.WORKDRIVE_PROSPECT_FOLDER_ID || '0kkbg9b5447e7e4f54e63853111c1279e3044';
    if (!parentId) {
      return res.status(500).json({ status: "error", message: "Missing WORKDRIVE_PROSPECT_FOLDER_ID" });
    }

    // 🔹 Find or create folder
    let folder = await getFolderByName(parentId, accountName , false);
    console.log("folder   " ,folder)
    if (!folder) {
      folder = await createFolder(parentId, accountName);
      console.log("Created new folder:", folder?.id || folder);
    }

    const uploadedFiles = [];

    // 🔹 Upload each file
    for (const file of files) {
      try {
        const uploadRes = await uploadFile(folder.id, file.buffer, file.originalname, "true");

        uploadedFiles.push({
          fileName: file.originalname,
          fileType: file.mimetype,
          folderId: folder.id,
          uploadStatus: "success",
          details: uploadRes?.data || {},
        });

        console.log(`✅ Uploaded: ${file.originalname} to folder ${folder.id}`);
      } catch (err) {
        console.error(`❌ Upload error for ${file.originalname}:`, err.message);
        uploadedFiles.push({
          fileName: file.originalname,
          status: "error",
          error: err.message,
        });
      }
    }

    // 🔹 Respond once after loop
    return res.json({
      status: "success",
      message: "File upload completed",
      uploadedFiles,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Endpoint error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message || err,
    });
  }
});


// Create a new Contact linked to an existing Account
router.post('/create-contact', async (req, res) => {
  try {
    const {
      First_Name,
      Last_Name,
      Email,
      Phone,
      Mobile,
      Department,
      Title,
      Account,
      Description,
      Lead_Source,
      Date_of_Birth,
      Fax,
      Secondary_Email,
      Mailing_Street,
      Mailing_City,
      Mailing_State,
      Mailing_Zip,
      Mailing_Country,
      Other_Street,
      Other_City,
      Other_State,
      Other_Zip,
      Other_Country
    } = req.body;

    if (!Last_Name || !Account) {
      return res.status(400).json({
        status: 'error',
        message: 'Last_Name and Account_ID are required'
      });
    }

    const payload = {
      data: [
        {
          Owner: { id: "6791036000000558001" }, 
          Account_Name: { id: Account },
          First_Name,
          Last_Name,
          Email,
          Secondary_Email,
          Phone,
          Mobile,
          Fax,
          Department,
          Title,
          Description,
          Lead_Source,
          Date_of_Birth,
          Mailing_Street,
          Mailing_City,
          Mailing_State,
          Mailing_Zip,
          Mailing_Country,
          Other_Street,
          Other_City,
          Other_State,
          Other_Zip,
          Other_Country,
          Email_Opt_Out: false
        }
      ],
      trigger: ['workflow']
    };

    console.log(`=== Creating Contact for Account ID: ${Account_ID} ===`);
    const response = await makeZohoAPICall(`${ZOHO_CONFIG.baseUrlCRM}/Contacts`, 'POST', payload);

    if (!response.data || !response.data[0]?.details?.id) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to create contact',
        response
      });
    }

    const contactId = response.data[0].details.id;

    res.json({
      status: 'success',
      message: 'Contact created successfully',
      contactId,
      response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Create Contact Error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create contact',
      error: error.response?.data || error.message
    });
  }
});

export default router;