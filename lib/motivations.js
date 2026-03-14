// lib/motivations.js - informal nudges when progress stalls
const messages = [
  'Hey, no shame breaks—knock out a couple reviews and brag later.',
  'Still sitting on those words? Two minutes of review beats scrolling.',
  'Friendly poke: clear a few due words and I\'ll chill.',
  'Pro tip: small streaks become big streaks. Hit /review for a quick win.',
  'Your vocab gym membership is active. Time for a mini workout.',
  'Dust off those words—you\'ll thank yourself tomorrow.',
  'Let\'s trade one meme scroll for one review session. Deal?',
  'Reminder: unfinished reviews get heavier. Lighten the load now.',
  'If you can read this, you can smash /review once. Go.',
  'A tiny session now saves you from a word avalanche later, you know?',
  'I see you. Your due words see you. Say hi with /review.',
  'Quick flex: finish 3 reviews and screenshot the streak.'
];

function pickMotivation(userId) {
  if (!messages.length) return null;
  const idx = Math.abs((Number(userId) || Date.now())) % messages.length;
  return messages[idx];
}

module.exports = { pickMotivation };
