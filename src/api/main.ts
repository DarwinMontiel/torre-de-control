/**
 * Punto de entrada: arma las dependencias según la configuración, arranca la API y el
 * vigía, y se apaga de forma ordenada con SIGTERM/SIGINT.
 *
 *   node src/api/main.ts         (Node 24 ejecuta TypeScript de forma nativa, ADR-0001)
 */
import { Redis } from 'ioredis';
import pg from 'pg';
import { simuladorMacondo } from '../dominio/simulador.ts';
import { CatalogoEnMemoria, EstadoVivoEnMemoria, EventosEnMemoria, IncidentesEnMemoria } from './adaptadores/memoria.ts';
import { BuzonAvisos, NotificadorCorreoSimulado, NotificadorWebhook } from './adaptadores/notificadores.ts';
import { leerMigraciones, migrar } from './adaptadores/postgres/migrador.ts';
import { CatalogoPg, EventosPg, IncidentesPg } from './adaptadores/postgres/repositorios.ts';
import { FuenteColasManagement, FuenteColasSimulada, inyectorDeSimulacion } from './adaptadores/rabbitmq.ts';
import { EstadoVivoRedis } from './adaptadores/redis.ts';
import { construirApp } from './app.ts';
import { leerConfig, type Config } from './config.ts';
import {
  relojDelSistema,
  type EstadoVivo,
  type FuenteColas,
  type Notificador,
  type RepositorioCatalogo,
  type RepositorioEventos,
} from './puertos.ts';
import { sembrarMacondo } from './semilla.ts';
import { Vigia } from './vigia.ts';

function crearFuente(config: Config, estado: EstadoVivo, eventos: RepositorioEventos): FuenteColas {
  if (config.fuenteColas === 'rabbitmq') return new FuenteColasManagement({ ...config.rabbit, timeoutMs: 4000 });
  // Modo demo: el simulador también hace las veces de bots que laten y reportan eventos.
  return new FuenteColasSimulada({
    crear: () => simuladorMacondo({ inicio: new Date().toISOString() }),
    aceleracion: config.aceleracionSimulador,
    alAvanzar: inyectorDeSimulacion({
      registrarLatido: (l) => estado.registrarLatido(l),
      registrarEventos: async (e) => {
        await eventos.registrar(e);
        for (const x of e) await estado.publicar({ tipo: 'evento_bot', datos: x });
      },
      ahora: () => relojDelSistema.ahora(),
    }),
  });
}

async function principal(): Promise<void> {
  const config = leerConfig();
  const cierres: (() => Promise<unknown>)[] = [];

  let repos: {
    catalogo: RepositorioCatalogo;
    incidentes: IncidentesPg | IncidentesEnMemoria;
    eventos: EventosPg | EventosEnMemoria;
  };
  if (config.almacen === 'postgres') {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    cierres.push(() => pool.end());
    await migrar(pool, await leerMigraciones(), (m) => console.info(m));
    repos = { catalogo: new CatalogoPg(pool), incidentes: new IncidentesPg(pool), eventos: new EventosPg(pool) };
  } else {
    repos = { catalogo: new CatalogoEnMemoria(), incidentes: new IncidentesEnMemoria(), eventos: new EventosEnMemoria() };
  }

  let estado: EstadoVivo;
  if (config.redisUrl) {
    const url = config.redisUrl;
    const cliente = new Redis(url, { maxRetriesPerRequest: 3 });
    cierres.push(async () => cliente.quit());
    estado = new EstadoVivoRedis({
      cliente,
      crearSuscriptor: () => new Redis(url),
      retencionLatidoSeg: config.retencionLatidoSeg,
    });
  } else {
    estado = new EstadoVivoEnMemoria();
  }

  const buzon = new BuzonAvisos();
  const notificadores: Notificador[] = [new NotificadorCorreoSimulado(buzon, config.correoDestinatarios)];
  if (config.webhookUrl) {
    notificadores.push(
      new NotificadorWebhook({ url: config.webhookUrl, intentos: 3, timeoutMs: 3000, esperaEntreIntentosMs: 500, buzon }),
    );
  }

  const fuente = crearFuente(config, estado, repos.eventos);
  const app = await construirApp(
    {
      ...repos,
      estado,
      buzon,
      reloj: relojDelSistema,
      estadoFuente: () => vigia.estadoFuente,
      config: {
        tokenBots: config.tokenBots,
        tokenAdmin: config.tokenAdmin,
        ttlLatidoSeg: config.ttlLatidoSeg,
        autoregistro: config.autoregistro,
      },
    },
    { logger: { level: config.nivelLog }, trustProxy: true },
  );
  const vigia = new Vigia(
    { ...repos, estado, fuente, notificadores, reloj: relojDelSistema, log: app.log },
    {
      nodo: config.nodo,
      intervaloMs: config.intervaloVigiaMs,
      ttlLatidoSeg: config.ttlLatidoSeg,
      ventanaTendenciaMin: config.ventanaTendenciaMin,
      coberturaMinimaMin: config.coberturaMinimaMin,
      reglasDesactivadas: config.reglasDesactivadas,
    },
  );

  if (config.sembrarMacondo && (await sembrarMacondo(repos.catalogo)))
    app.log.info('Catálogo vacío: se sembró el catálogo ficticio de Cobranzas Macondo.');
  if (!config.tokenAdmin && !config.tokenBots)
    app.log.warn('Sin TORRE_TOKEN_ADMIN ni TORRE_TOKEN_BOTS: las escrituras quedan abiertas (solo para desarrollo).');

  await app.listen({ port: config.puerto, host: config.host });
  app.log.info({ fuente: fuente.descripcion, nodo: config.nodo }, 'Torre de Control en servicio');
  vigia.iniciar();

  let apagando = false;
  const apagar = async (senal: string) => {
    if (apagando) return;
    apagando = true;
    app.log.info({ senal }, 'Apagado ordenado: se detiene el vigía y se cierran conexiones');
    await vigia.detener();
    await app.close();
    for (const cerrar of cierres.reverse()) await cerrar().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

principal().catch((e: unknown) => {
  console.error(`La Torre de Control no pudo arrancar: ${(e as Error).message}`);
  process.exit(1);
});
