# AWS Elastic Beanstalk Deployment Guide

## Prerequisites
- AWS CLI installed and configured
- Elastic Beanstalk CLI (eb-cli) installed
- Your application code committed to git

## Environment Variables to Set in Elastic Beanstalk

### Required Environment Variables:
```
NODE_ENV=production
PORT=8081
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_ad1psldfI
NEXT_PUBLIC_COGNITO_CLIENT_ID=cabkj0egcqag1v4f9siu3j6gh
NEXT_PUBLIC_COGNITO_CLIENT_SECRET=your_client_secret
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret
ZOHO_ACCESS_TOKEN=your_zoho_access_token
ZOHO_REFRESH_TOKEN=your_zoho_refresh_token
ALLOWED_ORIGINS=https://yourdomain.com
```

### Optional Environment Variables:
```
NODE_ENV=production
PORT=8081
```

## Deployment Steps

### 1. Initialize Elastic Beanstalk (First time only)
```bash
eb init
# Follow the prompts to select your region, application name, etc.
```

### 2. Create Environment
```bash
eb create production-env
# This will create a new environment and deploy your code
```

### 3. Set Environment Variables
```bash
eb setenv NODE_ENV=production
eb setenv PORT=8081
# Set all other required environment variables
```

### 4. Deploy Updates
```bash
eb deploy
```

### 5. Check Status
```bash
eb status
eb health
```

### 6. View Logs
```bash
eb logs
```

## Important Notes

- **Port**: Elastic Beanstalk expects your app to listen on port 8081 (or the port specified in PORT env var)
- **Health Check**: Your `/health` endpoint will be used by Elastic Beanstalk for health checks
- **Environment Variables**: All sensitive data should be set via Elastic Beanstalk environment variables, not in code
- **CORS**: Update `ALLOWED_ORIGINS` to match your frontend domain in production

## Troubleshooting

### Common Issues:
1. **Port binding errors**: Ensure your app listens on `process.env.PORT`
2. **Environment variables missing**: Check all required variables are set in EB
3. **CORS errors**: Verify `ALLOWED_ORIGINS` is set correctly
4. **Zoho token issues**: Ensure Zoho credentials are valid and not expired

### Useful Commands:
```bash
eb ssh          # SSH into your EC2 instance
eb logs --all   # View all logs
eb events       # View deployment events
eb terminate    # Delete environment (be careful!)
```
