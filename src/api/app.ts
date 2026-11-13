/**
 * Construcción de la aplicación Fastify. Recibe todas sus dependencias ya creadas
 * (inyección de dependencias), así las pruebas arman la API con adaptadores en memoria
 * y `main.ts` la arma con PostgreSQL, Redis y RabbitMQ.
 */
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import { ErrorTransicion } from '../dominio/alertas.ts';
import type { BuzonAvisos } from './adaptadores/notificadores.ts';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorValidacion,
  type EstadoVivo,
  type Reloj,
  type RepositorioCatalogo,
  type RepositorioEventos,
  type RepositorioIncidentes,
} from './puertos.ts';
import { rutasAlertas } from './rutas/alertas.ts';
import { rutasCatalogo } from './rutas/catalogo.ts';
import { rutasSdk } from './rutas/sdk.ts';
import { rutasSistema } from './rutas/sistema.ts';
import { rutasTiempoReal } from './rutas/tiempo-real.ts';
import type { EstadoFuente } from './vigia.ts';

export const VERSION = '1.0.0';

/** Traduce al español los mensajes de validación de Ajv (paquete CommonJS sin tipos ESM). */
const localizarEs = createRequire(import.meta.url)('ajv-i18n/localize/es') as (errores: unknown[]) => void;

export interface DependenciasApp {
  catalogo: RepositorioCatalogo;
  incidentes: RepositorioIncidentes;
  eventos: RepositorioEventos;
  estado: EstadoVivo;
  buzon: BuzonAvisos;
  reloj: Reloj;
  /** Estado de la lectura de colas del vigía (para /salud/lista). */
  estadoFuente: () => EstadoFuente | null;
  config: {
    tokenBots: string | null;
    tokenAdmin: string | null;
    ttlLatidoSeg: number;
    autoregistro: boolean;
  };
}

export type AppTorre = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export type Rol = 'bots' | 'admin';

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** preHandler que exige `Authorization: Bearer <token>` del rol indicado (el de admin sirve para todo). */
export function exigirToken(deps: DependenciasApp, rol: Rol) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const esperados = [deps.config.tokenAdmin, rol === 'bots' ? deps.config.tokenBots : null].filter(
      (t): t is string => t !== null,
    );
    if (esperados.length === 0) return; // sin tokens configurados: modo desarrollo
    const recibido = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!esperados.some((t) => iguales(t, recibido))) {
      return reply.code(401).send({ error: 'no_autorizado', mensaje: 'Falta el token o no es válido para esta operación.' });
    }
  };
}

export async function construirApp(deps: DependenciasApp, opciones: FastifyServerOptions = {}): Promise<AppTorre> {
  const app = Fastify({
    ...opciones,
    ajv: { customOptions: { allErrors: true, coerceTypes: 'array', useDefaults: true, removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error.validation) {
      localizarEs(error.validation);
      const detalle = error.validation
        .map((v) => `${v.instancePath || error.validationContext || 'solicitud'} ${v.message ?? ''}`.trim())
        .join('; ');
      return reply.code(400).send({ error: 'solicitud_invalida', mensaje: `La solicitud no es válida: ${detalle}.` });
    }
    if (error instanceof ErrorConflicto || error instanceof ErrorTransicion) {
      return reply.code(409).send({ error: 'conflicto', mensaje: error.message });
    }
    if (error instanceof ErrorNoEncontrado) return reply.code(404).send({ error: 'no_encontrado', mensaje: error.message });
    if (error instanceof ErrorValidacion) return reply.code(422).send({ error: 'no_procesable', mensaje: error.message });
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'solicitud_invalida', mensaje: error.message });
    }
    reply.log.error({ err: error }, 'Error no controlado');
    return reply.code(500).send({ error: 'interno', mensaje: 'Error interno de la torre. Revisa los logs.' });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: 'no_encontrado', mensaje: `No existe la ruta ${req.method} ${req.url}.` }),
  );

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Torre de Control · API',
        version: VERSION,
        description:
          'Monitoreo en tiempo real de bots RPA: catálogo de servidores, bots y colas; latidos y eventos que reportan los bots; alertas y difusión por WebSocket.',
      },
      tags: [
        { name: 'Sistema', description: 'Salud de la torre y métricas para Prometheus' },
        { name: 'Estado', description: 'Foto en vivo de la operación' },
        { name: 'Catálogo', description: 'Servidores, bots y colas (requiere token de administración)' },
        { name: 'SDK de bots', description: 'Latidos y eventos que envían los bots (requiere token de bots)' },
        { name: 'Alertas', description: 'Incidentes abiertos por las reglas y su reconocimiento' },
      ],
      components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });
  await app.register(websocket);

  await app.register(
    async (v1) => {
      const api = v1 as unknown as AppTorre;
      rutasSistema(api, deps);
      rutasCatalogo(api, deps);
      rutasSdk(api, deps);
      rutasAlertas(api, deps);
      await rutasTiempoReal(api, deps);
    },
    { prefix: '/api/v1' },
  );

  app.get('/', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/docs'));
  return app;
}
