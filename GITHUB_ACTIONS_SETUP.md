# GitHub Actions + AWS Elastic Beanstalk Setup Guide

## 🚀 **Overview**
This guide sets up automatic deployment of your Node.js backend to AWS Elastic Beanstalk using GitHub Actions. Every push to main/master will trigger a deployment.

## 📋 **Prerequisites**
- GitHub repository with your backend code
- AWS account with Elastic Beanstalk access
- AWS IAM user with appropriate permissions

## 🔑 **Required GitHub Secrets**

You need to add these secrets in your GitHub repository:

### 1. **AWS Credentials**
```
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
```

### 2. **Elastic Beanstalk Configuration**
```
EB_APPLICATION_NAME=your-eb-application-name
EB_STAGING_ENVIRONMENT=staging-env
EB_PRODUCTION_ENVIRONMENT=production-env
EB_SERVICE_ROLE=aws-elasticbeanstalk-service-role
```

## 🛠️ **Setup Steps**

### Step 1: Create IAM User for GitHub Actions

1. **Go to AWS IAM Console**
2. **Create a new user** (e.g., `github-actions-user`)
3. **Attach policies:**
   - `AWSElasticBeanstalkFullAccess`
   - `AmazonS3FullAccess` (for deployment artifacts)

### Step 2: Create Elastic Beanstalk Application

1. **Go to Elastic Beanstalk Console**
2. **Create Application:**
   - Application name: `your-backend-app`
   - Platform: `Node.js`
   - Platform branch: `Node.js 18`
   - Platform version: Latest

3. **Create Environment:**
   - Environment name: `staging-env`
   - Domain: `your-app-staging.region.elasticbeanstalk.com`

### Step 3: Add GitHub Secrets

1. **Go to your GitHub repository**
2. **Settings → Secrets and variables → Actions**
3. **Add the following secrets:**

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
EB_APPLICATION_NAME=your-backend-app
EB_STAGING_ENVIRONMENT=staging-env
EB_PRODUCTION_ENVIRONMENT=production-env
EB_SERVICE_ROLE=aws-elasticbeanstalk-service-role
```

### Step 4: Push Your Code

The workflow will automatically run when you push to main/master:

```bash
git add .
git commit -m "Add GitHub Actions workflow"
git push origin main
```

## 🔄 **Workflow Features**

### **Basic Workflow** (`.github/workflows/deploy.yml`)
- ✅ Runs tests
- ✅ Deploys to Elastic Beanstalk
- ✅ Health check after deployment

### **Advanced Workflow** (`.github/workflows/deploy-advanced.yml`)
- ✅ Security scanning
- ✅ Staging deployment (automatic)
- ✅ Production deployment (manual trigger)
- ✅ Better error handling
- ✅ Health checks for both environments

## 📊 **Workflow Triggers**

- **Push to main/master**: Automatic staging deployment
- **Pull Request**: Run tests only
- **Manual trigger**: Deploy to specific environment

## 🚨 **Troubleshooting**

### Common Issues:

1. **Permission Denied**
   - Check IAM user permissions
   - Verify AWS credentials in GitHub secrets

2. **Environment Not Found**
   - Ensure environment names match exactly
   - Check if environments exist in Elastic Beanstalk

3. **Deployment Fails**
   - Check Elastic Beanstalk logs
   - Verify environment variables are set
   - Check health endpoint is accessible

### Debug Commands:

```bash
# Check EB status
eb status

# View logs
eb logs

# SSH into instance
eb ssh
```

## 🔒 **Security Best Practices**

1. **Use IAM roles with minimal permissions**
2. **Rotate AWS access keys regularly**
3. **Enable CloudTrail for audit logging**
4. **Use VPC for network isolation**
5. **Enable HTTPS for production environments**

## 📈 **Monitoring & Alerts**

1. **Set up CloudWatch alarms**
2. **Monitor deployment metrics**
3. **Set up Slack/email notifications**
4. **Track deployment success rates**

## 🎯 **Next Steps**

1. **Set up your GitHub repository**
2. **Create AWS resources**
3. **Add GitHub secrets**
4. **Push your code**
5. **Monitor deployments**

## 📞 **Support**

If you encounter issues:
1. Check GitHub Actions logs
2. Review Elastic Beanstalk events
3. Check AWS CloudWatch logs
4. Verify all secrets are set correctly
