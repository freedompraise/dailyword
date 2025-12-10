// api/cron/daily.js
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { InferenceClient } = require('@huggingface/inference');

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
  "example": "one short example sentence using the word",
  "example_2": "a second short example in a different context"
}

Do not use words previously used. Prefer practical, non-obscure words people should know.`;
}

const STARTER_WORDS = [
  { word: 'serendipity', part_of_speech: 'noun', definition: 'the occurrence of events by chance in a happy way', example: 'Finding that book was pure serendipity.', example_2: 'Their meeting was pure serendipity.' },
  { word: 'lucid', part_of_speech: 'adjective', definition: 'expressed clearly; easy to understand', example: 'She wrote a lucid explanation.', example_2: 'After a nap, his thoughts felt lucid.' },
  { word: 'succinct', part_of_speech: 'adjective', definition: 'briefly and clearly expressed', example: 'He gave a succinct summary.', example_2: 'Keep your cover letter succinct.' },
  { word: 'mirth', part_of_speech: 'noun', definition: 'amusement, especially as expressed in laughter', example: 'The room was full of mirth.', example_2: 'Their mirth was contagious.' },
  { word: 'diligent', part_of_speech: 'adjective', definition: 'showing care and conscientiousness in work', example: 'Her diligent study paid off.', example_2: 'He is diligent about meeting deadlines.' }
];

function getStarterWord(avoidList = []) {
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()));
  return STARTER_WORDS.find(w => !avoidLower.has(w.word.toLowerCase())) || null;
}

async function getReusableWordFromDb(avoidList = []) {
  const { data, error } = await supabase
    .from('words')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('Error fetching reusable words:', error);
    return null;
  }
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()));
  const candidates = (data || []).filter(w => !avoidLower.has((w.word || '').toLowerCase()));
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    word: pick.word,
    part_of_speech: pick.part_of_speech || '',
    definition: pick.definition || '',
    example: pick.example || '',
    example_2: pick.example_2 || pick.example || ''
  };
}

async function generateWithSeed(seed, avoidList = []) {
  try {
    const prompt = `${promptForSeededWord(seed)}${avoidList.length ? "\nAvoid these words: " + JSON.stringify(avoidList.slice(0,200)) : ''}`;
    const response = await hf.textGeneration({
      model: 'HuggingFaceH4/zephyr-7b-beta',
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
    if (i === 0) {
      const reusable = await getReusableWordFromDb(avoidList);
      if (reusable) return reusable;
    }
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
  // Fallback to starter word if generation failed
  const starter = getStarterWord(avoidList);
  return starter || null;
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
  // If user has many due reviews, make it a review-only day
  const now = Date.now();
  const { data: dueReviews } = await supabase
    .from('user_words')
    .select('id')
    .eq('user_id', user.id)
    .lte('next_review', now);
  if (dueReviews && dueReviews.length >= 5) {
    await bot.sendMessage(user.chat_id, 'Today is a review day—clear your pending reviews first. Use /review.');
    return;
  }

  // If user is new or has very few words, prefer starter set to avoid API calls
  const { data: learnedWords } = await supabase
    .from('user_words')
    .select('id')
    .eq('user_id', user.id);

  const wordsToSend = [];
  const used = await getUsedWords(1000);

  for (let i = 0; i < user.words_per_day; i++) {
    const candidate =
      (learnedWords && learnedWords.length < 3 ? getStarterWord(used) : null) ||
      await generateUniqueWord(used);
    if (!candidate) continue;
    used.unshift(candidate.word.toLowerCase());
    wordsToSend.push(candidate);
    await saveWordAndAssignToUsers(candidate, [{ id: user.id, index: i + 1 }]);
  }

  if (!wordsToSend.length) {
    await bot.sendMessage(user.chat_id, 'Light day today—no new words. You can review with /review.');
    return;
  }

  let text = `Words of the day (${wordsToSend.length}):\n\n`;
  wordsToSend.forEach((w, idx) => {
    text += `${idx + 1}. ${w.word}\n`;
    if (w.part_of_speech) text += `${w.part_of_speech}\n`;
    text += `Definition: ${w.definition}\nExample: ${w.example}\n`;
    if (w.example_2) text += `Example 2: ${w.example_2}\n`;
    text += `\n`;
  });
  text += 'Reply to the prompts today to practise.';
  await bot.sendMessage(user.chat_id, text);
}

module.exports = async function handler(req, res) {
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
