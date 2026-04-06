// api/cron/midday.js - Midday reminder cron job
const { createDueReminderHandler } = require('../../lib/reminderCron');

module.exports = createDueReminderHandler({
  label: 'Midday',
  minDue: 3,
  messageBuilder: ({ dueCount }) =>
    `ðŸ’¡ Midday check-in: You have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review.\n\nUse /review to practice now!`
});
