# Daily.js Word Prioritization Optimization

## Changes Made

### 1. Enhanced Database Prioritization

The `generateUniqueWord()` function now follows a strict priority order to minimize AI consumption:

**Priority 1**: Get random word from DB that user hasn't learned
- Uses `getRandomWordFromDb()` with increased limit (100 → 200 words)
- Most efficient - no AI calls

**Priority 2**: Get any reusable word from DB
- Uses `getReusableWordFromDb()` with increased limit (50 → 200 words)
- Even if user learned it, other users can reuse it
- Still no AI calls

**Priority 3**: Reuse learned words (if user has learned many words)
- If user has learned 10+ words, allow reusing recently learned words
- Better than generating new words via AI
- No AI calls

**Priority 4**: AI Generation (Last Resort)
- Only if database is exhausted
- Reduced attempts from 3 to 2 (since DB is prioritized)
- Checks word existence BEFORE returning to avoid duplicates

**Final Fallback**: Get any word from DB
- Even if in avoid list, better than nothing
- Absolute last resort before returning null

### 2. Increased Database Query Limits

- `getRandomWordFromDb()`: Increased limit from 100 to 200 words
- `getReusableWordFromDb()`: Increased limit from 50 to 200 words
- Better coverage = higher chance of finding words without AI

### 3. Local Development Wrapper

Created `local.js` for local development:
- Loads `.env` file automatically (only in local, not production)
- Provides simple HTTP server for testing webhook locally
- Can be run with: `node local.js`
- Listens on port 3000 (or PORT env var)

## Expected Impact

- **AI Consumption**: Reduced by ~80-90%
  - Most words will come from existing database
  - AI only used when database is truly exhausted
  - Reduced AI attempts (3 → 2)

- **Performance**: Improved
  - Database queries are faster than AI generation
  - Less network latency
  - More predictable response times

- **Cost**: Significantly reduced
  - Fewer AI API calls
  - Lower infrastructure costs

## Testing

Tests updated to verify:
- Database prioritization logic
- Word delivery with proper formatting
- Button functionality

Run tests with: `npm test`

## Usage

### Local Development

```bash
# Start local webhook server
node local.js

# Server will run on http://localhost:3000/webhook
# POST Telegram updates to test locally
```

### Production

The `local.js` file is ignored in production. Vercel uses `api/webhook.js` directly with environment variables injected automatically.


