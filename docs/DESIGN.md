# Daily Word Bot - System Architecture

## Overview

A Telegram bot that delivers daily vocabulary words using spaced repetition. Built on Vercel serverless functions with Supabase for persistence and HuggingFace AI for word generation.

## Architecture Diagram

```
┌─────────────────┐
│ Telegram Users  │
└────────┬────────┘
         │
         │ Webhook Updates
         ▼
┌─────────────────────────────────────┐
│     VERCEL SERVERLESS PLATFORM       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  api/webhook.js                │  │
│  │  • Command handlers            │  │
│  │  • Callback handlers           │  │
│  │  • Message processors          │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Cron Jobs (GitHub Actions)    │  │
│  │  • daily.js (8:00 UTC)         │  │
│  │  • midday.js (12:00 UTC)       │  │
│  │  • evening.js (20:00 UTC)      │  │
│  │  • review.js (10,14,18 UTC)    │  │
│  │  • weekly.js (Sun 20:00 UTC)   │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  api/admin.js                  │  │
│  │  • Password-protected broadcast│  │
│  └────────────────────────────────┘  │
└──────────┬───────────────────────────┘
           │
    ┌──────┼──────┬──────────────┐
    ▼      ▼      ▼              ▼
┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│Supabase│ │HuggingFace│ │  GitHub   │ │ Telegram │
│        │ │   API     │ │  Actions  │ │   API    │
│• users │ │• Word gen │ │• Cron     │ │• Messages│
│• words │ │• Validation│ │  triggers │ │• Callbacks│
│• stats │ │           │ │           │ │          │
└────────┘ └──────────┘ └──────────┘ └──────────┘
```

## Core Components

### API Handlers

**api/webhook.js** - Main webhook handler

- Command processing (`/start`, `/today`, `/review`, etc.)
- Callback query handling (button presses)
- Message processing (answers, contact messages)
- Session management integration

**api/cron/daily.js** - Daily word delivery

- Fetches active users
- Generates words (DB-first, then AI)
- Sends word cards via Telegram
- Handles failures with admin alerts

**api/cron/midday.js** - Midday recall prompts

- Sends recall challenges for morning words

**api/cron/evening.js** - Evening usage challenges

- Sends usage prompts for learned words

**api/cron/review.js** - Review reminders

- Notifies users with 3+ due words (3x daily)

**api/cron/weekly.js** - Weekly summaries

- Generates progress statistics
- Sends weekly reports

**api/admin.js** - Admin broadcast

- Password-protected message broadcasting
- HTML form interface

### Library Modules

**lib/spacedRepetition.js**

- SRS algorithm implementation
- Interval calculation (exponential backoff)
- Due word queries
- Next review scheduling

**lib/sessionManager.js**

- Review/challenge session state
- Progress tracking
- Session lifecycle management

**lib/answerValidator.js**

- Answer validation logic
- AI-powered validation for complex answers
- Simple matching for short answers

**lib/keyboardUtils.js**

- Telegram inline keyboard generation
- Button layout management

**lib/utils.js**

- Helper functions (messages, formatting)
- User-facing text generation

## Data Flow

### Daily Word Delivery

```
GitHub Actions (8:00 UTC)
  → /api/cron/daily
    → Query users
    → For each user:
      → Check due reviews (skip if 5+)
      → Generate words:
        1. Unlearned words from DB (user-specific)
        2. Reusable words from DB
        3. AI generation (fallback)
      → Save to DB
      → Send via Telegram
```

### Review Session

```
User: /review
  → startReviewSession()
    → Get due words (exclude today's)
    → Create session
    → Send first challenge
      → User answers
        → Validate answer
        → Update SRS interval
        → Show feedback + "Next word" button
          → Continue until complete
```

### Spaced Repetition

```
Word delivered → next_review = now + 1 day

User reviews:
  ✓ Correct → interval *= 2, next_review = now + interval
  ✗ Incorrect → interval = 1 day, next_review = now + interval
```

## Database Schema

**users** - User accounts

- `chat_id`, `words_per_day`, `review_words_per_session`, `pending_contact_message`

**words** - Vocabulary database

- `word`, `pronunciation`, `definition`, `example`, `part_of_speech`

**user_words** - User learning progress

- `user_id`, `word_id`, `next_review`, `interval`, `correct_count`, `last_response`

**user_stats** - User statistics

- `user_id`, `streak`, `last_completed`

**sessions** - Active review sessions

- `user_id`, `type`, `word_ids`, `current_index`, `progress`

## Key Design Decisions

1. **Serverless Architecture** - Vercel functions for scalability
2. **Database-First Word Selection** - Reduces AI costs, improves consistency
3. **Session-Based Reviews** - Structured flow prevents confusion
4. **ETIAD Compliance** - No definitions before recall attempts
5. **GitHub Actions for Cron** - Free alternative to paid services
6. **Graceful Degradation** - User-friendly failure messages + admin alerts

## Technology Stack

- **Runtime**: Node.js (Vercel serverless)
- **Database**: Supabase (PostgreSQL)
- **AI**: HuggingFace Inference API
- **Scheduler**: GitHub Actions
- **Bot Framework**: node-telegram-bot-api
- **Deployment**: Vercel
