// api/cron/daily.js

import TelegramBot from 'node-telegram-bot-api';
import supabase from '../../supabaseClient';
import { InferenceClient } from '@huggingface/inference';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HF_TOKEN = process.env.HF_API_KEY;

if (!TELEGRAM_TOKEN || !HF_TOKEN) {
  console.error('Missing required environment variables for daily cron');
}

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

async function getUsedWords(limit = 500) {
  const { data, error } = await supabase
    .from('words')
    .select('word')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(r => r.word.toLowerCase());
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

Do not use words previously used.`;
}

async function generateWithSeed(seed, avoidList = []) {
  try {
    const prompt = `${promptForSeededWord(seed)}${avoidList.length ? "\nAvoid these words: " + JSON.stringify(avoidList.slice(0,200)) : ''}`;
    const response = await hf.textGeneration({
      model: 'mistralai/Mistral-7B-Instruct-v0.2',
      inputs: prompt,
      parameters: { max_new_tokens: 64, temperature: 0.9 }
    });
    const text = response.generated_text;

    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const jsonText = (start !== -1 && end !== -1) ? text.substring(start, end + 1) : text;
      return JSON.parse(jsonText);
    } catch (e) {
      console.warn('Error parsing JSON from HF output:', e, 'raw:', text);
      return null;
    }
  } catch (error) {
    console.error('Error generating word with HF:', error);
    return null;
  }
}

async function generateUniqueWord(avoidList = []) {
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i++) {
    const seed = Math.floor(Math.random() * 1e9) + i;
    const candidate = await generateWithSeed(seed, avoidList);
    if (!candidate || !candidate.word) continue;

    const { data: existing } = await supabase
      .from('words')
      .select('id')
      .ilike('word', candidate.word)
      .maybeSingle();

    if (!existing) return candidate;
  }
  return null;
}

async function saveWordAndAssignToUsers(wordObj, servedForUsers = []) {
  const nowISO = new Date().toISOString();
  const nextReviewISO = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: wordRowData, error: insertError } = await supabase
    .from('words')
    .insert({
      word: wordObj.word,
      part_of_speech: wordObj.part_of_speech || '',
      definition: wordObj.definition || '',
      example: wordObj.example || '',
      source: 'hf',
      created_at: nowISO
    })
    .select()
    .single();

  if (insertError || !wordRowData) return;

  for (const u of servedForUsers) {
    await supabase.from('user_words').insert({
      user_id: u.id,
      word_id: wordRowData.id,
      served_at: nowISO,
      next_review: nextReviewISO,
      interval: 2,
      served_index: u.index || 1
    });
  }

  return wordRowData;
}

async function serveWordsToUser(user) {
  const wordsToSend = [];
  const used = await getUsedWords(1000);

  for (let i = 0; i < user.words_per_day; i++) {
    const candidate = await generateUniqueWord(used);
    if (!candidate) continue;
    used.unshift(candidate.word.toLowerCase());
    wordsToSend.push(candidate);
    await saveWordAndAssignToUsers(candidate, [{ id: user.id, index: i + 1 }]);
  }

  if (!wordsToSend.length) {
    await bot.sendMessage(user.chat_id, 'Unable to generate today words. Try again later.');
    return;
  }

  let text = `Words of the day (${wordsToSend.length}):\n\n`;
  wordsToSend.forEach((w, idx) => {
    text += `${idx + 1}. ${w.word}\n`;
    if (w.part_of_speech) text += `${w.part_of_speech}\n`;
    text += `Definition: ${w.definition}\nExample: ${w.example}\n\n`;
  });
  text += 'Reply to the prompts today to practise.';
  await bot.sendMessage(user.chat_id, text);
}

export default async function handler(req, res) {
  if (!bot || !hf) {
    return res.status(500).json({ error: 'Bot or HF not configured' });
  }
  try {
    const { data: users } = await supabase.from('users').select('*');
    if (!users) return res.status(200).json({ message: 'No users found' });
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
}
