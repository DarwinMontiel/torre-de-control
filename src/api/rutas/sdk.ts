/**
 * Rutas que usan los bots (ver sdk/python): latidos y eventos.
 *
 * El reloj que cuenta es el de la torre (`recibidoEn`), no el del bot: los servidores
 * Windows de un centro de datos rara vez están perfectamente sincronizados.
 */
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { saludBot } from '../../dominio/salud.ts';
import type { EventoBot as TEventoBot, Latido as TLatido } from '../../dominio/tipos.ts';
import { exigirToken, type AppTorre, type DependenciasApp } from '../app.ts';
import {
  ErrorRespuesta,
  EventoBot,
  EventoEntrada,
  Latido,
  LatidoEntrada,
  type TEventoEntrada,
  type TLatidoEntrada,
} from '../esquemas.ts';
import { ErrorConflicto } from '../puertos.ts';

const seguridad = [{ token: [] }];
const tags = ['SDK de bots'];

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Autodescubrimiento: si llega el latido de un bot que no está en el catálogo, se le da
 * de alta (y a su servidor, por hostname) para que nadie quede fuera del radar.
 */
export async function autoregistrar(deps: DependenciasApp, l: TLatidoEntrada): Promise<boolean> {
  if (await deps.catalogo.obtenerBot(l.botId)) return false;
  const servidorId = `srv-${slug(l.hostname) || 'desconocido'}`;
  const ignorarDuplicado = (e: unknown) => {
    if (!(e instanceof ErrorConflicto)) throw e;
  };
  if (!(await deps.catalogo.obtenerServidor(servidorId))) {
    await deps.catalogo
      .crearServidor({
        id: servidorId,
        nombre: l.hostname,
        sistema: /windows/i.test(l.plataforma) ? 'windows' : 'linux',
        ip: 'desconocida',
        ubicacion: '',
        descripcion: 'Registrado automáticamente por un latido.',
      })
      .catch(ignorarDuplicado);
  }
  await deps.catalogo
    .crearBot({
      id: l.botId,
      alias: l.botId,
      proceso: l.procesos[0] ?? 'sin_proceso',
      servidorId,
      descripcion: 'Registrado automáticamente por un latido.',
    })
    .catch(ignorarDuplicado);
  return true;
}

function aEvento(e: TEventoEntrada, ahora: string): TEventoBot {
  return {
    id: e.id ?? randomUUID(),
    botId: e.botId,
    tipo: e.tipo,
    mensaje: e.mensaje,
    tareaId: e.tareaId ?? null,
    ocurridoEn: e.ocurridoEn ? new Date(e.ocurridoEn).toISOString() : ahora,
  };
}

export function rutasSdk(app: AppTorre, deps: DependenciasApp): void {
  const bots = exigirToken(deps, 'bots');

  app.post(
    '/latidos',
    {
      preHandler: bots,
      schema: {
        tags,
        summary: 'Reportar un latido',
        description:
          'El bot lo envía cada pocos segundos y en cada cambio de estado. Si el bot no está catalogado y el autorregistro está activo, se da de alta.',
        security: seguridad,
        body: LatidoEntrada,
        response: {
          202: Type.Object({ recibidoEn: Type.String(), ttlLatidoSeg: Type.Integer(), registradoAhora: Type.Boolean() }),
          401: ErrorRespuesta,
          404: ErrorRespuesta,
        },
      },
    },
    async (req, reply) => {
      const recibidoEn = deps.reloj.ahora();
      let registradoAhora = false;
      if (deps.config.autoregistro) {
        registradoAhora = await autoregistrar(deps, req.body);
      } else if (!(await deps.catalogo.obtenerBot(req.body.botId))) {
        return reply.code(404).send({
          error: 'no_encontrado',
          mensaje: `El bot ${req.body.botId} no está en el catálogo y el autorregistro está desactivado.`,
        });
      }
      const latido: TLatido = { ...req.body, iniciadoEn: new Date(req.body.iniciadoEn).toISOString(), recibidoEn };
      await deps.estado.registrarLatido(latido);
      if (registradoAhora) req.log.info({ bot: latido.botId, host: latido.hostname }, 'Bot nuevo registrado por su latido');
      return reply.code(202).send({ recibidoEn, ttlLatidoSeg: deps.config.ttlLatidoSeg, registradoAhora });
    },
  );

  app.get(
    '/bots/:id/latido',
    {
      schema: {
        tags,
        summary: 'Último latido de un bot',
        params: Type.Object({ id: Type.String() }),
        response: {
          200: Type.Object({ salud: Type.String(), latido: Latido }),
          404: ErrorRespuesta,
        },
      },
    },
    async (req, reply) => {
      const latido = (await deps.estado.ultimosLatidos()).get(req.params.id);
      if (!latido) return reply.code(404).send({ error: 'no_encontrado', mensaje: `No hay latidos del bot ${req.params.id}.` });
      return { salud: saludBot(latido, deps.reloj.ahora(), deps.config.ttlLatidoSeg), latido };
    },
  );

  const registrar = async (entradas: readonly TEventoEntrada[]) => {
    const ahora = deps.reloj.ahora();
    const eventos = entradas.map((e) => aEvento(e, ahora));
    await deps.eventos.registrar(eventos);
    for (const e of eventos) await deps.estado.publicar({ tipo: 'evento_bot', datos: e });
    return eventos;
  };

  app.post(
    '/eventos',
    {
      preHandler: bots,
      schema: {
        tags,
        summary: 'Reportar un evento',
        description: 'Tarea terminada, fallida, reintento, inicio, parada… Si el bot envía `id`, el reenvío es idempotente.',
        security: seguridad,
        body: EventoEntrada,
        response: { 202: EventoBot, 401: ErrorRespuesta },
      },
    },
    async (req, reply) => {
      const [evento] = await registrar([req.body]);
      if (!evento) throw new Error('No se registró el evento.');
      return reply.code(202).send(evento);
    },
  );

  app.post(
    '/eventos/lote',
    {
      preHandler: bots,
      schema: {
        tags,
        summary: 'Reportar varios eventos',
        description: 'Hasta 100 eventos en una sola llamada (el SDK los agrupa cuando la red está lenta).',
        security: seguridad,
        body: Type.Object(
          { eventos: Type.Array(EventoEntrada, { minItems: 1, maxItems: 100 }) },
          { additionalProperties: false },
        ),
        response: { 202: Type.Object({ registrados: Type.Integer() }), 401: ErrorRespuesta },
      },
    },
    async (req, reply) => reply.code(202).send({ registrados: (await registrar(req.body.eventos)).length }),
  );

  app.get(
    '/eventos',
    {
      schema: {
        tags,
        summary: 'Bitácora de eventos',
        querystring: Type.Object({
          botId: Type.Optional(Type.String({ maxLength: 64 })),
          limite: Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
        }),
        response: { 200: Type.Array(EventoBot) },
      },
    },
    async (req) => deps.eventos.recientes({ botId: req.query.botId, limite: req.query.limite }),
  );
}
