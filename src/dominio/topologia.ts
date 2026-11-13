/**
 * Convenciones de nombres de colas de colmena-rpa.
 *
 * Por cada proceso colmena declara:
 *   rpa.<proceso>               cola principal
 *   rpa.<proceso>.retry.<N>s    colas de espera con TTL fijo
 *   rpa.<proceso>.dlq           cola de mensajes muertos
 *
 * La torre usa estas reglas para descubrir colas que aún no están en el catálogo y
 * asignarles tipo y proceso sin configuración manual.
 */
import type { Cola, TipoCola } from './tipos.ts';

export const PREFIJO = 'rpa.';
export const EXCHANGE_TAREAS = 'rpa.tasks';

const PATRON = /^rpa\.([a-z][a-z0-9_]*)(?:\.(dlq)|\.retry\.(\d+)s)?$/;

export interface ColaInferida {
  proceso: string;
  tipo: TipoCola;
  /** Solo para colas de reintento: segundos de espera. */
  esperaSeg: number | null;
}

export function inferirCola(nombre: string): ColaInferida | null {
  const m = PATRON.exec(nombre);
  if (!m?.[1]) return null;
  if (m[2] === 'dlq') return { proceso: m[1], tipo: 'dlq', esperaSeg: null };
  if (m[3] !== undefined) return { proceso: m[1], tipo: 'reintento', esperaSeg: Number(m[3]) };
  return { proceso: m[1], tipo: 'principal', esperaSeg: null };
}

export function nombresDeProceso(proceso: string, esperas: readonly number[] = [10, 60, 300]) {
  return {
    principal: `${PREFIJO}${proceso}`,
    dlq: `${PREFIJO}${proceso}.dlq`,
    reintentos: esperas.map((s) => `${PREFIJO}${proceso}.retry.${s}s`),
  };
}

/** Umbrales por defecto cuando una cola se descubre sola. */
export function colaPorDefecto(nombre: string): Cola | null {
  const inferida = inferirCola(nombre);
  if (!inferida) return null;
  const umbrales: Record<TipoCola, [number, number]> = {
    principal: [500, 20],
    reintento: [200, 30],
    dlq: [25, 5],
  };
  const [umbralMensajes, umbralCrecimientoPorMin] = umbrales[inferida.tipo];
  return {
    nombre,
    proceso: inferida.proceso,
    tipo: inferida.tipo,
    umbralMensajes,
    umbralCrecimientoPorMin,
  };
}
