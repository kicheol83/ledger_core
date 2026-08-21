import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./test/setup/per-file.ts'],

    fileParallelism: false,

    testTimeout: 10_000,
    hookTimeout: 30_000,
  },
});
