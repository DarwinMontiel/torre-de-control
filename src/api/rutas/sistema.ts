/** Rutas de sistema y de estado agregado. */
import { Type } from 'typebox';
import type { Instantanea as TInstantanea } from '../../dominio/instantanea.ts';
import { DESCRIPCION_REGLAS } from '../../dominio/reglas.ts';
import { VERSION, type AppTorre, type DependenciasApp } from '../app.ts';
import { Aviso, CodigoRegla, ErrorRespuesta, Instantanea, Resumen } from '../esquemas.ts';

const SinInstantanea = {
  error: 'sin_datos',
  mensaje: 'El vigía aún no ha completado su primer ciclo. Intenta en unos segundos.',
};

export function metricasPrometheus(i: TInstantanea | null, version: string): string {
  const l: string[] = [
    '# HELP torre_info Versión de la Torre de Control.',
    '# TYPE torre_info gauge',
    `torre_info{version="${version}"} 1`,
  ];
  if (!i) return `${l.join('\n')}\n`;
  const esc = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  l.push('# HELP torre_bot_en_linea 1 si el bot tiene latido vigente.', '# TYPE torre_bot_en_linea gauge');
  for (const b of i.bots)
    l.push(`torre_bot_en_linea{bot="${esc(b.id)}",proceso="${esc(b.proceso)}"} ${b.salud === 'en_linea' ? 1 : 0}`);
  l.push('# HELP torre_cola_mensajes Mensajes en la cola.', '# TYPE torre_cola_mensajes gauge');
  for (const c of i.colas) l.push(`torre_cola_mensajes{cola="${esc(c.nombre)}",tipo="${c.tipo}"} ${c.mensajes}`);
  l.push('# HELP torre_cola_consumidores Consumidores conectados.', '# TYPE torre_cola_consumidores gauge');
  for (const c of i.colas) l.push(`torre_cola_consumidores{cola="${esc(c.nombre)}"} ${c.consumidores}`);
  l.push('# HELP torre_alertas_activas Alertas activas por severidad.', '# TYPE torre_alertas_activas gauge');
  l.push(`torre_alertas_activas{severidad="critica"} ${i.resumen.alertas.criticas}`);
  l.push(`torre_alertas_activas{severidad="advertencia"} ${i.resumen.alertas.advertencias}`);
  return `${l.join('\n')}\n`;
}

export function rutasSistema(app: AppTorre, deps: DependenciasApp): void {
  app.get(
    '/salud',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Vida del proceso',
        description: 'Responde 200 mientras el proceso esté arriba. Úsalo como liveness probe.',
        response: { 200: Type.Object({ estado: Type.Literal('ok'), version: Type.String() }) },
      },
    },
    async () => ({ estado: 'ok' as const, version: VERSION }),
  );

  app.get(
    '/salud/lista',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Preparación de dependencias',
        description:
          'Verifica PostgreSQL y Redis (503 si alguno falla; readiness probe) e informa el estado de la fuente de colas.',
        response: {
          200: Type.Object({ lista: Type.Boolean(), componentes: Type.Record(Type.String(), Type.String()) }),
          503: Type.Object({ lista: Type.Boolean(), componentes: Type.Record(Type.String(), Type.String()) }),
        },
      },
    },
    async (_req, reply) => {
      const componentes: Record<string, string> = {};
      try {
        await deps.catalogo.listarServidores();
        componentes['catalogo'] = 'ok';
      } catch (e) {
        componentes['catalogo'] = `falla: ${(e as Error).message}`;
      }
      componentes['estado_vivo'] = (await deps.estado.ping()) ? 'ok' : 'falla: sin respuesta';
      const fuente = deps.estadoFuente();
      componentes['fuente_colas'] = !fuente
        ? 'sin vigía en esta réplica'
        : fuente.ok
          ? 'ok'
          : `falla: ${fuente.error ?? 'aún sin lectura'}`;
      // Sin RabbitMQ la torre sigue sirviendo el último dato (marcado): eso es degradación,
      // no motivo para sacarla del balanceador. Sin base de datos o Redis, sí lo es.
      const lista = componentes['catalogo'] === 'ok' && componentes['estado_vivo'] === 'ok';
      return reply.code(lista ? 200 : 503).send({ lista, componentes });
    },
  );

  app.get(
    '/metrics',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Métricas para Prometheus',
        description: 'Formato de exposición de texto de Prometheus, calculado desde la última instantánea.',
        produces: ['text/plain'],
      },
    },
    async (_req, reply) => {
      const i = await deps.estado.ultimaInstantanea();
      return reply.type('text/plain; version=0.0.4').send(metricasPrometheus(i, VERSION));
    },
  );

  app.get(
    '/instantanea',
    {
      schema: {
        tags: ['Estado'],
        summary: 'Foto completa de la operación',
        description:
          'Lo mismo que empuja el WebSocket en cada ciclo del vigía: resumen, colas, bots, servidores, alertas y eventos.',
        response: { 200: Instantanea, 503: ErrorRespuesta },
      },
    },
    async (_req, reply) => {
      const i = await deps.estado.ultimaInstantanea();
      return i ? i : reply.code(503).send(SinInstantanea);
    },
  );

  app.get(
    '/resumen',
    {
      schema: {
        tags: ['Estado'],
        summary: 'Indicadores principales',
        response: { 200: Resumen, 503: ErrorRespuesta },
      },
    },
    async (_req, reply) => {
      const i = await deps.estado.ultimaInstantanea();
      return i ? i.resumen : reply.code(503).send(SinInstantanea);
    },
  );

  app.get(
    '/reglas',
    {
      schema: {
        tags: ['Alertas'],
        summary: 'Reglas de alerta disponibles',
        response: {
          200: Type.Array(Type.Object({ codigo: CodigoRegla, nombre: Type.String(), descripcion: Type.String() })),
        },
      },
    },
    async () => [...DESCRIPCION_REGLAS],
  );

  app.get(
    '/avisos',
    {
      schema: {
        tags: ['Alertas'],
        summary: 'Avisos enviados',
        description: 'Últimos avisos por webhook y correo (el correo es simulado: este es su buzón).',
        querystring: Type.Object({ limite: Type.Integer({ minimum: 1, maximum: 200, default: 50 }) }),
        response: { 200: Type.Array(Aviso) },
      },
    },
    async (req) => deps.buzon.listar(req.query.limite),
  );
}
