/**
 * Una torre completa que corre en un solo proceso, sin E/S: simulador + reglas +
 * conciliación + instantánea. Es lo que usa la demo de GitHub Pages en el navegador y
 * lo que usan las pruebas para recorrer la noche del cierre de principio a fin.
 */
import { conciliarAlertas, reconocer, type ResultadoConciliacion } from './alertas.ts';
import { construirInstantanea, type Instantanea } from './instantanea.ts';
import { CONFIG_REGLAS_POR_DEFECTO, evaluarReglas, type ConfigReglas } from './reglas.ts';
import type { Simulador } from './simulador.ts';
import { HistorialColas } from './tendencia.ts';
import type { Alerta, EventoBot } from './tipos.ts';

export interface OpcionesTorreLocal {
  ventanaTendenciaMin?: number;
  reglas?: ConfigReglas;
  maxEventos?: number;
}

export class TorreLocal {
  readonly simulador: Simulador;
  readonly historial: HistorialColas;
  readonly #reglas: ConfigReglas;
  readonly #maxEventos: number;
  #alertas: Alerta[] = [];
  #eventos: EventoBot[] = [];
  #seq = 0;

  constructor(simulador: Simulador, op: OpcionesTorreLocal = {}) {
    this.simulador = simulador;
    this.historial = new HistorialColas(op.ventanaTendenciaMin ?? 10);
    this.#reglas = op.reglas ?? CONFIG_REGLAS_POR_DEFECTO;
    this.#maxEventos = op.maxEventos ?? 200;
  }

  get alertas(): readonly Alerta[] {
    return this.#alertas;
  }

  /** Avanza la simulación y ejecuta un ciclo del vigía. */
  ciclo(segundos: number): ResultadoConciliacion {
    const sim = this.simulador;
    sim.avanzar(segundos);
    const ahora = sim.ahora;
    const metricas = sim.metricas();
    this.historial.registrar(Date.parse(ahora), metricas);
    this.#eventos = [...sim.tomarEventos().reverse(), ...this.#eventos].slice(0, this.#maxEventos);
    const hallazgos = evaluarReglas(
      { ahora, catalogo: sim.catalogo, latidos: sim.latidos(), metricas, historial: this.historial },
      this.#reglas,
    );
    const vigentes = this.#alertas.filter((a) => a.estado !== 'resuelta');
    const r = conciliarAlertas(
      vigentes,
      hallazgos,
      ahora,
      () => `00000000-0000-4000-8000-${String(++this.#seq).padStart(12, '0')}`,
    );
    const porId = new Map(this.#alertas.map((a) => [a.id, a]));
    for (const a of [...r.resueltas, ...r.vigentes]) porId.set(a.id, a);
    const todas = [...porId.values()].sort((a, b) => b.abiertaEn.localeCompare(a.abiertaEn) || b.id.localeCompare(a.id));
    // Se conservan todas las vigentes y el historial reciente de resueltas.
    this.#alertas = [
      ...todas.filter((a) => a.estado !== 'resuelta'),
      ...todas.filter((a) => a.estado === 'resuelta').slice(0, 60),
    ];
    return r;
  }

  reconocer(id: string, operador: string): Alerta | null {
    const a = this.#alertas.find((x) => x.id === id);
    if (!a || a.estado !== 'activa') return null;
    const r = reconocer(a, operador, this.simulador.ahora);
    this.#alertas = this.#alertas.map((x) => (x.id === id ? r : x));
    return r;
  }

  instantanea(): Instantanea {
    return construirInstantanea({
      ahora: this.simulador.ahora,
      catalogo: this.simulador.catalogo,
      latidos: this.simulador.latidos(),
      metricas: this.simulador.metricas(),
      historial: this.historial,
      alertas: this.#alertas,
      eventos: this.#eventos,
      ttlLatidoSeg: this.#reglas.ttlLatidoSeg,
    });
  }
}
