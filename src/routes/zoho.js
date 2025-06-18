import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

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

export default router;