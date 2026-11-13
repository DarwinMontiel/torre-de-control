import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración contra PostgreSQL, Redis y RabbitMQ reales.
 *   docker compose up -d postgres redis rabbitmq
 *   npm run test:integracion
 */
export default defineConfig({
  test: {
    include: ['tests/integracion/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
