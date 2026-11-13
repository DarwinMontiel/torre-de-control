import { defineConfig } from 'vite';

/**
 * Tablero.
 *   modo normal → dist/tablero, lo sirve nginx junto a la API (docker compose).
 *   modo demo   → dist/demo, sitio estático para GitHub Pages (rutas relativas).
 */
export default defineConfig(({ mode }) => ({
  root: 'src/tablero',
  base: './',
  build: {
    outDir: mode === 'demo' ? '../../dist/demo' : '../../dist/tablero',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
      '/docs': 'http://localhost:3000',
    },
  },
  preview: { port: 4173 },
}));
