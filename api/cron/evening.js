// api/cron/evening.js - Evening reminder cron job
const { createDueReminderHandler } = require('../../lib/reminderCron');

module.exports = createDueReminderHandler({
  label: 'Evening',
  minDue: 3,
  messageBuilder: ({ dueCount }) =>
    `ðŸŒ™ Evening check-in: ${dueCount} word${dueCount !== 1 ? 's' : ''} are ready for review.\n\nClear a batch with /review before tomorrow's drop.`
});
