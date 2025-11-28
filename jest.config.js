export default {
  testEnvironment: 'node',
  verbose: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  testEnvironmentOptions: {
    url: 'http://localhost:3001'
  },
  injectGlobals: true,
  setupFiles: ['<rootDir>/src/tests/testEnv.js'],
  testTimeout: 30000,
  maxWorkers: 1
};