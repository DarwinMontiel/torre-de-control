/**
 * Ciclo de vida de las alertas.
 *
 *   (hallazgo nuevo) ──► activa ──reconocer──► reconocida
 *                          │                       │
 *                          └──── condición desaparece ──► resuelta
 *
 * La identidad de una alerta es su `clave` (`<regla>:<objetivo>`): mientras el mismo
 * problema siga presente se actualiza la misma alerta en lugar de abrir otra, y solo
 * se vuelve a avisar si la severidad sube (escalamiento).
 */
import type { Alerta, Hallazgo, Severidad } from './tipos.ts';

const PESO: Record<Severidad, number> = { informativa: 0, advertencia: 1, critica: 2 };

export interface ResultadoConciliacion {
  abiertas: Alerta[];
  escaladas: Alerta[];
  actualizadas: Alerta[];
  resueltas: Alerta[];
  /** Estado completo de las alertas vigentes después de conciliar. */
  vigentes: Alerta[];
}

export function esVigente(a: Alerta): boolean {
  return a.estado !== 'resuelta';
}

export function conciliarAlertas(
  vigentes: readonly Alerta[],
  hallazgos: readonly Hallazgo[],
  ahora: string,
  nuevoId: () => string,
): ResultadoConciliacion {
  const porClave = new Map(vigentes.filter(esVigente).map((a) => [a.clave, a]));
  const r: ResultadoConciliacion = {
    abiertas: [],
    escaladas: [],
    actualizadas: [],
    resueltas: [],
    vigentes: [],
  };

  for (const h of hallazgos) {
    const previa = porClave.get(h.clave);
    porClave.delete(h.clave);
    if (!previa) {
      const nueva: Alerta = {
        ...h,
        id: nuevoId(),
        estado: 'activa',
        abiertaEn: ahora,
        actualizadaEn: ahora,
        reconocidaEn: null,
        reconocidaPor: null,
        resueltaEn: null,
      };
      r.abiertas.push(nueva);
      r.vigentes.push(nueva);
      continue;
    }
    const cambio = previa.severidad !== h.severidad || previa.valor !== h.valor || previa.titulo !== h.titulo;
    if (!cambio) {
      r.vigentes.push(previa);
      continue;
    }
    const actualizada: Alerta = { ...previa, ...h, id: previa.id, actualizadaEn: ahora };
    if (PESO[h.severidad] > PESO[previa.severidad]) r.escaladas.push(actualizada);
    else r.actualizadas.push(actualizada);
    r.vigentes.push(actualizada);
  }

  for (const sinHallazgo of porClave.values()) {
    r.resueltas.push({
      ...sinHallazgo,
      estado: 'resuelta',
      resueltaEn: ahora,
      actualizadaEn: ahora,
    });
  }
  return r;
}

export class ErrorTransicion extends Error {}

export function reconocer(alerta: Alerta, usuario: string, ahora: string): Alerta {
  if (alerta.estado !== 'activa') {
    throw new ErrorTransicion(`La alerta ${alerta.id} está ${alerta.estado}; solo se reconocen alertas activas.`);
  }
  return {
    ...alerta,
    estado: 'reconocida',
    reconocidaEn: ahora,
    reconocidaPor: usuario,
    actualizadaEn: ahora,
  };
}

/** Minutos que lleva (o llevó) abierta la alerta. */
export function duracionMin(a: Alerta, ahora: string): number {
  const fin = a.resueltaEn ?? ahora;
  return Math.max(0, Math.round((Date.parse(fin) - Date.parse(a.abiertaEn)) / 60_000));
}
