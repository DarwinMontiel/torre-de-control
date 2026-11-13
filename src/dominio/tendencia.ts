/**
 * Historial corto de profundidad de colas y cálculo de tendencia.
 *
 * Una cola con 800 mensajes puede estar perfectamente sana si los bots la están
 * vaciando; lo preocupante es que crezca de forma sostenida. Por eso la regla
 * `cola_creciendo` mira la pendiente (mensajes por minuto) por mínimos cuadrados
 * sobre una ventana, y no un valor puntual que oscila con cada lectura.
 */
import type { MetricaCola } from './tipos.ts';

export interface Muestra {
  /** Milisegundos desde época. */
  t: number;
  v: number;
}

/** Pendiente en unidades por minuto. Devuelve 0 con menos de dos muestras o sin variación de tiempo. */
export function pendientePorMinuto(muestras: readonly Muestra[]): number {
  const n = muestras.length;
  if (n < 2) return 0;
  const t0 = muestras[0]?.t ?? 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { t, v } of muestras) {
    const x = (t - t0) / 60_000;
    sx += x;
    sy += v;
    sxx += x * x;
    sxy += x * v;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return 0;
  return (n * sxy - sx * sy) / den;
}

export class HistorialColas {
  readonly #ventanaMs: number;
  readonly #maxMuestras: number;
  readonly #series = new Map<string, Muestra[]>();

  constructor(ventanaMin: number, maxMuestras = 240) {
    this.#ventanaMs = ventanaMin * 60_000;
    this.#maxMuestras = maxMuestras;
  }

  registrar(ahoraMs: number, metricas: readonly MetricaCola[]): void {
    for (const m of metricas) {
      const serie = this.#series.get(m.nombre) ?? [];
      serie.push({ t: ahoraMs, v: m.mensajes });
      const limite = ahoraMs - this.#ventanaMs;
      while (serie.length > this.#maxMuestras || (serie[0] && serie[0].t < limite)) serie.shift();
      this.#series.set(m.nombre, serie);
    }
  }

  muestras(nombre: string): readonly Muestra[] {
    return this.#series.get(nombre) ?? [];
  }

  pendiente(nombre: string): number {
    return pendientePorMinuto(this.muestras(nombre));
  }

  /** Minutos cubiertos por la serie (para no alertar con datos insuficientes). */
  cobertura(nombre: string): number {
    const s = this.muestras(nombre);
    const primero = s[0];
    const ultimo = s.at(-1);
    return primero && ultimo ? (ultimo.t - primero.t) / 60_000 : 0;
  }
}
