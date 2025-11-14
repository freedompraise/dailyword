// supabaseClient.js
// Note: dotenv.config() removed - Vercel injects env vars directly
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Supabase credentials missing in environment');
  // Don't exit in serverless - let the function handle the error
  throw new Error('Supabase credentials are required. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = supabase;
