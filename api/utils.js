// api/utils.js - Utility functions for bot interactions
const DAILY_HOUR = parseInt(process.env.DAILY_HOUR || '8', 10);

function formatTimeUntilNextWord() {
  const now = new Date();
  const nextWordTime = new Date();
  
  // Set to today's daily hour (UTC)
  nextWordTime.setUTCHours(DAILY_HOUR, 0, 0, 0);
  
  // If we've passed today's word time, set to tomorrow
  if (now.getTime() >= nextWordTime.getTime()) {
    nextWordTime.setUTCDate(nextWordTime.getUTCDate() + 1);
  }
  
  const diff = nextWordTime.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} and ${seconds} second${seconds !== 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
}

function hasReceivedTodayWords(userWords) {
  if (!userWords || userWords.length === 0) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  
  return userWords.some(uw => {
    const servedAt = new Date(uw.served_at);
    return servedAt.getTime() >= today.getTime();
  });
}

function getWelcomeMessage(isNewUser, hasTodayWords) {
  const emoji = {
    wave: '👋',
    book: '📚',
    brain: '🧠',
    star: '⭐',
    clock: '⏰',
    trophy: '🏆',
    sparkles: '✨'
  };
  
  let message = `${emoji.wave} Welcome to Daily Word Bot!\n\n`;
  message += `${emoji.book} I'm here to help you expand your vocabulary, one word at a time.\n\n`;
  message += `${emoji.brain} Here's how it works:\n`;
  message += `• Every morning, I'll send you 1-3 new words (you can choose how many)\n`;
  message += `• At midday, I'll test your recall\n`;
  message += `• In the evening, challenge yourself by using the words in sentences\n`;
  message += `• Track your progress and build your learning streak ${emoji.trophy}\n\n`;
  
  if (!hasTodayWords) {
    const timeUntil = formatTimeUntilNextWord();
    message += `${emoji.clock} Your first words will arrive in ${timeUntil}!\n\n`;
    message += `In the meantime, you can:\n`;
    message += `• Use /setwords 1-3 to choose how many words you want daily\n`;
    message += `• Use /help to see all available commands\n\n`;
  } else {
    message += `${emoji.sparkles} Great news! You can check today's words with /today\n\n`;
  }
  
  message += `Let's start building your vocabulary together! ${emoji.star}`;
  
  return message;
}

function getHelpMessage() {
  const emoji = {
    list: '📋',
    settings: '⚙️',
    chart: '📊',
    book: '📖'
  };
  
  let message = `${emoji.list} Available Commands:\n\n`;
  message += `/start - Register and get started\n`;
  message += `/setwords 1-3 - Choose how many words per day (1, 2, or 3)\n`;
  message += `/today - View today's word(s)\n`;
  message += `/progress - Check your learning progress and streak\n`;
  message += `/help - Show this help message\n\n`;
  message += `${emoji.settings} Tips:\n`;
  message += `• Reply to midday recall prompts with the word you remember\n`;
  message += `• Use evening words in sentences about your day\n`;
  message += `• Keep your streak going by engaging daily!`;
  
  return message;
}

function getFriendlyResponse(isCorrect, word) {
  const correctResponses = [
    '🎉 Excellent! You got it!',
    '✨ Perfect recall! Well done!',
    '🌟 Amazing! You remembered it!',
    '💫 Great job! Keep it up!',
    '🎯 Spot on! You\'re doing great!'
  ];
  
  const incorrectResponses = [
    `Not quite, but keep trying! The word was: ${word}`,
    `Close! The correct word is: ${word}`,
    `Good effort! It was: ${word}`,
    `Almost there! The word is: ${word}`
  ];
  
  if (isCorrect) {
    return correctResponses[Math.floor(Math.random() * correctResponses.length)];
  } else {
    return incorrectResponses[Math.floor(Math.random() * incorrectResponses.length)];
  }
}

module.exports = {
  formatTimeUntilNextWord,
  hasReceivedTodayWords,
  getWelcomeMessage,
  getHelpMessage,
  getFriendlyResponse
};

