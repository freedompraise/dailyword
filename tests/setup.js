/**
 * Test setup file
 * Configures environment for tests
 */

// Use mock Supabase in CI or when explicitly requested
if (process.env.CI === 'true' || process.env.USE_MOCK_SUPABASE === 'true') {
  const MockSupabaseClient = require('./mockSupabase');
  
  // Create a singleton instance that will be shared
  const mockSupabaseInstance = new MockSupabaseClient();
  
  // Replace supabaseClient module with the mock instance
  jest.mock('../supabaseClient', () => {
    return mockSupabaseInstance;
  }, { virtual: false });
  
  console.log('✅ Using mock Supabase for tests');
} else {
  console.log('⚠️  Using real Supabase for tests (set USE_MOCK_SUPABASE=true to use mocks)');
}

// Set test timeout
jest.setTimeout(30000);

