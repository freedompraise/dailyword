// api/cron/weekly.js - Weekly summary cron job
// Note: dotenv.config() removed - Vercel injects env vars directly
const TelegramBot = require('node-telegram-bot-api');
const db = require('../../db');
const { getDueWordsCount } = require('../../lib/spacedRepetition');

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
    const { data: users } = await db().from('users').select('*');
    if (!users) {
      return res.status(200).json({ message: 'No users found' });
    }
    
    for (const u of users) {
      try {
        const { data: words } = await db()
          .from('user_words')
          .select('served_at,served_index,correct_count,words:word_id(word,pronunciation,part_of_speech,definition)')
          .eq('user_id', u.id)
          .gte('served_at', weekStart)
          .order('served_at', { ascending: true });
        
        if (!words || words.length === 0) continue;
        
        // Get stats
        const { data: stat } = await db().from('user_stats').select('streak').eq('user_id', u.id).maybeSingle();
        const dueCount = await getDueWordsCount(u.id, true);
        
        // Count mastered words (3+ correct)
        const masteredCount = words.filter(w => (w.correct_count || 0) >= 3).length;
        
        let summaryText = `📊 <b>Your Weekly Vocabulary Summary</b>\n\n`;
        summaryText += `📚 Words learned this week: <b>${words.length}</b>\n`;
        summaryText += `✅ Words mastered: <b>${masteredCount}</b>\n`;
        if (stat && stat.streak) {
          summaryText += `🔥 Current streak: <b>${stat.streak} days</b>\n`;
        }
        if (dueCount > 0) {
          summaryText += `🔔 Reviews due: <b>${dueCount}</b>\n`;
        }
        summaryText += `\n📖 <b>This week's words:</b>\n\n`;
        
        words.forEach((w, idx) => {
          const wordObj = w.words || {};
          summaryText += `${idx + 1}. <b>${wordObj.word}</b>`;
          if (wordObj.pronunciation) {
            summaryText += ` \`${wordObj.pronunciation}\``;
          }
          if (wordObj.part_of_speech) {
            summaryText += ` <i>(${wordObj.part_of_speech})</i>`;
          }
          summaryText += `\n`;
          if (wordObj.definition) {
            summaryText += `   ${wordObj.definition}\n`;
          }
          // Show mastery status
          const correctCount = w.correct_count || 0;
          if (correctCount >= 3) {
            summaryText += `   ✅ Mastered (${correctCount} correct)\n`;
          } else if (correctCount > 0) {
            summaryText += `   📈 Learning (${correctCount} correct)\n`;
          }
          summaryText += `\n`;
        });
        
        if (dueCount > 0) {
          summaryText += `\n💡 Use /review to practice your due words!`;
        }
        
        await bot.sendMessage(u.chat_id, summaryText, { parse_mode: 'HTML' });
        await bot.sendPoll(
          u.chat_id,
          'How many of your DailyWord words did you actually use in real life this week?',
          ['0', '1-2', '3-5', '6-10', '11+'],
          { is_anonymous: false, allows_multiple_answers: false }
        );
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

