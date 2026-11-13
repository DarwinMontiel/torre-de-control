/**
 * Migrador mínimo: aplica en orden los archivos `migraciones/NNN_nombre.sql`, cada uno
 * en su propia transacción, y guarda su huella SHA-256. Si alguien edita una migración
 * ya aplicada, el arranque falla en lugar de dejar dos bases de datos distintas con la
 * misma versión (ver ADR-0004).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConexionPg } from './tipos.ts';

export const DIRECTORIO_MIGRACIONES = join(import.meta.dirname, 'migraciones');

export interface Migracion {
  version: string;
  sql: string;
  huella: string;
}

export class ErrorMigracion extends Error {}

export async function leerMigraciones(dir = DIRECTORIO_MIGRACIONES): Promise<Migracion[]> {
  const archivos = (await readdir(dir)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(
    archivos.map(async (f) => {
      const sql = await readFile(join(dir, f), 'utf8');
      // Se normalizan los saltos de línea para que la huella no dependa del sistema operativo.
      const huella = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
      return { version: f.replace(/\.sql$/, ''), sql, huella };
    }),
  );
}

export async function migrar(
  conexion: ConexionPg,
  migraciones: readonly Migracion[],
  log: (mensaje: string) => void = () => {},
): Promise<string[]> {
  const existe = await conexion.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'esquema_migraciones'",
  );
  if (existe.rows.length === 0) {
    await conexion.query(`CREATE TABLE esquema_migraciones (
      version text PRIMARY KEY,
      huella text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )`);
  }
  const { rows } = await conexion.query<{ version: string; huella: string }>('SELECT version, huella FROM esquema_migraciones');
  const aplicadas = new Map(rows.map((r) => [r.version, r.huella]));
  const nuevas: string[] = [];

  for (const m of migraciones) {
    const huella = aplicadas.get(m.version);
    if (huella !== undefined) {
      if (huella !== m.huella) {
        throw new ErrorMigracion(
          `La migración ${m.version} cambió después de aplicarse. Crea una migración nueva en lugar de editarla.`,
        );
      }
      continue;
    }
    const cliente = await conexion.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(m.sql);
      await cliente.query('INSERT INTO esquema_migraciones (version, huella) VALUES ($1, $2)', [m.version, m.huella]);
      await cliente.query('COMMIT');
      log(`Migración aplicada: ${m.version}`);
      nuevas.push(m.version);
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw new ErrorMigracion(`Falló la migración ${m.version}: ${(error as Error).message}`, { cause: error });
    } finally {
      cliente.release();
    }
  }
  return nuevas;
}
