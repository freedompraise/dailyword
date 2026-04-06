// lib/motivations.js - informal nudges when progress stalls

const baseMessages = [
  'Hey, no shame breaks - knock out a couple reviews and brag later.',
  'Still sitting on those words? Two minutes of review beats scrolling.',
  "Friendly poke: clear a few due words and I'll chill.",
  'Pro tip: small streaks become big streaks. Hit /review for a quick win.',
  'Your vocab gym membership is active. Time for a mini workout.',
  "Dust off those words - you'll thank yourself tomorrow.",
  "Let's trade one meme scroll for one review session. Deal?",
  'Reminder: unfinished reviews get heavier. Lighten the load now.',
  'If you can read this, you can smash /review once. Go.',
  'A tiny session now saves you from a word avalanche later, you know?',
  'I see you. Your due words see you. Say hi with /review.',
  'Quick flex: finish 3 reviews and screenshot the streak.',
  'Unlock the next drop by clearing a few reviews. /review is waiting.',
  'Those {pending} fresh words are still unopened - tap one and hit "Show definition."',
  'Hard mode activated: {due} reviews queued. /review to defuse the pile.',
  'Finish three reviews now and future-you gets fewer pings.',
  'Your backlog is the boss level. /review to land a combo.',
  'Pending words are cooling off. Open one, read the definition, lock it in.'
];

function pickMotivation(userId) {
  if (!baseMessages.length) return null;
  const idx = Math.abs((Number(userId) || Date.now())) % baseMessages.length;
  return baseMessages[idx];
}

function pickReviewNudge({ userId, dueCount = 0, pendingCount = 0, hard = false }) {
  const templated = baseMessages.filter(m => m.includes('{due}') || m.includes('{pending}'));
  const pool = hard
    ? templated.concat([
      'Backlog alert: clear a set in /review and I will resume new drops.',
      'New words paused until reviews dip below 10. Knock some out with /review.'
    ])
    : templated;

  const source = pool.length
    ? pool[Math.abs((Number(userId) || 0) + dueCount + pendingCount) % pool.length]
    : pickMotivation(userId);

  return source
    .replace('{due}', dueCount)
    .replace('{pending}', pendingCount);
}

module.exports = { pickMotivation, pickReviewNudge };
