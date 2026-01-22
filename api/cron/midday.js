// api/cron/midday.js - Midday reminder cron job
// Sends reminder to users with due reviews to use /review command
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { getDueWordsCount } = require('../../lib/spacedRepetition');
const { createReviewStartKeyboard } = require('../../lib/keyboardUtils');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;

function isBotBlockedError(error) {
  return error?.response?.statusCode === 403 || 
         error?.message?.includes('403') || 
         error?.message?.includes('Forbidden') ||
         error?.message?.includes('bot was blocked')
}

async function sendMessageSafely(chatId, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, options)
    return true
  } catch (error) {
    if (isBotBlockedError(error)) {
      console.warn(`Bot blocked by user ${chatId}, skipping message`)
      return false
    }
    throw error
  }
}

module.exports = async (req, res) => {
  if (!bot) {
    return res.status(500).json({ 
      error: 'Bot not configured. Please set TELEGRAM_TOKEN in Vercel environment variables.' 
    });
  }

  try {
    const { data: users } = await supabase.from('users').select('*');
    if (!users) {
      return res.status(200).json({ message: 'No users found' });
    }
    
    for (const u of users) {
      try {
        // Only send if user has due reviews (avoid spam if they're already caught up)
        const dueCount = await getDueWordsCount(u.id, true);
        
        if (dueCount >= 3) {
          // Only remind if 3+ words due (same threshold as review cron)
          await sendMessageSafely(
            u.chat_id,
            `💡 Midday check-in: You have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review.\n\nUse /review to practice now!`,
            createReviewStartKeyboard(dueCount, u.review_words_per_session || 3)
          );
        }
        // If fewer than 3 due, skip reminder (user is caught up)
      } catch (e) {
        console.warn('Error sending midday reminder to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: 'Midday reminder sent successfully' });
  } catch (error) {
    console.error('Midday cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

