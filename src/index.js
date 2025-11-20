import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { protectedRouter } from './routes/protected.js';
import { testRouter } from './routes/test.js';
import authRouter from './routes/auth.js';
import zohoRouter from './routes/zoho.js';
import aiRouter from './routes/ai.js';
import mailRouter from "./routes/contactus.js";
import { startScheduler } from './scheduler/cron.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_AWS_REGION',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Log environment configuration (without sensitive data)
console.log('Environment Configuration:', {
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  hasClientSecret: !!process.env.NEXT_PUBLIC_COGNITO_CLIENT_SECRET,
  hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT
});

const app = express();
const port = process.env.PORT || 8080;

// Public health check route (must be first, before any middleware that might fail)
app.get('/health', (_req, res) => res.status(200).send('OK'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));


// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the API',
    endpoints: {
      health: '/health',
      protected: '/profile',
      test: {
        cognitoStatus: '/test/cognito-status',
        verifyToken: '/test/verify-token'
      },
      auth: {
        login: '/auth/login',
        signup: '/auth/signup',
        confirmSignup: '/auth/confirm-signup'
      },
      zoho: {
        testConnection: '/zoho/test-connection',
        crmModules: '/zoho/crm/modules',
        workdriveFolders: '/zoho/workdrive/folders',
        crmRecords: '/zoho/crm/{module}',
        allContacts: '/zoho/crm/contacts/all',
        myContact: '/zoho/crm/my-contact (Protected - requires JWT token)',
        myContactCoql: '/zoho/crm/my-contact-coql (Protected - uses COQL Query API)',
        myConnectedAccounts: '/zoho/crm/my-connected-accounts (Protected - Multi-Select-Lookup fields)',
        myFiles: '/zoho/workdrive/my-files (Protected - user\'s Workdrive files)',
        downloadFile: '/zoho/workdrive/download/{fileId} (Protected)',
        uploadFile: '/zoho/workdrive/upload (Protected - POST)',
        createFolder: '/zoho/workdrive/create-folder (Protected - POST)',
        searchContactByEmail: '/zoho/crm/contacts/search/email/{email}',
        searchContactByEmailContains: '/zoho/crm/contacts/search/email-contains/{emailPart}',
        queryContacts: '/zoho/crm/query-contacts?email={email}&cognitoUserId={id} (Protected - COQL Query API)',
        testConnectedAccounts: '/zoho/crm/test-connected-accounts (Protected - Test Multi-Select-Lookup fields)',
        moduleMetadata: '/zoho/crm/module-metadata/{module} (Protected - Get module field metadata)',
        refreshToken: '/zoho/refresh-token'
      },
      ai: {
        testConnection: '/ai/test-connection',
        analyzeFile: '/ai/analyze-file (Protected - POST)',
        suggestFolders: '/ai/suggest-folders (Protected - POST)'
      }
    }
  });
});

// Routes
app.use('/api', protectedRouter);
app.use('/test', testRouter);
app.use('/auth', authRouter);
app.use('/zoho', zohoRouter);
app.use('/ai', aiRouter);
app.use('/contactus', mailRouter)

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error details:', {
    name: err.name,
    message: err.message,
    stack: err.stack
  });
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message,
    type: err.name
  });
});


// Start server
app.listen(port, () => {
  startScheduler()
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`🏥 Health check available at: http://localhost:${port}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
}); 