/**
 * Simulador determinista de una operación RPA.
 *
 * Modela, paso a paso, lo que verían la API de management de RabbitMQ y los latidos de
 * los bots: colas principales que se llenan con lotes y goteo, bots que las vacían a
 * cierta capacidad, errores transitorios que pasan por las colas de reintento con TTL,
 * errores de negocio que caen en la DLQ, servidores que se reinician y bots que se
 * cuelgan. Lo usan:
 *
 *  - la demo de GitHub Pages (corre en el navegador, sin backend);
 *  - la API en modo `simulado` como fuente de métricas de colas;
 *  - las pruebas, que verifican que cada capítulo dispara la alerta esperada.
 */
import { Acumulador, crearAzar, type Azar } from './azar.ts';
import { DURACION_NOCHE_MIN, GUION, INICIO_NOCHE, PERFILES, type Capitulo, type Efecto, type PerfilProceso } from './historia.ts';
import { catalogoMacondo } from './macondo.ts';
import { nombresDeProceso } from './topologia.ts';
import type { Bot, Catalogo, EstadoBot, EventoBot, Latido, MetricaCola, TipoEvento } from './tipos.ts';

const ESPERAS_REINTENTO = [10, 60, 300] as const;
const INTERVALO_LATIDO_SEG = 15;

export interface OpcionesSimulador {
  semilla: number;
  inicio: string;
  pasoSeg: number;
  catalogo: Catalogo;
  guion: readonly Capitulo[];
  perfiles: Readonly<Record<string, PerfilProceso>>;
  duracionMin: number;
}

interface EstadoProceso {
  proceso: string;
  perfil: PerfilProceso;
  principal: number;
  erroneos: number;
  dlq: number;
  reintentos: Map<number, { vence: number; n: number }[]>;
  llegadas: Acumulador;
  entrada: number;
  salida: number;
  entradaDlq: number;
  entradaReintento: Map<number, number>;
}

interface EstadoBotSim {
  bot: Bot;
  hostname: string;
  plataforma: string;
  estado: EstadoBot;
  ok: number;
  fallidas: number;
  version: string;
  iniciadoEn: string;
  ultimoLatidoMs: number;
  capacidad: Acumulador;
  tareaActual: string | null;
}

const VERBO: Record<string, string> = {
  payment_agreement: 'acuerdos de pago',
  collection_update: 'gestiones',
  support_download: 'soportes',
};

export class Simulador {
  readonly #op: OpcionesSimulador;
  readonly #azar: Azar;
  readonly #inicioMs: number;
  #ahoraMs: number;
  #seqEvento = 0;
  #seqTarea = 0;
  #pendientes: EventoBot[] = [];
  #capitulos: Capitulo[] = [];
  readonly #procesos = new Map<string, EstadoProceso>();
  readonly #bots = new Map<string, EstadoBotSim>();
  readonly #latidos = new Map<string, Latido>();
  readonly #lentitud = new Map<string, { factor: number; hasta: number }>();
  readonly #caidos = new Map<string, number>();
  readonly #colgados = new Map<string, number>();
  readonly #paradas = new Map<string, { hasta: number; version: string }>();

  constructor(op: OpcionesSimulador) {
    this.#op = op;
    this.#azar = crearAzar(op.semilla);
    this.#inicioMs = Date.parse(op.inicio);
    this.#ahoraMs = this.#inicioMs;

    const procesos = new Set(op.catalogo.colas.map((c) => c.proceso));
    for (const proceso of procesos) {
      const perfil = op.perfiles[proceso];
      if (!perfil) continue;
      this.#procesos.set(proceso, {
        proceso,
        perfil,
        principal: 0,
        erroneos: 0,
        dlq: 0,
        reintentos: new Map(ESPERAS_REINTENTO.map((s) => [s, []])),
        llegadas: new Acumulador(),
        entrada: 0,
        salida: 0,
        entradaDlq: 0,
        entradaReintento: new Map(),
      });
    }
    for (const bot of op.catalogo.bots) {
      const servidor = op.catalogo.servidores.find((s) => s.id === bot.servidorId);
      const windows = servidor?.sistema === 'windows';
      this.#bots.set(bot.id, {
        bot,
        hostname: servidor?.nombre ?? bot.servidorId,
        plataforma: windows ? 'Windows Server 2022' : 'Linux 6.8 (Ubuntu 24.04)',
        estado: 'IDLE',
        ok: 0,
        fallidas: 0,
        version: '1.4.0',
        iniciadoEn: op.inicio,
        ultimoLatidoMs: -Infinity,
        capacidad: new Acumulador(),
        tareaActual: null,
      });
      this.#evento(bot.id, 'inicio', `${bot.alias} inició en ${servidor?.nombre ?? bot.servidorId} (v1.4.0)`);
    }
  }

  get ahora(): string {
    return new Date(this.#ahoraMs).toISOString();
  }

  get minuto(): number {
    return (this.#ahoraMs - this.#inicioMs) / 60_000;
  }

  get terminado(): boolean {
    return this.minuto >= this.#op.duracionMin;
  }

  get catalogo(): Catalogo {
    return this.#op.catalogo;
  }

  /** Capítulos del guion que ya ocurrieron, en orden. */
  get capitulos(): readonly Capitulo[] {
    return this.#capitulos;
  }

  avanzar(segundos: number): void {
    const pasos = Math.max(1, Math.round(segundos / this.#op.pasoSeg));
    for (let i = 0; i < pasos && !this.terminado; i++) this.#paso(this.#op.pasoSeg);
  }

  /** Avanza hasta el minuto indicado de la noche (para saltar a un capítulo). */
  avanzarHasta(minuto: number): void {
    while (this.minuto < minuto && !this.terminado) this.#paso(this.#op.pasoSeg);
  }

  metricas(): MetricaCola[] {
    const dt = this.#op.pasoSeg;
    const r: MetricaCola[] = [];
    for (const p of this.#procesos.values()) {
      const n = nombresDeProceso(p.proceso, ESPERAS_REINTENTO);
      const consumidores = [...this.#bots.values()].filter((b) => b.bot.proceso === p.proceso && this.#vivo(b)).length;
      const ocupados = Math.min(consumidores, p.principal);
      r.push({
        nombre: n.principal,
        mensajes: p.principal,
        listos: p.principal - ocupados,
        sinConfirmar: ocupados,
        consumidores,
        tasaEntrada: redondear(p.entrada / dt),
        tasaSalida: redondear(p.salida / dt),
      });
      ESPERAS_REINTENTO.forEach((s, i) => {
        const enEspera = (p.reintentos.get(s) ?? []).reduce((acc, x) => acc + x.n, 0);
        r.push({
          nombre: n.reintentos[i] ?? `rpa.${p.proceso}.retry.${s}s`,
          mensajes: enEspera,
          listos: enEspera,
          sinConfirmar: 0,
          consumidores: 0,
          tasaEntrada: redondear((p.entradaReintento.get(s) ?? 0) / dt),
          tasaSalida: 0,
        });
      });
      r.push({
        nombre: n.dlq,
        mensajes: p.dlq,
        listos: p.dlq,
        sinConfirmar: 0,
        consumidores: 0,
        tasaEntrada: redondear(p.entradaDlq / dt),
        tasaSalida: 0,
      });
    }
    return r;
  }

  latidos(): Map<string, Latido> {
    return new Map(this.#latidos);
  }

  /** Devuelve y olvida los eventos generados desde la última llamada. */
  tomarEventos(): EventoBot[] {
    const e = this.#pendientes;
    this.#pendientes = [];
    return e;
  }

  // -------------------------------------------------------------------------

  #paso(dt: number): void {
    this.#ahoraMs += dt * 1000;
    const minuto = this.minuto;
    for (const p of this.#procesos.values()) {
      p.entrada = 0;
      p.salida = 0;
      p.entradaDlq = 0;
      p.entradaReintento.clear();
    }

    for (const cap of this.#op.guion) {
      if (cap.minuto <= minuto && !this.#capitulos.includes(cap)) {
        this.#capitulos.push(cap);
        for (const efecto of cap.efectos) this.#aplicar(efecto);
      }
    }
    this.#vencerEfectos(minuto);

    for (const p of this.#procesos.values()) {
      for (const [desde, hasta, porMin] of p.perfil.llegadas) {
        if (minuto >= desde && minuto < hasta) {
          const n = p.llegadas.tomar((porMin * dt) / 60);
          p.principal += n;
          p.entrada += n;
        }
      }
      for (const lista of p.reintentos.values()) {
        while (lista[0] && lista[0].vence <= this.#ahoraMs) {
          const vencido = lista.shift();
          if (vencido) p.principal += vencido.n;
        }
      }
    }

    for (const b of this.#bots.values()) this.#trabajar(b, dt);
    for (const b of this.#bots.values()) {
      if (this.#vivo(b) && this.#ahoraMs - b.ultimoLatidoMs >= INTERVALO_LATIDO_SEG * 1000) this.#latir(b);
    }
  }

  #trabajar(b: EstadoBotSim, dt: number): void {
    const p = this.#procesos.get(b.bot.proceso);
    if (!p || !this.#vivo(b)) return;
    const factor = this.#lentitud.get(p.proceso)?.factor ?? 1;
    const capacidad = b.capacidad.tomar((p.perfil.capacidadPorBotMin * factor * dt) / 60);
    const n = Math.min(capacidad, p.principal);
    for (let i = 0; i < n; i++) {
      const tarea = `MAC-${String(++this.#seqTarea).padStart(6, '0')}`;
      p.principal--;
      p.salida++;
      if (p.erroneos > 0 && this.#azar() < p.erroneos / (p.principal + 1)) {
        p.erroneos--;
        p.dlq++;
        p.entradaDlq++;
        b.fallidas++;
        const cedula = `CC 000${String(Math.floor(this.#azar() * 1e7)).padStart(7, '0')}`;
        this.#evento(
          b.bot.id,
          'tarea_fallida',
          `Tarea ${tarea}: la cédula ${cedula} (ficticia) no existe en el CRM. Enviada a la DLQ.`,
          tarea,
        );
      } else if (this.#azar() < p.perfil.probTransitoria) {
        const r = this.#azar();
        const espera = r < 0.85 ? 10 : r < 0.97 ? 60 : 300;
        p.reintentos.get(espera)?.push({ vence: this.#ahoraMs + espera * 1000, n: 1 });
        p.entradaReintento.set(espera, (p.entradaReintento.get(espera) ?? 0) + 1);
        this.#evento(b.bot.id, 'reintento', `Tarea ${tarea}: el portal respondió 503. Reintento en ${espera} s.`, tarea);
      } else {
        b.ok++;
        if (b.ok % 100 === 0) {
          this.#evento(b.bot.id, 'tarea_ok', `${b.bot.alias} completó ${b.ok} ${VERBO[p.proceso] ?? 'tareas'}.`, tarea);
        }
      }
      b.tareaActual = tarea;
    }
    const ocupado = n > 0 || p.principal > 0;
    b.estado = ocupado ? 'BUSY' : 'IDLE';
    if (!ocupado) b.tareaActual = null;
  }

  #vivo(b: EstadoBotSim): boolean {
    return !this.#caidos.has(b.bot.servidorId) && !this.#colgados.has(b.bot.id) && !this.#paradas.has(b.bot.id);
  }

  #latir(b: EstadoBotSim): void {
    b.ultimoLatidoMs = this.#ahoraMs;
    this.#latidos.set(b.bot.id, {
      botId: b.bot.id,
      hostname: b.hostname,
      plataforma: b.plataforma,
      procesos: [b.bot.proceso],
      estado: b.estado,
      tareaActual: b.tareaActual,
      tareasOk: b.ok,
      tareasFallidas: b.fallidas,
      version: b.version,
      iniciadoEn: b.iniciadoEn,
      recibidoEn: this.ahora,
    });
  }

  #aplicar(e: Efecto): void {
    switch (e.tipo) {
      case 'lote': {
        const p = this.#procesos.get(e.proceso);
        if (!p) return;
        p.principal += e.cantidad;
        p.erroneos += e.erroneos;
        p.entrada += e.cantidad;
        this.#evento(
          'productor',
          'lote',
          `Llegó un lote de ${e.cantidad.toLocaleString('es-CO')} ${VERBO[e.proceso] ?? 'tareas'} a rpa.${e.proceso}.`,
        );
        return;
      }
      case 'lentitud':
        this.#lentitud.set(e.proceso, { factor: e.factor, hasta: e.hasta });
        return;
      case 'servidor_caido':
        this.#caidos.set(e.servidorId, e.hasta);
        return;
      case 'bot_colgado':
        this.#colgados.set(e.botId, e.hasta);
        return;
      case 'parada_bot': {
        const b = this.#bots.get(e.botId);
        if (!b) return;
        b.estado = 'STOPPING';
        b.tareaActual = null;
        this.#latir(b);
        this.#paradas.set(e.botId, { hasta: e.hasta, version: e.nuevaVersion });
        this.#evento(e.botId, 'parada', `${b.bot.alias} se detiene de forma ordenada para actualizarse a la v${e.nuevaVersion}.`);
        return;
      }
      case 'reproceso_dlq': {
        const p = this.#procesos.get(e.proceso);
        if (!p) return;
        const n = p.dlq;
        p.principal += n;
        p.dlq = 0;
        this.#evento('operacion', 'info', `Operación reprocesó ${n} mensajes de rpa.${e.proceso}.dlq tras corregir los datos.`);
        return;
      }
    }
  }

  #vencerEfectos(minuto: number): void {
    for (const [proceso, l] of this.#lentitud) if (l.hasta <= minuto) this.#lentitud.delete(proceso);
    for (const [servidorId, hasta] of this.#caidos) {
      if (hasta > minuto) continue;
      this.#caidos.delete(servidorId);
      for (const b of this.#bots.values()) {
        if (b.bot.servidorId !== servidorId) continue;
        b.iniciadoEn = this.ahora;
        this.#evento(b.bot.id, 'inicio', `${b.bot.alias} volvió a iniciar tras el reinicio de ${b.hostname}.`);
      }
    }
    for (const [botId, hasta] of this.#colgados) {
      if (hasta > minuto) continue;
      this.#colgados.delete(botId);
      const b = this.#bots.get(botId);
      if (b) this.#evento(botId, 'inicio', `${b.bot.alias} se recuperó: el supervisor reinició su navegador.`);
    }
    for (const [botId, parada] of this.#paradas) {
      if (parada.hasta > minuto) continue;
      this.#paradas.delete(botId);
      const b = this.#bots.get(botId);
      if (!b) continue;
      b.version = parada.version;
      b.iniciadoEn = this.ahora;
      b.estado = 'IDLE';
      this.#evento(botId, 'inicio', `${b.bot.alias} inició con la v${parada.version}.`);
    }
  }

  #evento(botId: string, tipo: TipoEvento, mensaje: string, tareaId: string | null = null): void {
    this.#pendientes.push({
      id: `ev-${String(++this.#seqEvento).padStart(6, '0')}`,
      botId,
      tipo,
      mensaje,
      tareaId,
      ocurridoEn: this.ahora,
    });
  }
}

function redondear(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Simulador con la historia completa de Cobranzas Macondo. */
export function simuladorMacondo(opciones: Partial<Pick<OpcionesSimulador, 'semilla' | 'pasoSeg' | 'inicio'>> = {}): Simulador {
  return new Simulador({
    semilla: opciones.semilla ?? 30_11,
    inicio: opciones.inicio ?? INICIO_NOCHE,
    pasoSeg: opciones.pasoSeg ?? 5,
    catalogo: catalogoMacondo(),
    guion: GUION,
    perfiles: PERFILES,
    duracionMin: DURACION_NOCHE_MIN,
  });
}
