// routes/auth.js
import express from 'express';
import QRCode from 'qrcode';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  GetUserCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GlobalSignOutCommand,
  ChangePasswordCommand
} from '@aws-sdk/client-cognito-identity-provider';

dotenv.config();

const router = express.Router();

// ---- Config ----
const COGNITO_CONFIG = {
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID, // not required for these routes but kept for reference
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  clientSecret: process.env.NEXT_PUBLIC_COGNITO_CLIENT_SECRET || null
};

const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_CONFIG.region,
  // If running on AWS with an instance role, you can remove credentials below.
  credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    : undefined
});

// Minimal, safe config log
console.log('Cognito:', {
  region: COGNITO_CONFIG.region,
  userPoolId: COGNITO_CONFIG.userPoolId,
  clientId: COGNITO_CONFIG.clientId,
  hasClientSecret: !!COGNITO_CONFIG.clientSecret
});

// ---- Helpers ----
function calculateSecretHash(username) {
  if (!COGNITO_CONFIG.clientSecret) return undefined;
  const hmac = crypto.createHmac('sha256', COGNITO_CONFIG.clientSecret);
  hmac.update(username + COGNITO_CONFIG.clientId);
  return hmac.digest('base64');
}

function maskTokens(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  const mask = v => (typeof v === 'string' && v.length > 12 ? v.slice(0, 6) + '…(masked)' : v);
  if (clone.AuthenticationResult) {
    ['AccessToken','IdToken','RefreshToken'].forEach(k => {
      if (clone.AuthenticationResult[k]) clone.AuthenticationResult[k] = mask(clone.AuthenticationResult[k]);
    });
  }
  return clone;
}

// ===================== AUTH =====================

// Login (USER_PASSWORD_AUTH) + challenge routing
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const params = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CONFIG.clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password }
    };
    const secretHash = calculateSecretHash(username);
    if (secretHash) params.AuthParameters.SECRET_HASH = secretHash;

    const response = await cognitoClient.send(new InitiateAuthCommand(params));
    // Handle common challenges
    switch (response.ChallengeName) {
      case 'MFA_SETUP':
        return res.json({ status: 'MFA_SETUP_REQUIRED', session: response.Session, challengeName: 'MFA_SETUP' });
      case 'SOFTWARE_TOKEN_MFA':
        return res.json({ status: 'TOTP_MFA_REQUIRED', session: response.Session, challengeName: 'SOFTWARE_TOKEN_MFA' });
      case 'SMS_MFA':
        return res.json({ status: 'SMS_MFA_REQUIRED', session: response.Session, challengeName: 'SMS_MFA' });
      case 'NEW_PASSWORD_REQUIRED':
        return res.json({ status: 'NEW_PASSWORD_REQUIRED', session: response.Session, challengeName: 'NEW_PASSWORD_REQUIRED' });
      case 'PASSWORD_RESET_REQUIRED':
        return res.json({ status: 'PASSWORD_RESET_REQUIRED', session: response.Session, challengeName: 'PASSWORD_RESET_REQUIRED' });
      default:
        break;
    }

    // Success (no further challenge)
    return res.json({
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
    console.error('Login error:', { name: error.name, message: error.message });
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({ status: 'error', message: 'Incorrect username or password' });
    }
    if (error.name === 'UserNotFoundException') {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (error.name === 'UserNotConfirmedException') {
      return res.status(400).json({ status: 'error', message: 'User is not confirmed' });
    }
    return res.status(500).json({ status: 'error', message: 'Login failed', error: error.message, errorType: error.name });
  }
});

// Respond to MFA (TOTP or SMS) after /login
router.post('/respond-to-mfa', async (req, res) => {
  try {
    const { session, code, username, challengeName } = req.body || {};
    if (!session || !code || !username) return res.status(400).json({ error: 'Session, code, and username are required' });

    const name = challengeName || 'SOFTWARE_TOKEN_MFA';
    const challengeResponses = { USERNAME: username };
    if (name === 'SOFTWARE_TOKEN_MFA') challengeResponses.SOFTWARE_TOKEN_MFA_CODE = code;
    if (name === 'SMS_MFA') challengeResponses.SMS_MFA_CODE = code;

    const secretHash = calculateSecretHash(username);
    if (secretHash) challengeResponses.SECRET_HASH = secretHash;

    const resp = await cognitoClient.send(new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CONFIG.clientId,
      ChallengeName: name,
      Session: session,
      ChallengeResponses: challengeResponses
    }));

    return res.json({
      status: 'success',
      tokens: {
        accessToken: resp.AuthenticationResult.AccessToken,
        idToken: resp.AuthenticationResult.IdToken,
        refreshToken: resp.AuthenticationResult.RefreshToken,
        expiresIn: resp.AuthenticationResult.ExpiresIn
      }
    });
  } catch (error) {
    console.error('MFA respond error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to verify MFA code', error: error.message });
  }
});

// NEW_PASSWORD_REQUIRED
router.post('/respond-new-password', async (req, res) => {
try {
const { session, username, newPassword, givenName, familyName, email } = req.body || {};
if (!session || !username || !newPassword) return res.status(400).json({ error: 'Session, username, and newPassword are required' });

const challengeResponses = { USERNAME: username, NEW_PASSWORD: newPassword };

// Add required attributes if provided (but skip email if user already has one)
if (givenName) challengeResponses['userAttributes.given_name'] = givenName;
if (familyName) challengeResponses['userAttributes.family_name'] = familyName;
// Note: Don't send email if user already has one - it causes "Cannot modify an already provided email" error
// if (email) challengeResponses['userAttributes.email'] = email;

const secretHash = calculateSecretHash(username);
if (secretHash) challengeResponses.SECRET_HASH = secretHash;

const r = await cognitoClient.send(new RespondToAuthChallengeCommand({
ClientId: COGNITO_CONFIG.clientId,
ChallengeName: 'NEW_PASSWORD_REQUIRED',
Session: session,
ChallengeResponses: challengeResponses
}));

// Check if we got tokens or if there are more challenges
if (r.AuthenticationResult) {
// Success - we have tokens
return res.json({
  status: 'success',
  message: 'Password changed successfully',
  tokens: {
    accessToken: r.AuthenticationResult.AccessToken,
    idToken: r.AuthenticationResult.IdToken,
    refreshToken: r.AuthenticationResult.RefreshToken,
    expiresIn: r.AuthenticationResult.ExpiresIn
  }
});
} else if (r.ChallengeName) {
// There are more challenges to complete
return res.json({
  status: 'challenge_required',
  message: 'Additional challenge required',
  challengeName: r.ChallengeName,
  session: r.Session,
  username: username
});
} else {
// Password changed but no tokens (user needs to login again)
return res.json({
  status: 'success',
  message: 'Password changed successfully. Please login with your new password.',
  note: 'No tokens returned - this is normal for NEW_PASSWORD_REQUIRED challenges'
});
}
} catch (error) {
console.error('NEW_PASSWORD_REQUIRED error:', { name: error.name, message: error.message });
return res.status(400).json({ status: 'error', message: 'Failed to set new password', error: error.message });
}
});

// ===================== TOTP SETUP (FIRST LOGIN: CHALLENGE PATH) =====================

// Step 1: Associate software token using Session
router.post('/setup-authenticator-challenge', async (req, res) => {
  try {
    const { session, username } = req.body || {};
    if (!session || !username) return res.status(400).json({ error: 'Session and username are required' });

    const assoc = await cognitoClient.send(new AssociateSoftwareTokenCommand({ Session: session }));

    const issuer = 'Fortress-Portal'; // change to your app/brand
    const accountName = encodeURIComponent(username);
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${accountName}?secret=${assoc.SecretCode}&issuer=${encodeURIComponent(issuer)}`;
    const qrCode = await QRCode.toDataURL(otpauth);

    return res.json({ status: 'success', secretCode: assoc.SecretCode, session: assoc.Session, qrCode });
  } catch (error) {
    console.error('setup-authenticator-challenge error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to setup authenticator (challenge path)', error: error.message });
  }
});

// Step 2: Verify user TOTP using Session, then COMPLETE MFA_SETUP to get tokens
router.post('/verify-authenticator-challenge', async (req, res) => {
  try {
    const { session, userCode, username } = req.body || {};
    if (!session || !userCode || !username) {
      return res.status(400).json({ error: 'Session, authenticator code, and username are required' });
    }

    const verify = await cognitoClient.send(new VerifySoftwareTokenCommand({ Session: session, UserCode: userCode }));
    if (verify.Status !== 'SUCCESS') {
      return res.status(400).json({ status: verify.Status || 'FAILED' });
    }

    const challengeResponses = { USERNAME: username };
    const secretHash = calculateSecretHash(username);
    if (secretHash) challengeResponses.SECRET_HASH = secretHash;

    const complete = await cognitoClient.send(new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CONFIG.clientId,
      ChallengeName: 'MFA_SETUP',
      Session: verify.Session,
      ChallengeResponses: challengeResponses
    }));

    return res.json({
      status: 'success',
      tokens: {
        accessToken: complete.AuthenticationResult.AccessToken,
        idToken: complete.AuthenticationResult.IdToken,
        refreshToken: complete.AuthenticationResult.RefreshToken,
        expiresIn: complete.AuthenticationResult.ExpiresIn
      }
    });
  } catch (error) {
    console.error('verify-authenticator-challenge error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to verify authenticator (challenge path)', error: error.message });
  }
});

// ===================== TOTP SETUP (LOGGED-IN: ACCESSTOKEN PATH) =====================

router.post('/setup-authenticator', async (req, res) => {
  try {
    const { accessToken, accountLabel } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: 'Access token is required' });

    const assoc = await cognitoClient.send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));

    const issuer = 'Fortress-Portal';
    const accountName = accountLabel || 'user';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${assoc.SecretCode}&issuer=${encodeURIComponent(issuer)}`;
    const qrCode = await QRCode.toDataURL(otpauth);

    return res.json({ status: 'success', secretCode: assoc.SecretCode, session: assoc.Session, qrCode });
  } catch (error) {
    console.error('setup-authenticator error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to setup authenticator', error: error.message });
  }
});

router.post('/verify-authenticator', async (req, res) => {
  try {
    const { accessToken, userCode, session } = req.body || {};
    if (!accessToken || !userCode) return res.status(400).json({ error: 'Access token and authenticator code are required' });

    const params = { AccessToken: accessToken, UserCode: userCode };
    if (session) params.Session = session;

    const verify = await cognitoClient.send(new VerifySoftwareTokenCommand(params));

    if (verify.Status === 'SUCCESS') {
      await cognitoClient.send(new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true }
      }));
    }

    return res.json({ status: verify.Status, session: verify.Session });
  } catch (error) {
    console.error('verify-authenticator error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to verify authenticator code', error: error.message });
  }
});

// ===================== PROFILE / UTILS =====================

router.get('/mfa-preferences', async (req, res) => {
  try {
    const accessToken =
      req.headers.accesstoken ||
      req.headers['access-token'] ||
      (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);
    if (!accessToken) return res.status(400).json({ error: 'Access token is required' });

    const response = await cognitoClient.send(new GetUserCommand({ AccessToken: accessToken }));

    return res.json({
      status: 'success',
      preferredMfa: response.PreferredMfaSetting || null,
      availableMfas: response.UserMFASettingList || []
    });
  } catch (error) {
    console.error('mfa-preferences error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to get MFA preferences', error: error.message });
  }
});

// ===================== SIGNUP / CONFIRM =====================

router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, password, email } = req.body || {};
    if (!firstName || !lastName || !password || !email) return res.status(400).json({ error: 'First name, last name, password, and email are required' });

    const params = {
      ClientId: COGNITO_CONFIG.clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'given_name', Value: firstName },
        { Name: 'family_name', Value: lastName }
      ],
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) params.SecretHash = secretHash;

    const r = await cognitoClient.send(new SignUpCommand(params));
    return res.json({
      status: 'success',
      message: 'User registered successfully. Please check your email for verification code.',
      userSub: r.UserSub,
      userConfirmed: r.UserConfirmed
    });
  } catch (error) {
    console.error('Signup error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: error.message || 'Signup failed', error: error.message });
  }
});

router.post('/confirm-signup', async (req, res) => {
  try {
    const { username, code } = req.body || {};
    if (!username || !code) return res.status(400).json({ error: 'Username and verification code are required' });

    const params = {
      ClientId: COGNITO_CONFIG.clientId,
      Username: username,
      ConfirmationCode: code
    };
    const secretHash = calculateSecretHash(username);
    if (secretHash) params.SecretHash = secretHash;

    await cognitoClient.send(new ConfirmSignUpCommand(params));
    return res.json({ status: 'success', message: 'User confirmed successfully' });
  } catch (error) {
    console.error('Confirm signup error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Confirmation failed', error: error.message });
  }
});

// ===================== PASSWORD RESET =====================

router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const params = { ClientId: COGNITO_CONFIG.clientId, Username: username };
    const secretHash = calculateSecretHash(username);
    if (secretHash) params.SecretHash = secretHash;

    await cognitoClient.send(new ForgotPasswordCommand(params));
    return res.json({ status: 'success', message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to initiate password reset', error: error.message });
  }
});

router.post('/confirm-forgot-password', async (req, res) => {
  try {
    const { username, code, newPassword } = req.body || {};
    if (!username || !code || !newPassword) {
      return res.status(400).json({ error: 'Username, code, and new password are required' });
    }

    const params = {
      ClientId: COGNITO_CONFIG.clientId,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword
    };
    const secretHash = calculateSecretHash(username);
    if (secretHash) params.SecretHash = secretHash;

    await cognitoClient.send(new ConfirmForgotPasswordCommand(params));
    return res.json({ status: 'success', message: 'Password reset successful' });
  } catch (error) {
    console.error('Confirm forgot password error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to reset password', error: error.message });
  }
});

// ===================== CHANGE PASSWORD =====================

router.post('/change-password', async (req, res) => {
  try {
    const { accessToken, previousPassword, proposedPassword } = req.body || {};
    
    if (!accessToken || !proposedPassword) {
      return res.status(400).json({ 
        error: 'Access token and proposed password are required' 
      });
    }

    const params = {
      AccessToken: accessToken,
      ProposedPassword: proposedPassword
    };

    // Only include PreviousPassword if provided
    if (previousPassword) {
      params.PreviousPassword = previousPassword;
    }

    await cognitoClient.send(new ChangePasswordCommand(params));
    
    return res.json({ 
      status: 'success', 
      message: 'Password changed successfully' 
    });
    
  } catch (error) {
    console.error('Change password error:', { name: error.name, message: error.message });
    
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({ 
        status: 'error', 
        message: 'Invalid access token or previous password' 
      });
    }
    if (error.name === 'InvalidPasswordException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'New password does not meet requirements' 
      });
    }
    if (error.name === 'PasswordHistoryPolicyViolationException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'New password matches a previous password' 
      });
    }
    if (error.name === 'PasswordResetRequiredException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Password reset is required' 
      });
    }
    if (error.name === 'UserNotFoundException') {
      return res.status(404).json({ 
        status: 'error', 
        message: 'User not found' 
      });
    }
    if (error.name === 'InvalidParameterException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid parameter provided' 
      });
    }
    if (error.name === 'LimitExceededException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Too many requests. Please try again later' 
      });
    }
    if (error.name === 'TooManyRequestsException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Too many requests. Please try again later' 
      });
    }
    if (error.name === 'UserNotConfirmedException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'User is not confirmed' 
      });
    }
    if (error.name === 'ForbiddenException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Request forbidden' 
      });
    }
    if (error.name === 'InternalErrorException') {
      return res.status(500).json({ 
        status: 'error', 
        message: 'Internal server error' 
      });
    }
    if (error.name === 'ResourceNotFoundException') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Resource not found' 
      });
    }
    
    return res.status(500).json({ 
      status: 'error', 
      message: 'Failed to change password', 
      error: error.message 
    });
  }
});

// ===================== REFRESH & SIGNOUT =====================

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, username } = req.body || {};
    if (!refreshToken || !username) return res.status(400).json({ error: 'refreshToken and username are required' });

    const params = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CONFIG.clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken }
    };
    const secretHash = calculateSecretHash(username);
    if (secretHash) params.AuthParameters.SECRET_HASH = secretHash;

    const r = await cognitoClient.send(new InitiateAuthCommand(params));
    return res.json({
      status: 'success',
      tokens: {
        accessToken: r.AuthenticationResult.AccessToken,
        idToken: r.AuthenticationResult.IdToken,
        expiresIn: r.AuthenticationResult.ExpiresIn
      }
    });
  } catch (error) {
    console.error('Refresh error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to refresh tokens', error: error.message });
  }
});

router.post('/signout', async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: 'Access token is required' });

    await cognitoClient.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
    return res.json({ status: 'success', message: 'Signed out globally' });
  } catch (error) {
    console.error('Signout error:', { name: error.name, message: error.message });
    return res.status(400).json({ status: 'error', message: 'Failed to sign out', error: error.message });
  }
});

// ===================== PROTECTED TEST =====================

router.get('/protected-route', async (req, res) => {
  try {
    // Assumes a verifyToken middleware set req.user
    return res.json({ status: 'success', message: 'You have accessed a protected route', user: req.user || null });
  } catch (error) {
    console.error('Protected route error:', { name: error.name, message: error.message });
    return res.status(500).json({ status: 'error', message: 'Error accessing protected route', error: error.message });
  }
});

// ===================== DEBUG ENDPOINTS =====================

// Debug endpoint to test QR code generation with real Cognito
router.post('/debug-setup-authenticator', async (req, res) => {
  try {
    const { session, username, issuer = 'Fortress-Portal' } = req.body || {};
    
    if (!session || !username) {
      return res.status(400).json({ 
        error: 'Session and username are required for debug setup' 
      });
    }

    console.log('=== DEBUG AUTHENTICATOR SETUP ===');
    console.log('Session:', session.substring(0, 20) + '...');
    console.log('Username:', username);
    console.log('Issuer:', issuer);

    // Associate software token using Session
    const assoc = await cognitoClient.send(new AssociateSoftwareTokenCommand({ Session: session }));
    
    console.log('Secret code generated:', assoc.SecretCode ? 'Yes' : 'No');
    console.log('New session:', assoc.Session ? 'Yes' : 'No');

    // Generate QR code
    const accountName = encodeURIComponent(username);
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${accountName}?secret=${assoc.SecretCode}&issuer=${encodeURIComponent(issuer)}`;
    const qrCode = await QRCode.toDataURL(otpauth);

    console.log('QR code generated:', qrCode ? 'Yes' : 'No');
    console.log('QR code length:', qrCode ? qrCode.length : 0);
    console.log('OTP Auth URL:', otpauth);

    return res.json({ 
      status: 'success', 
      message: 'Debug authenticator setup completed',
      debug: {
        sessionReceived: !!session,
        usernameReceived: !!username,
        secretCodeGenerated: !!assoc.SecretCode,
        qrCodeGenerated: !!qrCode,
        qrCodeLength: qrCode ? qrCode.length : 0,
        otpauthUrl: otpauth,
        qrCodePrefix: qrCode ? qrCode.substring(0, 50) + '...' : 'No QR code'
      },
      secretCode: assoc.SecretCode, 
      session: assoc.Session, 
      qrCode,
      otpauthUrl: otpauth,
      instructions: [
        '1. The QR code is returned as a data URL in the qrCode field',
        '2. Display it using: <img src="' + (qrCode ? qrCode.substring(0, 50) + '...' : 'data:image/png;base64,...') + '" />',
        '3. Or use the secretCode to manually add to authenticator app',
        '4. The otpauthUrl can be used directly in some authenticator apps'
      ]
    });
  } catch (error) {
    console.error('Debug setup authenticator error:', { name: error.name, message: error.message });
    return res.status(400).json({ 
      status: 'error', 
      message: 'Debug authenticator setup failed', 
      error: error.message,
      errorType: error.name 
    });
  }
});

// Debug endpoint to test QR code display in different formats
router.get('/debug-qr-formats/:data', async (req, res) => {
  try {
    const { data } = req.params;
    
    // Decode the data
    const decodedData = Buffer.from(data, 'base64').toString('utf-8');
    
    // Generate QR code in different formats
    const qrCodeDataURL = await QRCode.toDataURL(decodedData);
    const qrCodeSVG = await QRCode.toString(decodedData, { type: 'svg' });
    const qrCodeBuffer = await QRCode.toBuffer(decodedData);
    
    res.json({
      status: 'success',
      message: 'QR code formats generated',
      originalData: decodedData,
      formats: {
        dataURL: qrCodeDataURL,
        svg: qrCodeSVG,
        buffer: qrCodeBuffer.toString('base64'),
        dataURLPrefix: qrCodeDataURL.substring(0, 50) + '...',
        svgLength: qrCodeSVG.length,
        bufferSize: qrCodeBuffer.length
      },
      usage: {
        dataURL: 'Use in <img src="data:image/png;base64,..." />',
        svg: 'Use directly in HTML or convert to other formats',
        buffer: 'Use for file downloads or API responses'
      }
    });
  } catch (error) {
    console.error('Debug QR formats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate QR code formats',
      error: error.message
    });
  }
});

export default router;