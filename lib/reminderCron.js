// lib/reminderCron.js - Shared helpers for review reminder cron jobs
const TelegramBot = require('node-telegram-bot-api');
const repo = require('./repo');
const { getDueCountsMap } = require('./spacedRepetition');
const { createReviewStartKeyboard } = require('./keyboardUtils');

const DEFAULT_MIN_DUE = 3;

function buildBotFromEnv(env = process.env) {
  const token = env.TELEGRAM_TOKEN;
  return token ? new TelegramBot(token) : null;
}

function defaultMessage({ dueCount }) {
  const plural = dueCount === 1 ? '' : 's';
  return `You have ${dueCount} word${plural} due for review!\n\nUse /review to start a practice session.`;
}

async function sendReminders({ bot, users, dueMap, minDue, messageBuilder }) {
  let reminded = 0;

  for (const user of users) {
    const dueCount = dueMap.get(user.id) || 0;
    if (dueCount < minDue) continue;

    const text = messageBuilder({ user, dueCount });

    try {
      await bot.sendMessage(
        user.chat_id,
        text,
        createReviewStartKeyboard(dueCount, user.review_words_per_session || 3)
      );
      reminded++;
    } catch (e) {
      console.warn('Error sending reminder to user', user.chat_id, e);
    }
  }

  return reminded;
}

function createDueReminderHandler({
  label = 'Reminder',
  minDue = DEFAULT_MIN_DUE,
  messageBuilder = defaultMessage
} = {}) {
  const bot = buildBotFromEnv();

  return async (req, res) => {
    if (!bot) {
      return res.status(500).json({
        error: 'Bot not configured. Please set TELEGRAM_TOKEN in Vercel environment variables.'
      });
    }

    try {
      const { data: users } = await repo.getUsersBasic();
      if (!users || users.length === 0) {
        return res.status(200).json({ message: 'No users found' });
      }

      const dueMap = await getDueCountsMap(users.map(u => u.id), true);
      const remindedCount = await sendReminders({
        bot,
        users,
        dueMap,
        minDue,
        messageBuilder
      });

      return res.status(200).json({
        message: `${label} reminder sent to ${remindedCount} users with due words.`
      });
    } catch (error) {
      console.error(`${label} cron error:`, error);
      return res.status(500).json({ error: error.message });
    }
  };
}

module.exports = {
  createDueReminderHandler,
  buildBotFromEnv
};
