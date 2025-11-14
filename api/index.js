// api/index.js - Root endpoint
module.exports = async (req, res) => {
  res.status(200).json({ 
    message: 'Vocab Telegram Bot API',
    status: 'running',
    endpoints: {
      webhook: '/api/webhook',
      cron: {
        daily: '/api/cron/daily',
        midday: '/api/cron/midday',
        evening: '/api/cron/evening',
        review: '/api/cron/review',
        weekly: '/api/cron/weekly'
      }
    }
  });
};
