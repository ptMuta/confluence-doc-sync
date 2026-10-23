import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'spikes/', 'test/fixtures/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:child_process', 'child_process'].map(name => ({
            name,
            message: 'Only src/diagrams/render may start processes.',
          })),
        },
      ],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Only src/confluence/http may use the network.' }],
    },
  },
  { files: ['src/diagrams/render/**'], rules: { 'no-restricted-imports': 'off' } },
  { files: ['src/confluence/http/**'], rules: { 'no-restricted-globals': 'off' } },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
)
