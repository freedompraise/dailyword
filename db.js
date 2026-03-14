// db.js - Centralized Supabase client with schema support
const supabase = require('./supabaseClient');

/**
 * Returns a Supabase client scoped to the given schema.
 * Default schema: process.env.DEFAULT_SCHEMA or 'public'.
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
