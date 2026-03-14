const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');
const { getWelcomeMessage, getHelpMessage, formatTimeUntilNextWord, hasReceivedTodayWords, getFriendlyResponse } = require('../lib/utils');
const { getUserByChatId, ensureUser, getUserById } = require('../lib/userUtils');
const sessionManager = require('../lib/sessionManager');
const { validateAnswer } = require('../lib/answerValidator');
const { updateWordInterval, getDueWords, getDueWordsCount, getTodayWords } = require('../lib/spacedRepetition');
const {
  createNewWordCardKeyboard,
  createWordCardKeyboard,
  createDefinitionKeyboard,
  createChallengeKeyboard,
  createFeedbackKeyboard,
  createReviewStartKeyboard
} = require('../lib/keyboardUtils');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || null;

let bot;
if (TELEGRAM_TOKEN) {
  bot = new TelegramBot(TELEGRAM_TOKEN);
} else {
  console.error('TELEGRAM_TOKEN missing');
}


async function updateUserStreak(userId) {
  const now = new Date();
  const nowISO = now.toISOString();
  const oneDay = 24 * 60 * 60 * 1000;
  const { data: stat } = await db().from('user_stats').select('*').eq('user_id', userId).maybeSingle();
  if (!stat) {
    await db().from('user_stats').insert({ user_id: userId, streak: 1, last_completed: nowISO });
    return;
  }
  if (stat.last_completed) {
    const lastCompletedDate = new Date(stat.last_completed);
    const timeDiff = now.getTime() - lastCompletedDate.getTime();
    if (timeDiff <= oneDay * 2) {
      await db().from('user_stats').update({ streak: stat.streak + 1, last_completed: nowISO }).eq('id', stat.id);
    } else {
      await db().from('user_stats').update({ streak: 1, last_completed: nowISO }).eq('id', stat.id);
    }
  } else {
    await db().from('user_stats').update({ streak: 1, last_completed: nowISO }).eq('id', stat.id);
  }
}

function buildStatusSummary({ todayCount, dueCount, wordsPerDay }) {
  const parts = [];
  parts.push(`📦 Today: ${todayCount} word${todayCount === 1 ? '' : 's'}`);
  parts.push(`🔔 Reviews due: ${dueCount}`);
  parts.push(`⚙️ Daily goal: ${wordsPerDay}`);
  return parts.join(' • ');
}

function getMessageFromUpdate(update) {
  return update.message || update.edited_message || update.channel_post || update.edited_channel_post || null;
}

function getChatId(msg) {
  if (!msg || !msg.chat) return null;
  return msg.chat.id;
}

if (!bot) {
  console.error('❌ Bot not initialized - handlers not registered');
}

// Callback query handler for button presses
async function handleCallbackQuery(callbackQuery) {
  if (!bot) return;
  
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  console.log('🔘 Processing callback:', data);
  
  // Get user
  const user = await getUserByChatId(chatId);
  if (!user) {
    await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
    return;
  }
  
  // Parse callback data
  const parts = data.split(':');
  const action = parts[0];
  
  try {
    if (action === 'word') {
      const subAction = parts[1];
      const wordId = parseInt(parts[2], 10);
      
      const { data: word } = await supabase
        .from('words')
        .select('*')
        .eq('id', wordId)
        .single();
      
      if (!word) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Word not found' });
        return;
      }
      
      if (subAction === 'show') {
        let defText = `${word.word}`;
        if (word.pronunciation) defText += ` (${word.pronunciation})`;
        if (word.part_of_speech) defText += `\n<i>${word.part_of_speech}</i>`;
        defText += `\n\nDefinition: ${word.definition}`;
        if (word.example) defText += `\nExample: ${word.example}`;
        
        await bot.editMessageText(defText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...createDefinitionKeyboard(wordId, !!word.example_2)
        });
      } else if (subAction === 'practice' || subAction === 'challenge') {
        await initiateRecallChallenge(chatId, user.id, wordId);
      } else if (subAction === 'example') {
        let exampleText = `${word.word}\n\n`;
        if (word.example_2) {
          exampleText += `Example 2: ${word.example_2}`;
        } else if (word.example) {
          exampleText += `Example: ${word.example}`;
        } else {
          exampleText += 'No additional examples available.';
        }
        
        await bot.editMessageText(exampleText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...createDefinitionKeyboard(wordId, false)
        });
      } else if (subAction === 'back') {
        let cardText = `${word.word}`;
        if (word.pronunciation) {
          cardText += ` (${word.pronunciation})`;
        }
        if (word.part_of_speech) {
          cardText += `\n<i>${word.part_of_speech}</i>`;
        }
        
        await bot.editMessageText(cardText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...createWordCardKeyboard(wordId)
        });
      }
    } else if (action === 'review') {
      const subAction = parts[1];
      
      if (subAction === 'start') {
        const count = parts[2] ? parseInt(parts[2], 10) : (user.review_words_per_session || 3);
        await startReviewSession(chatId, user.id, count);
      } else if (subAction === 'list') {
        const dueWords = await getDueWords(user.id, 10);
        if (dueWords.length === 0) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'No words due for review' });
          return;
        }
        let listText = `📋 Words due for review (${dueWords.length}):\n\n`;
        dueWords.slice(0, 10).forEach((w, idx) => {
          listText += `${idx + 1}. ${w.words?.word || 'Word'}\n`;
        });
        await bot.sendMessage(chatId, listText);
      } else if (subAction === 'cancel') {
        await sessionManager.cancelUserSession(user.id);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Review cancelled' });
      }
    } else if (action === 'session') {
      const sessionId = parts[1];
      const subAction = parts[2];
      
      const session = await sessionManager.getSessionById(sessionId);
      if (!session || session.user_id !== user.id) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Session expired or not found' });
        return;
      }
      
      if (subAction === 'next') {
        const nextWordId = parseInt(parts[3], 10);
        await continueReviewSession(chatId, user.id, sessionId, nextWordId);
      } else if (subAction === 'end') {
        await endReviewSession(chatId, user.id, sessionId);
      } else if (subAction === 'hint') {
        const wordId = parseInt(parts[3], 10);
        await showHint(chatId, wordId);
      } else if (subAction === 'skip') {
        const wordId = parseInt(parts[3], 10);
        await skipWord(chatId, user.id, sessionId, wordId);
      }
    } else if (action === 'challenge') {
      const subAction = parts[1];
      const wordId = parseInt(parts[2], 10);
      
      if (subAction === 'hint') {
        await showHint(chatId, wordId);
      } else if (subAction === 'skip') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Challenge skipped' });
      } else if (subAction === 'cancel') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Challenge cancelled' });
      }
    }
  } catch (error) {
    console.error('Error in callback handler:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing action' });
  }
}

async function processRecallAnswer(chatId, userId, sessionId, wordId, userAnswer) {
  const { data: word } = await supabase
    .from('words')
    .select('*')
    .eq('id', wordId)
    .single();
  
  if (!word) {
    await bot.sendMessage(chatId, 'Word not found.');
    return;
  }
  
  const { data: userWord } = await supabase
    .from('user_words')
    .select('*')
    .eq('user_id', userId)
    .eq('word_id', wordId)
    .maybeSingle();
  
  if (!userWord) {
    await bot.sendMessage(chatId, 'Word not found in your vocabulary.');
    return;
  }
  
  const useAI = userAnswer.trim().split(/\s+/).length > 5;
  const validation = await validateAnswer(userAnswer, word.word, word.definition || '', useAI);
  const wasCorrect = validation.correct;
  
  await updateWordInterval(userWord.id, wasCorrect);
  
  if (wasCorrect) {
    await updateUserStreak(userId);
  }
  
  const session = await sessionManager.getSessionById(sessionId);
  if (!session) {
    await sendChallengeFeedback(chatId, word, wasCorrect, validation);
    return;
  }
  
  await sessionManager.updateSessionProgress(sessionId, session.current_index, {
    word_id: wordId,
    was_correct: wasCorrect,
    answered_at: new Date().toISOString()
  });
  
  const nextIndex = (session.current_index || 0) + 1;
  const totalWords = session.word_ids.length;
  const currentWordNum = session.current_index + 1;
  const nextWordId = nextIndex < session.word_ids.length ? session.word_ids[nextIndex] : null;
  
  await sendChallengeFeedback(chatId, word, wasCorrect, validation, sessionId, nextWordId, currentWordNum, totalWords);
  
  if (nextIndex >= session.word_ids.length) {
    setTimeout(() => endReviewSession(chatId, userId, sessionId), 2000);
  } else {
    await sessionManager.updateSessionProgress(sessionId, nextIndex);
  }
}

async function sendChallengeFeedback(chatId, word, wasCorrect, validation, sessionId = null, nextWordId = null, currentWordNum = null, totalWords = null) {
  let feedbackText = '';
  
  if (wasCorrect) {
    feedbackText = `✅ Correct! Well done!\n\n`;
    feedbackText += `The word is: ${word.word}\n`;
    if (word.pronunciation) {
      feedbackText += `Pronunciation: ${word.pronunciation}\n`;
    }
    
    if (sessionId && currentWordNum && totalWords) {
      feedbackText += `\n(${currentWordNum}/${totalWords} complete)`;
    } else {
      feedbackText += `\nYou'll see this again based on your spaced repetition schedule.`;
    }
  } else {
    feedbackText = `❌ Not quite, but good effort!\n\n`;
    feedbackText += `The correct word is: ${word.word}\n`;
    if (word.pronunciation) {
      feedbackText += `Pronunciation: ${word.pronunciation}\n`;
    }
    feedbackText += `Definition: ${word.definition}\n`;
    if (word.example) {
      feedbackText += `Example: ${word.example}\n`;
    }
    
    if (sessionId && currentWordNum && totalWords) {
      feedbackText += `\n(${currentWordNum}/${totalWords} complete)`;
    } else {
      feedbackText += `\nI'll ask you again soon to help it stick.`;
    }
  }
  
  const keyboard = createFeedbackKeyboard(wasCorrect, sessionId, nextWordId);
  
  await bot.sendMessage(chatId, feedbackText, { 
    parse_mode: 'HTML',
    ...keyboard
  });
}

// Initiate a recall challenge for a word
async function initiateRecallChallenge(chatId, userId, wordId) {
  const { data: word } = await supabase
    .from('words')
    .select('*')
    .eq('id', wordId)
    .single();
  
  if (!word) {
    await bot.sendMessage(chatId, 'Word not found.');
    return;
  }
  
  const session = await sessionManager.createSession(userId, 'challenge', [wordId]);
  
  let challengeText = `🧠 Recall Challenge\n\n`;
  challengeText += `Definition: ${word.definition}\n`;
  if (word.example) {
    const exampleWithBlank = word.example.replace(new RegExp(word.word, 'gi'), '[???]');
    challengeText += `Example: ${exampleWithBlank}\n`;
  }
  challengeText += `\nWhat's the word?`;
  
  await bot.sendMessage(chatId, challengeText, {
    parse_mode: 'HTML',
    ...createChallengeKeyboard(wordId, session.id)
  });
}

async function startReviewSession(chatId, userId, wordCount) {
  const existingSession = await sessionManager.getActiveSession(userId);
  if (existingSession) {
    await bot.sendMessage(chatId, 'You already have an active review session. Complete it first or use /cancel to end it.');
    return;
  }
  
  const dueWords = await getDueWords(userId, wordCount, true);
  if (dueWords.length === 0) {
    await bot.sendMessage(chatId, '✅ No words due for review right now. Check back later!');
    return;
  }
  
  const wordIds = dueWords.map(uw => uw.word_id);
  const session = await sessionManager.createSession(userId, 'review', wordIds);
  
  await continueReviewSession(chatId, userId, session.id, wordIds[0]);
}

async function continueReviewSession(chatId, userId, sessionId, wordId) {
  const session = await sessionManager.getSessionById(sessionId);
  if (!session || session.user_id !== userId) {
    await bot.sendMessage(chatId, 'Session not found or expired.');
    return;
  }
  
  const { data: word } = await supabase
    .from('words')
    .select('*')
    .eq('id', wordId)
    .single();
  
  if (!word) {
    await bot.sendMessage(chatId, 'Word not found.');
    return;
  }
  
  const currentIndex = session.current_index || 0;
  const totalWords = session.word_ids.length;
  
  let challengeText = `🧠 Challenge ${currentIndex + 1} of ${totalWords}\n\n`;
  challengeText += `Definition: ${word.definition}\n`;
  if (word.example) {
    const exampleWithBlank = word.example.replace(new RegExp(word.word, 'gi'), '[???]');
    challengeText += `Example: ${exampleWithBlank}\n`;
  }
  challengeText += `\nWhat's the word?`;
  
  await bot.sendMessage(chatId, challengeText, {
    parse_mode: 'HTML',
    ...createChallengeKeyboard(wordId, sessionId)
  });
}

// Show hint for a word
async function showHint(chatId, wordId) {
  const { data: word } = await supabase
    .from('words')
    .select('*')
    .eq('id', wordId)
    .single();
  
  if (!word) return;
  
  // Show first letter and length
  const firstLetter = word.word.charAt(0).toUpperCase();
  const length = word.word.length;
  const hint = firstLetter + '_'.repeat(length - 1);
  
  await bot.sendMessage(chatId, `💡 Hint: ${hint} (${length} letters)`);
}

// Skip a word in review session
async function skipWord(chatId, userId, sessionId, wordId) {
  const session = await sessionManager.getSessionById(sessionId);
  if (!session) return;
  
  const currentIndex = session.current_index || 0;
  const wordIds = session.word_ids;
  
  // Mark as skipped (incorrect)
  await updateWordInterval(wordId, false);
  
  // Move to next word
  const nextIndex = currentIndex + 1;
  if (nextIndex >= wordIds.length) {
    // Session complete
    await endReviewSession(chatId, userId, sessionId);
  } else {
    await sessionManager.updateSessionProgress(sessionId, nextIndex);
    await continueReviewSession(chatId, userId, sessionId, wordIds[nextIndex]);
  }
}

// End review session and show summary
async function endReviewSession(chatId, userId, sessionId) {
  const session = await sessionManager.getSessionById(sessionId);
  if (!session) return;
  
  const user = await getUserById(userId);
  if (!user) return;
  
  const results = session.results || [];
  const correctCount = results.filter(r => r.was_correct === true).length;
  const totalCount = results.length;
  
  let summaryText = `🎉 Review Complete!\n\n`;
  summaryText += `Results:\n`;
  summaryText += `✅ Correct: ${correctCount}/${totalCount}\n`;
  summaryText += `❌ Incorrect: ${totalCount - correctCount}/${totalCount}\n\n`;
  
  // Get remaining due words
  const remainingDue = await getDueWordsCount(userId, true);
  if (remainingDue > 0) {
    summaryText += `You still have ${remainingDue} words due for review.\n\n`;
  }
  
  // Get streak
  const { data: stat } = await db().from('user_stats').select('streak').eq('user_id', userId).maybeSingle();
  if (stat && stat.streak) {
    summaryText += `Your streak: ${stat.streak} day${stat.streak !== 1 ? 's' : ''} 🔥\n\n`;
  }
  
  summaryText += `Great work! Keep practicing to build your vocabulary.`;
  
  await bot.sendMessage(chatId, summaryText, {
    ...createReviewStartKeyboard(remainingDue, user.review_words_per_session || 3)
  });
  
  // Complete session
  await sessionManager.completeSession(sessionId);
}

module.exports = async (req, res) => {
  // Check if bot is initialized
  if (!bot) {
    console.error('Bot not initialized - TELEGRAM_TOKEN missing');
    return res.status(500).json({ error: 'Bot not configured. Please set TELEGRAM_TOKEN in Vercel environment variables.' });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Log incoming update for debugging
      console.log('📥 Webhook received update:', {
        update_id: update?.update_id,
        hasMessage: !!update?.message,
        hasEditedMessage: !!update?.edited_message,
        hasCallbackQuery: !!update?.callback_query,
        hasInlineQuery: !!update?.inline_query,
        keys: update ? Object.keys(update) : 'no update'
      });
      
      // Validate update structure
      if (!update || typeof update !== 'object') {
        console.warn('❌ Invalid update received:', update);
        return res.status(200).send('OK');
      }
      
      // Handle callback queries (button presses)
      if (update.callback_query) {
        console.log('🔘 Callback query received');
        try {
          await handleCallbackQuery(update.callback_query);
          // Answer callback query to remove loading state
          await bot.answerCallbackQuery(update.callback_query.id);
        } catch (error) {
          console.error('Error handling callback query:', error);
          await bot.answerCallbackQuery(update.callback_query.id, { text: 'Error processing action' });
        }
        return res.status(200).send('OK');
      }
      
      if (update.inline_query) {
        console.log('ℹ️ Inline query received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chosen_inline_result) {
        console.log('ℹ️ Chosen inline result received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.poll) {
        console.log('ℹ️ Poll update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.poll_answer) {
        console.log('ℹ️ Poll answer received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.my_chat_member) {
        console.log('ℹ️ Chat member update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chat_member) {
        console.log('ℹ️ Chat member update received (ignored)');
        return res.status(200).send('OK');
      }
      
      if (update.chat_join_request) {
        console.log('ℹ️ Chat join request received (ignored)');
        return res.status(200).send('OK');
      }
      
      // Only process updates that have message-like structures
      const message = getMessageFromUpdate(update);
      
      // If no message-like structure, log and ignore
      if (!message) {
        console.log('⚠️ Update without message structure received. Update keys:', Object.keys(update));
        return res.status(200).send('OK');
      }
      
      // Ensure message has required structure before processing
      if (!message.chat || !message.chat.id) {
        console.warn('⚠️ Message missing chat or chat.id:', {
          hasChat: !!message.chat,
          hasChatId: !!(message.chat && message.chat.id),
          messageKeys: Object.keys(message)
        });
        return res.status(200).send('OK');
      }
      
      // Log message details for debugging
      console.log('✅ Processing message:', {
        chatId: message.chat.id,
        hasText: !!message.text,
        text: message.text ? message.text.substring(0, 50) : 'no text',
        messageId: message.message_id
      });
      
      // Route message to appropriate handler (onText handlers don't work reliably in serverless)
      // Using manual routing ensures handlers fire correctly in Vercel
      try {
        const text = (message.text || '').trim();
        const chatId = message.chat.id;
        
        // Route commands manually
        if (text === '/start') {
          try {
            const existingUser = await getUserByChatId(chatId, false);
            const isNewUser = !existingUser;
            const user = await ensureUser(chatId);
            
            const todayStart = new Date();
            todayStart.setUTCHours(0, 0, 0, 0);
            const todayISO = todayStart.toISOString();
            const { data: todayWords } = await db().from('user_words')
              .select('served_at')
              .eq('user_id', user.id)
              .gte('served_at', todayISO);
            
            const hasTodayWords = hasReceivedTodayWords(todayWords);
            const welcomeMsg = getWelcomeMessage(isNewUser, hasTodayWords);
            
            await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'HTML' });
            
            if (isNewUser && ADMIN_CHAT_ID) {
              await bot.sendMessage(ADMIN_CHAT_ID, `🎉 New user started: ${chatId}`);
            }
          } catch (e) {
            console.error('❌ Error in /start handler:', e);
            await bot.sendMessage(chatId, '😔 Oops! Something went wrong. Please try again in a moment.');
          }
        } else if (text.match(/^\/setwords (1|2|3)$/)) {
          const match = text.match(/^\/setwords (1|2|3)$/);
          const num = parseInt(match[1], 10);
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
          } else {
            await db().from('users').update({ words_per_day: num }).eq('id', user.id);
            const emoji = num === 1 ? '📖' : num === 2 ? '📚' : '📚📚📚';
            await bot.sendMessage(chatId, `${emoji} Perfect! I'll send you ${num} word${num > 1 ? 's' : ''} every day.\n\nThis will take effect from tomorrow's delivery!`);
          }
        } else if (text.match(/^\/setreview (\d+)$/)) {
          const match = text.match(/^\/setreview (\d+)$/);
          const num = parseInt(match[1], 10);
          if (num < 1 || num > 20) {
            await bot.sendMessage(chatId, 'Please enter a number between 1 and 20 for review words per session.');
          } else {
            const user = await getUserByChatId(chatId);
            if (!user) {
              await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
            } else {
              await db().from('users').update({ review_words_per_session: num }).eq('id', user.id);
              await bot.sendMessage(chatId, `⚙️ Perfect! Your review sessions will now include ${num} word${num > 1 ? 's' : ''} by default.`);
            }
          }
        } else if (text === '/today') {
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
          } else {
            const userWords = await getTodayWords(user.id);
            const dueCount = await getDueWordsCount(user.id, true);
            
            if (!userWords || userWords.length === 0) {
              const timeUntil = formatTimeUntilNextWord();
              await bot.sendMessage(chatId, `📖 You haven't received today's words yet.\n\n⏰ Your next words will arrive in ${timeUntil}!\n\n🔔 Reviews due: ${dueCount}\n💡 In the meantime, use /review to practice older words or /help for commands.`);
            } else {
              let message = `📚 Today's Words (${userWords.length}):\n\n`;
              userWords.forEach((uw, idx) => {
                const word = uw.words || {};
                message += `${idx + 1}. <b>${word.word}</b>`;
                if (word.pronunciation) message += ` \`${word.pronunciation}\``;
                message += `\n`;
                if (word.part_of_speech) message += `   <i>${word.part_of_speech}</i>\n`;
                message += `   Definition: ${word.definition}\n`;
                if (word.example) message += `   Example: ${word.example}\n`;
                message += `\n`;
              });
              message += `🔔 Reviews due: ${dueCount}\n💡 Use the buttons on today's word cards to practice, or /review for older words.`;
              await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            }
          }
        } else if (text === '/progress') {
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
          } else {
            const { data: stat } = await db().from('user_stats').select('*').eq('user_id', user.id).maybeSingle();
            const { data: learned } = await db().from('user_words')
              .select('id,served_at,word_id,words:word_id(word)')
              .eq('user_id', user.id)
              .order('served_at', { ascending: true });
            
            const wordCount = learned ? learned.length : 0;
            const streak = stat ? stat.streak : 0;
            const dueCount = await getDueWordsCount(user.id, true);
            const todayWords = await getTodayWords(user.id);
            
            let text = `📊 Your Learning Progress\n\n`;
            text += `📚 Total words learned: <b>${wordCount}</b>\n`;
            text += `🔥 Current streak: <b>${streak} day${streak !== 1 ? 's' : ''}</b>\n`;
            text += `📖 Words per day: <b>${user.words_per_day}</b>\n`;
            text += `🔁 Review words per session: <b>${user.review_words_per_session || 3}</b>\n`;
            text += `🔔 Reviews due now: <b>${dueCount}</b>\n`;
            text += `📦 Today's new words: <b>${todayWords.length}</b>\n\n`;
            
            if (learned && learned.length > 0) {
              text += `✨ Recent words:\n`;
              learned.slice(-10).reverse().forEach((l, idx) => {
                text += `${idx + 1}. ${l.words?.word || 'N/A'}\n`;
              });
            } else {
              text += `💡 Start learning! Your first words are coming soon!`;
            }
            
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
          }
        } else if (text === '/help') {
          const helpMsg = getHelpMessage();
          await bot.sendMessage(chatId, helpMsg);
        } else if (text === '/contact') {
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
          } else {
            await supabase
              .from('users')
              .update({ pending_contact_message: true })
              .eq('id', user.id);
            
            await bot.sendMessage(
              chatId,
              '💬 Send your message below and I\'ll forward it to the admin.\n\nType /cancel to cancel.'
            );
          }
        } else if (text === '/review') {
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
          } else {
            const existingSession = await sessionManager.getActiveSession(user.id);
            if (existingSession) {
              await bot.sendMessage(chatId, 'You already have an active review session. Complete it first or use /cancel to end it.');
            } else {
              const dueCount = await getDueWordsCount(user.id, true);
              if (dueCount === 0) {
                await bot.sendMessage(chatId, '✅ No reviews due right now. Check back after your next drop!');
              } else {
                const defaultCount = user.review_words_per_session || 3;
                await bot.sendMessage(chatId, 
                  `🔁 Review Session\n\nYou have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review.\nDefault session: ${defaultCount} words (configurable with /setreview)`,
                  createReviewStartKeyboard(dueCount, defaultCount)
                );
              }
            }
          }
        } else if (text && !text.startsWith('/')) {
          // Regular message - handle it
          const user = await getUserByChatId(chatId);
          if (!user) {
            await bot.sendMessage(chatId, '👋 Hi! Please send /start to get started first.');
            return;
          }
          
          // Check if user is sending a contact message
          if (user.pending_contact_message) {
            await supabase
              .from('users')
              .update({ pending_contact_message: false })
              .eq('id', user.id);
            
            if (ADMIN_CHAT_ID) {
              const adminMessage = `📩 Message from user (ID: ${user.id}, Chat: ${chatId}):\n\n${text}`;
              await bot.sendMessage(ADMIN_CHAT_ID, adminMessage);
              await bot.sendMessage(chatId, '✅ Your message has been sent to the admin. Thank you!');
            } else {
              await bot.sendMessage(chatId, '❌ Admin contact is not configured. Sorry for the inconvenience.');
            }
            return;
          }
          
          // Check for /cancel command
          if (text.toLowerCase() === '/cancel') {
            await supabase
              .from('users')
              .update({ pending_contact_message: false })
              .eq('id', user.id);
            await bot.sendMessage(chatId, 'Cancelled.');
            return;
          }
          
          // Check for active session first
          const activeSession = await sessionManager.getActiveSession(user.id);
          if (activeSession) {
            const currentWordId = sessionManager.getCurrentWordId(activeSession);
            if (currentWordId) {
              await processRecallAnswer(chatId, user.id, activeSession.id, currentWordId, text);
            } else {
              await bot.sendMessage(chatId, 'Session complete. Use /review to start a new session.');
            }
          } else {
            // No active session - check if message matches any due word (unsolicited recall)
            const dueWords = await getDueWords(user.id, 5, true);
            if (dueWords.length > 0) {
              const firstDue = dueWords[0];
              const word = firstDue.words;
              if (word) {
                const validation = await validateAnswer(text, word.word, word.definition || '', true);
                if (validation.correct) {
                  await updateWordInterval(firstDue.id, true);
                  await updateUserStreak(user.id);
                  await bot.sendMessage(chatId, `✅ Correct! The word is ${word.word}. Great recall!`);
                } else {
                  await bot.sendMessage(chatId, `💡 No active challenge. Use /review to start a review session, or /today to see today's words.`);
                }
              }
            } else {
              await bot.sendMessage(chatId, `💡 No active challenge. Use /review to start a review session, or /today to see today's words.`);
            }
          }
        }
      } catch (processError) {
        // If processing fails, log but don't crash
        console.error('❌ Error processing update:', {
          error: processError.message,
          stack: processError.stack,
          updateId: update.update_id
        });
        // Still return 200 to Telegram
      }
      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Error processing update:', {
        error: error.message,
        stack: error.stack,
        body: req.body
      });
      // Always return 200 to Telegram to prevent retries
      res.status(200).send('OK');
    }
  } else {
    res.status(200).send('Webhook endpoint');
  }
};

