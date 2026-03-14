// index.js - Local development entry point
// Provides Express endpoints that mirror Vercel serverless handlers.

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    console.warn('dotenv not loaded', e.message);
  }
}

const express = require('express');
const bodyParser = require('body-parser');

const webhookHandler = require('./api/webhook');
const adminHandler = require('./api/admin');
const cronDaily = require('./api/cron/daily');
const cronMidday = require('./api/cron/midday');
const cronEvening = require('./api/cron/evening');
const cronReview = require('./api/cron/review');
const cronWeekly = require('./api/cron/weekly');

const app = express();
app.use(bodyParser.json());

// Webhook
app.post('/api/webhook', webhookHandler);

// Admin
app.all('/api/admin', adminHandler);

// Cron routes for local testing
app.all('/api/cron/daily', cronDaily);
app.all('/api/cron/midday', cronMidday);
app.all('/api/cron/evening', cronEvening);
app.all('/api/cron/review', cronReview);
app.all('/api/cron/weekly', cronWeekly);

app.get('/', (req, res) => {
  res.json({ status: 'local dev running' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Local dev server listening on http://localhost:${port}`);
});
