import express from 'express';
import { 
  CognitoIdentityProviderClient, 
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  RespondToAuthChallengeCommand,
  GetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import QRCode from 'qrcode';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const router = express.Router();

// Initialize Cognito client with environment variables
const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Log configuration (without sensitive data)
console.log('Cognito Configuration:', {
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  hasClientSecret: true
});

// Cognito configuration from environment variables
const COGNITO_CONFIG = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  ClientSecret: process.env.NEXT_PUBLIC_COGNITO_CLIENT_SECRET
};

// Function to calculate SecretHash
const calculateSecretHash = (username) => {
  const message = username + COGNITO_CONFIG.ClientId;
  const hmac = crypto.createHmac('sha256', COGNITO_CONFIG.ClientSecret);
  hmac.update(message);
  return hmac.digest('base64');
};

// Login route with Cognito USER_PASSWORD_AUTH flow and MFA handling
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    console.log('Attempting login for user:', username); // Debug log

    const params = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CONFIG.ClientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
        SECRET_HASH: calculateSecretHash(username)
      }
    };

    console.log('Auth parameters:', { ...params, AuthParameters: { ...params.AuthParameters, PASSWORD: '***' } }); // Debug log

    const command = new InitiateAuthCommand(params);
    const response = await cognitoClient.send(command);

    console.log('Auth response:', response); // Debug log

    // Handle MFA challenge if required
    if (response.ChallengeName === 'MFA_SETUP') {
      return res.json({
        status: 'MFA_SETUP_REQUIRED',
        session: response.Session,
        challengeName: response.ChallengeName
      });
    }

    // Handle TOTP MFA challenge
    if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      return res.json({
        status: 'TOTP_MFA_REQUIRED',
        session: response.Session,
        challengeName: response.ChallengeName
      });
    }

    res.json({
      status: 'success',
      message: 'Login successful',
      tokens: {
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
        expiresIn: response.AuthenticationResult.ExpiresIn
      }
    });
  } catch (error) {
    console.error('Login error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    // Handle specific Cognito errors
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect username or password',
        error: error.message
      });
    }
    
    if (error.name === 'UserNotFoundException') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        error: error.message
      });
    }

    if (error.name === 'UserNotConfirmedException') {
      return res.status(400).json({
        status: 'error',
        message: 'User is not confirmed',
        error: error.message
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Login failed',
      error: error.message,
      errorType: error.name
    });
  }
});

// Setup Authenticator app MFA
router.post('/setup-authenticator', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Get the secret code from Cognito
    const params = {
      AccessToken: accessToken
    };

    const command = new AssociateSoftwareTokenCommand(params);
    const response = await cognitoClient.send(command);

    // Generate QR code for the authenticator app
    const issuer = 'Your App Name'; // Replace with your app name
    const accountName = req.body.email || 'user@example.com';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${response.SecretCode}&issuer=${encodeURIComponent(issuer)}`;
    
    const qrCode = await QRCode.toDataURL(otpauth);

    res.json({
      status: 'success',
      secretCode: response.SecretCode,
      session: response.Session,
      qrCode: qrCode
    });
  } catch (error) {
    console.error('Authenticator setup error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to setup authenticator',
      error: error.message
    });
  }
});

// Verify Authenticator setup
router.post('/verify-authenticator', async (req, res) => {
  try {
    const { accessToken, userCode, session } = req.body;

    if (!accessToken || !userCode) {
      return res.status(400).json({ error: 'Access token and authenticator code are required' });
    }

    const params = {
      AccessToken: accessToken,
      UserCode: userCode,
      Session: session
    };

    const command = new VerifySoftwareTokenCommand(params);
    const response = await cognitoClient.send(command);

    if (response.Status === 'SUCCESS') {
      // Set MFA preference to TOTP
      await cognitoClient.send(new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: {
          Enabled: true,
          PreferredMfa: true
        }
      }));
    }

    res.json({
      status: response.Status,
      session: response.Session
    });
  } catch (error) {
    console.error('Authenticator verification error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to verify authenticator code',
      error: error.message
    });
  }
});

// Respond to Authenticator MFA challenge
router.post('/respond-to-mfa', async (req, res) => {
  try {
    const { session, code, username } = req.body;

    if (!session || !code || !username) {
      return res.status(400).json({ error: 'Session, authenticator code, and username are required' });
    }

    const params = {
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      ClientId: COGNITO_CONFIG.ClientId,
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        SOFTWARE_TOKEN_MFA_CODE: code,
        SECRET_HASH: calculateSecretHash(username)
      }
    };

    const command = new RespondToAuthChallengeCommand(params);
    const response = await cognitoClient.send(command);

    res.json({
      status: 'success',
      tokens: {
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
        expiresIn: response.AuthenticationResult.ExpiresIn
      }
    });
  } catch (error) {
    console.error('MFA challenge response error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to verify authenticator code',
      error: error.message
    });
  }
});

// Get user MFA preferences
router.get('/mfa-preferences', async (req, res) => {
  try {
    const { accessToken } = req.headers;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    const params = {
      AccessToken: accessToken
    };

    const command = new GetUserCommand(params);
    const response = await cognitoClient.send(command);

    res.json({
      status: 'success',
      mfaEnabled: response.PreferredMfaSetting === 'SOFTWARE_TOKEN_MFA',
      mfaType: response.PreferredMfaSetting
    });
  } catch (error) {
    console.error('Get MFA preferences error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to get MFA preferences',
      error: error.message
    });
  }
});

// Sign up route with Cognito user attributes
router.post('/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Username, password, and email are required' });
    }

    // Cognito password requirements validation
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const params = {
      ClientId: COGNITO_CONFIG.ClientId,
      Username: username,
      Password: password,
      SecretHash: calculateSecretHash(username),
      UserAttributes: [
        {
          Name: 'email',
          Value: email
        }
      ],
      ValidationData: [
        {
          Name: 'email',
          Value: email
        }
      ]
    };

    const command = new SignUpCommand(params);
    const response = await cognitoClient.send(command);

    res.json({
      status: 'success',
      message: 'User registered successfully. Please check your email for verification code.',
      userSub: response.UserSub,
      userConfirmed: response.UserConfirmed
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Signup failed',
      error: error.message
    });
  }
});

// Confirm signup with Cognito verification code
router.post('/confirm-signup', async (req, res) => {
  try {
    const { username, code } = req.body;

    if (!username || !code) {
      return res.status(400).json({ error: 'Username and verification code are required' });
    }

    const params = {
      ClientId: COGNITO_CONFIG.ClientId,
      Username: username,
      ConfirmationCode: code,
      SecretHash: calculateSecretHash(username)
    };

    const command = new ConfirmSignUpCommand(params);
    await cognitoClient.send(command);

    res.json({
      status: 'success',
      message: 'User confirmed successfully'
    });
  } catch (error) {
    console.error('Confirmation error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Confirmation failed',
      error: error.message
    });
  }
});

// Forgot password flow
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const params = {
      ClientId: COGNITO_CONFIG.ClientId,
      Username: username,
      SecretHash: calculateSecretHash(username)
    };

    const command = new ForgotPasswordCommand(params);
    await cognitoClient.send(command);

    res.json({
      status: 'success',
      message: 'Verification code sent to your email'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to initiate password reset',
      error: error.message
    });
  }
});

// Confirm forgot password
router.post('/confirm-forgot-password', async (req, res) => {
  try {
    const { username, code, newPassword } = req.body;

    if (!username || !code || !newPassword) {
      return res.status(400).json({ error: 'Username, code, and new password are required' });
    }

    const params = {
      ClientId: COGNITO_CONFIG.ClientId,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
      SecretHash: calculateSecretHash(username)
    };

    const command = new ConfirmForgotPasswordCommand(params);
    await cognitoClient.send(command);

    res.json({
      status: 'success',
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Confirm forgot password error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to reset password',
      error: error.message
    });
  }
});

// Protected test route
router.get('/protected-route', async (req, res) => {
  try {
    // The verifyToken middleware will have already validated the token
    // and attached the user information to req.user
    res.json({
      status: 'success',
      message: 'You have accessed a protected route',
      user: req.user
    });
  } catch (error) {
    console.error('Protected route error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error accessing protected route',
      error: error.message
    });
  }
});

export default router; 