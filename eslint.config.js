import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import yml from 'eslint-plugin-yml';

export default tseslint.config(
  {
    ignores: [
      '.github/*',
      '!.github/workflows/',
      '.vscode/**',
      'scratchpad/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
  ...yml.configs['flat/recommended'],
  ...yml.configs['flat/prettier'],
  {
    // `pull_request:` with no value is the idiomatic GitHub Actions trigger form.
    files: ['.github/workflows/**/*.yml'],
    rules: { 'yml/no-empty-mapping-value': 'off' },
  },
);
