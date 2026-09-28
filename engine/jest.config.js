module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, resolveJsonModule: true, strict: true, target: 'ES2022', types: ['jest', 'node'] }, diagnostics: { ignoreCodes: [151001] } }] },
  testMatch: ['**/test/**/*.test.ts', '**/src/**/*.test.ts'],
};
