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

async function getUsedWords(limit = 500) {
  const { data, error } = await supabase
    .from('words')
    .select('word')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data || []).map(r => r.word.toLowerCase())
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

async function getAvailableWordsFromDb(userId, avoidList = []) {
  const avoidLower = new Set(avoidList.map(w => w.toLowerCase()))
  let learnedWordIds = []

  if (userId) {
    const { data } = await supabase
      .from('user_words')
      .select('word_id')
      .eq('user_id', userId)
    learnedWordIds = data ? data.map(r => r.word_id) : []
  }

  let query = supabase
    .from('words')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (learnedWordIds.length) {
    query = query.not('id', 'in', `(${learnedWordIds.join(',')})`)
  }

  const { data } = await query
  if (!data || !data.length) return null

  const candidates = data.filter(w => !avoidLower.has((w.word || '').toLowerCase()))
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

async function wordExists(word) {
  if (!word) return false
  const { data } = await supabase
    .from('words')
    .select('id')
    .ilike('word', word.trim())
    .maybeSingle()
  return !!data
}

async function generateUniqueWord(userId, avoidList = []) {
  const useAI = Math.random() < 0.1

  if (!useAI) {
    const dbWord = await getAvailableWordsFromDb(userId, avoidList)
    if (dbWord) return dbWord
  }

  for (let i = 0; i < 2; i++) {
    const seed = Math.floor(Math.random() * 1e9) + i
    const candidate = await generateWithSeed(seed, avoidList)
    if (!candidate) continue
    if (!(await wordExists(candidate.word))) return candidate
  }

  const { data } = await supabase.from('words').select('*').limit(1).single()
  if (!data) return null

  return {
    word: data.word,
    pronunciation: data.pronunciation || '',
    part_of_speech: data.part_of_speech || '',
    definition: data.definition || '',
    example: data.example || '',
    example_2: data.example_2 || data.example || ''
  }
}

async function saveWordAndAssignToUsers(wordObj, servedForUsers) {
  if (!wordObj || !servedForUsers.length) return null

  const now = new Date().toISOString()
  const nextReview = new Date(Date.now() + 2 * 86400000).toISOString()

  const { data: existing } = await supabase
    .from('words')
    .select('id, pronunciation')
    .ilike('word', wordObj.word)
    .maybeSingle()

  let wordId = existing?.id

  if (!wordId) {
    const { data } = await supabase
      .from('words')
      .insert({
        ...wordObj,
        source: 'hf',
        created_at: now
      })
      .select('id')
      .single()
    if (!data) return null
    wordId = data.id
  }

  const rows = servedForUsers.map(u => ({
    user_id: u.id,
    word_id: wordId,
    served_at: now,
    next_review: nextReview,
    interval: 2,
    served_index: u.index || 1
  }))

  await supabase.from('user_words').insert(rows)
  return { id: wordId }
}

async function serveWordsToUser(user) {
  const now = Date.now()
  const { count } = await supabase
    .from('user_words')
    .select('id', { count: 'exact' })
    .eq('user_id', user.id)
    .lte('next_review', now)

  if (count >= 5) {
    await bot.sendMessage(user.chat_id, 'Today is a review day. Use /review.')
    return
  }

  const used = await getUsedWords(1000)
  const words = []

  for (let i = 0; i < user.words_per_day; i++) {
    const w = await generateUniqueWord(user.id, used)
    if (!w) continue
    used.unshift(w.word.toLowerCase())
    words.push(w)
  }

  if (!words.length) {
    await notifyAdminOfFailure(user.id, 'No words generated')
    return
  }

  for (let i = 0; i < words.length; i++) {
    const saved = await saveWordAndAssignToUsers(words[i], [{ id: user.id, index: i + 1 }])
    if (!saved) continue

    let text = `📚 Word ${i + 1} of ${words.length}\n\n${words[i].word}`
    if (words[i].pronunciation) text += ` (${words[i].pronunciation})`
    if (words[i].part_of_speech) text += `\n<i>${words[i].part_of_speech}</i>`

    await bot.sendMessage(user.chat_id, text, {
      parse_mode: 'HTML',
      ...createNewWordCardKeyboard(saved.id)
    })

    if (i < words.length - 1) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
}

module.exports = async function handler(req, res) {
  if (!bot || !hf) {
    return res.status(500).json({ error: 'Bot not configured' })
  }

  try {
    const { data: users } = await supabase.from('users').select('*')
    if (!users?.length) {
      return res.status(200).json({ message: 'No users' })
    }

    for (const u of users) {
      await serveWordsToUser(u)
    }

    res.status(200).json({ message: 'Daily words sent' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
}
