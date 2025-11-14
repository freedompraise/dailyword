// api/cron/evening.js - Evening usage challenge cron job
// Note: dotenv.config() removed - Vercel injects env vars directly
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');

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
        await bot.sendMessage(u.chat_id, `Evening challenge: use each of today's words in a sentence about your day. Reply with your sentences.`);
      } catch (e) {
        console.warn('Error sending evening challenge to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: 'Evening challenge sent successfully' });
  } catch (error) {
    console.error('Evening cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

