// api/cron/daily.js
const TelegramBot = require('node-telegram-bot-api')
const supabase = require('../../supabaseClient')
const { InferenceClient } = require('@huggingface/inference')
const { createNewWordCardKeyboard } = require('../../lib/keyboardUtils')

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN
const HF_TOKEN = process.env.HF_API_KEY
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null

if (!TELEGRAM_TOKEN || !HF_TOKEN) {
  console.error('Missing required environment variables for daily cron')
}

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null

async function notifyAdminOfFailure(userId, reason, details = {}) {
  if (!ADMIN_CHAT_ID || !bot) return

  const message =
    `⚠️ Word Generation Failure\n\n` +
    `User ID: ${userId}\n` +
    `Reason: ${reason}\n` +
    `Details: ${JSON.stringify(details, null, 2)}\n` +
    `Time: ${new Date().toISOString()}`

  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message)
  } catch (e) {
    console.error('Failed to notify admin', e)
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
`
}

function parseGeneratedCandidate(rawText) {
  if (!rawText || typeof rawText !== 'string') return null

  try {
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const parsed = JSON.parse(rawText.slice(start, end + 1))
    if (!parsed.word || !parsed.definition) return null

    return {
      word: parsed.word.trim(),
      pronunciation: parsed.pronunciation || '',
      part_of_speech: parsed.part_of_speech || '',
      definition: parsed.definition.trim(),
      example: parsed.example?.trim() || '',
      example_2: parsed.example_2?.trim() || ''
    }
  } catch {
    return null
  }
}

async function generateWithSeed(seed, avoidList = []) {
  if (!hf) return null

  const prompt =
    promptForSeededWord(seed) +
    (avoidList.length
      ? `\nAvoid these words: ${JSON.stringify(avoidList.slice(0, 200))}`
      : '')

  try {
    const res = await hf.chatCompletion({
      model: 'meta-llama/Llama-3.2-3B-Instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7
    })

    const text = res.choices?.[0]?.message?.content
    if (!text) return null

    return parseGeneratedCandidate(text)
  } catch (e) {
    console.error('HF generation error', e)
    return null
  }
}

async function batchFetchAllData(userIds) {
  const [wordsResult, userWordsResult] = await Promise.all([
    supabase
      .from('words')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000),
    userIds.length > 0
      ? supabase
        .from('user_words')
        .select('user_id, word_id')
        .in('user_id', userIds)
      : { data: [], error: null }
  ])

  if (wordsResult.error) {
    console.error('Error fetching words:', wordsResult.error)
    throw wordsResult.error
  }

  if (userWordsResult.error) {
    console.error('Error fetching user_words:', userWordsResult.error)
    throw userWordsResult.error
  }

  const allWords = wordsResult.data || []
  const allUserWords = userWordsResult.data || []

  const learnedWordsByUser = new Map()
  for (const uw of allUserWords) {
    if (!learnedWordsByUser.has(uw.user_id)) {
      learnedWordsByUser.set(uw.user_id, new Set())
    }
    learnedWordsByUser.get(uw.user_id).add(uw.word_id)
  }

  const wordsByLowercase = new Map()
  for (const word of allWords) {
    const key = (word.word || '').toLowerCase()
    if (!wordsByLowercase.has(key)) {
      wordsByLowercase.set(key, word)
    }
  }

  return {
    allWords,
    learnedWordsByUser,
    wordsByLowercase
  }
}

function pickAvailableWord(userId, allWords, learnedWordIds, avoidList) {
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()))
  const learnedSet = new Set(learnedWordIds || [])

  const candidates = allWords.filter(w => {
    const wordLower = (w.word || '').toLowerCase()
    return !avoidLower.has(wordLower) && !learnedSet.has(w.id)
  })

  if (!candidates.length) return null

  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  return {
    word: pick.word,
    pronunciation: pick.pronunciation || '',
    part_of_speech: pick.part_of_speech || '',
    definition: pick.definition || '',
    example: pick.example || '',
    example_2: pick.example_2 || pick.example || ''
  }
}

async function generateUniqueWord(userId, avoidList, allWords, learnedWordIds, wordsByLowercase) {
  const useAI = Math.random() < 0.1

  if (!useAI) {
    const dbWord = pickAvailableWord(userId, allWords, learnedWordIds, avoidList)
    if (dbWord) return dbWord
  }

  for (let i = 0; i < 2; i++) {
    const seed = Math.floor(Math.random() * 1e9) + i
    const candidate = await generateWithSeed(seed, avoidList)
    if (!candidate) continue

    const wordLower = candidate.word.toLowerCase()
    if (!wordsByLowercase.has(wordLower)) {
      return candidate
    }
  }

  if (allWords.length > 0) {
    const fallback = allWords[Math.floor(Math.random() * allWords.length)]
    return {
      word: fallback.word,
      pronunciation: fallback.pronunciation || '',
      part_of_speech: fallback.part_of_speech || '',
      definition: fallback.definition || '',
      example: fallback.example || '',
      example_2: fallback.example_2 || fallback.example || ''
    }
  }

  return null
}

async function batchInsertWordsAndUserWords(allWordsToSave, allUserWordsToInsert, wordsByLowercase) {
  const now = new Date().toISOString()
  const wordMap = new Map()

  for (const [wordLower, word] of wordsByLowercase) {
    wordMap.set(wordLower, word.id)
  }

  const wordsToInsert = []
  const seenWords = new Set()

  for (const wordObj of allWordsToSave) {
    const wordLower = wordObj.word.toLowerCase()

    if (seenWords.has(wordLower)) continue
    seenWords.add(wordLower)

    if (!wordMap.has(wordLower)) {
      wordsToInsert.push({
        ...wordObj,
        source: 'hf',
        created_at: now
      })
    }
  }

  if (wordsToInsert.length > 0) {
    const { data: insertedWords, error: insertError } = await supabase
      .from('words')
      .insert(wordsToInsert)
      .select('id, word')

    if (insertError) {
      console.error('Error batch inserting words:', insertError)
      throw insertError
    }

    if (insertedWords) {
      for (const w of insertedWords) {
        wordMap.set(w.word.toLowerCase(), w.id)
      }
    }
  }

  const userWordsRows = []
  for (const { wordObj, userId, index } of allUserWordsToInsert) {
    const wordLower = wordObj.word.toLowerCase()
    let wordId = wordMap.get(wordLower)

    if (!wordId) {
      const { data: existingWord, error: checkError } = await supabase
        .from('words')
        .select('id')
        .ilike('word', wordObj.word)
        .maybeSingle()

      if (checkError) {
        console.error(`Error checking word existence for ${wordObj.word}:`, checkError)
        continue
      }

      if (existingWord) {
        wordId = existingWord.id
        wordMap.set(wordLower, wordId)
      } else {
        console.error(`Word not found in database: ${wordObj.word}`)
        continue
      }
    }

    const nextReview = new Date(Date.now() + 2 * 86400000).toISOString()
    userWordsRows.push({
      user_id: userId,
      word_id: wordId,
      served_at: now,
      next_review: nextReview,
      interval: 2,
      served_index: index
    })
  }

  if (userWordsRows.length > 0) {
    const { error: insertUserWordsError } = await supabase
      .from('user_words')
      .insert(userWordsRows)

    if (insertUserWordsError) {
      console.error('Error batch inserting user_words:', insertUserWordsError)
      throw insertUserWordsError
    }
  }

  return wordMap
}

async function serveWordsToUsers(users, allWords, learnedWordsByUser, wordsByLowercase) {
  const allWordsToSave = []
  const allUserWordsToInsert = []
  const userWordAssignments = []

  console.log(`Processing ${users.length} users for word delivery`)

  for (const user of users) {
    const learnedWordIds = learnedWordsByUser.get(user.id)
      ? Array.from(learnedWordsByUser.get(user.id))
      : []

    const used = []
    const words = []

    for (let i = 0; i < user.words_per_day; i++) {
      const w = await generateUniqueWord(
        user.id,
        used,
        allWords,
        learnedWordIds,
        wordsByLowercase
      )
      if (!w) {
        console.warn(`Failed to generate word ${i + 1} for user ${user.id}`)
        continue
      }
      used.push(w.word.toLowerCase())
      words.push(w)
    }

    if (!words.length) {
      console.error(`No words generated for user ${user.id}`)
      await notifyAdminOfFailure(user.id, 'No words generated')
      continue
    }

    console.log(`Generated ${words.length} words for user ${user.id}`)

    for (let i = 0; i < words.length; i++) {
      const wordObj = words[i]
      allWordsToSave.push(wordObj)
      allUserWordsToInsert.push({
        wordObj,
        userId: user.id,
        index: i + 1
      })
      userWordAssignments.push({
        user,
        wordObj,
        index: i + 1
      })
    }
  }

  if (allWordsToSave.length === 0) {
    console.warn('No words to save for any user')
    return
  }

  console.log(`Saving ${allWordsToSave.length} words and ${allUserWordsToInsert.length} user_word relationships`)
  const wordMap = await batchInsertWordsAndUserWords(allWordsToSave, allUserWordsToInsert, wordsByLowercase)
  console.log(`Word map contains ${wordMap.size} entries`)

  let sentCount = 0
  for (const { user, wordObj, index } of userWordAssignments) {
    const wordLower = wordObj.word.toLowerCase()
    const wordId = wordMap.get(wordLower)

    if (!wordId) {
      console.error(`Word ID not found in wordMap for: ${wordObj.word} (user ${user.id})`)
      continue
    }

    let text = `📚 Word ${index} of ${user.words_per_day}\n\n${wordObj.word}`
    if (wordObj.pronunciation) text += ` (${wordObj.pronunciation})`
    if (wordObj.part_of_speech) text += `\n<i>${wordObj.part_of_speech}</i>`

    try {
      await bot.sendMessage(user.chat_id, text, {
        parse_mode: 'HTML',
        ...createNewWordCardKeyboard(wordId)
      })
      sentCount++

      if (index < user.words_per_day) {
        await new Promise(r => setTimeout(r, 500))
      }
    } catch (error) {
      console.error(`Error sending word "${wordObj.word}" to user ${user.id} (${user.chat_id}):`, error.message || error)
      // Continue with other users instead of throwing
    }
  }

  console.log(`Successfully sent ${sentCount} messages out of ${userWordAssignments.length} total`)
}

module.exports = async function handler(req, res) {
  if (!bot || !hf) {
    return res.status(500).json({ error: 'Bot not configured' })
  }

  try {
    const { data: users, error: usersError } = await supabase.from('users').select('*')

    if (usersError) {
      console.error('Error fetching users:', usersError)
      return res.status(500).json({ error: usersError.message })
    }

    if (!users?.length) {
      return res.status(200).json({ message: 'No users' })
    }

    const userIds = users.map(u => u.id)

    const { allWords, learnedWordsByUser, wordsByLowercase } = await batchFetchAllData(userIds)

    await serveWordsToUsers(users, allWords, learnedWordsByUser, wordsByLowercase)

    res.status(200).json({ message: 'Daily words sent' })
  } catch (e) {
    console.error('Daily cron error:', e)
    res.status(500).json({ error: e.message })
  }
}
