# DailyWord Bot: System Redesign Document

## Executive Summary

The current implementation suffers from fundamental architectural flaws that prevent it from functioning as a true ETIAD-style vocabulary learning system. The bot operates as a passive word broadcaster rather than an active recall tutor, lacks proper state management, and contains multiple logical contradictions that create dead-ends for users.

---

## A. Flow Analysis

### A1. Critical Flow Breakdowns

#### **Problem 1: Dual Message Handler Logic Contradiction**

**Location:** `api/webhook.js` lines 322-388 (onText handler) vs lines 631-676 (manual routing)

**Issue:** The same message handler has two different behaviors:

- **onText handler (line 349):** Queries words with `lt('served_at', todayISO)` - only older words
- **Manual routing (line 642):** Queries words with `gte('served_at', todayISO)` - only today's words

**Impact:** User messages are processed inconsistently depending on which code path executes. This creates unpredictable behavior and breaks the spaced repetition system.

**User Experience:** User sends a sentence → sometimes it matches today's words, sometimes older words, with no clear indication of which.

---

#### **Problem 2: Review Cron Sends Prompts Without Context**

**Location:** `api/cron/review.js` lines 29-34

**Issue:** The review cron sends a prompt asking "do you remember the word X?" but:

- Immediately updates `next_review` BEFORE the user responds
- No session state tracking (no way to know which review prompt the user is answering)
- User's reply goes to the generic message handler, which may match wrong words

**Impact:** Review prompts are sent but responses cannot be reliably matched to the correct word. The system cannot validate whether the user's answer is correct.

**User Experience:** Bot asks "do you remember 'serendipity'?" → User replies "yes, serendipity" → Bot doesn't know which word they're answering about → No feedback.

---

#### **Problem 3: Midday/Evening Crons Are Orphaned**

**Location:** `api/cron/midday.js` and `api/cron/evening.js`

**Issue:** These crons send vague prompts:

- "can you recall any of today's words? Reply with the word you remember"
- "use each of today's words in a sentence about your day"

But:

- No structured challenge format
- No way to validate responses
- No integration with the recall system
- User responses fall into generic message handler with unpredictable matching

**Impact:** These scheduled messages create confusion. Users don't know what format to use, and the bot cannot process their responses meaningfully.

**User Experience:** Bot sends midday prompt → User replies "serendipity" → Bot may or may not recognize it → No clear feedback loop.

---

#### **Problem 4: /review Command Shows Words But Doesn't Initiate Challenge**

**Location:** `api/webhook.js` lines 285-310

**Issue:** `/review` lists due words with definitions/examples visible, then asks user to "reply with a sentence using any one of these words."

**Problems:**

- Shows answers (definitions) before asking questions - violates ETIAD principle
- No structured challenge format
- User's reply goes to generic handler, which may match wrong words
- No way to track which word from the list the user is practicing

**Impact:** The review command doesn't function as a true recall challenge. It's more like a word list with a vague instruction.

---

#### **Problem 5: Daily Word Delivery Violates ETIAD**

**Location:** `api/cron/daily.js` lines 189-198

**Issue:** Daily words are delivered as passive information dumps:

- Shows word, definition, examples all at once
- No recall challenge
- Just asks user to "send a sentence using any word"

**Impact:** This is exposure without testing. Users see the answer before being tested, which defeats the purpose of spaced repetition.

---

### A2. Handlers Without Clear Purpose

#### **Handler: Generic Message Handler**

**Location:** `api/webhook.js` lines 322-388

**Current Behavior:** Tries to match user text to words using fuzzy logic:

- If text ≤ 3 words: checks if it contains a word (case-insensitive substring match)
- If text > 3 words: logs it as "usage" and updates streak

**Problems:**

- No context awareness (which word is the user practicing?)
- Fuzzy matching is unreliable ("I love serendipity" matches, but "serendipitous" might not)
- No distinction between recall attempts and casual usage
- Updates streak even when user is just chatting

**Should Be:** Replaced with context-aware handlers that know:

- Which word the user is being tested on
- Whether this is a recall challenge or usage practice
- What the expected response format is

---

#### **Handler: /review Command**

**Location:** `api/webhook.js` lines 285-310

**Current Behavior:** Lists due words with full definitions, asks for sentence.

**Problems:**

- Not a true review challenge (shows answers first)
- No structured Q&A format
- No way to track which word user is practicing

**Should Be:** Initiates a structured review session with:

- One word at a time
- Definition/example hidden until user attempts recall
- Clear success/failure feedback
- Adaptive interval updates based on correctness

---

### A3. Messages That Instruct Unsupported Behavior

#### **Message 1: Daily Word Delivery**

**Text:** "Quick practice: send a short sentence using any word above. I'll log it and keep your streak going."

**Problem:** User sends sentence → Bot logs it → But there's no validation that the sentence actually uses the word correctly. The generic handler just checks if the word appears as a substring, which is unreliable.

**What User Expects:** Bot validates their sentence usage and gives feedback.
**What Actually Happens:** Bot logs the message and updates streak regardless of correctness.

---

#### **Message 2: Midday Recall**

**Text:** "Midday recall: can you recall any of today's words? Reply with the word you remember."

**Problem:**

- No context tracking (which word is being tested?)
- User replies → Bot may or may not recognize it
- No clear feedback on correctness

**What User Expects:** Bot tests them on a specific word and validates their answer.
**What Actually Happens:** Bot sends vague prompt, user replies, bot may or may not process it correctly.

---

#### **Message 3: Evening Challenge**

**Text:** "Evening challenge: use each of today's words in a sentence about your day. Reply with your sentences."

**Problem:**

- No validation that sentences actually use the words correctly
- No feedback on usage quality
- Generic handler just logs the message

**What User Expects:** Bot validates their sentences and provides feedback.
**What Actually Happens:** Bot logs the message and updates streak.

---

#### **Message 4: Review Cron Prompt**

**Text:** "Review: do you remember the word 'X'? Reply with it if you do."

**Problem:**

- Bot updates `next_review` BEFORE user responds
- No session state (bot doesn't know which prompt user is answering)
- User's reply goes to generic handler with unpredictable matching

**What User Expects:** Bot waits for their answer, validates it, and updates intervals accordingly.
**What Actually Happens:** Bot sends prompt, immediately updates schedule, user's reply may or may not be processed correctly.

---

## B. Handler Responsibility Redesign

### B1. Proposed Handler Architecture

#### **Handler Category 1: Word Delivery**

**Purpose:** Deliver new words to users on schedule.

**Responsibilities:**

- Fetch or generate words based on user's `words_per_day` setting
- Prefer reusable words from database before generating new ones
- Deliver words in structured format with pronunciation
- Mark words as "new" (not yet tested)
- Do NOT show definitions/examples immediately (ETIAD: Exposure only)

**Single Responsibility:** Deliver new words without spoiling recall challenges.

**Handler Name:** `deliverDailyWords(userId)`

---

#### **Handler Category 2: Recall Challenge**

**Purpose:** Test user's memory of a specific word without showing the answer.

**Responsibilities:**

- Select a word that needs review (based on `next_review` and correctness history)
- Present challenge: show definition/example, ask for the word
- Track active challenge state (which word, when started)
- Wait for user response
- Validate response against expected word
- Provide immediate feedback
- Update spaced repetition intervals based on correctness

**Single Responsibility:** Conduct one recall challenge and update intervals.

**Handler Name:** `initiateRecallChallenge(userId, wordId)` → `processRecallResponse(userId, wordId, userAnswer)`

---

#### **Handler Category 3: Answer Validation**

**Purpose:** Validate user's answer against expected word.

**Responsibilities:**

- Compare user input to expected word (fuzzy matching with tolerance)
- Handle variations (plurals, verb forms, etc.)
- Return structured result: { correct: boolean, confidence: number, matchedWord: string }

**Single Responsibility:** Pure validation logic, no side effects.

**Handler Name:** `validateRecallAnswer(userAnswer, expectedWord)`

---

#### **Handler Category 4: Feedback Delivery**

**Purpose:** Provide immediate, meaningful feedback after a recall attempt.

**Responsibilities:**

- Show correct answer if user was wrong
- Explain why answer was wrong (if applicable)
- Indicate when word will be reviewed again
- Celebrate correct answers appropriately
- Never dead-end the user

**Single Responsibility:** Format and send feedback messages.

**Handler Name:** `sendRecallFeedback(userId, wordId, wasCorrect, userAnswer)`

---

#### **Handler Category 5: Review Session**

**Purpose:** Manage a sequence of recall challenges initiated by user.

**Responsibilities:**

- Fetch due words for user
- Present challenges one at a time
- Track session state (current word index, total words)
- Allow user to skip or end session
- Update intervals after each challenge
- Provide session summary at end

**Single Responsibility:** Orchestrate multiple recall challenges in a session.

**Handler Name:** `startReviewSession(userId)` → `continueReviewSession(userId, sessionId, challengeResult)`

---

#### **Handler Category 6: Progress Tracking**

**Purpose:** Display user's learning statistics and progress.

**Responsibilities:**

- Calculate statistics (total words, streak, due reviews, mastery level)
- Format progress display
- Show recent words learned
- Indicate next review times

**Single Responsibility:** Read and display progress data.

**Handler Name:** `displayProgress(userId)`

---

### B2. Handler Separation Rules

**Rule 1:** No handler shall both deliver words AND test recall. These are separate concerns.

**Rule 2:** No handler shall update database state without clear user action. (Exception: scheduled deliveries)

**Rule 3:** Every handler that expects user input must track session state to match responses to requests.

**Rule 4:** No handler shall send messages that instruct behavior the bot cannot process.

---

## C. State Model

### C1. User State

**Per-User State (stored in `users` and `user_stats` tables):**

```
user_state = {
  // Basic info
  id: number,
  chat_id: string,
  words_per_day: number (1-3),
  review_words_per_session: number (default: 3, configurable),

  // Learning progress
  total_words_learned: number,
  current_streak: number,
  last_completed_date: timestamp,

  // Active session (if any)
  active_session: {
    type: 'review' | 'challenge' | null,
    session_id: string | null,
    current_word_id: number | null,
    started_at: timestamp | null
  } | null
}
```

**State Transitions:**

- `idle` → `review_session`: User runs `/review`
- `idle` → `challenge_active`: Bot sends scheduled recall challenge
- `review_session` → `idle`: User completes or cancels review
- `challenge_active` → `idle`: User responds to challenge
- `idle` → `idle`: User checks progress, views words (no state change)

---

### C2. Word State (Per User-Word Pair)

**Per-Word State (stored in `user_words` table):**

```
word_state = {
  // Identity
  user_id: number,
  word_id: number,

  // Learning stage
  stage: 'new' | 'learning' | 'reviewing' | 'mastered',

  // Spaced repetition
  interval_days: number,
  next_review: timestamp,
  last_reviewed: timestamp | null,

  // Performance tracking
  correct_count: number,
  incorrect_count: number,
  last_response: string | null,
  last_was_correct: boolean | null,

  // Timing
  served_at: timestamp,
  served_index: number (1-3, which word in daily batch)
}
```

**Word Stage Transitions:**

```
new → learning: User receives word (served_at set)
learning → reviewing: First recall challenge initiated
reviewing → reviewing: User answers incorrectly (interval decreases)
reviewing → mastered: User answers correctly 3 times consecutively
mastered → reviewing: User answers incorrectly after mastery
```

**Interval Update Rules:**

- Correct answer: `interval = interval * 2.5` (capped at max, e.g., 30 days)
- Incorrect answer: `interval = max(1, interval / 2)` (minimum 1 day)
- After incorrect: Increase likelihood of earlier review (reduce `next_review` by 25%)

---

### C3. Session State (New - Not Currently Stored)

**Review Session State (should be stored temporarily, e.g., in-memory cache or Redis):**

```
session_state = {
  session_id: string (UUID),
  user_id: number,
  type: 'review' | 'challenge',
  words: [word_id_1, word_id_2, ...],
  current_index: number,
  started_at: timestamp,
  expires_at: timestamp,
  results: [
    { word_id: number, was_correct: boolean, answered_at: timestamp }
  ]
}
```

**Why Needed:** To match user responses to specific challenges. Without this, the bot cannot know which word the user is answering about.

**Storage Options:**

- In-memory cache (simple, but lost on serverless cold start)
- Database table `active_sessions` (persistent, survives restarts)
- Redis (if available, fast and reliable)

**Recommended:** Database table for persistence in serverless environment.

---

## D. Interaction Design

### D1. Daily Word Flow

**Current Flow (Broken):**

1. Cron sends words with definitions/examples visible
2. User sees everything immediately
3. Bot asks user to "send a sentence"
4. User sends sentence → Bot logs it → Done

**Proposed Flow (ETIAD-Compliant):**

**Step 1: Exposure (Morning Delivery)**

```
Bot: "📚 New words for today (2):"

[Card 1]
Word: "serendipity"
Pronunciation: /ˌserənˈdipitē/
Part of speech: noun

[Button: "Show definition"]
[Button: "Start practice"]

[Card 2]
Word: "lucid"
Pronunciation: /ˈlo͞osid/
Part of speech: adjective

[Button: "Show definition"]
[Button: "Start practice"]
```

**User Action:** Clicks "Show definition" or "Start practice"

**If "Show definition":**

```
Bot: "serendipity (noun)
Definition: the occurrence of events by chance in a happy way
Example: Finding that book was pure serendipity.

[Button: "Got it - test me"]
[Button: "See another example"]
```

**If "Start practice":**
→ Proceeds to Testing phase (see D2)

---

### D2. Recall Challenge Flow

**Proposed Flow:**

**Step 1: Challenge Initiation**

```
Bot: "🧠 Recall Challenge

Definition: the occurrence of events by chance in a happy way
Example: Finding that book was pure [???]

What's the word?

[Button: "I know it"]
[Button: "Show hint"]
[Button: "Skip this word"]
```

**User Action:** Types word OR clicks "I know it" → types word

**Step 2: Answer Validation**

- User types: "serendipity"
- Bot validates: Correct (exact match or close variation)

**Step 3: Immediate Feedback (Correct)**

```
Bot: "✅ Correct! Well done!

The word is: serendipity
Pronunciation: /ˌserənˈdipitē/

You'll see this again in 5 days.

[Button: "Next challenge"]
[Button: "End session"]
```

**Step 4: Immediate Feedback (Incorrect)**

```
Bot: "❌ Not quite, but good effort!

The correct word is: serendipity
Pronunciation: /ˌserənˈdipitē/
Definition: the occurrence of events by chance in a happy way

I'll ask you again in 1 day to help it stick.

[Button: "Try another word"]
[Button: "End session"]
```

**State Updates:**

- Correct: `interval *= 2.5`, `next_review = now + interval`, `correct_count++`
- Incorrect: `interval = max(1, interval / 2)`, `next_review = now + interval`, `incorrect_count++`, reduce `next_review` by 25% for earlier review

---

### D3. Review Session Flow

**Proposed Flow:**

**Step 1: Session Initiation (`/review` command)**

```
Bot: "🔁 Review Session

You have 8 words due for review.
Default session: 3 words (configurable with /setreview)

[Button: "Start review (3 words)"]
[Button: "Start review (all due)"]
[Button: "View word list"]
[Button: "Cancel"]
```

**User Action:** Clicks "Start review"

**Step 2: First Challenge**

```
Bot: "Challenge 1 of 3

Definition: expressed clearly; easy to understand
Example: She wrote a [???] explanation.

What's the word?

[Button: "Show hint"]
[Button: "Skip"]
```

**User Action:** Types answer

**Step 3: Feedback + Next Challenge**

```
Bot: "✅ Correct! (1/5 complete)

Next challenge in 2 seconds..."

[Automatically proceeds to next challenge]
```

**Step 4: Session Summary (After All Challenges)**

```
Bot: "🎉 Review Complete!

Results:
✅ Correct: 2/3
❌ Incorrect: 1/3

Words reviewed:
- serendipity (correct)
- lucid (correct)
- succinct (incorrect - will review in 1 day)

You still have 5 words due for review.

Your streak: 7 days 🔥

[Button: "Review again"]
[Button: "Check progress"]
```

---

### D4. Incorrect Answer Flow

**Proposed Flow:**

**Step 1: User Answers Incorrectly**

```
User types: "lucid" (but expected word is "serendipity")
```

**Step 2: Immediate Feedback**

```
Bot: "❌ Not quite, but keep trying!

The correct word is: serendipity
Pronunciation: /ˌserənˈdipitē/
Definition: the occurrence of events by chance in a happy way

I'll ask you again in 1 day to help it stick.

[Button: "Try another word"]
[Button: "End session"]
```

**Step 3: State Updates (Non-Blocking)**

- Record attempt: `incorrect_count++`, `last_was_correct = false`
- Update interval: `interval = max(1, interval / 2)`
- Schedule earlier review: `next_review = now + (interval * 0.75)` (25% earlier)
- Do NOT block session - allow user to continue

**Step 4: Continue Session**

- Bot automatically proceeds to next challenge (if in review session)
- OR waits for user to click "Try another word"

**Key Principle:** Never dead-end the user. Always provide a path forward.

---

## E. AI Usage Boundaries

### E1. Current AI Usage Problems

**Problem 1: AI Called Unnecessarily**
**Location:** `api/cron/daily.js` lines 95-117

**Issue:** `generateUniqueWord()` calls AI even when:

- Database has words available that haven't been served to this user
- Previous generation just failed (should fallback immediately)

**Impact:** Wastes quota on avoidable calls.

**Solution:** Strict fallback chain:

1. Check database for words not yet served to this user (no AI)
2. If none available → try AI generation (includes pronunciation in prompt)
3. If AI fails → select random word from database (even if served to other users)
4. Never use hardcoded starter words - always use database

---

**Problem 2: AI Response Not Parsed**
**Location:** `api/cron/daily.js` lines 79-93

**Issue:** `generateWithSeed()` returns raw text from AI, but `generateUniqueWord()` expects a parsed object with `.word` property.

**Code:**

```javascript
const candidate = await generateWithSeed(seed, avoidList);
if (!candidate || !candidate.word) continue; // This will always fail!
```

**Impact:** AI generation always fails silently, falls back to database words. AI quota is wasted.

**Solution:** Parse AI response before returning:

```javascript
async function generateWithSeed(seed, avoidList = []) {
  const rawText = await hf.textGeneration(...);
  return parseGeneratedCandidate(rawText); // Parse JSON from text
}
```

**Updated Prompt Format (includes pronunciation):**

```
You are a concise vocabulary generator.
Use the numeric seed ${seed} to produce one uncommon but useful English word.
Return only valid JSON in this exact shape with no extra text:

{
  "word": "singleword",
  "pronunciation": "/IPA notation here/",
  "part_of_speech": "noun|verb|adjective|adverb",
  "definition": "one line definition",
  "example": "one short example sentence using the word",
  "example_2": "a second short example in a different context"
}

Do not use words previously used. Prefer practical, non-obscure words people should know.
Provide pronunciation in IPA (International Phonetic Alphabet) notation.
```

---

**Problem 3: AI Used for Validation**
**Current:** No AI validation, but user requirements mention "maybe AI powered" for free-text input.

**Recommendation:** Use deterministic validation first, AI only as fallback:

1. Exact match (case-insensitive)
2. Fuzzy match (Levenshtein distance < 2)
3. Stemming match (serendipity ≈ serendipitous)
4. If all fail AND user sent long text → Use AI to check if word is used correctly in context

**AI Call Boundary:** Only call AI for validation if:

- User sent > 10 words (likely a sentence)
- Deterministic matching failed
- Word is in user's vocabulary (not random text)

---

### E2. Proposed AI Usage Rules

**Rule 1: Word Generation**

- **When:** Only when database has no reusable words for this user
- **Fallback:** Select random words from database that user hasn't learned yet
- **Max Attempts:** 3 per user per day
- **Failure Handling:** Immediately fallback to database words, no retries
- **Pronunciation:** Always included in AI generation prompt (IPA format)

**Rule 2: Answer Validation**

- **Primary:** Deterministic matching (exact, fuzzy, stemming) for simple cases
- **AI Validation:** Preferred for complex cases (sentences, context-dependent usage)
- **When to use AI:** Long sentences (> 5 words), ambiguous matches, context validation needed
- **Note:** Free model allows more liberal AI usage for better validation quality

**Rule 3: Pronunciation Generation**

- **Method:** AI generation in initial word creation prompt
- **Format:** IPA notation (e.g., `/ˌserənˈdipitē/`)
- **Storage:** Stored in `words.pronunciation` field
- **Display:** Always shown when word is introduced

**Rule 4: Example Generation**

- **Method:** AI generation in initial word creation prompt (2 examples per word)
- **Storage:** Stored in `words.example` and `words.example_2` fields
- **Reuse:** Examples stored in database, reused for all users

---

## F. Failure Safety

### F1. AI Failure Scenarios

**Scenario 1: AI Quota Exceeded**
**Current Behavior:** `generateWithSeed()` returns `null`, `generateUniqueWord()` falls back to starter words.

**Problem:** No user notification. User receives words but doesn't know AI failed.

**Proposed Behavior:**

1. Fallback to words from database not yet served to this user (silent)
2. If none available → try AI generation
3. If AI fails → select random word from database (even if served to other users)
4. Log error for admin
5. User receives words normally (no error message)
6. Admin dashboard shows AI quota status

**Rationale:** User experience should not degrade. Fallbacks are seamless.

---

**Scenario 2: AI Returns Invalid JSON**
**Current Behavior:** `parseGeneratedCandidate()` returns `null`, falls back to starter word.

**Problem:** No retry, no logging of what went wrong.

**Proposed Behavior:**

1. Attempt to parse JSON
2. If fails → log raw response for debugging
3. Fallback to random word from database (not yet served to this user)
4. If none available → select any word from database
5. Continue silently (user gets word)

---

**Scenario 3: AI Service Unavailable**
**Current Behavior:** Exception caught, returns `null`, falls back.

**Proposed Behavior:**

1. Catch exception
2. Log error with timestamp
3. Mark AI as "unavailable" for 1 hour (circuit breaker)
4. Skip AI calls during circuit breaker period
5. Fallback to database words (select random words not yet served to user)
6. Retry AI after circuit breaker expires

---

### F2. Word Generation Failure

**Scenario: Cannot Generate Unique Word**
**Current Behavior:** `serveWordsToUser()` sends message "Light day today—no new words."

**Problem:** User gets no words even though they should.

**Proposed Behavior:**

1. Try reusable words from database (words not yet served to this user)
2. If none available → generate new word with AI
3. If AI fails → select random word from database (even if served to other users, but not this user)
4. If truly no words exist → send message: "All words reviewed! New words coming tomorrow. Use /review to practice existing words."
5. Never send "no words" message unless truly no words exist in entire database

---

### F3. User Reply Out of Context

**Scenario: User Sends Message When No Challenge Active**
**Current Behavior:** Generic handler checks for pending words, may or may not match.

**Proposed Behavior:**

1. Check if user has active session → route to session handler
2. If no active session → check if message matches any due word (fuzzy match)
3. If matches → treat as unsolicited recall attempt → provide feedback
4. If no match → send helpful message: "No active challenge. Use /review to start a session, or /today to see today's words."

**Key:** Never silently ignore user messages. Always provide feedback.

---

### F4. Handler Receives Unexpected Input

**Scenario: User Clicks Button That Doesn't Exist Anymore**
**Current Behavior:** Callback query ignored (line 423).

**Proposed Behavior:**

1. Check if callback data is valid
2. If invalid/expired → send message: "That action expired. Use /review to start a new session."
3. Log invalid callbacks for debugging
4. Always respond to callback (Telegram requires 200 OK)

---

**Scenario: User Sends Command During Active Session**
**Current Behavior:** Command handler executes, session state lost.

**Proposed Behavior:**

1. Check if user has active session
2. If yes → send message: "You have an active review session. Complete it or use /cancel to end it."
3. Allow `/cancel` command to end session
4. Other commands blocked during active session (or session auto-cancels)

---

### F5. Database Failure

**Scenario: Supabase Query Fails**
**Current Behavior:** Some handlers catch errors, some don't. User may see generic error or no response.

**Proposed Behavior:**

1. All database queries wrapped in try-catch
2. On error → log error, send user-friendly message: "Temporary issue. Please try again in a moment."
3. Retry logic for transient failures (network issues)
4. Never expose database errors to user
5. Always return 200 OK to Telegram (prevent retries)

---

### F6. Never Dead-End the User

**Principle:** Every user action must have a clear next step.

**Examples:**

- User answers incorrectly → Show correct answer + "Try another word" button
- User has no words → Show "Your first words arrive at [time]" + "/help" button
- User sends invalid input → Show "I didn't understand. Use /help for commands." + "/help" button
- Session expires → Show "Session expired. Use /review to start a new one." + "/review" button

**Rule:** Every error message must include at least one actionable button or command.

---

## G. Missing Features (Per Requirements)

### G1. Pronunciation

**Requirement:** Words must include pronunciation when introduced.

**Current:** Not implemented (no `pronunciation` field in schema).

**Proposed:**

1. Add `pronunciation` field to `words` table (TEXT, nullable)
2. Generate pronunciation during AI word creation (included in prompt)
3. Display pronunciation in word cards: "serendipity /ˌserənˈdipitē/"
4. Format: IPA notation stored as string

---

### G2. Inline Keyboards

**Requirement:** Use inline keyboards and buttons wherever possible.

**Current:** No inline keyboards used. All interactions are free-text.

**Proposed:**

- Daily word delivery: Buttons for "Show definition", "Start practice"
- Recall challenges: Buttons for "Show hint", "Skip", "I know it"
- Review sessions: Buttons for "Start review", "Next challenge", "End session"
- Feedback: Buttons for "Try another", "End session"

**Implementation:** Use `TelegramBot.sendMessage()` with `reply_markup` option.

---

### G3. Structured Cards

**Requirement:** Use structured cards with buttons, not raw text walls.

**Current:** All messages are plain text with emojis.

**Proposed:** Use Telegram's message formatting:

- Bold for words: `**serendipity**`
- Italic for definitions: `*the occurrence of events...*`
- Code blocks for pronunciation: `` `/ˌserənˈdipitē/` ``
- Inline keyboards for actions

**Example:**

```
**serendipity** (noun)
`/ˌserənˈdipitē/`

Definition: the occurrence of events by chance in a happy way

[Show definition] [Start practice]
```

---

## H. Implementation Priority

### Phase 1: Critical Fixes (Week 1)

1. Fix message handler logic contradiction (unify today vs older words)
2. Fix AI response parsing (parse JSON before returning)
3. Add session state tracking (database table)
4. Implement proper recall challenge flow
5. Add inline keyboards to all interactions

### Phase 2: Core Features (Week 2)

1. Implement review session handler with state tracking
2. Add pronunciation field and generation
3. Fix spaced repetition interval updates
4. Implement structured cards with buttons
5. Add failure safety handlers

### Phase 3: Polish (Week 3)

1. Improve feedback messages (gen-z friendly)
2. Add AI validation fallback for long sentences
3. Implement circuit breaker for AI failures
4. Add admin dashboard for monitoring
5. Comprehensive error handling and logging

---

## I. Product Decisions (Confirmed)

1. **Session State Storage:** ✅ **Database** - Persistent storage in `active_sessions` table for serverless reliability.

2. **Review Session Length:** ✅ **Configurable per user** - Default: 3 words per session (5 is too much). Stored in `users.review_words_per_session` field.

3. **Mastery Definition:** ✅ **3 consecutive correct answers** - Word transitions to "mastered" stage after 3 correct recalls in a row.

4. **AI Validation:** ✅ **AI-powered validation preferred** - Since using free model, AI can handle more validation. Use deterministic matching for exact/simple cases, AI for complex sentence validation.

5. **Pronunciation Source:** ✅ **AI generation** - Pronunciation included in initial word generation prompt. Format: IPA notation (e.g., `/ˌserənˈdipitē/`).

6. **Starter Words:** ✅ **No hardcoded words** - Use existing words from database instead. For new users, select random words from `words` table that haven't been served to that user.

---

## Conclusion

The current implementation requires fundamental architectural changes to function as a true ETIAD-style vocabulary learning system. The primary issues are:

1. **Lack of state management** - No way to track active challenges
2. **Passive word delivery** - Shows answers before testing
3. **Broken recall system** - Cannot validate user responses
4. **AI misuse** - Wasted quota on avoidable calls
5. **Poor error handling** - Users can dead-end

The proposed redesign addresses all these issues with clear handler responsibilities, proper state management, and failure-safe flows that never dead-end the user.
