module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'api/**/*.js',
    '!api/index.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000
};


