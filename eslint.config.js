// ESLint 9 flat config for a strict TypeScript NestJS project.
// Correctness rules only — no stylistic rules, since there is no Prettier
// pass to keep them satisfied.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.superpowers/**', 'prisma/migrations/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Destructuring a key solely to exclude it from the rest object
      // (used in env.schema.spec.ts) is intentional, not an unused var.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
);
