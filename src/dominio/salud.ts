/**
 * Salud de bots y servidores a partir de los latidos.
 *
 * Un bot está `en_linea` si su último latido tiene menos de `ttlLatidoSeg` segundos.
 * Si lo último que dijo fue `STOPPING` y luego calló, es una parada ordenada
 * (`detenido`), no una caída: no debe despertar a nadie a las 3 a. m.
 */
import type { Bot, Latido, SaludBot, SaludServidor, Servidor } from './tipos.ts';

export function segundosDesde(iso: string, ahora: string): number {
  return Math.max(0, (Date.parse(ahora) - Date.parse(iso)) / 1000);
}

export function saludBot(latido: Latido | undefined, ahora: string, ttlLatidoSeg: number): SaludBot {
  if (!latido) return 'nunca_visto';
  if (segundosDesde(latido.recibidoEn, ahora) <= ttlLatidoSeg) return 'en_linea';
  return latido.estado === 'STOPPING' ? 'detenido' : 'sin_latido';
}

/**
 * - `sin_bots`: no tiene bots catalogados.
 * - `caido`: todos sus bots que deberían estar vivos callaron (ninguno en línea).
 * - `degradado`: alguno calló pero otros siguen en línea.
 * - `operativo`: el resto.
 * Los bots `detenido` (parada ordenada) no cuentan como fallas.
 */
export function saludServidor(salud: readonly SaludBot[]): SaludServidor {
  if (salud.length === 0) return 'sin_bots';
  const fallas = salud.filter((s) => s === 'sin_latido' || s === 'nunca_visto').length;
  const enLinea = salud.filter((s) => s === 'en_linea').length;
  if (fallas === 0) return 'operativo';
  return enLinea === 0 ? 'caido' : 'degradado';
}

export function botsDe(servidor: Servidor, bots: readonly Bot[]): Bot[] {
  return bots.filter((b) => b.servidorId === servidor.id);
}
