# AWS Amplify Flawless Deployment Guide

This guide details how to deploy the **Guard Slider CAPTCHA & Anti-Bot System** to AWS Amplify.

---

## Architecture on AWS Amplify

```
[ Visitor Browser ]
        │
        ▼
[ AWS Amplify Hosting (CloudFront CDN Edge) ]
        │
        ├── Static Assets (/index.html, /captcha.js, /captcha.css)
        │
        └── API Rewrites (/api/*)
                │
                ▼
        [ API Gateway / AWS Lambda: guardCaptcha ]
                │
                ├── Challenge Generator (AES-256-GCM + PNG)
                ├── Human Motion Entropy Validator
                └── Protected Route Gatekeeper
```

---

## Method 1: Git Deployment via AWS Amplify Console (Recommended)

This is the fastest, fully automated zero-maintenance deployment.

### Step 1: Push Project to GitHub / GitLab
Initialize a Git repository in `guard` (if not already done) and push to your repository:
```bash
git init
git add .
git commit -m "feat: implement guard slider captcha and antibot for amplify"
git remote add origin https://github.com/YOUR_USERNAME/guard.git
git push -u origin main
```

### Step 2: Connect Repository in AWS Amplify Console
1. Open the [AWS Amplify Console](https://console.aws.amazon.com/amplify/).
2. Click **Deploy an app** (or **New app** > **Host web app**).
3. Select **GitHub** (or your Git provider) and authorize AWS Amplify.
4. Select your `guard` repository and the `main` branch.
5. Click **Next**.

### Step 3: Configure Build Settings
Amplify will automatically detect `amplify.yml` in the root of the project:
- Verify that `baseDirectory: public` is set.
- Under **Advanced settings**, click **Add environment variable**:
  - **Key**: `CAPTCHA_SECRET`
  - **Value**: Any strong 32+ character random string (e.g., `a78f4b0c2e914d3f82a17b6c5e4d3a2b109876543210fedcba`)
  - *(This ensures cryptographic tamper resistance across Lambda executions).*

### Step 4: Configure API Gateway or Function URL
To connect the frontend to the backend function:
1. In the AWS Lambda Console, create/deploy `guardCaptcha` (using the files in `amplify/backend/function/guardCaptcha/src/`).
2. Under **Configuration** > **Function URL**, click **Create Function URL**:
   - Auth type: `NONE`
   - Configure CORS: Allow Origin `*`, Allow Methods `GET, POST, OPTIONS`.
   - Copy the generated URL (e.g. `https://xyz.lambda-url.us-east-1.on.aws/`).

### Step 5: Setup Rewrites and Redirects (Zero-CORS Setup)
In the AWS Amplify Console:
1. Navigate to **App settings** > **Rewrites and redirects**.
2. Click **Edit** and add a reverse proxy rule:
   - **Source address**: `/api/<*>`
   - **Target address**: `https://xyz.lambda-url.us-east-1.on.aws/api/<*>`
   - **Type**: `200 (Rewrite)`
3. Save.

Now, all requests to `/api/captcha/create` and `/api/captcha/verify` from your Amplify domain are transparently forwarded to the Lambda backend with **zero CORS configuration needed**!

---

## Method 2: AWS Amplify CLI Deployment

If you prefer deploying purely from the command line using the Amplify CLI:

### Step 1: Install & Configure Amplify CLI
```powershell
npm install -g @aws-amplify/cli
amplify configure
```

### Step 2: Initialize Amplify in the Project
In `c:\Users\Administrator\Desktop\guard`:
```powershell
amplify init
```
Answer the interactive prompts:
- Project name: `guard`
- Environment name: `prod`
- Default editor: Visual Studio Code (or your preference)
- App type: `javascript`
- Framework: `none`
- Source directory: `public`
- Distribution directory: `public`
- Build command: `npm run build`
- Start command: `npm start`

### Step 3: Add the REST API & Function
```powershell
amplify add api
```
- Select: **REST**
- Provide a friendly name: `guardApi`
- Path: `/api`
- Choose: **Create a new Lambda function**
- Function name: `guardCaptcha`
- Runtime: **NodeJS**
- Advanced settings: **Do you want to configure environment variables?** -> **Yes**
  - Name: `CAPTCHA_SECRET`
  - Value: `<Your-Secret-Hex-String>`

Copy the code from:
`amplify/backend/function/guardCaptcha/src/`
into the generated function directory.

### Step 4: Add Hosting
```powershell
amplify add hosting
```
- Select: **Hosting with Amplify Console**
- Select: **Manual deployment** (or **Continuous deployment with Git**)

### Step 5: Publish / Deploy
```powershell
amplify publish
```

Amplify will provision:
- The S3 bucket and CloudFront CDN for the frontend
- The API Gateway REST API
- The AWS Lambda verification function
- Output the live production URL: `https://prod.xxxxxx.amplifyapp.com`

---

## Verification on AWS Amplify

Once deployed:
1. Open your live Amplify URL (`https://your-app.amplifyapp.com`).
2. Verify the **Guard Shield Active** badge and procedural puzzle canvas appear.
3. Drag the slider to solve the puzzle.
4. Verify the success state triggers, granting access to the protected content card.
