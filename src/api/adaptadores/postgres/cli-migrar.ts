/**
 * Aplica las migraciones pendientes y termina. `npm run migrar`
 * Con `--sembrar` además carga el catálogo ficticio de Cobranzas Macondo si está vacío.
 */
import pg from 'pg';
import { leerConfig } from '../../config.ts';
import { sembrarMacondo } from '../../semilla.ts';
import { leerMigraciones, migrar } from './migrador.ts';
import { CatalogoPg } from './repositorios.ts';

const config = leerConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
try {
  const nuevas = await migrar(pool, await leerMigraciones(), (m) => console.info(m));
  console.info(nuevas.length ? `${nuevas.length} migración(es) aplicada(s).` : 'La base de datos ya estaba al día.');
  if (process.argv.includes('--sembrar')) {
    const c = await sembrarMacondo(new CatalogoPg(pool));
    console.info(
      c
        ? `Catálogo sembrado: ${c.servidores.length} servidores, ${c.bots.length} bots y ${c.colas.length} colas ficticios.`
        : 'El catálogo ya tiene datos; no se sembró.',
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
