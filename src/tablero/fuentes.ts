/**
 * De dónde saca el tablero sus datos.
 *
 * - `FuenteEnVivo`: la API de la torre (REST para la foto inicial y WebSocket para lo
 *   que sigue), con reconexión exponencial si se cae la red.
 * - `FuenteDemo`: la torre completa corriendo en el navegador sobre el simulador de la
 *   noche del cierre. Es lo que se publica en GitHub Pages: no necesita backend.
 *
 * Ambas entregan la misma `Instantanea`, así que las vistas no saben cuál están usando.
 */
import { DURACION_NOCHE_MIN, GUION, type Capitulo } from '../dominio/historia.ts';
import type { Instantanea } from '../dominio/instantanea.ts';
import { simuladorMacondo } from '../dominio/simulador.ts';
import { TorreLocal } from '../dominio/torre-local.ts';

export type EstadoConexion = 'conectando' | 'en_vivo' | 'reconectando' | 'demo';

export interface EstadoDemo {
  minuto: number;
  capitulo: Capitulo | null;
  pausado: boolean;
  velocidad: number;
  terminado: boolean;
}

export interface Suscriptor {
  alInstantanea(i: Instantanea): void;
  alConexion(estado: EstadoConexion, detalle?: string): void;
  alDemo?(estado: EstadoDemo): void;
}

export interface FuenteDatos {
  readonly modo: 'en_vivo' | 'demo';
  iniciar(s: Suscriptor): void;
  detener(): void;
  reconocer(alertaId: string, operador: string): Promise<void>;
}

// ---------------------------------------------------------------------------

export interface SocketMinimo {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export interface EntornoEnVivo {
  fetch: typeof fetch;
  crearSocket: (url: string) => SocketMinimo;
  programar: (fn: () => void, ms: number) => unknown;
  cancelar: (id: unknown) => void;
}

export const RETARDOS_RECONEXION_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000];

export class FuenteEnVivo implements FuenteDatos {
  readonly modo = 'en_vivo' as const;
  readonly #base: string;
  readonly #entorno: EntornoEnVivo;
  #suscriptor: Suscriptor | null = null;
  #socket: SocketMinimo | null = null;
  #intentos = 0;
  #temporizador: unknown = null;
  #activa = false;

  constructor(base: string, entorno: EntornoEnVivo) {
    this.#base = base.replace(/\/$/, '');
    this.#entorno = entorno;
  }

  iniciar(s: Suscriptor): void {
    this.#suscriptor = s;
    this.#activa = true;
    s.alConexion('conectando');
    void this.#cargarFoto();
    this.#conectar();
  }

  detener(): void {
    this.#activa = false;
    if (this.#temporizador !== null) this.#entorno.cancelar(this.#temporizador);
    this.#socket?.close();
  }

  async reconocer(alertaId: string, operador: string): Promise<void> {
    const r = await this.#entorno.fetch(`${this.#base}/api/v1/alertas/${encodeURIComponent(alertaId)}/reconocer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operador }),
    });
    if (!r.ok) {
      const cuerpo = (await r.json().catch(() => ({}))) as { mensaje?: string };
      throw new Error(cuerpo.mensaje ?? `La torre respondió ${r.status}.`);
    }
    await this.#cargarFoto();
  }

  async #cargarFoto(): Promise<void> {
    try {
      const r = await this.#entorno.fetch(`${this.#base}/api/v1/instantanea`);
      if (r.ok) this.#suscriptor?.alInstantanea((await r.json()) as Instantanea);
    } catch {
      // Sin foto inicial: el WebSocket la traerá al conectar.
    }
  }

  #conectar(): void {
    const url = `${this.#base.replace(/^http/, 'ws')}/api/v1/ws`;
    const socket = this.#entorno.crearSocket(url);
    this.#socket = socket;
    socket.onopen = () => {
      this.#intentos = 0;
      this.#suscriptor?.alConexion('en_vivo');
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      try {
        const m = JSON.parse(e.data) as { tipo: string; datos: unknown };
        if (m.tipo === 'instantanea') this.#suscriptor?.alInstantanea(m.datos as Instantanea);
      } catch {
        // mensaje ilegible: se ignora
      }
    };
    socket.onclose = () => {
      if (!this.#activa) return;
      const espera = RETARDOS_RECONEXION_MS[Math.min(this.#intentos, RETARDOS_RECONEXION_MS.length - 1)] ?? 15000;
      this.#intentos++;
      this.#suscriptor?.alConexion('reconectando', `Reintento en ${Math.round(espera / 1000)} s`);
      this.#temporizador = this.#entorno.programar(() => this.#conectar(), espera);
    };
  }
}

// ---------------------------------------------------------------------------

export interface OpcionesDemo {
  /** Segundos simulados por segundo real. */
  velocidad: number;
  /** Cada cuánto se avanza y se pinta (ms reales). */
  pasoMs: number;
  /** Minuto de la noche en el que empieza. */
  minutoInicial: number;
  pausado: boolean;
  programarIntervalo: (fn: () => void, ms: number) => unknown;
  cancelarIntervalo: (id: unknown) => void;
}

/** Ciclo del vigía simulado: el de la API usa 5 s; aquí 15 s simulados bastan. */
const CICLO_SIMULADO_SEG = 15;

export class FuenteDemo implements FuenteDatos {
  readonly modo = 'demo' as const;
  readonly #op: OpcionesDemo;
  #torre: TorreLocal;
  #suscriptor: Suscriptor | null = null;
  #intervalo: unknown = null;
  #pendienteSeg = 0;

  constructor(op: OpcionesDemo) {
    this.#op = { ...op };
    this.#torre = FuenteDemo.torreEn(op.minutoInicial);
  }

  /** Torre recién creada y avanzada hasta `minuto`, ciclo a ciclo (para que la tendencia sea real). */
  static torreEn(minuto: number): TorreLocal {
    const torre = new TorreLocal(simuladorMacondo());
    while (torre.simulador.minuto < minuto && !torre.simulador.terminado) torre.ciclo(CICLO_SIMULADO_SEG);
    if (minuto === 0) torre.ciclo(CICLO_SIMULADO_SEG);
    return torre;
  }

  get torre(): TorreLocal {
    return this.#torre;
  }

  iniciar(s: Suscriptor): void {
    this.#suscriptor = s;
    s.alConexion('demo');
    this.#emitir();
    this.#intervalo = this.#op.programarIntervalo(() => this.tic(), this.#op.pasoMs);
  }

  detener(): void {
    if (this.#intervalo !== null) this.#op.cancelarIntervalo(this.#intervalo);
    this.#intervalo = null;
  }

  /** Un paso de reloj real. Público para que las pruebas no dependan de temporizadores. */
  tic(): void {
    if (this.#op.pausado || this.#torre.simulador.terminado) return;
    this.#pendienteSeg += (this.#op.velocidad * this.#op.pasoMs) / 1000;
    while (this.#pendienteSeg >= CICLO_SIMULADO_SEG && this.#torre.simulador.minuto < DURACION_NOCHE_MIN) {
      this.#torre.ciclo(CICLO_SIMULADO_SEG);
      this.#pendienteSeg -= CICLO_SIMULADO_SEG;
    }
    this.#emitir();
  }

  pausar(pausado: boolean): void {
    this.#op.pausado = pausado;
    this.#emitir();
  }

  cambiarVelocidad(velocidad: number): void {
    this.#op.velocidad = velocidad;
    this.#emitir();
  }

  irA(minuto: number): void {
    this.#torre = FuenteDemo.torreEn(Math.max(0, Math.min(DURACION_NOCHE_MIN, minuto)));
    this.#pendienteSeg = 0;
    this.#emitir();
  }

  async reconocer(alertaId: string, operador: string): Promise<void> {
    if (!this.#torre.reconocer(alertaId, operador)) throw new Error('La alerta ya no está activa.');
    this.#emitir();
  }

  estadoDemo(): EstadoDemo {
    const minuto = this.#torre.simulador.minuto;
    const capitulo = [...GUION].reverse().find((c) => c.minuto <= minuto) ?? null;
    return {
      minuto,
      capitulo,
      pausado: this.#op.pausado,
      velocidad: this.#op.velocidad,
      terminado: this.#torre.simulador.terminado,
    };
  }

  #emitir(): void {
    this.#suscriptor?.alInstantanea(this.#torre.instantanea());
    this.#suscriptor?.alDemo?.(this.estadoDemo());
  }
}
