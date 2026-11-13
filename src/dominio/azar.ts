/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 *
 * La simulación debe ser reproducible: con la misma semilla la noche del cierre se
 * cuenta igual en las pruebas, en la captura del README y en la demo publicada.
 */
export type Azar = () => number;

export function crearAzar(semilla: number): Azar {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reparte `cantidad` (con decimales acumulados) en unidades enteras sin perder fracciones. */
export class Acumulador {
  #resto = 0;

  tomar(cantidad: number): number {
    this.#resto += cantidad;
    // El épsilon evita perder una unidad por errores de punto flotante (0,1 × 10 = 0,999…).
    const enteras = Math.floor(this.#resto + 1e-9);
    this.#resto -= enteras;
    return enteras;
  }
}
