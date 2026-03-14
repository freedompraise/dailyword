// db.js - Centralized Supabase client with schema support
const supabase = require('./supabaseClient');

const DEFAULT_SCHEMA = process.env.DEFAULT_SCHEMA || 'public';

/**
 * Returns a Supabase client scoped to the given schema.
 * @param {string} [schema] - Schema name. Uses process.env.DEFAULT_SCHEMA or 'public' when omitted.
 * @returns {object} Supabase client (use .from('table') as usual)
 */
function db(schema) {
  const s = schema ?? DEFAULT_SCHEMA;
  if (s === 'public' || s === 'test') {
    return supabase; // Supabase PostgREST only allows public/graphql_public; map "test" to public for local/testing
  }
  return supabase.schema(s);
}

module.exports = db;
