# DailyWord Bot - Functional Tests

## Overview

This directory contains functional tests for the DailyWord Telegram bot. The tests verify core functionality including user registration, word delivery, review sessions, answer validation, and spaced repetition logic.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test tests/functional.test.js
```

## Test Structure

### Test Categories

1. **User Registration** - Tests user creation and onboarding
2. **Daily Word Delivery** - Tests word delivery with ETIAD compliance
3. **Keyboard Utilities** - Tests inline keyboard creation
4. **Answer Validation** - Tests answer validation logic (exact, fuzzy, AI)
5. **Spaced Repetition** - Tests interval updates and mastery tracking
6. **Session Management** - Tests review session creation and tracking
7. **Word Card Flow** - Tests ETIAD-compliant word card interactions
8. **Error Handling** - Tests graceful error handling
9. **Integration** - Tests complete user flows

## Prerequisites

- Node.js 14+
- Supabase database with test schema
- Environment variables configured:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`

## Test Data

Tests create and clean up their own test data:

- Test users (chat_id: 123456789, 999999999, etc.)
- Test words
- Test user_words entries
- Test sessions

All test data is automatically cleaned up after tests complete.

## Notes

- Tests use real Supabase database (use a test/development database)
- Tests are designed to be idempotent (can run multiple times)
- Mock Telegram bot is used to avoid sending actual messages
- Tests verify ETIAD compliance (no definitions shown before recall challenges)
