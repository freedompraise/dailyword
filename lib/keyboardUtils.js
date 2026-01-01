// lib/keyboardUtils.js - Utility functions for creating Telegram inline keyboards

/**
 * Create inline keyboard button
 * @param {string} text - Button text
 * @param {string} callbackData - Callback data (max 64 bytes)
 * @returns {Object} Button object
 */
function createButton(text, callbackData) {
  return {
    text,
    callback_data: callbackData
  };
}

/**
 * Create inline keyboard with buttons arranged in rows
 * @param {Array<Array<Object>>} buttonRows - Array of button rows
 * @returns {Object} Reply markup object
 */
function createInlineKeyboard(buttonRows) {
  return {
    reply_markup: {
      inline_keyboard: buttonRows
    }
  };
}

/**
 * Create keyboard for daily word card
 * @param {number} wordId - Word ID
 * @returns {Object} Reply markup
 */
function createWordCardKeyboard(wordId) {
  return createInlineKeyboard([
    [
      createButton('📖 Show definition', `word:show:${wordId}`),
      createButton('🧠 Start practice', `word:practice:${wordId}`)
    ]
  ]);
}

/**
 * Create keyboard for word definition view
 * @param {number} wordId - Word ID
 * @param {boolean} hasSecondExample - Whether word has example_2
 * @returns {Object} Reply markup
 */
function createDefinitionKeyboard(wordId, hasSecondExample = false) {
  const buttons = [];
  
  // Only show "See another example" if there's a second example
  if (hasSecondExample) {
    buttons.push([
      createButton('📝 See another example', `word:example:${wordId}`)
    ]);
  }
  
  // Always show back button
  buttons.push([
    createButton('◀️ Back to word', `word:back:${wordId}`)
  ]);
  
  return createInlineKeyboard(buttons);
}

/**
 * Create keyboard for recall challenge
 * @param {number} wordId - Word ID
 * @param {string} sessionId - Session ID (if in session)
 * @returns {Object} Reply markup
 */
function createChallengeKeyboard(wordId, sessionId = null) {
  const callbackPrefix = sessionId ? `session:${sessionId}:` : `challenge:`;
  return createInlineKeyboard([
    [
      createButton('💡 Show hint', `${callbackPrefix}hint:${wordId}`),
      createButton('⏭️ Skip', `${callbackPrefix}skip:${wordId}`)
    ],
    ...(sessionId ? [] : [
      [createButton('❌ Cancel', `${callbackPrefix}cancel:${wordId}`)]
    ])
  ]);
}

/**
 * Create keyboard for challenge feedback
 * @param {boolean} wasCorrect - Whether answer was correct
 * @param {string} sessionId - Session ID (if in session)
 * @param {number} nextWordId - Next word ID (if in session)
 * @returns {Object} Reply markup
 */
function createFeedbackKeyboard(wasCorrect, sessionId = null, nextWordId = null) {
  if (sessionId && nextWordId) {
    // In session - show next button
    return createInlineKeyboard([
      [
        createButton('➡️ Next challenge', `session:${sessionId}:next:${nextWordId}`)
      ],
      [
        createButton('❌ End session', `session:${sessionId}:end`)
      ]
    ]);
  } else if (sessionId) {
    // Session complete
    return createInlineKeyboard([
      [
        createButton('📊 View results', `session:${sessionId}:results`),
        createButton('🔄 Review again', `review:start`)
      ]
    ]);
  } else {
    // Standalone challenge
    return createInlineKeyboard([
      [
        createButton('🔄 Try another word', `review:start`)
      ],
      [
        createButton('📊 Check progress', `progress:show`)
      ]
    ]);
  }
}

/**
 * Create keyboard for review session start
 * @param {number} dueCount - Number of words due
 * @param {number} defaultCount - Default words per session
 * @returns {Object} Reply markup
 */
function createReviewStartKeyboard(dueCount, defaultCount = 3) {
  const buttons = [
    [
      createButton(`▶️ Start review (${defaultCount} words)`, `review:start:${defaultCount}`)
    ]
  ];

  if (dueCount > defaultCount) {
    buttons.push([
      createButton(`▶️ Start review (all ${dueCount} words)`, `review:start:${dueCount}`)
    ]);
  }

  buttons.push(
    [
      createButton('📋 View word list', `review:list`),
      createButton('❌ Cancel', `review:cancel`)
    ]
  );

  return createInlineKeyboard(buttons);
}

/**
 * Create keyboard for session summary
 * @param {string} sessionId - Session ID
 * @returns {Object} Reply markup
 */
function createSessionSummaryKeyboard(sessionId) {
  return createInlineKeyboard([
    [
      createButton('🔄 Review again', `review:start`),
      createButton('📊 Check progress', `progress:show`)
    ]
  ]);
}

/**
 * Create simple keyboard with one or two buttons
 * @param {Array<{text: string, callback: string}>} buttons - Array of button configs
 * @returns {Object} Reply markup
 */
function createSimpleKeyboard(buttons) {
  const rows = buttons.map(btn => [createButton(btn.text, btn.callback)]);
  return createInlineKeyboard(rows);
}

module.exports = {
  createButton,
  createInlineKeyboard,
  createWordCardKeyboard,
  createDefinitionKeyboard,
  createChallengeKeyboard,
  createFeedbackKeyboard,
  createReviewStartKeyboard,
  createSessionSummaryKeyboard,
  createSimpleKeyboard
};

