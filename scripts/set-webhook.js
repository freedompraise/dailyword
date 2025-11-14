// scripts/set-webhook.js - Script to set Telegram webhook
require('dotenv').config();
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.argv[2];

if (!TELEGRAM_TOKEN) {
  console.error('Error: TELEGRAM_TOKEN not found in environment variables');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error('Error: WEBHOOK_URL not provided');
  console.log('Usage: node scripts/set-webhook.js <webhook-url>');
  console.log('Example: node scripts/set-webhook.js https://your-project.vercel.app/api/webhook');
  process.exit(1);
}

async function setWebhook() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`;
    const response = await axios.post(url, {
      url: WEBHOOK_URL
    });
    
    if (response.data.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Webhook URL:', WEBHOOK_URL);
      
      // Get webhook info
      const infoResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo`);
      console.log('\nWebhook Info:');
      console.log(JSON.stringify(infoResponse.data.result, null, 2));
    } else {
      console.error('❌ Failed to set webhook:', response.data.description);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error setting webhook:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

setWebhook();

