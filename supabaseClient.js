// supabaseClient.js
// Note: dotenv.config() removed - Vercel injects env vars directly
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Supabase credentials missing in environment');
  // Create a dummy client that will fail gracefully
  supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: { message: 'Supabase not configured' } }) })
    })
  };
} else {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  } catch (error) {
    console.error('Error creating Supabase client:', error);
    throw new Error('Failed to initialize Supabase client. Please check SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.');
  }
}

module.exports = supabase;
