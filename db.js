// db.js - Centralized Supabase client with schema support
/**
 * Fail fast if Supabase environment variables are not configured.
 */
/**
 * Returns a Supabase client scoped to the given schema.
 * Default schema: process.env.DEFAULT_SCHEMA or 'public'.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

/**
 *
 * @param {string} [schema] - Schema name. Uses process.env.DEFAULT_SCHEMA or 'public' when omitted.
 * @returns {object} Supabase client (use .from('table') as usual)
 */
function db(schema) {
  const defaultSchema = process.env.DEFAULT_SCHEMA || 'public';
  const s = schema ?? defaultSchema;
  if (s === 'public') {
    return supabase;
  }
  return supabase.schema(s);
}

module.exports = db;
