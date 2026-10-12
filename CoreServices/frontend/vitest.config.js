import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests (*.spec.jsx) run in jsdom. Framework-free unit tests
// (*.test.js) run with `node --test`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{js,jsx}'],
  },
});
