// api/cron/daily.js
// Delivers new words while gating by review load and pending engagement

const TelegramBot = require('node-telegram-bot-api');
const { InferenceClient } = require('@huggingface/inference');
const repo = require('../../lib/repo');
const { createNewWordCardKeyboard, createReviewStartKeyboard } = require('../../lib/keyboardUtils');
const { REVIEW_SOFT_CAP, REVIEW_HARD_CAP, PENDING_STALE_DAYS } = require('../../lib/constants');
const { getDueCountsMap } = require('../../lib/spacedRepetition');
const { addPendingOffers, getPendingCountsByUser, cleanupStalePending } = require('../../lib/pendingWords');
const { pickReviewNudge } = require('../../lib/motivations');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HF_TOKEN = process.env.HF_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null;

if (!TELEGRAM_TOKEN || !HF_TOKEN) {
  console.error('Missing required environment variables for daily cron');
}

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

async function notifyAdminOfFailure(userId, reason, details = {}) {
  if (!ADMIN_CHAT_ID || !bot) return;

  const message =
    `⚠️ Word Generation Failure\n\n` +
    `User ID: ${userId}\n` +
    `Reason: ${reason}\n` +
    `Details: ${JSON.stringify(details, null, 2)}\n` +
    `Time: ${new Date().toISOString()}`;

  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message);
  } catch (e) {
    console.error('Failed to notify admin', e);
  }
}

function promptForSeededWord(seed) {
  return `
You generate ONE useful, modern English word that an educated person is likely to encounter in daily reading, work, or conversation.

Use the numeric seed ${seed} for determinism.

Hard constraints:
- The word must NOT be archaic, overly literary, academic-only, or obscure.
- Avoid rare SAT-only words and dictionary trivia.
- Prefer words commonly used in journalism, tech, business, psychology, or everyday speech.
- The word must be a single token, no hyphens, no spaces.

Return ONLY valid JSON in this exact structure, with no extra text:

{
  "word": "singleword",
  "pronunciation": "simple phonetic spelling, not IPA",
  "part_of_speech": "noun|verb|adjective|adverb",
  "definition": "clear, practical, one-line definition",
  "example": "short everyday sentence using the word naturally",
  "example_2": "another short sentence in a different context"
}

The pronunciation should be easy to read, for example: ser-uhn-DIP-i-tee.
`;
}

function parseGeneratedCandidate(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(rawText.slice(start, end + 1));
    if (!parsed.word || !parsed.definition) return null;

    return {
      word: parsed.word.trim(),
      pronunciation: parsed.pronunciation || '',
      part_of_speech: parsed.part_of_speech || '',
      definition: parsed.definition.trim(),
      example: parsed.example?.trim() || '',
      example_2: parsed.example_2?.trim() || ''
    };
  } catch {
    return null;
  }
}

async function generateWithSeed(seed, avoidList = []) {
  if (!hf) return null;

  const prompt =
    promptForSeededWord(seed) +
    (avoidList.length
      ? `\nAvoid these words: ${JSON.stringify(avoidList.slice(0, 200))}`
      : '');

  try {
    const res = await hf.chatCompletion({
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = res.choices?.[0]?.message?.content;
    if (!text) return null;

    return parseGeneratedCandidate(text);
  } catch (e) {
    console.error('HF generation error', e);
    return null;
  }
}

async function batchFetchAllData(userIds) {
  const [wordsResult, userWordsResult] = await Promise.all([
    repo.getRecentWords(1000),
    repo.getUserWordsByUserIds(userIds)
  ]);

  if (wordsResult.error) {
    console.error('Error fetching words:', wordsResult.error);
    throw wordsResult.error;
  }

  if (userWordsResult.error) {
    console.error('Error fetching user_words:', userWordsResult.error);
    throw userWordsResult.error;
  }

  const allWords = wordsResult.data || [];
  const allUserWords = userWordsResult.data || [];

  const learnedWordsByUser = new Map();
  for (const uw of allUserWords) {
    if (!learnedWordsByUser.has(uw.user_id)) {
      learnedWordsByUser.set(uw.user_id, new Set());
    }
    learnedWordsByUser.get(uw.user_id).add(uw.word_id);
  }

  const wordsByLowercase = new Map();
  for (const word of allWords) {
    const key = (word.word || '').toLowerCase();
    if (!wordsByLowercase.has(key)) {
      wordsByLowercase.set(key, word);
    }
  }

  return {
    allWords,
    learnedWordsByUser,
    wordsByLowercase
  };
}

function pickAvailableWord(userId, allWords, learnedWordIds, avoidList) {
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()));
  const learnedSet = new Set(learnedWordIds || []);

  const candidates = allWords.filter(w => {
    const wordLower = (w.word || '').toLowerCase();
    return !avoidLower.has(wordLower) && !learnedSet.has(w.id);
  });

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

async function generateUniqueWord(userId, avoidList, allWords, learnedWordIds, wordsByLowercase) {
  // Try AI first; fall back to curated words on failure/duplication
  for (let i = 0; i < 2; i++) {
    const seed = Math.floor(Math.random() * 1e9) + i;
    const candidate = await generateWithSeed(seed, avoidList);
    if (!candidate) continue;

    const wordLower = candidate.word.toLowerCase();
    if (!wordsByLowercase.has(wordLower)) {
      return candidate;
    }
  }

  const dbWord = pickAvailableWord(userId, allWords, learnedWordIds, avoidList);
  if (dbWord) return dbWord;

  if (allWords.length > 0) {
    const fallback = allWords[Math.floor(Math.random() * allWords.length)];
    return {
      word: fallback.word,
      pronunciation: fallback.pronunciation || '',
      part_of_speech: fallback.part_of_speech || '',
      definition: fallback.definition || '',
      example: fallback.example || '',
      example_2: fallback.example_2 || fallback.example || ''
    };
  }

  return null;
}

async function saveWordsAndQueueOffers(allWordsToSave, pendingAssignments, wordsByLowercase) {
  const now = new Date().toISOString();
  const wordMap = new Map();

  for (const [wordLower, word] of wordsByLowercase) {
    wordMap.set(wordLower, word.id);
  }

  const wordsToInsert = [];
  const seenWords = new Set();

  for (const wordObj of allWordsToSave) {
    const wordLower = wordObj.word.toLowerCase();
    if (seenWords.has(wordLower)) continue;
    seenWords.add(wordLower);

    if (!wordMap.has(wordLower)) {
      wordsToInsert.push({
        ...wordObj,
        source: 'hf',
        created_at: now
      });
    }
  }

  if (wordsToInsert.length > 0) {
    const { data: insertedWords, error: insertError } = await repo.insertWords(wordsToInsert);

    if (insertError) {
      console.error('Error batch inserting words:', insertError);
      throw insertError;
    }

    if (insertedWords) {
      for (const w of insertedWords) {
        wordMap.set(w.word.toLowerCase(), w.id);
      }
    }
  }

  const pendingRows = [];
  for (const { wordObj, userId, index } of pendingAssignments) {
    const wordLower = wordObj.word.toLowerCase();
    const wordId = wordMap.get(wordLower);

    if (!wordId) {
      console.error(`Word ID not found after insert: ${wordObj.word} (user ${userId})`);
      continue;
    }

    pendingRows.push({
      user_id: userId,
      word_id: wordId,
      offered_at: now,
      served_index: index
    });
  }

  if (pendingRows.length > 0) {
    const { error: pendingError } = await addPendingOffers(pendingRows);
    if (pendingError) {
      console.error('Error inserting pending offers:', pendingError);
      throw pendingError;
    }
  }

  // Keep local cache aware of newly inserted words to avoid duplicates for later users
  for (const [wordLower, wordId] of wordMap.entries()) {
    if (!wordsByLowercase.has(wordLower)) {
      wordsByLowercase.set(wordLower, { id: wordId, word: wordLower });
    }
  }

  return wordMap;
}

function classifyUsers(users, dueCountsMap, pendingCountsMap) {
  const eligibleUsers = [];
  const blockedUsers = [];

  for (const user of users) {
    const dueCount = dueCountsMap.get(user.id) || 0;
    const pendingCount = pendingCountsMap.get(user.id) || 0;
    const hard = dueCount >= REVIEW_HARD_CAP;
    const overSoft = dueCount >= REVIEW_SOFT_CAP || pendingCount > 0;

    if (hard || overSoft) {
      blockedUsers.push({ user, dueCount, pendingCount, hard });
    } else {
      eligibleUsers.push({ user, dueCount, pendingCount });
    }
  }

  return { eligibleUsers, blockedUsers };
}

async function sendNudge({ user, dueCount, pendingCount, hard }) {
  if (!bot) return;
  const text = pickReviewNudge({ userId: user.id, dueCount, pendingCount, hard });
  const keyboard = createReviewStartKeyboard(Math.max(dueCount, 1), user.review_words_per_session || 3);
  const header = hard
    ? '⏸️ New words paused until you clear your backlog.'
    : "⏸️ Holding today's drop until reviews lighten up.";

  try {
    await bot.sendMessage(
      user.chat_id,
      `${header}\n\n${text}\n\nReviews due: ${dueCount}\nPending words: ${pendingCount}`,
      keyboard
    );
  } catch (e) {
    console.warn('Error sending nudge to user', user.chat_id, e.message || e);
  }
}

async function serveWordsToUsers(users, allWords, learnedWordsByUser, wordsByLowercase) {
  const allWordsToSave = [];
  const pendingAssignments = [];
  const userWordAssignments = [];

  console.log(`Processing ${users.length} users for word delivery`);

  for (const user of users) {
    const learnedWordIds = learnedWordsByUser.get(user.id)
      ? Array.from(learnedWordsByUser.get(user.id))
      : [];

    const used = [];
    const words = [];

    for (let i = 0; i < user.words_per_day; i++) {
      const w = await generateUniqueWord(
        user.id,
        used,
        allWords,
        learnedWordIds,
        wordsByLowercase
      );
      if (!w) {
        console.warn(`Failed to generate word ${i + 1} for user ${user.id}`);
        continue;
      }
      used.push(w.word.toLowerCase());
      words.push(w);
    }

    if (!words.length) {
      console.error(`No words generated for user ${user.id}`);
      await notifyAdminOfFailure(user.id, 'No words generated');
      continue;
    }

    console.log(`Generated ${words.length} words for user ${user.id}`);

    for (let i = 0; i < words.length; i++) {
      const wordObj = words[i];
      allWordsToSave.push(wordObj);
      pendingAssignments.push({
        wordObj,
        userId: user.id,
        index: i + 1
      });
      userWordAssignments.push({
        user,
        wordObj,
        index: i + 1
      });
    }
  }

  if (allWordsToSave.length === 0) {
    console.warn('No words to save for any user');
    return;
  }

  console.log(`Saving ${allWordsToSave.length} words and queuing ${pendingAssignments.length} pending offers`);
  const wordMap = await saveWordsAndQueueOffers(allWordsToSave, pendingAssignments, wordsByLowercase);
  console.log(`Word map contains ${wordMap.size} entries`);

  let sentCount = 0;
  for (const { user, wordObj, index } of userWordAssignments) {
    const wordLower = wordObj.word.toLowerCase();
    const wordId = wordMap.get(wordLower);

    if (!wordId) {
      console.error(`Word ID not found in wordMap for: ${wordObj.word} (user ${user.id})`);
      continue;
    }

    let text = `🆕 New Word Drop\nWord ${index} of ${user.words_per_day}\n\n${wordObj.word}`;
    if (wordObj.pronunciation) text += ` (${wordObj.pronunciation})`;
    if (wordObj.part_of_speech) text += `\n<i>${wordObj.part_of_speech}</i>`;
    text += `\n\nTap "Show definition" to add this word to your list.`;

    try {
      await bot.sendMessage(user.chat_id, text, {
        parse_mode: 'HTML',
        ...createNewWordCardKeyboard(wordId)
      });
      sentCount++;

      if (index < user.words_per_day) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (error) {
      console.error(`Error sending word "${wordObj.word}" to user ${user.id} (${user.chat_id}):`, error.message || error);
      // Continue with other users instead of throwing
    }
  }

  console.log(`Successfully sent ${sentCount} messages out of ${userWordAssignments.length} total`);
}

module.exports = async function handler(req, res) {
  if (!bot || !hf) {
    return res.status(500).json({ error: 'Bot not configured' });
  }

  try {
    const { data: users, error: usersError } = await repo.getUsers();
    if (usersError) {
      console.error('Error fetching users:', usersError);
      return res.status(500).json({ error: usersError.message });
    }

    if (!users?.length) {
      return res.status(200).json({ message: 'No users' });
    }

    const userIds = users.map(u => u.id);
    const [dueCountsMap, pendingCountsMap] = await Promise.all([
      getDueCountsMap(userIds, true),
      getPendingCountsByUser(userIds)
    ]);

    const staleCutoff = new Date(Date.now() - PENDING_STALE_DAYS * 86400000).toISOString();
    cleanupStalePending(staleCutoff).catch(e => console.warn('Pending cleanup error', e.message || e));

    const { eligibleUsers, blockedUsers } = classifyUsers(users, dueCountsMap, pendingCountsMap);

    await Promise.all(blockedUsers.map(b => sendNudge(b)));

    if (!eligibleUsers.length) {
      return res.status(200).json({ message: `All users gated: ${blockedUsers.length}` });
    }

    const eligibleIds = eligibleUsers.map(e => e.user.id);
    const { allWords, learnedWordsByUser, wordsByLowercase } = await batchFetchAllData(eligibleIds);

    await serveWordsToUsers(
      eligibleUsers.map(e => e.user),
      allWords,
      learnedWordsByUser,
      wordsByLowercase
    );

    res.status(200).json({ message: `Daily words sent`, eligible: eligibleUsers.length, gated: blockedUsers.length });
  } catch (e) {
    console.error('Daily cron error:', e);
    res.status(500).json({ error: e.message });
  }
};
