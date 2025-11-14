// api/cron/midday.js - Midday recall cron job
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN);

module.exports = async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('*');
    if (!users) {
      return res.status(200).json({ message: 'No users found' });
    }
    
    for (const u of users) {
      try {
        await bot.sendMessage(u.chat_id, `Midday recall: can you recall any of today's words? Reply with the word you remember.`);
      } catch (e) {
        console.warn('Error sending midday recall to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: 'Midday recall sent successfully' });
  } catch (error) {
    console.error('Midday cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

