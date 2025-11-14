// api/cron/weekly.js - Weekly summary cron job
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
    const weekStartDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekStart = weekStartDate.toISOString();
    const { data: users } = await supabase.from('users').select('*');
    if (!users) {
      return res.status(200).json({ message: 'No users found' });
    }
    
    for (const u of users) {
      try {
        const { data: words } = await supabase.from('user_words').select('served_at,served_index,words:word_id(word,definition,example)').eq('user_id', u.id).gte('served_at', weekStart).order('served_at', { ascending: true });
        if (!words || words.length === 0) continue;
        
        let summaryText = 'Your weekly vocabulary summary:\n\n';
        words.forEach((w, idx) => {
          const wordObj = w.words || {};
          summaryText += `${idx + 1}. ${wordObj.word}\n`;
          if (wordObj.definition) summaryText += `   ${wordObj.definition}\n`;
        });
        
        const { data: stat } = await supabase.from('user_stats').select('streak').eq('user_id', u.id).maybeSingle();
        if (stat && stat.streak) summaryText += `\nCurrent streak: ${stat.streak} days`;
        
        await bot.sendMessage(u.chat_id, summaryText);
      } catch (e) {
        console.warn('Error sending weekly summary to user', u.chat_id, e);
      }
    }
    
    res.status(200).json({ message: 'Weekly summary sent successfully' });
  } catch (error) {
    console.error('Weekly cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

