// api/cron/evening.js - Evening reminder cron job
// Sends reminder to users with due reviews to use /review command
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { getDueWordsCount } = require('../../lib/spacedRepetition');
const { createReviewStartKeyboard } = require('../../lib/keyboardUtils');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;

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
          await bot.sendMessage(
            u.chat_id,
            `🌙 Evening check-in: You have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review.\n\nUse /review to practice before tomorrow's new words.`,
            createReviewStartKeyboard(dueCount, u.review_words_per_session || 3)
          );
        }
        // If fewer than 3 due, skip reminder (user is caught up)
      } catch (e) {
        console.warn('Error sending evening reminder to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: 'Evening reminder sent successfully' });
  } catch (error) {
    console.error('Evening cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

