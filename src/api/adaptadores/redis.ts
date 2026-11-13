/**
 * Estado vivo en Redis.
 *
 *   torre:latido:<botId>   JSON del último latido, con expiración (retención). Si un bot
 *                          se da de baja sin avisar, su rastro desaparece solo.
 *   torre:instantanea      última instantánea completa (la recibe el tablero al conectar).
 *   torre:eventos          canal pub/sub que difunde instantáneas, alertas y eventos a
 *                          todas las réplicas de la API.
 *   torre:vigia:lider      candado con TTL: solo una réplica evalúa reglas a la vez.
 *
 * La vigencia del latido (¿está vivo el bot?) la decide el dominio comparando
 * `recibidoEn` con `ttlLatidoSeg`; la expiración de Redis solo limpia (ADR-0003).
 */
import type { Redis } from 'ioredis';
import type { Instantanea } from '../../dominio/instantanea.ts';
import type { Latido } from '../../dominio/tipos.ts';
import type { EstadoVivo, MensajeTorre } from '../puertos.ts';

export const CLAVES = {
  latido: (botId: string) => `torre:latido:${botId}`,
  patronLatidos: 'torre:latido:*',
  instantanea: 'torre:instantanea',
  canal: 'torre:eventos',
  lider: 'torre:vigia:lider',
} as const;

export interface OpcionesRedis {
  /** Cliente para comandos normales. */
  cliente: Redis;
  /** Fábrica de un cliente dedicado a la suscripción (Redis lo exige en modo pub/sub). */
  crearSuscriptor: () => Redis;
  retencionLatidoSeg: number;
}

export class EstadoVivoRedis implements EstadoVivo {
  readonly #r: Redis;
  readonly #crearSuscriptor: () => Redis;
  readonly #retencion: number;

  constructor(op: OpcionesRedis) {
    this.#r = op.cliente;
    this.#crearSuscriptor = op.crearSuscriptor;
    this.#retencion = op.retencionLatidoSeg;
  }

  async registrarLatido(latido: Latido): Promise<void> {
    await this.#r.set(CLAVES.latido(latido.botId), JSON.stringify(latido), 'EX', this.#retencion);
  }

  async ultimosLatidos(): Promise<Map<string, Latido>> {
    const claves: string[] = [];
    let cursor = '0';
    do {
      const [siguiente, lote] = await this.#r.scan(cursor, 'MATCH', CLAVES.patronLatidos, 'COUNT', 200);
      cursor = siguiente;
      claves.push(...lote);
    } while (cursor !== '0');
    if (claves.length === 0) return new Map();
    const valores = await this.#r.mget(...claves);
    const mapa = new Map<string, Latido>();
    for (const v of valores) {
      if (!v) continue;
      const l = JSON.parse(v) as Latido;
      mapa.set(l.botId, l);
    }
    return mapa;
  }

  async guardarInstantanea(i: Instantanea): Promise<void> {
    await this.#r.set(CLAVES.instantanea, JSON.stringify(i));
  }

  async ultimaInstantanea(): Promise<Instantanea | null> {
    const v = await this.#r.get(CLAVES.instantanea);
    return v ? (JSON.parse(v) as Instantanea) : null;
  }

  async publicar(m: MensajeTorre): Promise<void> {
    await this.#r.publish(CLAVES.canal, JSON.stringify(m));
  }

  async suscribir(manejador: (m: MensajeTorre) => void): Promise<() => Promise<void>> {
    const sub = this.#crearSuscriptor();
    sub.on('message', (canal: string, mensaje: string) => {
      if (canal !== CLAVES.canal) return;
      try {
        manejador(JSON.parse(mensaje) as MensajeTorre);
      } catch {
        // Un mensaje malformado no debe tumbar la suscripción.
      }
    });
    await sub.subscribe(CLAVES.canal);
    return async () => {
      await sub.unsubscribe(CLAVES.canal);
      sub.disconnect();
    };
  }

  async tomarLiderazgo(nodo: string, ttlMs: number): Promise<boolean> {
    const ok = await this.#r.set(CLAVES.lider, nodo, 'PX', ttlMs, 'NX');
    if (ok === 'OK') return true;
    if ((await this.#r.get(CLAVES.lider)) !== nodo) return false;
    await this.#r.pexpire(CLAVES.lider, ttlMs);
    return true;
  }

  async ping(): Promise<boolean> {
    try {
      await this.#r.ping();
      return true;
    } catch {
      return false;
    }
  }
}
