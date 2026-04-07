require('dotenv').config();
process.env.DEFAULT_SCHEMA = process.env.DEFAULT_SCHEMA || 'test';
const mockUseSupabase = process.env.USE_MOCK_SUPABASE
  ? process.env.USE_MOCK_SUPABASE === 'true'
  : process.env.CI !== 'true';
jest.setTimeout(30000);

jest.mock('../db', () => {
  if (mockUseSupabase) {
    const MockSupabaseClient = require('./mockSupabase');
    const client = new MockSupabaseClient();
    const dbFn = (schema) => {
      if (schema && schema !== 'public') return client.schema(schema);
      return client;
    };
    dbFn.schema = (schema) => client.schema(schema);
    dbFn.from = (...args) => client.from(...args);
    return dbFn;
  }
  return jest.requireActual('../db');
});

if (mockUseSupabase) {
  console.log('Using mock Supabase for tests');
} else {
  console.log('Using Supabase test schema for tests');
}
