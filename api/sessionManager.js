// api/sessionManager.js - Session state management for review/challenge sessions
const supabase = require('../supabaseClient');
const crypto = require('crypto');

// Session expires after 30 minutes of inactivity
const SESSION_EXPIRY_MINUTES = 30;

/**
 * Create a new review or challenge session
 * @param {number} userId - User ID
 * @param {string} sessionType - 'review' or 'challenge'
 * @param {number[]} wordIds - Array of word IDs for this session
 * @returns {Promise<Object>} Session object with session_id
 */
async function createSession(userId, sessionType, wordIds) {
  if (!wordIds || wordIds.length === 0) {
    throw new Error('Cannot create session with no words');
  }

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_MINUTES * 60 * 1000);

  const { data, error } = await supabase
    .from('active_sessions')
    .insert({
      id: sessionId,
      user_id: userId,
      session_type: sessionType,
      word_ids: wordIds,
      current_index: 0,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      results: []
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating session:', error);
    throw error;
  }

  return data;
}

/**
 * Get active session for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Active session or null
 */
async function getActiveSession(userId) {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('active_sessions')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', now)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching active session:', error);
    return null;
  }

  return data;
}

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session or null
 */
async function getSessionById(sessionId) {
  const { data, error } = await supabase
    .from('active_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching session by ID:', error);
    return null;
  }

  // Check if expired
  if (data && new Date(data.expires_at) < new Date()) {
    return null;
  }

  return data;
}

/**
 * Update session progress
 * @param {string} sessionId - Session ID
 * @param {number} currentIndex - New current index
 * @param {Object} result - Result object { word_id, was_correct, answered_at }
 * @returns {Promise<Object>} Updated session
 */
async function updateSessionProgress(sessionId, currentIndex, result = null) {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error('Session not found or expired');
  }

  let results = session.results || [];
  if (result) {
    results.push(result);
  }

  const { data, error } = await supabase
    .from('active_sessions')
    .update({
      current_index: currentIndex,
      results: results
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    console.error('Error updating session:', error);
    throw error;
  }

  return data;
}

/**
 * Complete a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
async function completeSession(sessionId) {
  const { error } = await supabase
    .from('active_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    console.error('Error completing session:', error);
    throw error;
  }
}

/**
 * Cancel/delete a session
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
async function cancelUserSession(userId) {
  const { error } = await supabase
    .from('active_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error canceling session:', error);
    throw error;
  }
}

/**
 * Get current word for a session
 * @param {Object} session - Session object
 * @returns {number|null} Current word ID or null if session complete
 */
function getCurrentWordId(session) {
  if (!session || !session.word_ids || session.word_ids.length === 0) {
    return null;
  }

  const currentIndex = session.current_index || 0;
  if (currentIndex >= session.word_ids.length) {
    return null; // Session complete
  }

  return session.word_ids[currentIndex];
}

/**
 * Check if session is complete
 * @param {Object} session - Session object
 * @returns {boolean}
 */
function isSessionComplete(session) {
  if (!session || !session.word_ids) return true;
  return (session.current_index || 0) >= session.word_ids.length;
}

/**
 * Clean up expired sessions (should be called periodically)
 * @returns {Promise<number>} Number of sessions deleted
 */
async function cleanupExpiredSessions() {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('active_sessions')
    .delete()
    .lt('expires_at', now)
    .select();

  if (error) {
    console.error('Error cleaning up expired sessions:', error);
    return 0;
  }

  return data ? data.length : 0;
}

module.exports = {
  createSession,
  getActiveSession,
  getSessionById,
  updateSessionProgress,
  completeSession,
  cancelUserSession,
  getCurrentWordId,
  isSessionComplete,
  cleanupExpiredSessions,
  SESSION_EXPIRY_MINUTES
};

