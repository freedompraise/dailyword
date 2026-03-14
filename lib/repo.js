// lib/repo.js - Centralized Supabase data access helpers
const db = require('../db');

// Words
async function getWordById(id, columns = '*') {
  return db().from('words').select(columns).eq('id', id).maybeSingle();
}

async function getWordsByIds(ids, columns = '*') {
  if (!ids || ids.length === 0) return { data: [], error: null };
  return db().from('words').select(columns).in('id', ids);
}

// Users
async function getUsers(columns = '*') {
  return db().from('users').select(columns);
}

async function setPendingContact(userId, pending) {
  return db().from('users').update({ pending_contact_message: pending }).eq('id', userId);
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

// User words
async function getUserWord(userId, wordId, columns = '*') {
  return db()
    .from('user_words')
    .select(columns)
    .eq('user_id', userId)
    .eq('word_id', wordId)
    .maybeSingle();
}

async function getLeaderboard(limit = 10) {
  return db()
    .from('leaderboard_view')
    .select('user_id,total_words,streak')
    .order('total_words', { ascending: false })
    .limit(limit);
}

module.exports = {
  getWordById,
  getWordsByIds,
  getUsers,
  setPendingContact,
  getUserStats,
  upsertUserStats,
  updateUserStatsById,
  getUserWord,
  getLeaderboard
};
