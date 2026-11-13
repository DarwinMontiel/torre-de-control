/** Consulta y reconocimiento de alertas. */
import { Type } from 'typebox';
import { reconocer } from '../../dominio/alertas.ts';
import type { AppTorre, DependenciasApp } from '../app.ts';
import { Alerta, CodigoRegla, ErrorRespuesta, EstadoAlerta } from '../esquemas.ts';

const tags = ['Alertas'];

export function rutasAlertas(app: AppTorre, deps: DependenciasApp): void {
  app.get(
    '/alertas',
    {
      schema: {
        tags,
        summary: 'Listar alertas',
        description: 'Más recientes primero. Filtra por estado, regla u objetivo (cola, bot o servidor).',
        querystring: Type.Object({
          estado: Type.Optional(EstadoAlerta),
          regla: Type.Optional(CodigoRegla),
          objetivo: Type.Optional(Type.String({ maxLength: 200 })),
          limite: Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
        }),
        response: { 200: Type.Array(Alerta), 400: ErrorRespuesta },
      },
    },
    async (req) => deps.incidentes.listar(req.query),
  );

  app.get(
    '/alertas/:id',
    {
      schema: {
        tags,
        summary: 'Obtener una alerta',
        params: Type.Object({ id: Type.String() }),
        response: { 200: Alerta, 404: ErrorRespuesta },
      },
    },
    async (req, reply) =>
      (await deps.incidentes.obtener(req.params.id)) ??
      reply.code(404).send({ error: 'no_encontrado', mensaje: `No existe la alerta ${req.params.id}.` }),
  );

  app.post(
    '/alertas/:id/reconocer',
    {
      schema: {
        tags,
        summary: 'Reconocer una alerta',
        description:
          'Indica que alguien ya la está atendiendo. La alerta sigue vigente hasta que la condición desaparezca; solo se reconocen alertas activas (409 si no).',
        params: Type.Object({ id: Type.String() }),
        body: Type.Object(
          { operador: Type.String({ minLength: 2, maxLength: 80, description: 'Quién la atiende', examples: ['Rebeca'] }) },
          { additionalProperties: false },
        ),
        response: { 200: Alerta, 400: ErrorRespuesta, 404: ErrorRespuesta, 409: ErrorRespuesta },
      },
    },
    async (req, reply) => {
      const alerta = await deps.incidentes.obtener(req.params.id);
      if (!alerta) return reply.code(404).send({ error: 'no_encontrado', mensaje: `No existe la alerta ${req.params.id}.` });
      const reconocida = reconocer(alerta, req.body.operador, deps.reloj.ahora());
      await deps.incidentes.guardar([reconocida]);
      await deps.estado.publicar({ tipo: 'alerta', motivo: 'reconocida', datos: reconocida });
      return reconocida;
    },
  );
}
