import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    environment: 'node',

    globalSetup: ['./test/setup/global-setup.ts'],

    fileParallelism: false,

    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
