// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/resources/**',
      '**/resources-slim/**',
      '**/coverage/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // 渐进收紧：存量代码里有不少 any 兜底，先不阻断
      '@typescript-eslint/no-explicit-any': 'off',
      // catch {} 是本仓库的既定风格（尽力而为的清理路径）
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // CommonJS / Node 脚本：require/process 等是正常用法；桌面端类型问题交给 tsc checkJs
    files: ['**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, fetch: 'readonly', AbortSignal: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // 测试文件：宽松一点
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
