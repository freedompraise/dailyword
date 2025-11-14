// api/webhook.js - Telegram webhook handler
// Note: dotenv.config() removed - Vercel injects env vars directly
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../supabaseClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getWelcomeMessage, getHelpMessage, getFriendlyResponse, hasReceivedTodayWords, formatTimeUntilNextWord } = require('./utils');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null;

// Validate required environment variables
if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('Missing required environment variables:', {
    hasToken: !!TELEGRAM_TOKEN,
    hasGeminiKey: !!GEMINI_API_KEY
  });
}

// Initialize bot and AI - will fail gracefully if tokens are missing
let bot, genai;
try {
  if (TELEGRAM_TOKEN) {
    bot = new TelegramBot(TELEGRAM_TOKEN);
  }
  if (GEMINI_API_KEY) {
    genai = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
} catch (error) {
  console.error('Error initializing bot or AI:', error);
}

async function ensureUser(chatId) {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
    if (error) {
      console.error('Error fetching user:', error);
      throw new Error(`Database error: ${error.message || 'Failed to fetch user'}`);
    }
    if (data) return data;
    
    const { data: newUserData, error: insertErr } = await supabase.from('users').insert({ chat_id: String(chatId), words_per_day: 1, created_at: now }).select().single();
    if (insertErr) {
      console.error('Error inserting user:', insertErr);
      throw new Error(`Database error: ${insertErr.message || 'Failed to create user'}`);
    }
    if (!newUserData) {
      throw new Error('Failed to create user - no data returned');
    }
    
    const newUser = newUserData;
    const { error: statsErr } = await supabase.from('user_stats').insert({ user_id: newUser.id, streak: 0, last_completed: null });
    if (statsErr) {
      console.warn('Error inserting user_stats (non-critical):', statsErr);
      // Don't throw - user creation succeeded
    }
    return newUser;
  } catch (error) {
    console.error('ensureUser error:', error);
    // Re-throw with more context
    if (error.message && error.message.includes('fetch failed')) {
      throw new Error('Network error connecting to database. Please try again in a moment.');
    }
    throw error;
  }
}

async function updateUserStreak(userId) {
  const now = new Date();
  const nowISO = now.toISOString();
  const oneDay = 24 * 60 * 60 * 1000;
  const { data: stat } = await supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
  if (!stat) {
    await supabase.from('user_stats').insert({ user_id: userId, streak: 1, last_completed: nowISO });
    return;
  }
  if (stat.last_completed) {
    const lastCompletedDate = new Date(stat.last_completed);
    const timeDiff = now.getTime() - lastCompletedDate.getTime();
    if (timeDiff <= oneDay * 2) {
      await supabase.from('user_stats').update({ streak: stat.streak + 1, last_completed: nowISO }).eq('id', stat.id);
    } else {
      await supabase.from('user_stats').update({ streak: 1, last_completed: nowISO }).eq('id', stat.id);
    }
  } else {
    await supabase.from('user_stats').update({ streak: 1, last_completed: nowISO }).eq('id', stat.id);
  }
}

// Helper function to safely get message from update
function getMessageFromUpdate(update) {
  return update.message || update.edited_message || update.channel_post || update.edited_channel_post || null;
}

// Helper function to safely get chat ID from message
function getChatId(msg) {
  if (!msg || !msg.chat) return null;
  return msg.chat.id;
}

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
  if (!msg || !msg.chat) {
    console.warn('Invalid message in /start handler');
    return;
  }
  const chatId = msg.chat.id;
  try {
    // Check if user already exists
    const { data: existingUser } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
    const isNewUser = !existingUser;
    
    const user = await ensureUser(chatId);
    
    // Check if user has received today's words
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    const { data: todayWords } = await supabase.from('user_words')
      .select('served_at')
      .eq('user_id', user.id)
      .gte('served_at', todayISO);
    
    const hasTodayWords = hasReceivedTodayWords(todayWords);
    const welcomeMsg = getWelcomeMessage(isNewUser, hasTodayWords);
    
    await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'HTML' });
    
    if (isNewUser && ADMIN_CHAT_ID) {
      await bot.sendMessage(ADMIN_CHAT_ID, `🎉 New user started: ${chatId}`);
    }
  } catch (e) {
    console.error('Error in /start', e);
    await bot.sendMessage(chatId, '😔 Oops! Something went wrong. Please try again in a moment.');
  }
});

bot.onText(/\/setwords (1|2|3)/, async (msg, match) => {
  if (!msg || !msg.chat) {
    console.warn('Invalid message in /setwords handler');
    return;
  }
  const chatId = msg.chat.id;
  const num = parseInt(match[1], 10);
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) {
    await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
    return;
  }
  await supabase.from('users').update({ words_per_day: num }).eq('id', user.id);
  const emoji = num === 1 ? '📖' : num === 2 ? '📚' : '📚📚📚';
  await bot.sendMessage(chatId, `${emoji} Perfect! I'll send you ${num} word${num > 1 ? 's' : ''} every day.\n\nThis will take effect from tomorrow's delivery!`);
});

bot.onText(/\/today/, async (msg) => {
  if (!msg || !msg.chat) {
    console.warn('Invalid message in /today handler');
    return;
  }
  const chatId = msg.chat.id;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) {
    await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
    return;
  }
  
  // Get today's words for this user
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const { data: userWords } = await supabase.from('user_words')
    .select('word_id,words:word_id(word,part_of_speech,definition,example)')
    .eq('user_id', user.id)
    .gte('served_at', todayISO)
    .order('served_at', { ascending: true });
  
  if (!userWords || userWords.length === 0) {
    const timeUntil = formatTimeUntilNextWord();
    await bot.sendMessage(chatId, `📖 You haven't received today's words yet.\n\n⏰ Your next words will arrive in ${timeUntil}!\n\nIn the meantime, use /help to see what you can do.`);
    return;
  }
  
  let message = `📚 Today's Words (${userWords.length}):\n\n`;
  userWords.forEach((uw, idx) => {
    const word = uw.words || {};
    message += `${idx + 1}. <b>${word.word}</b>\n`;
    if (word.part_of_speech) message += `   <i>${word.part_of_speech}</i>\n`;
    message += `   Definition: ${word.definition}\n`;
    message += `   Example: ${word.example}\n\n`;
  });
  message += `💡 Remember to reply to the prompts today to practice!`;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
});

bot.onText(/\/progress/, async (msg) => {
  if (!msg || !msg.chat) {
    console.warn('Invalid message in /progress handler');
    return;
  }
  const chatId = msg.chat.id;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) {
    await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
    return;
  }
  
  const { data: stat } = await supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle();
  const { data: learned } = await supabase.from('user_words')
    .select('id,served_at,word_id,words:word_id(word)')
    .eq('user_id', user.id)
    .order('served_at', { ascending: true });
  
  const wordCount = learned ? learned.length : 0;
  const streak = stat ? stat.streak : 0;
  
  let text = `📊 Your Learning Progress\n\n`;
  text += `📚 Total words learned: <b>${wordCount}</b>\n`;
  text += `🔥 Current streak: <b>${streak} day${streak !== 1 ? 's' : ''}</b>\n`;
  text += `📖 Words per day: <b>${user.words_per_day}</b>\n\n`;
  
  if (learned && learned.length > 0) {
    text += `✨ Recent words:\n`;
    learned.slice(-10).reverse().forEach((l, idx) => {
      text += `${idx + 1}. ${l.words?.word || 'N/A'}\n`;
    });
  } else {
    text += `💡 Start learning! Your first words are coming soon!`;
  }
  
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

bot.onText(/\/help/, async (msg) => {
  if (!msg || !msg.chat) {
    console.warn('Invalid message in /help handler');
    return;
  }
  const chatId = msg.chat.id;
  const helpMsg = getHelpMessage();
  await bot.sendMessage(chatId, helpMsg);
});

bot.on('message', async (msg) => {
  // Guard: ensure message and chat exist
  if (!msg || !msg.chat) {
    console.warn('Invalid message in message handler');
    return;
  }
  
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) return;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const { data: pending } = await supabase.from('user_words').select('id,word_id,last_response,served_at,words:word_id(word)').eq('user_id', user.id).gte('served_at', todayISO).order('served_at', { ascending: true });
  if (!pending || pending.length === 0) return;
  const shortReply = text.split(' ').length <= 3;
  if (shortReply) {
    const lastPending = pending[pending.length - 1];
    const expected = (lastPending.words && lastPending.words.word) || '';
    const isCorrect = text.toLowerCase().includes(expected.toLowerCase());
    
    if (isCorrect) {
      await supabase.from('user_words').update({ correct_count: (lastPending.correct_count || 0) + 1 }).eq('id', lastPending.id);
      const response = getFriendlyResponse(true, expected);
      await bot.sendMessage(chatId, response);
    } else {
      await supabase.from('user_words').update({ last_response: text }).eq('id', lastPending.id);
      const response = getFriendlyResponse(false, expected);
      await bot.sendMessage(chatId, response);
    }
    return;
  }
  for (const p of pending) {
    if (!p.last_response) {
      await supabase.from('user_words').update({ last_response: text }).eq('id', p.id);
    }
  }
  await bot.sendMessage(chatId, '✨ Great! Your usage has been saved and your streak has been updated. Keep up the excellent work! 💪');
  try {
    await updateUserStreak(user.id);
  } catch (e) {
    console.warn('updateUserStreak error', e);
  }
});

module.exports = async (req, res) => {
  // Check if bot is initialized
  if (!bot) {
    console.error('Bot not initialized - TELEGRAM_TOKEN missing');
    return res.status(500).json({ error: 'Bot not configured. Please set TELEGRAM_TOKEN in Vercel environment variables.' });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Validate update structure
      if (!update || typeof update !== 'object') {
        console.warn('Invalid update received:', update);
        return res.status(200).send('OK');
      }
      
      // Handle different update types safely
      // Check for non-message update types first and ignore them
      if (update.callback_query) {
        console.log('Callback query received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.inline_query) {
        console.log('Inline query received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chosen_inline_result) {
        console.log('Chosen inline result received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.poll) {
        console.log('Poll update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.poll_answer) {
        console.log('Poll answer received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.my_chat_member) {
        console.log('Chat member update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chat_member) {
        console.log('Chat member update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chat_join_request) {
        console.log('Chat join request received (ignored)');
        return res.status(200).send('OK');
      }
      
      // Only process updates that have message-like structures
      const message = getMessageFromUpdate(update);
      
      // If no message-like structure, log and ignore
      if (!message) {
        console.log('Update without message structure received:', Object.keys(update));
        return res.status(200).send('OK');
      }
      
      // Ensure message has required structure before processing
      if (!message.chat || !message.chat.id) {
        console.warn('Message missing chat or chat.id:', message);
        return res.status(200).send('OK');
      }
      
      // Process the update - bot handlers will receive the message
      // Only process if we have a valid message structure
      try {
        await bot.processUpdate(update);
      } catch (processError) {
        // If processUpdate fails, log but don't crash
        console.error('Error in bot.processUpdate:', processError);
        // Still return 200 to Telegram
      }
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error processing update:', error);
      // Always return 200 to Telegram to prevent retries
      res.status(200).send('OK');
    }
  } else {
    res.status(200).send('Webhook endpoint');
  }
};

