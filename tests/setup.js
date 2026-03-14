// testSetup.js - integration tests against Supabase "test" schema
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.DEFAULT_SCHEMA = 'test';
jest.setTimeout(30000);
console.log('Using Supabase test schema for tests');
