import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integracion/**', 'node_modules/**'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Puntos de entrada que solo cablean dependencias reales; se ejercitan en las
        // pruebas de integración y en docker compose.
        'src/api/main.ts',
        'src/api/adaptadores/postgres/cli-migrar.ts',
        'src/tablero/main.ts',
        'src/**/*.d.ts',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: { lines: 95, functions: 95, branches: 80, statements: 95 },
    },
  },
});
