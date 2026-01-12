// api/cron/daily.js
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../../supabaseClient');
const { InferenceClient } = require('@huggingface/inference');
const { createNewWordCardKeyboard } = require('../../lib/keyboardUtils');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HF_TOKEN = process.env.HF_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null;

if (!TELEGRAM_TOKEN || !HF_TOKEN) {
  console.error('Missing required environment variables for daily cron');
}

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

// Admin alerting function
async function notifyAdminOfFailure(userId, reason, details = {}) {
  if (!ADMIN_CHAT_ID || !bot) {
    console.warn('Admin alerting not configured (ADMIN_CHAT_ID or bot missing)');
    return;
  }
  
  try {
    const message = `⚠️ Word Generation Failure\n\n` +
      `User ID: ${userId}\n` +
      `Reason: ${reason}\n` +
      `Details: ${JSON.stringify(details, null, 2)}\n` +
      `Time: ${new Date().toISOString()}`;
    
    await bot.sendMessage(ADMIN_CHAT_ID, message);
    console.log(`Admin alert sent for user ${userId}`);
  } catch (error) {
    console.error('Failed to send admin alert:', error);
  }
}

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
  "pronunciation": "phonetic respelling here",
  "part_of_speech": "noun|verb|adjective|adverb",
  "definition": "one line definition",
  "example": "one short example sentence using the word",
  "example_2": "a second short example in a different context"
}

Do not use words previously used. Prefer practical, non-obscure words people should know.
Provide pronunciation as phonetic respelling (e.g., "ser-uhn-DIP-i-tee" for serendipity, not IPA notation).`;
}

// Get random word from database that user hasn't learned yet
async function getRandomWordFromDb(userId, avoidList = []) {
  // Get words this user has already learned
  const { data: userWords } = await supabase
    .from('user_words')
    .select('word_id')
    .eq('user_id', userId);
  
  const learnedWordIds = userWords ? userWords.map(uw => uw.word_id) : [];
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()));
  
  // Get all words, excluding learned ones and avoid list
  let query = supabase
    .from('words')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  
  if (learnedWordIds.length > 0) {
    query = query.not('id', 'in', `(${learnedWordIds.join(',')})`);
  }
  
  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    // If no unused words, get any word from database
    const { data: anyWord } = await supabase
      .from('words')
      .select('*')
      .limit(1)
      .single();
    if (anyWord && !avoidLower.has((anyWord.word || '').toLowerCase())) {
      return {
        word: anyWord.word,
        pronunciation: anyWord.pronunciation || '',
        part_of_speech: anyWord.part_of_speech || '',
        definition: anyWord.definition || '',
        example: anyWord.example || '',
        example_2: anyWord.example_2 || anyWord.example || ''
      };
    }
    return null;
  }
  
  // Filter out avoid list
  const candidates = data.filter(w => !avoidLower.has((w.word || '').toLowerCase()));
  if (candidates.length === 0) return null;
  
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    word: pick.word,
    pronunciation: pick.pronunciation || '',
    part_of_speech: pick.part_of_speech || '',
    definition: pick.definition || '',
    example: pick.example || '',
    example_2: pick.example_2 || pick.example || ''
  };
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
    pronunciation: pick.pronunciation || '',
    part_of_speech: pick.part_of_speech || '',
    definition: pick.definition || '',
    example: pick.example || '',
    example_2: pick.example_2 || pick.example || ''
  };
}

function parseGeneratedCandidate(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  
  try {
    // Try to extract JSON from the response
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      console.warn('No JSON found in AI response:', rawText.substring(0, 200));
      return null;
    }
    
    const jsonText = rawText.substring(start, end + 1);
    const parsed = JSON.parse(jsonText);
    
    // Validate required fields
    if (!parsed.word || !parsed.definition) {
      console.warn('Missing required fields in parsed response:', parsed);
      return null;
    }
    
    return {
      word: parsed.word.trim(),
      pronunciation: parsed.pronunciation || '',
      part_of_speech: parsed.part_of_speech || '',
      definition: parsed.definition.trim(),
      example: parsed.example ? parsed.example.trim() : '',
      example_2: parsed.example_2 ? parsed.example_2.trim() : ''
    };
  } catch (error) {
    console.error('Error parsing AI response:', error, 'Raw text:', rawText.substring(0, 200));
    return null;
  }
}

async function generateWithSeed(seed, avoidList = []) {
  if (!hf) return null;
  
  try {
    const prompt = `${promptForSeededWord(seed)}${avoidList.length ? "\nAvoid these words: " + JSON.stringify(avoidList.slice(0,200)) : ''}`;
    const response = await hf.chatCompletion({
      model: 'meta-llama/Llama-3.2-3B-Instruct',
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.9
    });
    
    // Parse the response - chatCompletion returns choices[0].message.content
    const generatedText = response.choices?.[0]?.message?.content || '';
    if (!generatedText) {
      console.warn('No content in chatCompletion response:', response);
      return null;
    }
    
    return parseGeneratedCandidate(generatedText);
  } catch (error) {
    console.error('Error generating word with HF:', error);
    return null;
  }
}

async function generateUniqueWord(userId, avoidList = []) {
  if (userId) {
    const randomWord = await getRandomWordFromDb(userId, avoidList);
    if (randomWord) return randomWord;
  }
  
  const reusable = await getReusableWordFromDb(avoidList);
  if (reusable) return reusable;
  
  const maxAttempts = 3;
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
  
  if (userId) {
    const fallbackWord = await getRandomWordFromDb(userId, []);
    if (fallbackWord) return fallbackWord;
  }
  
  return null;
}

async function saveWordAndAssignToUsers(wordObj, servedForUsers = []) {
  const nowISO = new Date().toISOString();
  const nextReviewISO = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  // Check if word already exists
  const { data: existingWord } = await supabase
    .from('words')
    .select('id')
    .ilike('word', wordObj.word)
    .maybeSingle();

  let wordRowData;
  if (existingWord) {
    // Word exists, use it
    wordRowData = existingWord;
    // Update pronunciation if missing
    if (!existingWord.pronunciation && wordObj.pronunciation) {
      await supabase
        .from('words')
        .update({ pronunciation: wordObj.pronunciation })
        .eq('id', existingWord.id);
    }
  } else {
    // Insert new word
    const { data: newWord, error: insertError } = await supabase
      .from('words')
      .insert({
        word: wordObj.word,
        pronunciation: wordObj.pronunciation || '',
        part_of_speech: wordObj.part_of_speech || '',
        definition: wordObj.definition || '',
        example: wordObj.example || '',
        example_2: wordObj.example_2 || '',
        source: 'hf',
        created_at: nowISO
      })
      .select()
      .single();

    if (insertError || !newWord) return null;
    wordRowData = newWord;
  }

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

  const { data: learnedWords } = await supabase
    .from('user_words')
    .select('id')
    .eq('user_id', user.id);

  const wordsToSend = [];
  const used = await getUsedWords(1000);

  for (let i = 0; i < user.words_per_day; i++) {
    const candidate = await generateUniqueWord(user.id, used);
    if (!candidate) {
      console.warn(`Could not generate word ${i + 1} for user ${user.id}`);
      continue;
    }
    used.unshift(candidate.word.toLowerCase());
    wordsToSend.push(candidate);
    await saveWordAndAssignToUsers(candidate, [{ id: user.id, index: i + 1 }]);
  }

  if (!wordsToSend.length) {
    // Funny/teaser failure message (Option B)
    const failureMessages = [
      "🤖 Oops! My word generator took a coffee break. Your words will arrive tomorrow—promise! In the meantime, flex those brain muscles with /review.",
      "📚 Plot twist: Today's words are playing hide and seek. They'll show up tomorrow! Until then, /review is your best friend.",
      "🎭 The words are being dramatic today—they'll make their grand entrance tomorrow. Use /review to keep your streak alive!",
      "⚡ Quick update: The word factory is rebooting. Fresh words incoming tomorrow! Practice mode: /review",
      "🔮 The crystal ball says... words tomorrow! Today's a perfect day to /review what you've learned."
    ];
    
    const randomMessage = failureMessages[Math.floor(Math.random() * failureMessages.length)];
    await bot.sendMessage(user.chat_id, randomMessage);
    
    // Alert admin
    await notifyAdminOfFailure(user.id, 'No words generated', {
      wordsPerDay: user.words_per_day,
      attempts: user.words_per_day,
      chatId: user.chat_id
    });
    
    return;
  }

  // Send each word as a separate card with buttons (ETIAD-compliant)
  for (let i = 0; i < wordsToSend.length; i++) {
    const w = wordsToSend[i];
    const wordNum = i + 1;
    
    // Get the word ID from database (we just saved it)
    const { data: savedWord } = await supabase
      .from('words')
      .select('id')
      .ilike('word', w.word)
      .maybeSingle();
    
    const wordId = savedWord?.id || null;
    
    // Format word card (ETIAD: Exposure only - no definition shown)
    let cardText = `📚 Word ${wordNum} of ${wordsToSend.length}\n\n`;
    cardText += `${w.word}`;
    if (w.pronunciation) {
      cardText += ` (${w.pronunciation})`;
    }
    if (w.part_of_speech) {
      cardText += `\n<i>${w.part_of_speech}</i>`;
    }
    
    // Send card with buttons (new words only show definition, no practice)
    const keyboard = wordId ? createNewWordCardKeyboard(wordId) : undefined;
    await bot.sendMessage(user.chat_id, cardText, {
      parse_mode: 'HTML',
      ...(keyboard || {})
    });
    
    // Small delay between messages to avoid rate limiting
    if (i < wordsToSend.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
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
