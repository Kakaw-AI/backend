import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The request/session plumbing and the agent payloads use `any` on
      // purpose in a few places; tsconfig has noImplicitAny off to match.
      '@typescript-eslint/no-explicit-any': 'off',
      // `import x = require()` is the correct form for CommonJS `export =`
      // modules while the project compiles without esModuleInterop.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
