/**
 * Adaptadores en memoria. Sirven para pruebas, para correr la API sin PostgreSQL
 * (`TORRE_ALMACEN=memoria`) y como referencia del comportamiento que deben cumplir los
 * adaptadores reales (ver tests/contratos).
 */
import type { Instantanea } from '../../dominio/instantanea.ts';
import type { Alerta, Bot, Catalogo, Cola, EventoBot, Latido, Servidor } from '../../dominio/tipos.ts';
import {
  ErrorConflicto,
  ErrorValidacion,
  type EstadoVivo,
  type MensajeTorre,
  type FiltroAlertas,
  type FiltroEventos,
  type RepositorioCatalogo,
  type RepositorioEventos,
  type RepositorioIncidentes,
} from '../puertos.ts';

const copia = <T>(x: T): T => structuredClone(x);

export class CatalogoEnMemoria implements RepositorioCatalogo {
  readonly #servidores = new Map<string, Servidor>();
  readonly #bots = new Map<string, Bot>();
  readonly #colas = new Map<string, Cola>();

  constructor(inicial?: Catalogo) {
    for (const s of inicial?.servidores ?? []) this.#servidores.set(s.id, copia(s));
    for (const b of inicial?.bots ?? []) this.#bots.set(b.id, copia(b));
    for (const c of inicial?.colas ?? []) this.#colas.set(c.nombre, copia(c));
  }

  async catalogo(): Promise<Catalogo> {
    return {
      servidores: await this.listarServidores(),
      bots: await this.listarBots(),
      colas: await this.listarColas(),
    };
  }

  async listarServidores() {
    return [...this.#servidores.values()].map(copia).sort((a, b) => a.id.localeCompare(b.id));
  }
  async obtenerServidor(id: string) {
    const s = this.#servidores.get(id);
    return s ? copia(s) : null;
  }
  async crearServidor(s: Servidor) {
    if (this.#servidores.has(s.id)) throw new ErrorConflicto(`Ya existe el servidor ${s.id}.`);
    this.#servidores.set(s.id, copia(s));
    return copia(s);
  }
  async actualizarServidor(id: string, cambios: Partial<Omit<Servidor, 'id'>>) {
    const s = this.#servidores.get(id);
    if (!s) return null;
    const nuevo = { ...s, ...cambios, id };
    this.#servidores.set(id, nuevo);
    return copia(nuevo);
  }
  async eliminarServidor(id: string) {
    if ([...this.#bots.values()].some((b) => b.servidorId === id)) {
      throw new ErrorConflicto(`El servidor ${id} tiene bots asignados; reasígnalos antes de eliminarlo.`);
    }
    return this.#servidores.delete(id);
  }

  async listarBots() {
    return [...this.#bots.values()].map(copia).sort((a, b) => a.id.localeCompare(b.id));
  }
  async obtenerBot(id: string) {
    const b = this.#bots.get(id);
    return b ? copia(b) : null;
  }
  async crearBot(b: Bot) {
    if (this.#bots.has(b.id)) throw new ErrorConflicto(`Ya existe el bot ${b.id}.`);
    this.#exigirServidor(b.servidorId);
    this.#bots.set(b.id, copia(b));
    return copia(b);
  }
  async actualizarBot(id: string, cambios: Partial<Omit<Bot, 'id'>>) {
    const b = this.#bots.get(id);
    if (!b) return null;
    if (cambios.servidorId !== undefined) this.#exigirServidor(cambios.servidorId);
    const nuevo = { ...b, ...cambios, id };
    this.#bots.set(id, nuevo);
    return copia(nuevo);
  }
  async eliminarBot(id: string) {
    return this.#bots.delete(id);
  }

  async listarColas() {
    return [...this.#colas.values()].map(copia).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  async obtenerCola(nombre: string) {
    const c = this.#colas.get(nombre);
    return c ? copia(c) : null;
  }
  async crearCola(c: Cola) {
    if (this.#colas.has(c.nombre)) throw new ErrorConflicto(`Ya existe la cola ${c.nombre}.`);
    this.#colas.set(c.nombre, copia(c));
    return copia(c);
  }
  async actualizarCola(nombre: string, cambios: Partial<Omit<Cola, 'nombre'>>) {
    const c = this.#colas.get(nombre);
    if (!c) return null;
    const nueva = { ...c, ...cambios, nombre };
    this.#colas.set(nombre, nueva);
    return copia(nueva);
  }
  async eliminarCola(nombre: string) {
    return this.#colas.delete(nombre);
  }

  #exigirServidor(id: string): void {
    if (!this.#servidores.has(id)) throw new ErrorValidacion(`El servidor ${id} no existe en el catálogo.`);
  }
}

export class IncidentesEnMemoria implements RepositorioIncidentes {
  readonly #alertas = new Map<string, Alerta>();

  async vigentes() {
    return [...this.#alertas.values()].filter((a) => a.estado !== 'resuelta').map(copia);
  }
  async guardar(alertas: readonly Alerta[]) {
    const resultado = new Map(this.#alertas);
    for (const a of [...alertas].sort((x, y) => Number(y.estado === 'resuelta') - Number(x.estado === 'resuelta'))) {
      resultado.set(a.id, a);
    }
    const vigentesPorClave = new Set<string>();
    for (const a of resultado.values()) {
      if (a.estado === 'resuelta') continue;
      if (vigentesPorClave.has(a.clave)) throw new ErrorConflicto('Ya existe una alerta vigente con esa clave.');
      vigentesPorClave.add(a.clave);
    }
    for (const a of alertas) {
      const previa = this.#alertas.get(a.id);
      const nueva = copia(a);
      // Igual que en PostgreSQL: un reconocimiento concurrente no se pierde.
      if (previa?.estado === 'reconocida' && nueva.estado === 'activa') nueva.estado = 'reconocida';
      nueva.reconocidaEn ??= previa?.reconocidaEn ?? null;
      nueva.reconocidaPor ??= previa?.reconocidaPor ?? null;
      this.#alertas.set(a.id, nueva);
    }
  }
  async obtener(id: string) {
    const a = this.#alertas.get(id);
    return a ? copia(a) : null;
  }
  async listar(f: FiltroAlertas) {
    return [...this.#alertas.values()]
      .filter((a) => (f.estado ? a.estado === f.estado : true))
      .filter((a) => (f.regla ? a.regla === f.regla : true))
      .filter((a) => (f.objetivo ? a.objetivo === f.objetivo : true))
      .sort((a, b) => b.abiertaEn.localeCompare(a.abiertaEn) || b.id.localeCompare(a.id))
      .slice(0, f.limite)
      .map(copia);
  }
}

/** Estado vivo de un solo proceso: útil sin Redis (una réplica) y en pruebas. */
export class EstadoVivoEnMemoria implements EstadoVivo {
  readonly #latidos = new Map<string, Latido>();
  readonly #manejadores = new Set<(m: MensajeTorre) => void>();
  #instantanea: Instantanea | null = null;
  #lider: { nodo: string; vence: number } | null = null;
  readonly #ahoraMs: () => number;

  constructor(ahoraMs: () => number = Date.now) {
    this.#ahoraMs = ahoraMs;
  }

  async registrarLatido(latido: Latido) {
    this.#latidos.set(latido.botId, copia(latido));
  }
  async ultimosLatidos() {
    return new Map([...this.#latidos].map(([k, v]) => [k, copia(v)]));
  }
  async guardarInstantanea(i: Instantanea) {
    this.#instantanea = copia(i);
  }
  async ultimaInstantanea() {
    return this.#instantanea ? copia(this.#instantanea) : null;
  }
  async publicar(m: MensajeTorre) {
    for (const h of this.#manejadores) h(copia(m));
  }
  async suscribir(manejador: (m: MensajeTorre) => void) {
    this.#manejadores.add(manejador);
    return async () => {
      this.#manejadores.delete(manejador);
    };
  }
  async tomarLiderazgo(nodo: string, ttlMs: number) {
    const ahora = this.#ahoraMs();
    if (this.#lider && this.#lider.vence > ahora && this.#lider.nodo !== nodo) return false;
    this.#lider = { nodo, vence: ahora + ttlMs };
    return true;
  }
  async ping() {
    return true;
  }
}

export class EventosEnMemoria implements RepositorioEventos {
  readonly #eventos: EventoBot[] = [];
  readonly #maximo: number;

  constructor(maximo = 5_000) {
    this.#maximo = maximo;
  }

  async registrar(eventos: readonly EventoBot[]) {
    // Idempotente por id, como el ON CONFLICT DO NOTHING de PostgreSQL.
    const existentes = new Set(this.#eventos.map((e) => e.id));
    this.#eventos.push(...eventos.filter((e) => !existentes.has(e.id)).map(copia));
    if (this.#eventos.length > this.#maximo) this.#eventos.splice(0, this.#eventos.length - this.#maximo);
  }
  async recientes(f: FiltroEventos) {
    return this.#eventos
      .filter((e) => (f.botId ? e.botId === f.botId : true))
      .sort((a, b) => b.ocurridoEn.localeCompare(a.ocurridoEn) || b.id.localeCompare(a.id))
      .slice(0, f.limite)
      .map(copia);
  }
}
