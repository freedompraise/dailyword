// testSetup.js

const MockSupabaseClient = require('./mockSupabase');

const mockSupabaseInstance = new MockSupabaseClient();

jest.mock('../supabaseClient', () => {
  return mockSupabaseInstance;
});

jest.setTimeout(30000);

console.log('Using mock Supabase for tests');
