module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  // Worktrees created inside this repo (e.g. .claude/worktrees/<id>) contain
  // a full nested checkout, including their own node_modules and spec
  // files. Without these ignores, Jest walks into them and collects every
  // spec a second time, inflating the reported test count and producing
  // spurious duplicate-run failures.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageThreshold: { global: { lines: 80, statements: 80 } },
  testEnvironment: 'node',
};
