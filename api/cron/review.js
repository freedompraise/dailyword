// api/cron/review.js - Review reminder cron (runs hourly)
// Note: Per SYSTEM_REDESIGN.md, this should NOT send prompts that update next_review before user responds
// Instead, it sends reminders to users with due words to use /review command
// The actual review happens through structured sessions initiated by /review command
// Note: dotenv.config() removed - Vercel injects env vars directly
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
    
    let remindedCount = 0;
    
    for (const u of users) {
      try {
        // Check if user has due reviews (excluding today's words)
        const dueCount = await getDueWordsCount(u.id, true);
        
        // Only remind users with 3+ due words to avoid spam
        if (dueCount >= 3) {
          const sent = await sendMessageSafely(
            u.chat_id,
            `🔔 You have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review!\n\nUse /review to start a practice session.`,
            createReviewStartKeyboard(dueCount, u.review_words_per_session || 3)
          );
          if (sent) remindedCount++;
        }
      } catch (e) {
        console.warn('Error sending review reminder to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: `Review reminder sent to ${remindedCount} users with due words.` });
  } catch (error) {
    console.error('Review cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

