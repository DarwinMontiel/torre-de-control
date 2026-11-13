/** PostgreSQL en memoria (pg-mem) con las migraciones reales aplicadas. */
import { newDb } from 'pg-mem';
import { leerMigraciones, migrar } from '../../src/api/adaptadores/postgres/migrador.ts';
import type { ConexionPg } from '../../src/api/adaptadores/postgres/tipos.ts';

export function poolPgMem(): ConexionPg {
  const db = newDb();
  const { Pool } = db.adapters.createPg() as { Pool: new () => ConexionPg };
  return new Pool();
}

export async function baseMigrada(): Promise<ConexionPg> {
  const pool = poolPgMem();
  await migrar(pool, await leerMigraciones());
  return pool;
}
