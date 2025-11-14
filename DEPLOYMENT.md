# Deployment Guide for Vercel

This guide will help you deploy your Telegram bot to Vercel.

## Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. A Telegram bot token from [@BotFather](https://t.me/botfather)
3. Supabase project credentials
4. Google Gemini API key

## Step 1: Prepare Environment Variables

You'll need to set these environment variables in Vercel:

- `TELEGRAM_TOKEN` - Your Telegram bot token
- `GEMINI_API_KEY` - Your Google Gemini API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key
- `ADMIN_CHAT_ID` - (Optional) Your Telegram chat ID for admin notifications

## Step 2: Deploy to Vercel

### Option A: Using Vercel CLI

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy:
```bash
vercel
```

4. Set environment variables:
```bash
vercel env add TELEGRAM_TOKEN
vercel env add GEMINI_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add ADMIN_CHAT_ID  # Optional
```

5. Deploy to production:
```bash
vercel --prod
```

### Option B: Using GitHub Integration

1. Push your code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and click "New Project"
3. Import your GitHub repository
4. Add environment variables in the Vercel dashboard:
   - Go to Project Settings → Environment Variables
   - Add all required variables
5. Deploy

## Step 3: Set Up Telegram Webhook

After deployment, you need to configure Telegram to send updates to your webhook.

### Get Your Vercel URL

After deployment, Vercel will give you a URL like: `https://your-project.vercel.app`

### Set the Webhook

Run this command (replace with your actual values):

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/webhook"
```

Or use the provided script:

```bash
node scripts/set-webhook.js
```

## Step 4: Set Up GitHub Actions for Cron Jobs

Since you're using the free Vercel plan, we'll use GitHub Actions to trigger the cron jobs.

### Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:
   - **Name**: `VERCEL_URL`
   - **Value**: Your Vercel deployment URL (e.g., `https://your-project.vercel.app`)

### Verify GitHub Actions Workflow

The workflow file `.github/workflows/cron.yml` is already configured with these schedules (UTC):

- **Daily words**: 8:00 AM UTC (0 8 * * *)
- **Midday recall**: 12:00 PM UTC (0 12 * * *)
- **Evening challenge**: 8:00 PM UTC (0 20 * * *)
- **Review job**: Every hour (0 * * * *)
- **Weekly summary**: Sunday 8:00 PM UTC (0 20 * * 0)

**Note**: 
- GitHub Actions will automatically run these schedules
- Times are in UTC - adjust the cron expressions in `.github/workflows/cron.yml` if needed
- You can manually trigger jobs from the Actions tab in GitHub

## Step 5: Test Your Bot

1. Send `/start` to your bot on Telegram
2. Test other commands: `/setwords 2`, `/today`, `/progress`
3. Check Vercel function logs in the dashboard

## Troubleshooting

### Webhook not receiving updates
- Verify the webhook is set: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check Vercel function logs
- Ensure the webhook URL is accessible (HTTPS required)

### Cron jobs not running
- Check GitHub Actions workflow runs in your repository's Actions tab
- Verify the `VERCEL_URL` secret is set correctly in GitHub
- Ensure the workflow file `.github/workflows/cron.yml` is committed to your repository
- Check that GitHub Actions are enabled for your repository (Settings → Actions → General)

### Environment variables not working
- Ensure variables are set for Production, Preview, and Development
- Redeploy after adding new environment variables

## Important Notes

1. **GitHub Actions**: The cron jobs are handled by GitHub Actions (free for public repos). The workflow automatically triggers your Vercel endpoints at scheduled times.

2. **Cold Starts**: Serverless functions may have cold starts. This is normal and shouldn't affect functionality.

3. **Function Timeout**: Vercel has execution time limits. If your cron jobs take too long, consider breaking them into smaller batches.

4. **GitHub Actions Limits**: 
   - Free accounts: 2,000 minutes/month for private repos, unlimited for public repos
   - Each cron job run uses minimal minutes (usually < 1 minute)
   - Monitor usage in your repository's Actions tab

## Manual Testing

You can manually trigger cron jobs for testing:

1. Go to your GitHub repository
2. Click on **Actions** tab
3. Select **Bot Cron Jobs** workflow
4. Click **Run workflow** button
5. Choose which job to run (daily, midday, evening, review, or weekly)

