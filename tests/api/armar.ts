/** Arma la API y el vigía con adaptadores en memoria y un reloj controlable. */
import {
  CatalogoEnMemoria,
  EstadoVivoEnMemoria,
  EventosEnMemoria,
  IncidentesEnMemoria,
} from '../../src/api/adaptadores/memoria.ts';
import { BuzonAvisos, NotificadorCorreoSimulado } from '../../src/api/adaptadores/notificadores.ts';
import { construirApp, type AppTorre, type DependenciasApp } from '../../src/api/app.ts';
import type { FuenteColas, Notificador } from '../../src/api/puertos.ts';
import { Vigia, type Bitacora, type ConfigVigia } from '../../src/api/vigia.ts';
import type { Catalogo, MetricaCola } from '../../src/dominio/tipos.ts';
import { catalogoPequeno, T0 } from '../ayudantes.ts';

export class RelojFalso {
  #ms = Date.parse(T0);
  ahora = (): string => new Date(this.#ms).toISOString();
  avanzar(segundos: number): void {
    this.#ms += segundos * 1000;
  }
}

export class FuenteFalsa implements FuenteColas {
  readonly descripcion = 'fuente de prueba';
  metricas: MetricaCola[] = [];
  error: Error | null = null;
  async leer(): Promise<MetricaCola[]> {
    if (this.error) throw this.error;
    return this.metricas;
  }
}

export const bitacoraMuda = (): Bitacora & { mensajes: string[] } => {
  const mensajes: string[] = [];
  const guardar = (_o: object, m: string) => void mensajes.push(m);
  return { mensajes, info: guardar, warn: guardar, error: guardar };
};

export interface Banco {
  deps: DependenciasApp;
  reloj: RelojFalso;
  fuente: FuenteFalsa;
  estado: EstadoVivoEnMemoria;
  vigia: Vigia;
  buzon: BuzonAvisos;
  log: ReturnType<typeof bitacoraMuda>;
}

export const CONFIG_VIGIA: ConfigVigia = {
  nodo: 'nodo-prueba',
  intervaloMs: 1000,
  ttlLatidoSeg: 45,
  ventanaTendenciaMin: 10,
  coberturaMinimaMin: 3,
  reglasDesactivadas: [],
};

export function armarBanco(
  op: {
    catalogo?: Catalogo;
    tokens?: { bots?: string; admin?: string };
    autoregistro?: boolean;
    notificadores?: Notificador[];
  } = {},
): Banco {
  const reloj = new RelojFalso();
  const estado = new EstadoVivoEnMemoria(() => Date.parse(reloj.ahora()));
  const buzon = new BuzonAvisos();
  const fuente = new FuenteFalsa();
  const log = bitacoraMuda();
  const repos = {
    catalogo: new CatalogoEnMemoria(op.catalogo ?? catalogoPequeno()),
    incidentes: new IncidentesEnMemoria(),
    eventos: new EventosEnMemoria(),
  };
  let n = 0;
  const vigia = new Vigia(
    {
      ...repos,
      estado,
      fuente,
      notificadores: op.notificadores ?? [new NotificadorCorreoSimulado(buzon, ['turno@macondo.example'])],
      reloj,
      log,
      nuevoId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    },
    CONFIG_VIGIA,
  );
  const deps: DependenciasApp = {
    ...repos,
    estado,
    buzon,
    reloj,
    estadoFuente: () => vigia.estadoFuente,
    config: {
      tokenBots: op.tokens?.bots ?? null,
      tokenAdmin: op.tokens?.admin ?? null,
      ttlLatidoSeg: 45,
      autoregistro: op.autoregistro ?? true,
    },
  };
  return { deps, reloj, fuente, estado, vigia, buzon, log };
}

export async function armarApp(banco: Banco): Promise<AppTorre> {
  const app = await construirApp(banco.deps, { logger: false });
  await app.ready();
  return app;
}
