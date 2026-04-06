// lib/constants.js - Shared constants for gating & review logic

// Review load thresholds
const REVIEW_SOFT_CAP = 5; // start slowing new drops
const REVIEW_HARD_CAP = 10; // block new drops entirely

// Default interval for first review (days)
const INITIAL_INTERVAL_DAYS = 2;

// Pending offer hygiene
const PENDING_STALE_DAYS = 3; // clean up pending offers older than this

const MASTERY_THRESHOLD = 3; // 3 consecutive correct answers = mastered
const MAX_INTERVAL_DAYS = 30;
const MIN_INTERVAL_DAYS = 1;

module.exports = {
  REVIEW_SOFT_CAP,
  REVIEW_HARD_CAP,
  INITIAL_INTERVAL_DAYS,
  PENDING_STALE_DAYS,
  MASTERY_THRESHOLD,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS
};
