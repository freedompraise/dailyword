// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const supabase = require('./supabaseClient');
const scheduler = require('./scheduler');

const {
  TELEGRAM_TOKEN,
  DAILY_HOUR = 8,
  MIDDAY_HOUR = 12,
  EVENING_HOUR = 20,
  ADMIN_CHAT_ID,
  WORDNIK_API_KEY,
  MAX_WORDS_PER_DAY = 2
} = process.env;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

async function getWordOfTheDay() {
  if (WORDNIK_API_KEY) {
    try {
      const res = await axios.get('https://api.wordnik.com/v4/words.json/wordOfTheDay', {
        params: { api_key: WORDNIK_API_KEY }
      });
      const w = res.data;
      return {
        word: w.word,
        definition: (w.definitions && w.definitions[0]?.text) || '',
        example: (w.examples && w.examples[0]?.text) || '',
        source: 'wordnik'
      };
    } catch (e) {
      console.warn('Wordnik fetch failed, using local fallback.');
    }
  }
  const local = [
    { word: 'ebullient', definition: 'cheerful and full of energy', example: 'Her ebullient personality lit the room.' },
    { word: 'laconic', definition: 'using very few words', example: 'His laconic reply ended the discussion.' },
    { word: 'perspicacious', definition: 'having keen insight', example: 'A perspicacious student noticed the flaw.' }
  ];
  return local[Math.floor(Math.random() * local.length)];
}

async function ensureUser(chatId) {
  const now = Date.now();
  let { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('chat_id', chatId)
    .single();

  if (error || !data) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({ chat_id: chatId, created_at: now })
      .select()
      .single();
    return newUser.id;
  }
  return data.id;
}

async function saveWord(item) {
  const now = Date.now();
  const { data: wordRow } = await supabase
    .from('words')
    .insert({
      word: item.word,
      definition: item.definition || '',
      example: item.example || '',
      source: item.source || 'local',
      created_at: now
    })
    .select()
    .single();
  return wordRow.id;
}

async function serveWordToAllUsers() {
  const item = await getWordOfTheDay();
  const wordId = await saveWord(item);

  const { data: users } = await supabase.from('users').select('*');
  const now = Date.now();

  for (const u of users) {
    await supabase.from('user_words').insert({
      user_id: u.id,
      word_id: wordId,
      served_at: now,
      next_review: now + 2 * 24 * 60 * 60 * 1000,
      interval: 2
    });
    const text = `Word of the day: ${item.word}\nDefinition: ${item.definition}\nExample: ${item.example}\n\nReply with one sentence using this word.`;
    bot.sendMessage(u.chat_id, text).catch(console.warn);
  }
}


async function serveWordsToUser(user) {
  const now = Date.now();
  const words = [];

  for (let i = 0; i < MAX_WORDS_PER_DAY; i++) {
    const item = await getWordOfTheDay();
    const wordId = await saveWord(item);
    await supabase.from('user_words').insert({
      user_id: user.id,
      word_id: wordId,
      served_at: now,
      next_review: now + 2 * 24 * 60 * 60 * 1000,
      interval: 2
    });
    words.push(item);
  }

  let text = 'Words of the day:\n';
  words.forEach((w, idx) => {
    text += `${idx + 1}. ${w.word} — ${w.definition}\nExample: ${w.example}\n\n`;
  });
  text += 'Reply to prompts during the day to practice each word.';
  await bot.sendMessage(user.chat_id, text);
}

async function middayRecall() {
  const { data: users } = await supabase.from('users').select('*');
  for (const u of users) {
    bot.sendMessage(u.chat_id, "Midday recall: can you remember today's word? Reply with the word.");
  }
}

async function eveningUsage() {
  const { data: users } = await supabase.from('users').select('*');
  for (const u of users) {
    bot.sendMessage(u.chat_id, "Evening usage: use today's word in a sentence about your day.");
  }
}

async function runReviewJob() {
  const now = Date.now();
  const { data: due } = await supabase
    .from('user_words')
    .select('id,user_id,word_id,interval')
    .lte('next_review', now);

  for (const row of due) {
    const { data: user } = await supabase.from('users').select('*').eq('id', row.user_id).single();
    const { data: word } = await supabase.from('words').select('*').eq('id', row.word_id).single();
    if (!user || !word) continue;

    bot.sendMessage(user.chat_id, `Review: do you remember the word "${word.word}"? Reply with it if you do.`);

    const nextInterval = Math.round(row.interval * 2.5);
    const nextReview = now + nextInterval * 24 * 60 * 60 * 1000;

    await supabase.from('user_words').update({ interval: nextInterval, next_review: nextReview }).eq('id', row.id);
  }
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id.toString();
  await ensureUser(chatId);
  bot.sendMessage(chatId, 'Welcome! I will send one new word each day. Reply to prompts to practice.');
  if (ADMIN_CHAT_ID) bot.sendMessage(ADMIN_CHAT_ID, `New user started: ${chatId}`);
});

bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const { data: wordRow } = await supabase.from('words').select('*').order('id', { ascending: false }).limit(1).single();
  if (!wordRow) return bot.sendMessage(chatId, 'No word yet. Wait for the next scheduled word.');
  bot.sendMessage(chatId, `Word: ${wordRow.word}\nDefinition: ${wordRow.definition}\nExample: ${wordRow.example}`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;

  const { data: user } = await supabase.from('users').select('*').eq('chat_id', chatId).single();
  if (!user) return;

  const { data: last } = await supabase
    .from('user_words')
    .select('id,word_id')
    .eq('user_id', user.id)
    .order('served_at', { ascending: false })
    .limit(1)
    .single();

  if (!last) return;

  const { data: word } = await supabase.from('words').select('*').eq('id', last.word_id).single();
  if (!word) return;

  if (text.toLowerCase().includes(word.word.toLowerCase())) {
    await supabase.from('user_words').update({ correct_count: 1 }).eq('id', last.id);
    bot.sendMessage(chatId, 'Nice! You recalled it correctly.');
  } else {
    await supabase.from('user_words').update({ last_response: text }).eq('id', last.id);
    bot.sendMessage(chatId, `Got it! The word was: ${word.word}`);
  }
});

async function start() {
  scheduler.start({
    dailyHour: parseInt(DAILY_HOUR),
    middayHour: parseInt(MIDDAY_HOUR),
    eveningHour: parseInt(EVENING_HOUR),
    serveWordToAllUsers,
    middayRecall,
    eveningUsage,
    runReviewJob
  });

  const app = express();
  app.get('/', (req, res) => res.send('Vocab bot running'));
  app.listen(process.env.PORT || 3000, () => console.log('Server listening'));
}

start();
