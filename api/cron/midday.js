// api/cron/midday.js - Midday recall cron job
// Note: This cron is deprecated per SYSTEM_REDESIGN.md - midday/evening crons are "orphaned"
// Users should use /review command for structured recall challenges
// This file is kept for backward compatibility but sends a message directing users to /review
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { getTodayWords } = require('../spacedRepetition');
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
        // Check if user has today's words
        const todayWords = await getTodayWords(u.id);
        
        if (todayWords.length > 0) {
          // User has today's words - suggest structured review
          const { data: dueCount } = await supabase
            .from('user_words')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', u.id)
            .lte('next_review', new Date().toISOString())
            .lt('served_at', new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');
          
          const count = dueCount || 0;
          
          if (count > 0) {
            await bot.sendMessage(
              u.chat_id,
              `💡 Midday reminder: You have ${count} word${count !== 1 ? 's' : ''} due for review!\n\nUse /review to start a structured practice session.`,
              createReviewStartKeyboard(count, u.review_words_per_session || 3)
            );
          } else {
            // No reviews due, but has today's words - suggest practicing them
            await bot.sendMessage(
              u.chat_id,
              `💡 Midday reminder: Practice today's words! Use the buttons on your word cards to start challenges, or use /today to see them again.`
            );
          }
        } else {
          // No today's words - just remind about review
          await bot.sendMessage(
            u.chat_id,
            `💡 Use /review to practice your vocabulary words!`
          );
        }
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

