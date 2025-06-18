import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { healthRouter } from './routes/health.js';
import { protectedRouter } from './routes/protected.js';
import { testRouter } from './routes/test.js';
import authRouter from './routes/auth.js';
import zohoRouter from './routes/zoho.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_AWS_REGION',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY'
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
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT
});

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        refreshToken: '/zoho/refresh-token'
      }
    }
  });
});

// Routes
app.use('/health', healthRouter);
app.use('/api', protectedRouter);
app.use('/test', testRouter);
app.use('/auth', authRouter);
app.use('/zoho', zohoRouter);

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
  console.log(`Server is running on port ${port}`);
}); 