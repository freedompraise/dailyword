// tests/setup.js - test env and optional Supabase mock
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.DEFAULT_SCHEMA = 'test';
jest.setTimeout(30000);

// Factory runs when supabaseClient is first required; USE_MOCK_SUPABASE is set in CI.
jest.mock('../db', () => {
  if (process.env.USE_MOCK_SUPABASE === 'true') {
    const MockSupabaseClient = require('./mockSupabase');
    return new MockSupabaseClient();
  }
  return jest.requireActual('../db');
});

if (process.env.USE_MOCK_SUPABASE === 'true') {
  console.log('Using mock Supabase for tests');
} else {
  console.log('Using Supabase test schema for tests');
}
