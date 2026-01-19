/**
 * Local development wrapper for webhook.js
 * Loads environment variables from .env file for local testing
 */

// Only load dotenv in local development (not in production/Vercel)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  try {
    require('dotenv').config();
    console.log('✅ Loaded environment variables from .env file');
  } catch (error) {
    console.warn('⚠️  dotenv not available, using system environment variables');
  }
}

// Import and export the webhook handler
const webhookHandler = require('./api/webhook');

// For local testing, you can run: node local.js
// Or use with a local server like: npx vercel dev
module.exports = webhookHandler;

// If running directly, start a simple HTTP server for testing
if (require.main === module) {
  const http = require('http');
  const port = process.env.PORT || 3000;
  
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          req.body = JSON.parse(body);
          await webhookHandler(req, res);
        } catch (error) {
          console.error('Error processing request:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else {
      res.statusCode = 200;
      res.end('Local webhook server running. POST to /webhook to test.');
    }
  });
  
  server.listen(port, () => {
    console.log(`🚀 Local webhook server running on http://localhost:${port}/webhook`);
    console.log(`📝 POST Telegram updates to http://localhost:${port}/webhook`);
  });
}

