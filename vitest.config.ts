import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    passWithNoTests: false,
    silent: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.config.js',
        '**/*.config.ts',
        'src/__tests__/setup.ts',
        'src/__tests__/mocks/',
        'coverage/',
        '**/*.d.ts',
        '**/types/**',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      all: true,
      clean: true,
      cleanOnRerun: true,
    },
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      ignoreSourceErrors: false,
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
    isolate: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/types': resolve(__dirname, './src/types'),
      '@/services': resolve(__dirname, './src/services'),
      '@/calculators': resolve(__dirname, './src/calculators'),
      '@/mappers': resolve(__dirname, './src/mappers'),
      '@/utils': resolve(__dirname, './src/utils'),
      '@/constants': resolve(__dirname, './src/constants'),
    },
  },
});
