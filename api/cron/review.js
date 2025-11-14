// api/cron/review.js - Review job cron (runs hourly)
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN);

module.exports = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: due } = await supabase.from('user_words').select('id,user_id,word_id,interval,next_review').lte('next_review', now);
    if (!due) {
      return res.status(200).json({ message: 'No reviews due' });
    }
    
    for (const row of due) {
      try {
        const { data: user } = await supabase.from('users').select('*').eq('id', row.user_id).maybeSingle();
        const { data: word } = await supabase.from('words').select('*').eq('id', row.word_id).maybeSingle();
        if (!user || !word) continue;
        
        await bot.sendMessage(user.chat_id, `Review: do you remember the word "${word.word}"? Reply with it if you do.`);
        
        const nextInterval = Math.max(1, Math.round((row.interval || 2) * 2.5));
        const nextReviewDate = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000);
        const nextReview = nextReviewDate.toISOString();
        await supabase.from('user_words').update({ interval: nextInterval, next_review: nextReview }).eq('id', row.id);
      } catch (e) {
        console.warn('runReviewJob error', e);
      }
    }
    
    res.status(200).json({ message: `Review job completed. Processed ${due.length} reviews.` });
  } catch (error) {
    console.error('Review cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

