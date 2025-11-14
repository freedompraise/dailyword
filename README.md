# Daily Word Telegram Bot

A Telegram bot that sends daily vocabulary words to help users learn new words. Built with Node.js, Supabase, and Google Gemini AI.

## Features

- 📚 Daily vocabulary words (1-3 words per day, customizable)
- 🧠 Midday recall prompts
- 🌙 Evening usage challenges
- 📊 Progress tracking and streaks
- 🔄 Spaced repetition reviews
- 📈 Weekly summaries

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with:

```
TELEGRAM_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
ADMIN_CHAT_ID=your_chat_id  # Optional
```

3. Run locally (uses polling):

```bash
npm start
```

## Deployment to Vercel

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deploy Steps:

1. **Deploy to Vercel:**

   ```bash
   npm i -g vercel
   vercel login
   vercel --prod
   ```

2. **Set environment variables in Vercel dashboard:**

   - `TELEGRAM_TOKEN`
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `ADMIN_CHAT_ID` (optional)

3. **Set Telegram webhook:**
   ```bash
   WEBHOOK_URL=https://your-project.vercel.app/api/webhook npm run set-webhook
   ```

## Bot Commands

- `/start` - Register and start using the bot
- `/setwords N` - Set words per day (1, 2, or 3)
- `/today` - View today's word
- `/progress` - View your learning progress

## Architecture

- **Webhook Handler**: `api/webhook.js` - Handles all Telegram updates
- **Cron Jobs**: Scheduled tasks in `api/cron/` for daily operations
- **Database**: Supabase for user data, words, and progress tracking
- **AI**: Google Gemini for generating unique vocabulary words

## Important Notes

✅ **GitHub Actions** are used for cron jobs (free for public repos). See DEPLOYMENT.md for setup.

✅ **User Experience**: The bot now features:

- Friendly welcome messages with bot explanation
- Countdown to next word delivery for new users
- Engaging responses and emoji-rich interactions
- Helpful `/help` command
- Improved progress tracking with visual feedback

⚠️ All cron schedules in `.github/workflows/cron.yml` are in **UTC timezone**. Adjust if needed for your timezone.

## License

ISC
