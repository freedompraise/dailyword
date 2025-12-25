// api/cron/evening.js - Evening reminder cron job
// Note: This cron is deprecated per SYSTEM_REDESIGN.md - evening challenges are "orphaned"
// Users should use /review command for structured recall challenges
// This file is kept for backward compatibility but sends a reminder directing users to /review
// Note: dotenv.config() removed - Vercel injects env vars directly
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { getDueWordsCount } = require('../spacedRepetition');
const { createReviewStartKeyboard } = require('../keyboardUtils');

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
        // Check for due reviews
        const dueCount = await getDueWordsCount(u.id, true);
        
        if (dueCount > 0) {
          await bot.sendMessage(
            u.chat_id,
            `🌙 Evening reminder: You have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review!\n\nUse /review to practice before tomorrow's new words.`,
            createReviewStartKeyboard(dueCount, u.review_words_per_session || 3)
          );
        } else {
          // No reviews due - just a friendly reminder
          await bot.sendMessage(
            u.chat_id,
            `🌙 Great job today! Keep up the learning streak. Use /progress to see your stats.`
          );
        }
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

