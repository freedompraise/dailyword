// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const supabase = require('./supabaseClient');
const scheduler = require('./scheduler');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null;

const DAILY_HOUR = parseInt(process.env.DAILY_HOUR || '8', 10);
const MIDDAY_HOUR = parseInt(process.env.MIDDAY_HOUR || '12', 10);
const EVENING_HOUR = parseInt(process.env.EVENING_HOUR || '20', 10);
const WEEKLY_SUMMARY_HOUR = parseInt(process.env.WEEKLY_SUMMARY_HOUR || '20', 10);
const MAX_WORDS_PER_DAY = Math.min(3, Math.max(1, parseInt(process.env.MAX_WORDS_PER_DAY || '1', 10)));

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('TELEGRAM_TOKEN or GEMINI_API_KEY missing in env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

async function ensureUser(chatId) {
  const now = Date.now();
  const { data, error } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: newUser, error: insertErr } = await supabase.from('users').insert({ chat_id: String(chatId), words_per_day: 1, created_at: now }).select().maybeSingle();
  if (insertErr) throw insertErr;
  await supabase.from('user_stats').insert({ user_id: newUser.id, streak: 0, last_completed: null }).maybeSingle();
  return newUser;
}

async function getUsedWords(limit = 500) {
  const { data, error } = await supabase.from('words').select('word').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.word.toLowerCase());
}

function promptForSeededWord(seed) {
  return `You are a concise vocabulary generator.
Use the numeric seed ${seed} to produce one uncommon but useful English word.
Return only valid JSON in this exact shape with no extra text:

{
  "word": "singleword",
  "part_of_speech": "noun|verb|adjective|adverb",
  "definition": "one line definition",
  "example": "one example sentence using the word"
}

Do not use words previously used. If the model attempts to use a previously used word, respond with a different word.`;
}

async function generateWithSeed(seed, avoidList = []) {
  const model = genai.getGenerativeModel({ model: 'gemini-pro' });

  const avoidSnippet = avoidList && avoidList.length ? `\nAvoid these words: ${JSON.stringify(avoidList.slice(0, 200))}\n` : '';

  const prompt = `${promptForSeededWord(seed)}${avoidSnippet}`;

  const result = await model.generateContent(prompt);
  const text = result.response?.text?.() || result.outputText || '';

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const jsonText = start !== -1 && end !== -1 ? text.substring(start, end + 1) : text;
    const parsed = JSON.parse(jsonText);
    return parsed;
  } catch (e) {
    return null;
  }
}

async function generateUniqueWord(avoidList = []) {
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i++) {
    const seed = Math.floor(Math.random() * 1e9) + i;
    const candidate = await generateWithSeed(seed, avoidList);
    if (!candidate || !candidate.word) continue;
    const existing = await supabase.from('words').select('id').ilike('word', candidate.word).maybeSingle();
    if (!existing || !existing.data) {
      return candidate;
    }
  }
  return null;
}

async function saveWordAndAssignToUsers(wordObj, servedForUsers = []) {
  const now = Date.now();
  const { data: wordRow } = await supabase.from('words').insert({
    word: wordObj.word,
    part_of_speech: wordObj.part_of_speech || '',
    definition: wordObj.definition || wordObj.definition || '',
    example: wordObj.example || wordObj.example || '',
    source: 'gemini',
    created_at: now
  }).select().maybeSingle();

  if (!wordRow) return;

  for (const u of servedForUsers) {
    await supabase.from('user_words').insert({
      user_id: u.id,
      word_id: wordRow.id,
      served_at: now,
      next_review: now + 2 * 24 * 60 * 60 * 1000,
      interval: 2,
      served_index: u.index || 1
    });
  }

  return wordRow;
}

async function serveWordsToUser(user) {
  const wordsToSend = [];
  const used = await getUsedWords(1000);
  for (let i = 0; i < user.words_per_day; i++) {
    const candidate = await generateUniqueWord(used);
    if (!candidate) continue;
    used.unshift(candidate.word.toLowerCase());
    wordsToSend.push(candidate);
    await saveWordAndAssignToUsers({
      word: candidate.word,
      part_of_speech: candidate.part_of_speech,
      definition: candidate.definition,
      example: candidate.example
    }, [{ id: user.id, index: i + 1 }]);
  }

  if (wordsToSend.length === 0) {
    await bot.sendMessage(user.chat_id, "Unable to generate today's words. Try again later.");
    return; 
  }

  let text = `Words of the day (${wordsToSend.length}):\n\n`;
  wordsToSend.forEach((w, idx) => {
    text += `${idx + 1}. ${w.word}\n${w.part_of_speech ? `${w.part_of_speech}\n` : ''}Definition: ${w.definition}\nExample: ${w.example}\n\n`;
  });
  text += 'Reply to the prompts today to practise.';

  await bot.sendMessage(user.chat_id, text);
}

async function serveWordToAllUsers() {
  const { data: users } = await supabase.from('users').select('*');
  if (!users) return;
  for (const u of users) {
    try {
      await serveWordsToUser(u);
    } catch (e) {
      console.warn('serveWordsToUser error', e);
    }
  }
}

async function middayRecall() {
  const { data: users } = await supabase.from('users').select('*');
  if (!users) return;
  for (const u of users) {
    await bot.sendMessage(u.chat_id, `Midday recall: can you recall any of today's words? Reply with the word you remember.`);
  }
}

async function eveningUsage() {
  const { data: users } = await supabase.from('users').select('*');
  if (!users) return;
  for (const u of users) {
    await bot.sendMessage(u.chat_id, `Evening challenge: use each of today's words in a sentence about your day. Reply with your sentences.`);
  }
}

async function runReviewJob() {
  const now = Date.now();
  const { data: due } = await supabase.from('user_words').select('id,user_id,word_id,interval,next_review').lte('next_review', now);
  if (!due) return;
  for (const row of due) {
    try {
      const { data: user } = await supabase.from('users').select('*').eq('id', row.user_id).maybeSingle();
      const { data: word } = await supabase.from('words').select('*').eq('id', row.word_id).maybeSingle();
      if (!user || !word) continue;
      await bot.sendMessage(user.chat_id, `Review: do you remember the word "${word.word}"? Reply with it if you do.`);
      const nextInterval = Math.max(1, Math.round((row.interval || 2) * 2.5));
      const nextReview = now + nextInterval * 24 * 60 * 60 * 1000;
      await supabase.from('user_words').update({ interval: nextInterval, next_review: nextReview }).eq('id', row.id);
    } catch (e) {
      console.warn('runReviewJob error', e);
    }
  }
}

async function weeklySummary() {
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const { data: users } = await supabase.from('users').select('*');
  if (!users) return;
  for (const u of users) {
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
  }
}

async function updateUserStreak(userId) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const { data: stat } = await supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
  if (!stat) {
    await supabase.from('user_stats').insert({ user_id: userId, streak: 1, last_completed: now });
    return;
  }
  if (stat.last_completed && now - stat.last_completed <= oneDay * 2) {
    await supabase.from('user_stats').update({ streak: stat.streak + 1, last_completed: now }).eq('id', stat.id);
  } else {
    await supabase.from('user_stats').update({ streak: 1, last_completed: now }).eq('id', stat.id);
  }
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user = await ensureUser(chatId);
    await bot.sendMessage(chatId, 'Welcome. I will send new words daily. Use /setwords N to choose 1 to 3 words per day.');
    if (ADMIN_CHAT_ID) await bot.sendMessage(ADMIN_CHAT_ID, `New user started: ${chatId}`);
  } catch (e) {
    console.error('Error in /start', e);
    await bot.sendMessage(chatId, 'Registration error occurred.');
  }
});

bot.onText(/\/setwords (1|2|3)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const num = parseInt(match[1], 10);
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) {
    await bot.sendMessage(chatId, 'Not registered. Send /start first.');
    return;
  }
  await supabase.from('users').update({ words_per_day: num }).eq('id', user.id);
  await bot.sendMessage(chatId, `Set words per day to ${num}`);
});

bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  const { data: wordRow } = await supabase.from('words').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!wordRow) {
    await bot.sendMessage(chatId, 'No word available yet.');
    return;
  }
  await bot.sendMessage(chatId, `Word: ${wordRow.word}\nDefinition: ${wordRow.definition}\nExample: ${wordRow.example}`);
});

bot.onText(/\/progress/, async (msg) => {
  const chatId = msg.chat.id;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) return bot.sendMessage(chatId, 'Not registered. Send /start.');
  const { data: stat } = await supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle();
  const { data: learned } = await supabase.from('user_words').select('id,served_at,word_id,words:word_id(word)').eq('user_id', user.id).order('served_at', { ascending: true });
  let text = `Progress:\n\nWords served: ${learned ? learned.length : 0}\nStreak: ${stat ? stat.streak : 0}\n\nRecent words:\n`;
  if (learned && learned.length > 0) learned.slice(-10).forEach((l) => { text += `${l.words?.word}\n`; });
  await bot.sendMessage(chatId, text);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', String(chatId)).maybeSingle();
  if (!user) return;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const { data: pending } = await supabase.from('user_words').select('id,word_id,last_response,served_at,words:word_id(word)').eq('user_id', user.id).gte('served_at', todayMs).order('served_at', { ascending: true });
  if (!pending || pending.length === 0) return;
  const shortReply = text.split(' ').length <= 3;
  if (shortReply) {
    const lastPending = pending[pending.length - 1];
    const expected = (lastPending.words && lastPending.words.word) || '';
    if (text.toLowerCase().includes(expected.toLowerCase())) {
      await supabase.from('user_words').update({ correct_count: (lastPending.correct_count || 0) + 1 }).eq('id', lastPending.id);
      await bot.sendMessage(chatId, 'Nice recall. You got it.');
    } else {
      await supabase.from('user_words').update({ last_response: text }).eq('id', lastPending.id);
      await bot.sendMessage(chatId, `Not quite. The correct word was: ${expected}`);
    }
    return;
  }
  for (const p of pending) {
    if (!p.last_response) {
      await supabase.from('user_words').update({ last_response: text }).eq('id', p.id);
    }
  }
  await bot.sendMessage(chatId, 'Thanks. Your usage is saved. Streak updated.');
  try {
    await updateUserStreak(user.id);
  } catch (e) {
    console.warn('updateUserStreak error', e);
  }
});

async function start() {
  scheduler.start({
    dailyHour: DAILY_HOUR,
    middayHour: MIDDAY_HOUR,
    eveningHour: EVENING_HOUR,
    serveWordToAllUsers,
    middayRecall,
    eveningUsage,
    runReviewJob,
    weeklySummaryHour: WEEKLY_SUMMARY_HOUR,
    weeklySummary
  });

  const app = express();
  app.get('/', (req, res) => res.send('Vocab bot running'));
  app.listen(process.env.PORT || 3000, () => console.log('Server listening'));
}

start().catch((e) => {
  console.error('Fatal error starting bot', e);
  process.exit(1);
});
