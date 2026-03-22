// lib/spacedRepetition.js - Spaced repetition interval management
const db = require('../db');

// Constants
const MASTERY_THRESHOLD = 3; // 3 consecutive correct answers = mastered
const MAX_INTERVAL_DAYS = 30;
const MIN_INTERVAL_DAYS = 1;

/**
 * Update word interval and next_review based on correctness
 * @param {number} userWordId - user_words.id
 * @param {boolean} wasCorrect - Whether the answer was correct
 * @returns {Promise<Object>} Updated user_word record
 */
async function updateWordInterval(userWordId, wasCorrect) {
  // Get current word state
  const { data: userWord, error: fetchError } = await db()
    .from('user_words')
    .select('*, words:word_id(word, definition)')
    .eq('id', userWordId)
    .single();

  if (fetchError || !userWord) {
    throw new Error(`Word not found: ${fetchError?.message || 'Unknown error'}`);
  }

  const now = new Date();
  const nowISO = now.toISOString();
  const currentInterval = userWord.interval || 2;
  const correctCount = userWord.correct_count || 0;
  const incorrectCount = userWord.incorrect_count || 0;

  let newInterval;
  let nextReviewDate;
  let newCorrectCount = correctCount;
  let newIncorrectCount = incorrectCount;
  let newLastWasCorrect = wasCorrect;

  if (wasCorrect) {
    // Correct answer: increase interval
    newCorrectCount = correctCount + 1;
    newIncorrectCount = 0; // Reset incorrect streak
    
    // Increase interval by 2.5x (standard SRS algorithm)
    newInterval = Math.min(
      MAX_INTERVAL_DAYS,
      Math.round(currentInterval * 2.5)
    );
    
    // Next review in newInterval days
    nextReviewDate = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);
  } else {
    // Incorrect answer: decrease interval
    newIncorrectCount = incorrectCount + 1;
    newCorrectCount = 0; // Reset correct streak
    
    // Decrease interval by half (minimum 1 day)
    newInterval = Math.max(
      MIN_INTERVAL_DAYS,
      Math.round(currentInterval / 2)
    );
    
    // Schedule earlier review (25% earlier than normal interval)
    // This increases likelihood of earlier review
    const adjustedInterval = Math.max(1, Math.round(newInterval * 0.75));
    nextReviewDate = new Date(now.getTime() + adjustedInterval * 24 * 60 * 60 * 1000);
  }

  // Check for mastery (3 consecutive correct answers)
  const isMastered = newCorrectCount >= MASTERY_THRESHOLD;

  // Update user_word record
  const updateData = {
    interval: newInterval,
    next_review: nextReviewDate.toISOString(),
    correct_count: newCorrectCount,
    incorrect_count: newIncorrectCount,
    last_was_correct: newLastWasCorrect,
    last_response: null // Clear last_response on new attempt
  };

  const { data: updated, error: updateError } = await db()
    .from('user_words')
    .update(updateData)
    .eq('id', userWordId)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating word interval:', updateError);
    throw updateError;
  }

  return {
    ...updated,
    isMastered,
    newInterval,
    nextReviewDate: nextReviewDate.toISOString()
  };
}

/**
 * Get words due for review
 * @param {number} userId - User ID
 * @param {number} limit - Maximum number of words to return
 * @param {boolean} excludeToday - Exclude words served today
 * @returns {Promise<Array>} Array of user_words with word details
 */
async function getDueWords(userId, limit = 10, excludeToday = true) {
  const now = new Date().toISOString();
  let query = db()
    .from('user_words')
    .select('*, words:word_id(word, pronunciation, part_of_speech, definition, example, example_2)')
    .eq('user_id', userId)
    .lte('next_review', now);

  if (excludeToday) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    query = query.lt('served_at', todayISO);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching due words:', error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Randomize order to prevent users from predicting which word comes next
  // This maintains the learning challenge integrity
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  
  // Still limit the results after shuffling
  return shuffled.slice(0, limit);
}

/**
 * Get count of words due for review
 * @param {number} userId - User ID
 * @param {boolean} excludeToday - Exclude words served today
 * @returns {Promise<number>} Count of due words
 */
async function getDueWordsCount(userId, excludeToday = true) {
  const now = new Date().toISOString();
  let query = db()
    .from('user_words')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('next_review', now);

  if (excludeToday) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    query = query.lt('served_at', todayISO);
  }

  const { count, error } = await query;

  if (error) {
    console.error('Error counting due words:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Get today's words for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of today's words
 */
async function getTodayWords(userId) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const { data, error } = await db()
    .from('user_words')
    .select('*, words:word_id(word, pronunciation, part_of_speech, definition, example, example_2)')
    .eq('user_id', userId)
    .gte('served_at', todayISO)
    .order('served_at', { ascending: true });

  if (error) {
    console.error('Error fetching today words:', error);
    return [];
  }

  return data || [];
}

module.exports = {
  updateWordInterval,
  getDueWords,
  getDueWordsCount,
  getTodayWords,
  MASTERY_THRESHOLD,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS
};



