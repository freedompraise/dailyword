// scheduler.js
const cron = require('node-cron');

function scheduleAtHour(hour, fn) {
  const rule = `0 ${hour} * * *`;
  return cron.schedule(rule, fn, { timezone: 'Africa/Lagos' });
}

function start(config) {
  const {
    dailyHour,
    middayHour,
    eveningHour,
    serveWordToAllUsers,
    middayRecall,
    eveningUsage,
    runReviewJob,
    weeklySummaryHour,
    weeklySummary
  } = config;

  scheduleAtHour(dailyHour, serveWordToAllUsers);
  scheduleAtHour(middayHour, middayRecall);
  scheduleAtHour(eveningHour, eveningUsage);
  cron.schedule('0 * * * *', runReviewJob, { timezone: 'Africa/Lagos' });
  cron.schedule(`0 ${weeklySummaryHour} * * 0`, weeklySummary, { timezone: 'Africa/Lagos' });
}

module.exports = { start };
