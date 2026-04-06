// lib/pendingWords.js - Manage pending word offers before user engagement
const repo = require('./repo');
const { INITIAL_INTERVAL_DAYS } = require('./constants');

async function addPendingOffers(rows) {
  if (!rows || rows.length === 0) return { data: [], error: null };
  return repo.insertPendingOffers(rows);
}

async function removePendingOffer(userId, wordId) {
  return repo.deletePendingOffer(userId, wordId);
}

async function getPendingWords(userId) {
  return repo.getPendingWords(userId);
}

async function getPendingCountsByUser(userIds = []) {
  const { data, error } = await repo.getPendingCountsByUser(userIds);
  if (error) {
    console.error('Error fetching pending counts:', error);
    return new Map();
  }

  const map = new Map();
  (data || []).forEach(row => {
    map.set(row.user_id, row.count || 0);
  });
  return map;
}

async function claimPendingWord(userId, wordId) {
  const { data: pending, error: fetchError } = await repo.getPendingWord(userId, wordId);

  if (fetchError) {
    console.error('Error fetching pending word:', fetchError);
  }

  // If nothing pending, do nothing (maybe already claimed)
  if (!pending) return null;

  // Avoid duplicate user_words entry
  const { data: existing } = await repo.getUserWord(userId, wordId, 'id');

  if (existing) {
    await removePendingOffer(userId, wordId);
    return existing;
  }

  const servedAt = pending.offered_at || new Date().toISOString();
  const nextReviewDate = new Date(new Date(servedAt).getTime() + INITIAL_INTERVAL_DAYS * 86400000).toISOString();

  const insertPayload = {
    user_id: userId,
    word_id: wordId,
    served_at: servedAt,
    served_index: pending.served_index,
    next_review: nextReviewDate,
    interval: INITIAL_INTERVAL_DAYS
  };

  const { data: createdArr, error: insertError } = await repo.insertUserWords([insertPayload], '*');
  const created = Array.isArray(createdArr) ? createdArr[0] : createdArr;

  if (insertError) {
    console.error('Error inserting user_word from pending:', insertError);
    throw insertError;
  }

  await removePendingOffer(userId, wordId);

  return created;
}

async function cleanupStalePending(cutoffDateISO) {
  const { data, error } = await repo.deletePendingBefore(cutoffDateISO);

  if (error) {
    console.error('Error cleaning stale pending offers:', error);
    return 0;
  }

  return data ? data.length : 0;
}

module.exports = {
  addPendingOffers,
  removePendingOffer,
  getPendingWords,
  getPendingCountsByUser,
  claimPendingWord,
  cleanupStalePending
};
