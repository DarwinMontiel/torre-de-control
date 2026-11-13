/**
 * Fuentes de métricas de colas.
 *
 * - `FuenteColasManagement` lee la API HTTP de management de RabbitMQ
 *   (`GET /api/queues/<vhost>`): no abre conexiones AMQP ni consume mensajes, así que
 *   observar nunca altera lo observado (ADR-0002).
 * - `FuenteColasSimulada` usa el simulador del dominio para demos sin broker.
 */
import type { Simulador } from '../../dominio/simulador.ts';
import type { EventoBot, Latido, MetricaCola } from '../../dominio/tipos.ts';
import type { FuenteColas } from '../puertos.ts';

/** Forma (parcial) de cada elemento que devuelve `GET /api/queues/<vhost>`. */
export interface ColaManagement {
  name: string;
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  consumers?: number;
  message_stats?: {
    publish_details?: { rate?: number };
    ack_details?: { rate?: number };
  };
}

export class ErrorFuenteColas extends Error {}

export function aMetrica(c: ColaManagement): MetricaCola {
  return {
    nombre: c.name,
    mensajes: c.messages ?? 0,
    listos: c.messages_ready ?? 0,
    sinConfirmar: c.messages_unacknowledged ?? 0,
    consumidores: c.consumers ?? 0,
    tasaEntrada: c.message_stats?.publish_details?.rate ?? 0,
    tasaSalida: c.message_stats?.ack_details?.rate ?? 0,
  };
}

export interface OpcionesManagement {
  /** Ej.: http://rabbitmq:15672 */
  url: string;
  usuario: string;
  clave: string;
  vhost: string;
  /** Solo se reportan colas cuyo nombre empiece así (por defecto, las de colmena-rpa). */
  prefijo: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class FuenteColasManagement implements FuenteColas {
  readonly descripcion: string;
  readonly #op: OpcionesManagement;
  readonly #fetch: typeof fetch;

  constructor(op: OpcionesManagement) {
    this.#op = op;
    this.#fetch = op.fetch ?? fetch;
    this.descripcion = `RabbitMQ management en ${new URL(op.url).host} (vhost ${op.vhost})`;
  }

  async leer(): Promise<MetricaCola[]> {
    const url = new URL(`/api/queues/${encodeURIComponent(this.#op.vhost)}`, this.#op.url);
    url.searchParams.set('columns', 'name,messages,messages_ready,messages_unacknowledged,consumers,message_stats');
    const credenciales = Buffer.from(`${this.#op.usuario}:${this.#op.clave}`).toString('base64');
    let respuesta: Response;
    try {
      respuesta = await this.#fetch(url, {
        headers: { authorization: `Basic ${credenciales}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.#op.timeoutMs),
      });
    } catch (e) {
      throw new ErrorFuenteColas(`No se pudo contactar a RabbitMQ en ${url.host}: ${(e as Error).message}`, { cause: e });
    }
    if (respuesta.status === 401) throw new ErrorFuenteColas('RabbitMQ rechazó las credenciales de management (401).');
    if (!respuesta.ok) throw new ErrorFuenteColas(`RabbitMQ respondió ${respuesta.status} al listar colas.`);
    const cuerpo = (await respuesta.json()) as unknown;
    if (!Array.isArray(cuerpo)) throw new ErrorFuenteColas('Respuesta inesperada de RabbitMQ: se esperaba una lista de colas.');
    return (cuerpo as ColaManagement[])
      .filter((c) => typeof c.name === 'string' && c.name.startsWith(this.#op.prefijo))
      .map(aMetrica)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
}

/**
 * Métricas simuladas en tiempo real. `aceleracion` comprime el tiempo: con 10, un
 * minuto real equivale a diez de la noche simulada. Al terminar la noche, vuelve a empezar.
 */
export class FuenteColasSimulada implements FuenteColas {
  readonly descripcion = 'Simulador de la noche del cierre (sin RabbitMQ)';
  readonly #crear: () => Simulador;
  readonly #aceleracion: number;
  readonly #ahoraMs: () => number;
  readonly #alAvanzar: ((sim: Simulador) => Promise<void>) | undefined;
  #sim: Simulador;
  #ultimaLectura: number;

  constructor(op: {
    crear: () => Simulador;
    aceleracion?: number;
    ahoraMs?: () => number;
    /** Se llama tras cada avance; sirve para inyectar los latidos y eventos simulados. */
    alAvanzar?: (sim: Simulador) => Promise<void>;
  }) {
    this.#crear = op.crear;
    this.#aceleracion = op.aceleracion ?? 1;
    this.#ahoraMs = op.ahoraMs ?? Date.now;
    this.#alAvanzar = op.alAvanzar;
    this.#sim = op.crear();
    this.#ultimaLectura = this.#ahoraMs();
  }

  get simulador(): Simulador {
    return this.#sim;
  }

  async leer(): Promise<MetricaCola[]> {
    const ahora = this.#ahoraMs();
    const transcurrido = ((ahora - this.#ultimaLectura) / 1000) * this.#aceleracion;
    this.#ultimaLectura = ahora;
    if (transcurrido > 0) this.#sim.avanzar(transcurrido);
    if (this.#sim.terminado) this.#sim = this.#crear();
    await this.#alAvanzar?.(this.#sim);
    return this.#sim.metricas();
  }
}

/**
 * Lleva los latidos y eventos del simulador al estado vivo como si los hubieran enviado
 * bots reales. El simulador corre acelerado, así que se re-sellan con el reloj real de la
 * torre: un latido cuenta solo si el bot simulado latió desde la última vez.
 */
export function inyectorDeSimulacion(dest: {
  registrarLatido: (l: Latido) => Promise<void>;
  registrarEventos: (e: EventoBot[]) => Promise<void>;
  ahora: () => string;
}): (sim: Simulador) => Promise<void> {
  const vistos = new Map<string, string>();
  return async (sim) => {
    const ahora = dest.ahora();
    for (const [botId, l] of sim.latidos()) {
      if (vistos.get(botId) === l.recibidoEn) continue;
      vistos.set(botId, l.recibidoEn);
      await dest.registrarLatido({ ...l, recibidoEn: ahora });
    }
    const eventos = sim.tomarEventos().map((e) => ({ ...e, id: `${e.id}-${Date.parse(ahora)}`, ocurridoEn: ahora }));
    if (eventos.length) await dest.registrarEventos(eventos);
  };
}
