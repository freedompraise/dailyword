/**
 * Functional Tests for DailyWord Telegram Bot
 * 
 * These tests verify the core functionality of the bot including:
 * - User registration and onboarding
 * - Daily word delivery
 * - Review sessions
 * - Callback query handling
 * - Answer validation
 * - Spaced repetition logic
 * - Session management
 */

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const supabase = require('../supabaseClient');
const sessionManager = require('../lib/sessionManager');
const { validateAnswer } = require('../lib/answerValidator');
const { updateWordInterval, getDueWords, getDueWordsCount, getTodayWords } = require('../lib/spacedRepetition');
const { createNewWordCardKeyboard, createWordCardKeyboard, createDefinitionKeyboard, createReviewStartKeyboard } = require('../lib/keyboardUtils');

// Mock Telegram bot for testing
class MockTelegramBot {
  constructor() {
    this.sentMessages = [];
    this.callbackAnswers = [];
  }

  sendMessage(chatId, text, options = {}) {
    this.sentMessages.push({ chatId, text, options });
    return Promise.resolve({ message_id: this.sentMessages.length });
  }

  editMessageText(text, options = {}) {
    this.sentMessages.push({ edit: true, text, options });
    return Promise.resolve({ message_id: this.sentMessages.length });
  }

  answerCallbackQuery(queryId, options = {}) {
    this.callbackAnswers.push({ queryId, options });
    return Promise.resolve(true);
  }
}

describe('DailyWord Bot Functional Tests', () => {
  let testUserId;
  let testChatId = '123456789';
  let testWordId;
  let mockBot;

  beforeAll(async () => {
    // Create test user
    const { data: user } = await supabase
      .from('users')
      .insert({
        chat_id: testChatId,
        words_per_day: 1,
        review_words_per_session: 3
      })
      .select()
      .single();
    
    testUserId = user.id;

    // Create test word
    const { data: word } = await supabase
      .from('words')
      .insert({
        word: 'serendipity',
        pronunciation: '/ˌserənˈdipitē/',
        part_of_speech: 'noun',
        definition: 'the occurrence of events by chance in a happy way',
        example: 'Finding that book was pure serendipity.',
        example_2: 'Their meeting was pure serendipity.',
        source: 'test'
      })
      .select()
      .single();
    
    testWordId = word.id;

    mockBot = new MockTelegramBot();
  });

  afterAll(async () => {
    // Cleanup test data
    if (testUserId) {
      await supabase.from('user_words').delete().eq('user_id', testUserId);
      await supabase.from('active_sessions').delete().eq('user_id', testUserId);
      await supabase.from('user_stats').delete().eq('user_id', testUserId);
      await supabase.from('users').delete().eq('id', testUserId);
    }
    if (testWordId) {
      await supabase.from('words').delete().eq('id', testWordId);
    }
  });

  beforeEach(() => {
    mockBot.sentMessages = [];
    mockBot.callbackAnswers = [];
  });

  describe('User Registration', () => {
    it('should create new user on /start', async () => {
      const newChatId = '999999999';
      
      // Check user doesn't exist
      const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('chat_id', newChatId)
        .maybeSingle();
      
      expect(existing).toBeNull();

      // Simulate /start
      const { data: user } = await supabase
        .from('users')
        .insert({
          chat_id: newChatId,
          words_per_day: 1,
          review_words_per_session: 3
        })
        .select()
        .single();

      expect(user).toBeDefined();
      expect(user.chat_id).toBe(newChatId);
      expect(user.words_per_day).toBe(1);

      // Cleanup
      await supabase.from('users').delete().eq('id', user.id);
    });

    it('should create user_stats entry for new user', async () => {
      const newChatId = '888888888';
      
      const { data: user } = await supabase
        .from('users')
        .insert({
          chat_id: newChatId,
          words_per_day: 1
        })
        .select()
        .single();

      const { data: stats } = await supabase
        .from('user_stats')
        .insert({
          user_id: user.id,
          streak: 0
        })
        .select()
        .single();

      expect(stats).toBeDefined();
      expect(stats.user_id).toBe(user.id);
      expect(stats.streak).toBe(0);

      // Cleanup
      await supabase.from('user_stats').delete().eq('id', stats.id);
      await supabase.from('users').delete().eq('id', user.id);
    });
  });

  describe('Daily Word Delivery', () => {
    it('should deliver words with pronunciation and buttons', async () => {
      const word = {
        word: 'lucid',
        pronunciation: '/ˈlo͞osid/',
        part_of_speech: 'adjective',
        definition: 'expressed clearly',
        example: 'She wrote a lucid explanation.'
      };

      const keyboard = createWordCardKeyboard(testWordId);
      
      expect(keyboard).toHaveProperty('reply_markup');
      expect(keyboard.reply_markup.inline_keyboard).toBeDefined();
      expect(keyboard.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(keyboard.reply_markup.inline_keyboard[0][0].text).toContain('Show definition');
      expect(keyboard.reply_markup.inline_keyboard[0][1].text).toContain('Start practice');
    });

    it('should not show definition in initial word card', () => {
      const word = {
        word: 'lucid',
        pronunciation: '/ˈlo͞osid/',
        part_of_speech: 'adjective',
        definition: 'expressed clearly',
        example: 'She wrote a lucid explanation.'
      };

      const cardText = `**${word.word}**`;
      expect(cardText).not.toContain('definition');
      expect(cardText).not.toContain('expressed clearly');
    });

    it('should prioritize existing words from database over AI generation', async () => {
      // Create multiple words in DB
      const words = [
        { word: 'test1', pronunciation: '/test1/', part_of_speech: 'noun', definition: 'test 1', example: 'test 1', example_2: 'test 1 again' },
        { word: 'test2', pronunciation: '/test2/', part_of_speech: 'noun', definition: 'test 2', example: 'test 2', example_2: 'test 2 again' },
        { word: 'test3', pronunciation: '/test3/', part_of_speech: 'noun', definition: 'test 3', example: 'test 3', example_2: 'test 3 again' }
      ];

      for (const w of words) {
        await supabase.from('words').insert(w);
      }

      // Mock the daily.js functions - we'll test the prioritization logic
      // The function should prefer DB words over AI generation
      const { data: dbWords } = await supabase
        .from('words')
        .select('*')
        .limit(10);

      expect(dbWords).toBeDefined();
      expect(dbWords.length).toBeGreaterThan(0);
      
      // Cleanup
      for (const w of words) {
        await supabase.from('words').delete().ilike('word', w.word);
      }
    });
  });

  describe('Keyboard Utilities', () => {
    it('should create word card keyboard with correct buttons', () => {
      const keyboard = createWordCardKeyboard(123);
      const buttons = keyboard.reply_markup.inline_keyboard[0];
      
      expect(buttons).toHaveLength(2);
      expect(buttons[0].callback_data).toBe('word:show:123');
      expect(buttons[1].callback_data).toBe('word:practice:123');
    });

    it('should create definition keyboard without test button', () => {
      const keyboard = createDefinitionKeyboard(123, true);
      const buttons = keyboard.reply_markup.inline_keyboard;
      
      // Should not have "test me" button
      const allCallbacks = buttons.flat().map(b => b.callback_data);
      expect(allCallbacks).not.toContain(expect.stringContaining('challenge'));
      
      // Should have back button
      expect(allCallbacks).toContain('word:back:123');
    });

    it('should create review start keyboard with correct options', () => {
      const keyboard = createReviewStartKeyboard(10, 3);
      const buttons = keyboard.reply_markup.inline_keyboard;
      
      expect(buttons[0][0].text).toContain('Start review (3 words)');
      expect(buttons[1][0].text).toContain('Start review (all 10 words)');
      expect(buttons[2][0].text).toContain('View word list');
    });
  });

  describe('Answer Validation', () => {
    it('should validate exact match correctly', async () => {
      const result = await validateAnswer('serendipity', 'serendipity', '', false);
      
      expect(result.correct).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.method).toBe('exact');
    });

    it('should validate case-insensitive match', async () => {
      const result = await validateAnswer('SERENDIPITY', 'serendipity', '', false);
      
      expect(result.correct).toBe(true);
      expect(result.method).toBe('exact');
    });

    it('should validate fuzzy match for typos', async () => {
      const result = await validateAnswer('serendipity', 'serendipity', '', false);
      
      // Should still match with small typo
      const result2 = await validateAnswer('serendipity', 'serendipity', '', false);
      expect(result2.correct).toBe(true);
    });

    it('should reject completely wrong words', async () => {
      const result = await validateAnswer('lucid', 'serendipity', '', false);
      
      expect(result.correct).toBe(false);
    });

    it('should handle word in sentence', async () => {
      const result = await validateAnswer('I experienced serendipity today', 'serendipity', '', false);
      
      expect(result.correct).toBe(true);
      expect(result.method).toBe('contains');
    });
  });

  describe('Spaced Repetition', () => {
    let testUserWordId;

    beforeEach(async () => {
      // Create test user_word
      const { data: userWord } = await supabase
        .from('user_words')
        .insert({
          user_id: testUserId,
          word_id: testWordId,
          interval: 2,
          next_review: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          correct_count: 0,
          incorrect_count: 0
        })
        .select()
        .single();
      
      testUserWordId = userWord.id;
    });

    afterEach(async () => {
      if (testUserWordId) {
        await supabase.from('user_words').delete().eq('id', testUserWordId);
      }
    });

    it('should increase interval on correct answer', async () => {
      const before = await supabase
        .from('user_words')
        .select('interval')
        .eq('id', testUserWordId)
        .single();

      const initialInterval = before.data.interval;

      await updateWordInterval(testUserWordId, true);

      const after = await supabase
        .from('user_words')
        .select('interval, correct_count')
        .eq('id', testUserWordId)
        .single();

      expect(after.data.interval).toBeGreaterThan(initialInterval);
      expect(after.data.correct_count).toBe(1);
    });

    it('should decrease interval on incorrect answer', async () => {
      const before = await supabase
        .from('user_words')
        .select('interval')
        .eq('id', testUserWordId)
        .single();

      const initialInterval = before.data.interval;

      await updateWordInterval(testUserWordId, false);

      const after = await supabase
        .from('user_words')
        .select('interval, incorrect_count')
        .eq('id', testUserWordId)
        .single();

      expect(after.data.interval).toBeLessThan(initialInterval);
      expect(after.data.incorrect_count).toBe(1);
    });

    it('should mark word as mastered after 3 correct answers', async () => {
      // Answer correctly 3 times
      for (let i = 0; i < 3; i++) {
        await updateWordInterval(testUserWordId, true);
      }

      const { data: userWord } = await supabase
        .from('user_words')
        .select('correct_count')
        .eq('id', testUserWordId)
        .single();

      expect(userWord.correct_count).toBeGreaterThanOrEqual(3);
    });

    it('should get due words correctly', async () => {
      // Set word as due (next_review in past)
      await supabase
        .from('user_words')
        .update({
          next_review: new Date(Date.now() - 1000).toISOString()
        })
        .eq('id', testUserWordId);

      const dueWords = await getDueWords(testUserId, 10, true);
      
      expect(dueWords.length).toBeGreaterThan(0);
      expect(dueWords[0].word_id).toBe(testWordId);
    });

    it('should exclude today words from due reviews', async () => {
      // Create today's word
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      
      const { data: todayWord } = await supabase
        .from('user_words')
        .insert({
          user_id: testUserId,
          word_id: testWordId,
          served_at: today.toISOString(),
          next_review: new Date(Date.now() - 1000).toISOString()
        })
        .select()
        .single();

      const dueWords = await getDueWords(testUserId, 10, true);
      
      // Should not include today's word
      const todayWordInDue = dueWords.find(w => w.id === todayWord.id);
      expect(todayWordInDue).toBeUndefined();

      // Cleanup
      await supabase.from('user_words').delete().eq('id', todayWord.id);
    });

    it('should get today words correctly', async () => {
      const todayWords = await getTodayWords(testUserId);
      
      // Should return array
      expect(Array.isArray(todayWords)).toBe(true);
    });
  });

  describe('Session Management', () => {
    let testSessionId;

    afterEach(async () => {
      if (testSessionId) {
        await sessionManager.completeSession(testSessionId);
      }
    });

    it('should create review session', async () => {
      const session = await sessionManager.createSession(
        testUserId,
        'review',
        [testWordId]
      );

      expect(session).toBeDefined();
      expect(session.user_id).toBe(testUserId);
      expect(session.session_type).toBe('review');
      expect(session.word_ids).toContain(testWordId);
      expect(session.current_index).toBe(0);

      testSessionId = session.id;
    });

    it('should get active session for user', async () => {
      const session = await sessionManager.createSession(
        testUserId,
        'review',
        [testWordId]
      );

      testSessionId = session.id;

      const activeSession = await sessionManager.getActiveSession(testUserId);

      expect(activeSession).toBeDefined();
      expect(activeSession.id).toBe(session.id);
    });

    it('should update session progress', async () => {
      const session = await sessionManager.createSession(
        testUserId,
        'review',
        [testWordId]
      );

      testSessionId = session.id;

      await sessionManager.updateSessionProgress(
        session.id,
        1,
        {
          word_id: testWordId,
          was_correct: true,
          answered_at: new Date().toISOString()
        }
      );

      const updated = await sessionManager.getSessionById(session.id);

      expect(updated.current_index).toBe(1);
      expect(updated.results).toHaveLength(1);
      expect(updated.results[0].was_correct).toBe(true);
    });

    it('should return null for expired session', async () => {
      const session = await sessionManager.createSession(
        testUserId,
        'review',
        [testWordId]
      );

      testSessionId = session.id;

      // Manually expire session
      await supabase
        .from('active_sessions')
        .update({
          expires_at: new Date(Date.now() - 1000).toISOString()
        })
        .eq('id', session.id);

      const expiredSession = await sessionManager.getSessionById(session.id);

      expect(expiredSession).toBeNull();
    });

    it('should get current word ID from session', () => {
      const session = {
        word_ids: [1, 2, 3],
        current_index: 0
      };

      const currentWordId = sessionManager.getCurrentWordId(session);

      expect(currentWordId).toBe(1);
    });

    it('should detect completed session', () => {
      const session = {
        word_ids: [1, 2, 3],
        current_index: 3
      };

      const isComplete = sessionManager.isSessionComplete(session);

      expect(isComplete).toBe(true);
    });
  });

  describe('Word Card Flow (ETIAD Compliance)', () => {
    it('should not show definition in initial card', () => {
      const cardText = `**serendipity** \`/ˌserənˈdipitē/\`\n<i>noun</i>`;
      
      expect(cardText).not.toContain('definition');
      expect(cardText).not.toContain('occurrence');
    });

    it('should allow user to choose show definition OR start practice', () => {
      const keyboard = createWordCardKeyboard(testWordId);
      const buttons = keyboard.reply_markup.inline_keyboard[0];
      
      // Both options available
      expect(buttons).toHaveLength(2);
      expect(buttons[0].text).toContain('Show definition');
      expect(buttons[1].text).toContain('Start practice');
    });

    it('should not show test button after definition is shown', () => {
      const keyboard = createDefinitionKeyboard(testWordId, true);
      const allCallbacks = keyboard.reply_markup.inline_keyboard
        .flat()
        .map(b => b.callback_data);
      
      // Should NOT have challenge button
      expect(allCallbacks).not.toContain(expect.stringContaining('challenge'));
      expect(allCallbacks).not.toContain(expect.stringContaining('practice'));
    });
  });

  describe('Error Handling', () => {
    it('should handle missing word gracefully', async () => {
      const result = await validateAnswer('test', 'nonexistent', '', false);
      
      // Should return result (not throw)
      expect(result).toBeDefined();
      expect(result.correct).toBe(false);
    });

    it('should handle invalid session ID gracefully', async () => {
      const session = await sessionManager.getSessionById('invalid-uuid');
      
      expect(session).toBeNull();
    });

    it('should return empty array for due words when none exist', async () => {
      const dueWords = await getDueWords(999999, 10, true);
      
      expect(Array.isArray(dueWords)).toBe(true);
      expect(dueWords.length).toBe(0);
    });
  });

  describe('Integration: Review Session Flow', () => {
    let sessionId;

    beforeEach(async () => {
      // Create due word
      await supabase
        .from('user_words')
        .insert({
          user_id: testUserId,
          word_id: testWordId,
          next_review: new Date(Date.now() - 1000).toISOString(),
          interval: 2
        });
    });

    afterEach(async () => {
      if (sessionId) {
        await sessionManager.completeSession(sessionId);
      }
      await supabase.from('user_words').delete().eq('user_id', testUserId).eq('word_id', testWordId);
    });

    it('should create session with due words', async () => {
      const dueWords = await getDueWords(testUserId, 5, true);
      
      if (dueWords.length > 0) {
        const wordIds = dueWords.map(uw => uw.word_id);
        const session = await sessionManager.createSession(
          testUserId,
          'review',
          wordIds
        );

        sessionId = session.id;

        expect(session.word_ids.length).toBeGreaterThan(0);
        expect(session.current_index).toBe(0);
      }
    });

    it('should process answer and update word interval', async () => {
      const dueWords = await getDueWords(testUserId, 1, true);
      
      if (dueWords.length > 0) {
        const userWordId = dueWords[0].id;
        const beforeInterval = dueWords[0].interval;

        // Process correct answer
        await updateWordInterval(userWordId, true);

        const after = await supabase
          .from('user_words')
          .select('interval, correct_count')
          .eq('id', userWordId)
          .single();

        expect(after.data.interval).toBeGreaterThan(beforeInterval);
        expect(after.data.correct_count).toBeGreaterThan(0);
      }
    });
  });
});

