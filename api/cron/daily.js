// api/cron/daily.js - Daily word serving cron job
// Note: dotenv.config() removed - Vercel injects env vars directly
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('Missing required environment variables for daily cron');
}

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;
const genai = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

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
    const { data: existing } = await supabase.from('words').select('id').ilike('word', candidate.word).maybeSingle();
    if (!existing) {
      return candidate;
    }
  }
  return null;
}

async function saveWordAndAssignToUsers(wordObj, servedForUsers = []) {
  const now = new Date();
  const nowISO = now.toISOString();
  const nextReviewDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const nextReviewISO = nextReviewDate.toISOString();
  
  const { data: wordRowData, error: insertError } = await supabase.from('words').insert({
    word: wordObj.word,
    part_of_speech: wordObj.part_of_speech || '',
    definition: wordObj.definition || wordObj.definition || '',
    example: wordObj.example || wordObj.example || '',
    source: 'gemini',
    created_at: nowISO
  }).select().single();

  if (insertError || !wordRowData) return;
  const wordRow = wordRowData;

  for (const u of servedForUsers) {
    await supabase.from('user_words').insert({
      user_id: u.id,
      word_id: wordRow.id,
      served_at: nowISO,
      next_review: nextReviewISO,
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

module.exports = async (req, res) => {
  if (!bot || !genai) {
    return res.status(500).json({ 
      error: 'Bot or AI not configured. Please set TELEGRAM_TOKEN and GEMINI_API_KEY in Vercel environment variables.' 
    });
  }

  try {
    const { data: users } = await supabase.from('users').select('*');
    if (!users) {
      return res.status(200).json({ message: 'No users found' });
    }
    
    for (const u of users) {
      try {
        await serveWordsToUser(u);
      } catch (e) {
        console.warn('serveWordsToUser error', e);
      }
    }
    
    res.status(200).json({ message: 'Daily words served successfully' });
  } catch (error) {
    console.error('Daily cron error:', error);
    res.status(500).json({ error: error.message });
  }
};

