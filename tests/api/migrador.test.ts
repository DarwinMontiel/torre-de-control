import { describe, expect, it } from 'vitest';
import { ErrorMigracion, leerMigraciones, migrar, type Migracion } from '../../src/api/adaptadores/postgres/migrador.ts';
import { poolPgMem } from './pg-mem.ts';

describe('migrador', () => {
  it('lee las migraciones del repositorio en orden y con huella SHA-256', async () => {
    const m = await leerMigraciones();
    expect(m.map((x) => x.version)).toEqual(['001_catalogo', '002_incidentes', '003_eventos_bot']);
    expect(m.every((x) => /^[0-9a-f]{64}$/.test(x.huella))).toBe(true);
  });

  it('aplica una sola vez: la segunda ejecución no hace nada', async () => {
    const pool = poolPgMem();
    const migraciones = await leerMigraciones();
    const mensajes: string[] = [];
    expect(await migrar(pool, migraciones, (x) => mensajes.push(x))).toHaveLength(3);
    expect(await migrar(pool, migraciones)).toEqual([]);
    expect(mensajes[0]).toBe('Migración aplicada: 001_catalogo');
    const { rows } = await pool.query<{ version: string }>('SELECT version FROM esquema_migraciones ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual(['001_catalogo', '002_incidentes', '003_eventos_bot']);
  });

  it('se niega a continuar si alguien editó una migración ya aplicada', async () => {
    const pool = poolPgMem();
    const migraciones = await leerMigraciones();
    await migrar(pool, migraciones);
    const editadas: Migracion[] = migraciones.map((m, i) => (i === 0 ? { ...m, huella: 'f'.repeat(64) } : m));
    await expect(migrar(pool, editadas)).rejects.toThrow(/cambió después de aplicarse/);
  });

  it('revierte una migración que falla y no la registra', async () => {
    const pool = poolPgMem();
    const rota: Migracion = {
      version: '900_rota',
      sql: 'CREATE TABLE ok_parcial (id int); SELECT * FROM tabla_que_no_existe;',
      huella: 'a'.repeat(64),
    };
    await expect(migrar(pool, [rota])).rejects.toBeInstanceOf(ErrorMigracion);
    const { rows } = await pool.query('SELECT * FROM esquema_migraciones');
    expect(rows).toEqual([]);
  });
});
