import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.js';
import FormData from 'form-data';
import stringSimilarity from "string-similarity";
import multer from "multer";

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
  try {
    const {  accountData : accountDatas , userData  } = req.body;

    if (!Array.isArray(accountDatas) || accountDatas.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No account data provided.",
        errors: [
          {
            field: "accountDatas",
            message: "You must provide at least one account entry.",
          },
        ],
      });
    }

    // -----------------------------
    // 1️⃣ Validate Required Fields
    // -----------------------------
    const missingFields = accountDatas
      .filter((f) => !f.accountName || !f.accountType)
      .map((f) => ({
        name: f.accountName || "(missing name)",
        message: "Both account name and account type are required.",
      }));

    if (missingFields.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields in one or more accounts.",
        errors: missingFields,
      });
    }

    // -----------------------------
    // 2️⃣ Check Local Duplicates
    // -----------------------------
    const nameMap = new Map();
    const localDuplicates = [];

    for (const f of accountDatas) {
      const nameKey = f.accountName.trim().toLowerCase();
      if (nameMap.has(nameKey)) {
        localDuplicates.push(f.accountName);
      } else {
        nameMap.set(nameKey, true);
      }
    }

    if (localDuplicates.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Duplicate account names found in your submission.",
        errors: localDuplicates.map((name) => ({
          field: "accountName",
          message: `Account name "${name}" appears more than once.`,
        })),
      });
    }

    // -----------------------------
    // 3️⃣ Check Zoho Account Duplicates
    // -----------------------------
    const zohoAccountChecks = await Promise.allSettled(
      accountDatas.map((f) =>
        makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(
            f.accountName.trim()
          )})`,
          "GET"
        )
      )
    );

    const existingAccounts = [];
    for (let i = 0; i < zohoAccountChecks.length; i++) {
      const result = zohoAccountChecks[i];
      const accountName = accountDatas[i].accountName;

      if (result.status === "fulfilled" && result.value?.data?.length) {
        existingAccounts.push(accountName);
      } else if (result.status === "rejected" && result.reason?.response?.status !== 204) {
        return res.status(502).json({
          status: "error",
          message: "Error verifying accounts.",
          errors: [
            {
              field: "zoho",
              message: `lookup failed for account "${accountName}". Please try again.`,
            },
          ],
        });
      }
    }

    if (existingAccounts.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "One or more accounts already exist!",
        errors: existingAccounts.map((name) => ({
          field: "accountName",
          message: `Account "${name}" already exists!.`,
        })),
      });
    }

    // -----------------------------
    // 4️⃣ Prepare Contact List & Validate
    // -----------------------------
    const allContacts = [...accountDatas.flatMap((f) => f.connectedContacts || [])];

    // local duplicates (by email)
    const emailMap = new Map();
    const localContactDuplicates = [];

    for (const c of allContacts) {
      const key = c.email.trim().toLowerCase();
      if (emailMap.has(key)) localContactDuplicates.push(c.email);
      else emailMap.set(key, true);
    }

    if (localContactDuplicates.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Duplicate contact emails found in your submission.",
        errors: localContactDuplicates.map((email) => ({
          field: "email",
          message: `Email "${email}" appears more than once.`,
        })),
      });
    }

    // -----------------------------
    // 5️⃣ Check Zoho Contact Duplicates
    // -----------------------------
    const zohoContactChecks = await Promise.allSettled(
      allContacts.map((c) =>
        makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:equals:${encodeURIComponent(
            c.email.trim()
          )})`,
          "GET"
        )
      )
    );

    const existingContacts = [];
    for (let i = 0; i < zohoContactChecks.length; i++) {
      const result = zohoContactChecks[i];
      const email = allContacts[i].email;
      if (result.status === "fulfilled" && result.value?.data?.length) {
        existingContacts.push(email);
      } else if (result.status === "rejected" && result.reason?.response?.status !== 204) {
        return res.status(502).json({
          status: "error",
          message: "Error verifying contacts in Zoho.",
          errors: [
            {
              field: "email",
              message: `Zoho lookup failed for contact "${email}". Please retry.`,
            },
          ],
        });
      }
    }

    if (existingContacts.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "One or more contacts already exist in Zoho CRM.",
        errors: existingContacts.map((email) => ({
          field: "email",
          message: `Contact with email "${email}" already exists in Zoho.`,
        })),
      });
    }

    // -----------------------------
    // ✅ 6️⃣ All Clear — Proceed to Create Accounts & Contacts
    // -----------------------------
    const createdAccounts = [];
    const createdContacts = [];

    for (const accountData of accountDatas) {
        // Create folder
        const folder = await createFolder(
          process.env.WORKDRIVE_PARENT_FOLDER_ID || "l0dnwed8da556672f4f6698fb16f1662271be",
          accountData.accountName
        );

        const workdriveLink = folder?.attributes?.permalink || "";

        // ✅ Use first contact for defaults
        const firstContact = accountData.connectedContacts?.[0] || {};

        const accountPayload = {
          data: [
            {
              Owner: { id: "6791036000000558001" },
              Account_Name: accountData.accountName || "",
              Account_Type: accountData.accountType || "",
              Description: accountData.description || "",
              Client_Note: accountData.clientNote || "",
              Phone_1:  accountData.phone1 || "",
              Fax:  accountData.fax || "",
              Client_ID: accountData.clientId || "",
              Billing_Street:  accountData.billingStreet || "",
              Billing_City:  accountData.billingCity || "",
              Billing_State:  accountData.billingState || "",
              Billing_Country:  accountData.billingCountry || "",
              Billing_Code:  accountData.billingCode || "",
              easyworkdriveforcrm__Workdrive_Folder_ID_EXT: workdriveLink,
              Workdrive_Link: workdriveLink,
              Ownership: accountData.trustee || "",
              Compliance_Officer: accountData.complianceOfficer || "",
              TIN : accountData.taxId || "",
              Date_Created: accountData.dateCreated || "",
              Trustee: accountData.trusteeName || "",
              Account_Owner: accountData.accountOwner || "",
              OpenCorp_Page: accountData.openCorpPage || "",
            },
          ],
        };

        const accountRes = await makeZohoAPICall(
          `${ZOHO_CONFIG.baseUrlCRM}/Accounts`,
          "POST",
          accountPayload
        );

        const accountId = accountRes?.data?.[0]?.details?.id;
        if (accountId) {
          createdAccounts.push({
            id: accountId,
            name: accountData.accountName,
            link: workdriveLink,
          });
        }
      }


    // Create contacts only after successful accounts
    for (const contact of allContacts) {
      const connectedAccounts = []
      createdAccounts.map( a => {
          connectedAccounts.push({
              Connected_Accounts: {
                module: "Accounts",
                name: a?.name,
                id: a?.id,
              },
            })
      })

      console.log("connectedAccounts" , connectedAccounts)
      const contactPayload = {
          data: [
            {
              Owner: { id: "6791036000000558001" },
              Connected_Accounts: connectedAccounts,
              Single_Line_1: contact.type == 'own' ? userData.username : "",
              First_Name: contact.firstName || "",
              Last_Name: contact.lastName || "",
              Email: contact.email || "",
              Contact_Type: contact.contactType || "Prospect",
              Account_Type: contact.accountType || "Prospect",
              Mailing_Street: contact.billingStreet || "",
              Mailing_City: contact.billingCity || "",
              Mailing_Code: contact.billingCode || "",
              Mailing_State: contact.billingState || "",
              Mailing_Zip: contact.billingZip || "",
              Mailing_Country: contact.billingCountry || "",
              Secondary_Email:contact.secondaryEmail || "",
              Fax: contact.fax || "",
              EIN_Number: contact.tin || "",
              Important_Notes: contact.importantNotes || "",
              Date_of_Birth: contact.dateOfBirth || "",
              Phone: contact.phone || "",
            },
          ],
          trigger: ["workflow"],
      };

      const contactRes = await makeZohoAPICall(
        `${ZOHO_CONFIG.baseUrlCRM}/Contacts`,
        "POST",
        contactPayload
      );

      const contactId = contactRes?.data?.[0]?.details?.id;
      if (contactId) createdContacts.push({ id: contactId, email: contact.email , firstName: contact.firstName , lastName: contact.lastName });
    }

    return res.status(200).json({
      status: "success",
      message: "All accounts and contacts created successfully.",
      // data: {
      //   accounts: [
      //     {
      //       id : "3435555", 
      //       "name": "aamish test"
      //     },
      //     {
      //       id : "43453", 
      //       "name": "sh test"
      //     }
      //   ] ,
      //   contacts: [],
      // },

      data: {
        accounts: createdAccounts,
        contacts: createdContacts,
      },

    });
  } catch (err) {
    console.error("Error creating account:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Unexpected server error occurred.",
      errors: [
        {
          field: "server",
          message: err.message || "Internal Server Error",
        },
      ],
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