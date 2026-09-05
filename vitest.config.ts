import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(__dirname, '__mocks__/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/attachment-rules.ts', 'src/creation-plan.ts', 'src/metadata-diff.ts',
        'src/paths.ts', 'src/resource-links.ts', 'src/settings-model.ts',
        'src/sources.ts', 'src/template.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 80,
        functions: 90,
      },
    },
  },
});
