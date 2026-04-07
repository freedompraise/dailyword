// lib/repo.js - Centralized Supabase data access helpers
const db = require('../db');

const RPC_DUE_COUNTS = 'get_due_counts';
const RPC_PENDING_COUNTS = 'get_pending_counts';
const RPC_USER_WORD_TOTALS = 'get_user_word_totals';

// ---- internal helpers ----
function rowsToCountMap(rows, key = 'user_id') {
  const counts = new Map();
  (rows || []).forEach(r => {
    const k = r[key];
    if (k === undefined || k === null) return;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return counts;
}

async function mapFromRpc(rpcName, params = {}, key = 'user_id') {
  const { data, error } = await db().rpc(rpcName, params);
  if (error) return { data: null, error };
  return { data: rowsToCountMap(data, key), error: null };
}

// Words
async function getWordById(id, columns = '*') {
  return db().from('words').select(columns).eq('id', id).maybeSingle();
}

async function getWordsByIds(ids, columns = '*') {
  if (!ids || ids.length === 0) return { data: [], error: null };
  return db().from('words').select(columns).in('id', ids);
}

async function getRecentWords(limit = 1000, columns = '*') {
  return db()
    .from('words')
    .select(columns)
    .order('created_at', { ascending: false })
    .limit(limit);
}

async function insertWords(rows) {
  if (!rows || rows.length === 0) return { data: [], error: null };
  return db().from('words').insert(rows).select('id, word');
}

// Users
async function getUsers(columns = '*') {
  return db().from('users').select(columns);
}

async function getUsersBasic() {
  return getUsers('id, chat_id, words_per_day, review_words_per_session');
}

async function getUserById(userId, columns = '*') {
  return db().from('users').select(columns).eq('id', userId).maybeSingle();
}

async function getUserByChatId(chatId, columns = '*') {
  return db().from('users').select(columns).eq('chat_id', String(chatId)).maybeSingle();
}

async function insertUser(payload, columns = '*') {
  return db().from('users').insert(payload).select(columns).maybeSingle();
}

async function setPendingContact(userId, pending) {
  return db().from('users').update({ pending_contact_message: pending }).eq('id', userId);
}

async function updateUserById(userId, payload) {
  return db().from('users').update(payload).eq('id', userId);
}

async function updateUserByChatId(chatId, payload) {
  return db().from('users').update(payload).eq('chat_id', String(chatId));
}

// User stats
async function getUserStats(userId, columns = '*') {
  return db().from('user_stats').select(columns).eq('user_id', userId).maybeSingle();
}

async function upsertUserStats(userId, payload) {
  return db()
    .from('user_stats')
    .upsert({ user_id: userId, ...payload }, { onConflict: 'user_id' })
    .select()
    .maybeSingle();
}

async function updateUserStatsById(id, payload) {
  return db().from('user_stats').update(payload).eq('id', id);
}

async function insertUserStats(payload) {
  return db().from('user_stats').insert(payload);
}

async function getUserStatsByUserIds(userIds = [], columns = 'user_id, streak') {
  if (!userIds.length) return { data: [], error: null };
  return db().from('user_stats').select(columns).in('user_id', userIds);
}

// User words
async function getUserWord(userId, wordId, columns = '*') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .eq('word_id', wordId)
    .maybeSingle();
}

async function getUserWordById(id, columns = '*') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('id', id)
    .maybeSingle();
}

async function getUserWordsByUserIds(userIds = [], columns = 'user_id, word_id') {
  if (!userIds.length) return { data: [], error: null };
  return db().from('user_words').select(columns).in('user_id', userIds);
}

async function getUserWordsSince(userId, sinceISO, columns = 'served_at,served_index,correct_count,words:word_id(word,pronunciation,part_of_speech,definition)') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .gte('served_at', sinceISO)
    .order('served_at', { ascending: true });
}

async function getLeaderboard(limit = 10) {
  return db()
    .from('leaderboard_view')
    .select('user_id,total_words,streak')
    .order('total_words', { ascending: false })
    .limit(limit);
}

async function getAllUserWords(userId, columns = 'id,served_at,word_id,correct_count,words:word_id(word)') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .order('served_at', { ascending: true });
}

async function getUserWordsToday(userId, todayISO, columns = '*, words:word_id(word, pronunciation, part_of_speech, definition, example, example_2)') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .gte('served_at', todayISO)
    .order('served_at', { ascending: true });
}

async function insertUserWords(rows, columns = '*') {
  return db().from('user_words').insert(rows).select(columns);
}

async function updateUserWordById(id, payload, columns = '*') {
  return db().from('user_words').update(payload).eq('id', id).select(columns).maybeSingle();
}

async function getDueUserWords(userId, nowISO, excludeToday = true, columns = '*, words:word_id(word, pronunciation, part_of_speech, definition, example, example_2)') {
  let query = db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .lte('next_review', nowISO);

  if (excludeToday) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    query = query.lt('served_at', todayISO);
  }
  return query;
}

async function countDueUserWords(userId, nowISO, excludeToday = true) {
  let query = db()
    .from('user_words')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('next_review', nowISO);

  if (excludeToday) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    query = query.lt('served_at', todayISO);
  }
  return query;
}

async function getDueCountsMap(userIds = [], nowISO, excludeToday = true) {
  return mapFromRpc(RPC_DUE_COUNTS, {
    user_ids: userIds,
    now_iso: nowISO,
    exclude_today: excludeToday
  });
}

async function getUserWordTotals(limit = 10) {
  const rpcResult = await mapFromRpc(RPC_USER_WORD_TOTALS, {});
  if (rpcResult.error) return rpcResult;
  const rows = Array.from(rpcResult.data.entries())
    .map(([user_id, total]) => ({ user_id, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  return { data: rows, error: null };
}

// Pending user words
async function insertPendingOffers(rows) {
  if (!rows || rows.length === 0) return { data: [], error: null };
  return db().from('pending_user_words').insert(rows);
}

async function deletePendingOffer(userId, wordId) {
  return db()
    .from('pending_user_words')
    .delete()
    .eq('user_id', userId)
    .eq('word_id', wordId);
}

async function getPendingWords(userId) {
  return db()
    .from('pending_user_words')
    .select('id, offered_at, served_index, words:word_id(word, pronunciation, part_of_speech, definition, example, example_2)')
    .eq('user_id', userId)
    .order('offered_at', { ascending: true });
}

async function getPendingWord(userId, wordId) {
  return db()
    .from('pending_user_words')
    .select('*')
    .eq('user_id', userId)
    .eq('word_id', wordId)
    .maybeSingle();
}

async function getPendingCountsByUser(userIds = []) {
  return mapFromRpc(RPC_PENDING_COUNTS, { user_ids: userIds });
}

async function deletePendingBefore(cutoffDateISO) {
  return db()
    .from('pending_user_words')
    .delete()
    .lt('offered_at', cutoffDateISO)
    .select('id');
}

// Active sessions
async function insertSession(payload) {
  return db().from('active_sessions').insert(payload).select().single();
}

async function getActiveSessionForUser(userId, nowISO) {
  return db()
    .from('active_sessions')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', nowISO)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function getSessionById(sessionId) {
  return db()
    .from('active_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
}

async function updateSessionById(sessionId, payload) {
  return db()
    .from('active_sessions')
    .update(payload)
    .eq('id', sessionId)
    .select()
    .single();
}

async function deleteSessionById(sessionId) {
  return db().from('active_sessions').delete().eq('id', sessionId);
}

async function deleteSessionsByUser(userId) {
  return db().from('active_sessions').delete().eq('user_id', userId);
}

async function deleteExpiredSessions(nowISO) {
  return db().from('active_sessions').delete().lt('expires_at', nowISO).select();
}

module.exports = {
  getWordById,
  getWordsByIds,
  getRecentWords,
  insertWords,
  getUsers,
  getUsersBasic,
  getUserById,
  getUserByChatId,
  insertUser,
  setPendingContact,
  updateUserById,
  updateUserByChatId,
  getUserStats,
  upsertUserStats,
  updateUserStatsById,
  getUserStatsByUserIds,
  insertUserStats,
  getUserWord,
  getUserWordById,
  getUserWordsByUserIds,
  getUserWordsSince,
  getAllUserWords,
  getUserWordsToday,
  insertUserWords,
  updateUserWordById,
  getDueUserWords,
  countDueUserWords,
  getDueCountsMap,
  getUserWordTotals,
  insertPendingOffers,
  deletePendingOffer,
  getPendingWords,
  getPendingWord,
  getPendingCountsByUser,
  deletePendingBefore,
  insertSession,
  getActiveSessionForUser,
  getSessionById,
  updateSessionById,
  deleteSessionById,
  deleteSessionsByUser,
  deleteExpiredSessions,
  getLeaderboard
};
