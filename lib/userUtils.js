// lib/userUtils.js - Centralized user-related database operations
const db = require('../db');

/**
 * Get user by chat ID, creating if doesn't exist
 * @param {string|number} chatId - Telegram chat ID
 * @param {boolean} createIfMissing - Whether to create user if not found (default: true)
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserByChatId(chatId, createIfMissing = true) {
  try {
    const { data, error } = await db()
      .from('users')
      .select('*')
      .eq('chat_id', String(chatId))
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching user:', error);
      throw new Error(`Database error: ${error.message || 'Failed to fetch user'}`);
    }
    
    if (data) return data;
    
    // User doesn't exist - create if requested
    if (createIfMissing) {
      return await ensureUser(chatId);
    }
    
    return null;
  } catch (error) {
    console.error('getUserByChatId error:', error);
    if (error.message && error.message.includes('fetch failed')) {
      throw new Error('Network error connecting to database. Please try again in a moment.');
    }
    throw error;
  }
}

/**
 * Ensure user exists, creating if necessary
 * @param {string|number} chatId - Telegram chat ID
 * @returns {Promise<Object>} User object
 */
async function ensureUser(chatId) {
  try {
    const now = new Date().toISOString();
    
    // Try to get existing user first
    const { data: existing, error: fetchError } = await db()
      .from('users')
      .select('*')
      .eq('chat_id', String(chatId))
      .maybeSingle();
    
    if (fetchError) {
      console.error('Error fetching user:', fetchError);
      throw new Error(`Database error: ${fetchError.message || 'Failed to fetch user'}`);
    }
    
    if (existing) return existing;
    
    // Create new user
    const { data: newUserData, error: insertErr } = await db()
      .from('users')
      .insert({ 
        chat_id: String(chatId), 
        words_per_day: 1, 
        review_words_per_session: 3,
        created_at: now 
      })
      .select()
      .single();
    
    if (insertErr) {
      console.error('Error inserting user:', insertErr);
      throw new Error(`Database error: ${insertErr.message || 'Failed to create user'}`);
    }
    
    if (!newUserData) {
      throw new Error('Failed to create user - no data returned');
    }
    
    // Create user_stats entry (non-critical, don't fail if this fails)
    const { error: statsErr } = await db()
      .from('user_stats')
      .insert({ 
        user_id: newUserData.id, 
        streak: 0, 
        last_completed: null 
      });
    
    if (statsErr) {
      console.warn('Error inserting user_stats (non-critical):', statsErr);
    }
    
    return newUserData;
  } catch (error) {
    console.error('ensureUser error:', error);
    if (error.message && error.message.includes('fetch failed')) {
      throw new Error('Network error connecting to database. Please try again in a moment.');
    }
    throw error;
  }
}

/**
 * Get user by ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserById(userId) {
  try {
    const { data, error } = await db()
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching user by ID:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('getUserById error:', error);
    return null;
  }
}

module.exports = {
  getUserByChatId,
  ensureUser,
  getUserById
};

