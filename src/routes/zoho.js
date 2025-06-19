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
  baseUrlCRM: 'https://www.zohoapis.com/crm/v2',
  baseUrlWorkdrive: 'https://www.zohoapis.com/workdrive/api/v1',
  authUrl: 'https://accounts.zoho.com/oauth/v2/token'
};

// Function to refresh access token
const refreshAccessToken = async () => {
  try {
    const response = await axios.post(ZOHO_CONFIG.authUrl, null, {
      params: {
        refresh_token: ZOHO_CONFIG.refreshToken,
        client_id: ZOHO_CONFIG.clientId,
        client_secret: ZOHO_CONFIG.clientSecret,
        grant_type: 'refresh_token'
      }
    });

    console.log('Token refreshed successfully');
    return response.data.access_token;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
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

// Get CRM records from a specific module
router.get('/crm/:module', async (req, res) => {
  try {
    const { module } = req.params;
    const { page = 1, per_page = 10 } = req.query;
    
    const response = await makeZohoAPICall(
      `${ZOHO_CONFIG.baseUrlCRM}/${module}?page=${page}&per_page=${per_page}`
    );
    
    res.json({
      status: 'success',
      module,
      data: response.data,
      info: response.info,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching ${req.params.module} records:`, error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: `Failed to fetch ${req.params.module} records`,
      error: error.response?.data || error.message
    });
  }
});

// Refresh token endpoint
router.post('/refresh-token', async (req, res) => {
  try {
    const newToken = await refreshAccessToken();
    
    res.json({
      status: 'success',
      message: 'Token refreshed successfully',
      access_token: newToken,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing token:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to refresh token',
      error: error.message
    });
  }
});

// Search contacts by email
router.get('/crm/contacts/search/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email parameter is required'
      });
    }

    // Use Zoho's search API to find contacts by email
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:equals:${encodeURIComponent(email)})`;
    
    const response = await makeZohoAPICall(searchUrl);
    
    res.json({
      status: 'success',
      searchQuery: email,
      data: response.data || [],
      info: response.info || {},
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error searching contacts by email:', error.response?.data || error.message);
    
    // Handle case where no records found
    if (error.response?.status === 204 || error.response?.data?.code === 'NO_DATA') {
      return res.json({
        status: 'success',
        searchQuery: req.params.email,
        data: [],
        message: 'No contacts found with this email',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to search contacts by email',
      searchQuery: req.params.email,
      error: error.response?.data || error.message
    });
  }
});

// Search contacts by partial email (contains)
router.get('/crm/contacts/search/email-contains/:emailPart', async (req, res) => {
  try {
    const { emailPart } = req.params;
    
    if (!emailPart) {
      return res.status(400).json({
        status: 'error',
        message: 'Email part parameter is required'
      });
    }

    // Use Zoho's search API to find contacts by partial email match
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Email:contains:${encodeURIComponent(emailPart)})`;
    
    const response = await makeZohoAPICall(searchUrl);
    
    res.json({
      status: 'success',
      searchQuery: emailPart,
      searchType: 'contains',
      data: response.data || [],
      info: response.info || {},
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error searching contacts by partial email:', error.response?.data || error.message);
    
    // Handle case where no records found
    if (error.response?.status === 204 || error.response?.data?.code === 'NO_DATA') {
      return res.json({
        status: 'success',
        searchQuery: req.params.emailPart,
        searchType: 'contains',
        data: [],
        message: 'No contacts found with this email pattern',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to search contacts by partial email',
      searchQuery: req.params.emailPart,
      error: error.response?.data || error.message
    });
  }
});

// Get ALL contacts (handles pagination automatically)
router.get('/crm/contacts/all', async (req, res) => {
  try {
    console.log('Fetching all contacts with automatic pagination...');
    
    let allContacts = [];
    let page = 1;
    let hasMoreRecords = true;
    const perPage = 200; // Maximum allowed by Zoho API
    
    while (hasMoreRecords) {
      console.log(`Fetching page ${page} with ${perPage} contacts per page...`);
      
      const response = await makeZohoAPICall(
        `${ZOHO_CONFIG.baseUrlCRM}/Contacts?page=${page}&per_page=${perPage}`
      );
      
      if (response.data && response.data.length > 0) {
        allContacts = allContacts.concat(response.data);
        console.log(`Fetched ${response.data.length} contacts from page ${page}. Total so far: ${allContacts.length}`);
        
        // Check if there are more records
        hasMoreRecords = response.info?.more_records || false;
        page++;
        
        // Add a small delay to avoid rate limiting
        if (hasMoreRecords) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        hasMoreRecords = false;
      }
    }
    
    console.log(`Completed fetching all contacts. Total: ${allContacts.length}`);
    
    res.json({
      status: 'success',
      message: `Successfully fetched all contacts`,
      totalContacts: allContacts.length,
      pagesProcessed: page - 1,
      data: allContacts,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching all contacts:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch all contacts',
      error: error.response?.data || error.message
    });
  }
});

// Protected route: Get logged-in user's CRM contact data
router.get('/crm/my-contact', authenticateToken, async (req, res) => {
  try {
    // Extract Cognito User ID from authenticated token
    const cognitoUserId = req.user.sub;
    
    if (!cognitoUserId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID not found in token'
      });
    }

    console.log(`Searching for contact with Cognito_User_ID: ${cognitoUserId}`);

    // Search for contact using Cognito_User_ID custom field
    const searchUrl = `${ZOHO_CONFIG.baseUrlCRM}/Contacts/search?criteria=(Cognito_User_ID:equals:${encodeURIComponent(cognitoUserId)})`;
    
    const response = await makeZohoAPICall(searchUrl);
    
    if (!response.data || response.data.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Contact not found for this user',
        userInfo: {
          cognitoUserId: cognitoUserId,
          email: req.user.email,
          username: req.user.username
        },
        suggestion: 'Please contact support to link your account with CRM data'
      });
    }

    // Should only be one contact, but handle multiple just in case
    const userContact = response.data[0];
    
    console.log(`Found contact: ${userContact.Full_Name} (ID: ${userContact.id})`);

    res.json({
      status: 'success',
      message: 'User contact data retrieved successfully',
      userInfo: {
        cognitoUserId: cognitoUserId,
        email: req.user.email,
        username: req.user.username,
        given_name: req.user.given_name,
        family_name: req.user.family_name
      },
      contactData: userContact,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching user contact:', error.response?.data || error.message);
    
    // Handle case where no records found
    if (error.response?.status === 204 || error.response?.data?.code === 'NO_DATA') {
      return res.status(404).json({
        status: 'error',
        message: 'No contact found for this user',
        userInfo: {
          cognitoUserId: req.user?.sub,
          email: req.user?.email,
          username: req.user?.username
        },
        suggestion: 'Please contact support to link your account with CRM data',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user contact data',
      error: error.response?.data || error.message,
      userInfo: {
        cognitoUserId: req.user?.sub,
        email: req.user?.email
      }
    });
  }
  });

export default router;