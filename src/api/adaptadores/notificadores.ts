/**
 * Canales de aviso.
 *
 * - Webhook: POST JSON a la URL configurada (Teams, Slack, n8n, un tablero propio…),
 *   con reintento corto y tiempo límite. Un webhook caído nunca detiene al vigía.
 * - Correo simulado: no envía nada; guarda el mensaje en un buzón visible en
 *   `GET /api/v1/avisos` y en el tablero. Reemplazarlo por SMTP es implementar `Notificador`.
 */
import type { Aviso } from '../../dominio/tipos.ts';
import type { Notificador } from '../puertos.ts';

export class BuzonAvisos {
  readonly #avisos: Aviso[] = [];
  readonly #maximo: number;

  constructor(maximo = 200) {
    this.#maximo = maximo;
  }

  agregar(a: Aviso): void {
    this.#avisos.unshift(a);
    this.#avisos.length = Math.min(this.#avisos.length, this.#maximo);
  }

  listar(limite = 50): Aviso[] {
    return this.#avisos.slice(0, limite);
  }
}

export class NotificadorCorreoSimulado implements Notificador {
  readonly canal = 'correo' as const;
  readonly #buzon: BuzonAvisos;
  readonly #destinatarios: readonly string[];

  constructor(buzon: BuzonAvisos, destinatarios: readonly string[]) {
    this.#buzon = buzon;
    this.#destinatarios = destinatarios;
  }

  get destinatarios(): readonly string[] {
    return this.#destinatarios;
  }

  async enviar(aviso: Aviso): Promise<void> {
    this.#buzon.agregar(aviso);
  }
}

export class ErrorWebhook extends Error {}

export interface OpcionesWebhook {
  url: string;
  intentos: number;
  timeoutMs: number;
  esperaEntreIntentosMs: number;
  buzon?: BuzonAvisos;
  fetch?: typeof fetch;
}

export class NotificadorWebhook implements Notificador {
  readonly canal = 'webhook' as const;
  readonly #op: OpcionesWebhook;
  readonly #fetch: typeof fetch;

  constructor(op: OpcionesWebhook) {
    this.#op = op;
    this.#fetch = op.fetch ?? fetch;
  }

  async enviar(aviso: Aviso): Promise<void> {
    let ultimo = '';
    for (let intento = 1; intento <= this.#op.intentos; intento++) {
      try {
        const r = await this.#fetch(this.#op.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texto: `${aviso.asunto}\n\n${aviso.cuerpo}`, ...aviso }),
          signal: AbortSignal.timeout(this.#op.timeoutMs),
        });
        if (r.ok) {
          this.#op.buzon?.agregar(aviso);
          return;
        }
        ultimo = `HTTP ${r.status}`;
        // Un 4xx no mejora reintentando (salvo 429).
        if (r.status < 500 && r.status !== 429) break;
      } catch (e) {
        ultimo = (e as Error).message;
      }
      if (intento < this.#op.intentos) await new Promise((ok) => setTimeout(ok, this.#op.esperaEntreIntentosMs * intento));
    }
    throw new ErrorWebhook(`El webhook rechazó el aviso «${aviso.asunto}»: ${ultimo}`);
  }
}
