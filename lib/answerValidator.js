// lib/answerValidator.js - Answer validation with AI fallback
const { InferenceClient } = require('@huggingface/inference');

const HF_API_KEY = process.env.HF_API_KEY;
const hf = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number}
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix = [];
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Check if user answer contains the expected word (case-insensitive)
 * @param {string} userAnswer 
 * @param {string} expectedWord 
 * @returns {boolean}
 */
function containsWord(userAnswer, expectedWord) {
  const answerLower = userAnswer.toLowerCase();
  const wordLower = expectedWord.toLowerCase();
  
  // Exact match
  if (answerLower === wordLower) return true;
  
  // Word appears as substring
  const words = answerLower.split(/\s+/);
  return words.some(w => w === wordLower || w.includes(wordLower) || wordLower.includes(w));
}

/**
 * Deterministic validation (exact, fuzzy, stemming)
 * @param {string} userAnswer 
 * @param {string} expectedWord 
 * @returns {{correct: boolean, confidence: number, method: string}}
 */
function validateDeterministic(userAnswer, expectedWord) {
  const answerLower = userAnswer.toLowerCase().trim();
  const wordLower = expectedWord.toLowerCase().trim();
  
  // Exact match
  if (answerLower === wordLower) {
    return { correct: true, confidence: 1.0, method: 'exact' };
  }
  
  // Contains word
  if (containsWord(userAnswer, expectedWord)) {
    return { correct: true, confidence: 0.9, method: 'contains' };
  }
  
  // Fuzzy match (Levenshtein distance)
  const distance = levenshteinDistance(answerLower, wordLower);
  const maxLength = Math.max(answerLower.length, wordLower.length);
  const similarity = 1 - (distance / maxLength);
  
  // If similarity > 0.8, consider it correct (allows for typos)
  if (similarity > 0.8 && maxLength > 0) {
    return { correct: true, confidence: similarity, method: 'fuzzy' };
  }
  
  // Check for common variations (plurals, verb forms)
  // Simple heuristic: if answer ends with 's' and word doesn't, or vice versa
  if (Math.abs(answerLower.length - wordLower.length) <= 2) {
    const answerStem = answerLower.replace(/s$/, '');
    const wordStem = wordLower.replace(/s$/, '');
    if (answerStem === wordStem || answerStem === wordLower || wordStem === answerLower) {
      return { correct: true, confidence: 0.85, method: 'variation' };
    }
  }
  
  return { correct: false, confidence: similarity, method: 'deterministic' };
}

/**
 * AI-powered validation for complex sentences
 * @param {string} userAnswer 
 * @param {string} expectedWord 
 * @param {string} definition - Word definition for context
 * @returns {Promise<{correct: boolean, confidence: number, method: string}>}
 */
async function validateWithAI(userAnswer, expectedWord, definition = '') {
  if (!hf) {
    // Fallback to deterministic if AI not available
    return validateDeterministic(userAnswer, expectedWord);
  }

  try {
    const prompt = `You are a vocabulary learning assistant. Determine if the user's answer correctly uses or identifies the target word.

Target word: "${expectedWord}"
Definition: "${definition}"

User's answer: "${userAnswer}"

Respond with ONLY valid JSON in this exact format:
{
  "correct": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation"
}

The answer is correct if:
1. The user typed the exact word "${expectedWord}" (case-insensitive)
2. The user used the word correctly in a sentence
3. The user's answer clearly demonstrates understanding of the word

Be lenient with typos (1-2 character errors) but strict about completely wrong words.`;

    const response = await hf.chatCompletion({
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      messages: [{ role: 'user', content: prompt }]
    });

    const generatedText = response.generated_text || '';
    
    // Parse JSON from response
    const start = generatedText.indexOf('{');
    const end = generatedText.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.warn('AI validation: No JSON found, falling back to deterministic');
      return validateDeterministic(userAnswer, expectedWord);
    }

    const jsonText = generatedText.substring(start, end + 1);
    const parsed = JSON.parse(jsonText);

    return {
      correct: parsed.correct === true,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      method: 'ai',
      reason: parsed.reason || ''
    };
  } catch (error) {
    console.error('AI validation error:', error);
    // Fallback to deterministic
    return validateDeterministic(userAnswer, expectedWord);
  }
}

/**
 * Main validation function - tries deterministic first, then AI if needed
 * @param {string} userAnswer 
 * @param {string} expectedWord 
 * @param {string} definition - Optional definition for AI context
 * @param {boolean} useAI - Whether to use AI for complex validation
 * @returns {Promise<{correct: boolean, confidence: number, method: string}>}
 */
async function validateAnswer(userAnswer, expectedWord, definition = '', useAI = false) {
  // Always try deterministic first (fast and free)
  const deterministicResult = validateDeterministic(userAnswer, expectedWord);
  
  // If deterministic says correct with high confidence, return it
  if (deterministicResult.correct && deterministicResult.confidence >= 0.8) {
    return deterministicResult;
  }
  
  // If answer is long (> 5 words) and AI is enabled, use AI for context validation
  const wordCount = userAnswer.trim().split(/\s+/).length;
  if (useAI && wordCount > 5 && !deterministicResult.correct) {
    return await validateWithAI(userAnswer, expectedWord, definition);
  }
  
  // Return deterministic result
  return deterministicResult;
}

module.exports = {
  validateAnswer,
  validateDeterministic,
  validateWithAI,
  containsWord,
  levenshteinDistance
};



