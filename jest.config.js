module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: [
    'api/**/*.js',
    '!api/index.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000
};


