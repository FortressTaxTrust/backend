# GitHub Actions Deployment Workflow

## Overview
This workflow deploys your Node.js application to AWS Elastic Beanstalk with comprehensive error handling and debugging feedback at every step.

## Workflow File: `deploy-to-eb.yml`

### Triggers
1. **Automatic deployment** - Triggered on push to `main` or `master` branch (deploys to staging)
2. **Manual deployment** - Can be triggered manually from GitHub Actions tab with environment selection

### Required GitHub Secrets
You already have these configured:
- `AWS_ACCESS_KEY_ID` - Your AWS access key ✅
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key ✅
- `EB_APPLICATION_NAME` - Your EB application name (fortressFromTheBack) ✅
- `EB_SERVICE_ROLE` - Your EB service role ✅
- `EB_STAGING_ENVIRONMENT` - Your staging environment name ✅

**Optional (for production deployments):**
- `EB_PRODUCTION_ENVIRONMENT` - Your production environment name (if you have one)

## How to Use

### Automatic Deployment
Simply push to the `main` or `master` branch:
```bash
git push origin main
```

### Manual Deployment
1. Go to your repository on GitHub
2. Click on the "Actions" tab
3. Select "Deploy to AWS Elastic Beanstalk" workflow
4. Click "Run workflow"
5. Select the environment (staging or production)
6. Click "Run workflow" button

## Enhanced Features

### 🔍 Pre-deployment Checks
- **AWS Credentials Validation** - Verifies AWS access and shows account details
- **Elastic Beanstalk Access** - Confirms you can access EB services
- **GitHub Secrets Validation** - Checks all required secrets are configured
- **Application Verification** - Ensures your EB application exists
- **Environment Verification** - Confirms environment exists and is not terminated
- **File Checks** - Verifies essential files (package.json, Procfile)

### 📊 Deployment Monitoring
- **Real-time Status Updates** - Shows environment status every 20 seconds
- **Event Streaming** - Displays recent EB events during deployment
- **Health Monitoring** - Tracks environment health throughout deployment
- **Instance Health Details** - Shows detailed instance health if issues arise
- **Deployment Package Info** - Lists files being deployed and checks for large files

### 🏥 Post-deployment Verification
- **Environment Details** - Shows version, platform, and URL information
- **Application Health Checks** - Tests root and /health endpoints
- **Response Code Validation** - Verifies expected HTTP responses
- **Deployment Summary** - Final status report with all key information

### 🛠️ Error Handling
- **Detailed Error Messages** - Specific guidance for each failure type
- **AWS CLI Fallbacks** - Uses AWS CLI when EB CLI might fail
- **Timeout Protection** - 10-minute deployment timeout with clear messaging
- **Graceful Degradation** - Continues when non-critical steps fail

## Key Features
- ✅ Correct EB CLI syntax (no --environment flag issues)
- ✅ Automatic EB CLI configuration
- ✅ Environment variable management
- ✅ Comprehensive health checks
- ✅ Real-time deployment monitoring
- ✅ Detailed error diagnostics
- ✅ Cleanup of temporary files

## Understanding the Output

### Step-by-Step Feedback
Each step provides clear feedback:
- 📋 Information/Status
- ✅ Success indicators
- ⚠️ Warnings (non-fatal)
- ❌ Errors (fatal)
- 🔍 Diagnostic information

### Key Monitoring Points
1. **Deployment Information** - Shows who triggered, when, and from which branch
2. **AWS Validation** - Confirms credentials work and shows account info
3. **EB Verification** - Lists available environments if target not found
4. **Deployment Progress** - Real-time status with recent events
5. **Health Checks** - HTTP status codes and response details
6. **Final Summary** - Complete deployment overview with next steps

## Troubleshooting

### If deployment fails, check these steps:

#### 1. AWS Credentials Validation Failed
```
❌ ERROR: AWS credentials are invalid or not configured!
```
**Solution:** Verify your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets

#### 2. Elastic Beanstalk Access Failed
```
❌ ERROR: Cannot access Elastic Beanstalk. Check IAM permissions!
```
**Solution:** Ensure your AWS user has necessary EB permissions

#### 3. Application Not Found
```
❌ ERROR: Application 'appname' not found in Elastic Beanstalk!
```
**Solution:** Check `EB_APPLICATION_NAME` secret matches exactly

#### 4. Environment Not Found
```
❌ ERROR: Environment 'env-name' not found!
Available environments for application 'appname':
```
**Solution:** The workflow will list available environments - update your secret

#### 5. Deployment Timeout
```
⚠️ WARNING: Timeout waiting for deployment to complete
```
**Solution:** Check AWS Console - deployment might still be in progress

#### 6. Health Check Failed
```
⚠️ Root endpoint returned unexpected status: 503
```
**Solution:** This might be normal during startup - check CloudWatch logs

### Common Issues:
- **"package.json not found"** - Ensure you're deploying from the correct directory
- **"Environment health is Severe"** - Check instance health details shown in output
- **"No /health endpoint found"** - This is just informational, not an error
- **Large file warnings** - Consider adding large files to .gitignore

## Debugging Tips

1. **Read the Full Output** - The workflow provides extensive diagnostics
2. **Check Recent Events** - EB events show what's happening during deployment
3. **Monitor Health Status** - Watch for status changes from "Updating" to "Ready"
4. **Review Instance Health** - If deployment fails, instance details are shown
5. **Use AWS Console Links** - Direct links to AWS Console are provided in summary

## Notes
- The workflow uses Node.js 18 for GitHub Actions runner (compatible with your Node.js 22 EB environment)
- Deployment timeout is set to 30 minutes for the EB deploy command
- Monitoring timeout is 10 minutes for the deployment to complete
- The workflow waits for the environment to be healthy before completing
- Temporary EB configuration files are cleaned up after deployment
- All timestamps are shown for tracking deployment duration
