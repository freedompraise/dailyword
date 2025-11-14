// supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Fail fast (recommended)
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase environment variables:", {
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_SERVICE_KEY
  });
  throw new Error("Supabase environment variables not configured. Check Vercel production env.");
}

let supabase;

try {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
} catch (error) {
  console.error("Error initializing Supabase client:", error);
  throw error;
}

module.exports = supabase;
