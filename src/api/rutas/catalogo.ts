/** CRUD del catálogo: servidores, bots y colas. Las escrituras exigen el token de administración. */
import { Type, type TSchema } from 'typebox';
import { exigirToken, type AppTorre, type DependenciasApp } from '../app.ts';
import { Bot, CambiosBot, CambiosCola, CambiosServidor, Cola, ErrorRespuesta, Servidor } from '../esquemas.ts';

const seguridad = [{ token: [] }];
const NoEncontrado = (que: string) => ({ error: 'no_encontrado', mensaje: `${que} no existe en el catálogo.` });

function respuestas(ok: TSchema, codigo = 200) {
  return {
    [codigo]: ok,
    400: ErrorRespuesta,
    401: ErrorRespuesta,
    404: ErrorRespuesta,
    409: ErrorRespuesta,
    422: ErrorRespuesta,
  };
}

export function rutasCatalogo(app: AppTorre, deps: DependenciasApp): void {
  const admin = exigirToken(deps, 'admin');
  const tags = ['Catálogo'];
  const ParamId = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
  const ParamNombre = Type.Object({ nombre: Type.String({ minLength: 1, maxLength: 200 }) });

  // --- Servidores ---------------------------------------------------------
  app.get('/servidores', { schema: { tags, summary: 'Listar servidores', response: { 200: Type.Array(Servidor) } } }, () =>
    deps.catalogo.listarServidores(),
  );
  app.get(
    '/servidores/:id',
    { schema: { tags, summary: 'Obtener un servidor', params: ParamId, response: { 200: Servidor, 404: ErrorRespuesta } } },
    async (req, reply) =>
      (await deps.catalogo.obtenerServidor(req.params.id)) ?? reply.code(404).send(NoEncontrado(`El servidor ${req.params.id}`)),
  );
  app.post(
    '/servidores',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Registrar un servidor',
        security: seguridad,
        body: Servidor,
        response: respuestas(Servidor, 201),
      },
    },
    async (req, reply) => reply.code(201).send(await deps.catalogo.crearServidor(req.body)),
  );
  app.patch(
    '/servidores/:id',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Modificar un servidor',
        security: seguridad,
        params: ParamId,
        body: CambiosServidor,
        response: respuestas(Servidor),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.actualizarServidor(req.params.id, req.body)) ??
      reply.code(404).send(NoEncontrado(`El servidor ${req.params.id}`)),
  );
  app.delete(
    '/servidores/:id',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Eliminar un servidor',
        description: 'Falla con 409 si aún tiene bots asignados.',
        security: seguridad,
        params: ParamId,
        response: respuestas(Type.Null(), 204),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.eliminarServidor(req.params.id))
        ? reply.code(204).send()
        : reply.code(404).send(NoEncontrado(`El servidor ${req.params.id}`)),
  );

  // --- Bots ---------------------------------------------------------------
  app.get('/bots', { schema: { tags, summary: 'Listar bots', response: { 200: Type.Array(Bot) } } }, () =>
    deps.catalogo.listarBots(),
  );
  app.get(
    '/bots/:id',
    { schema: { tags, summary: 'Obtener un bot', params: ParamId, response: { 200: Bot, 404: ErrorRespuesta } } },
    async (req, reply) =>
      (await deps.catalogo.obtenerBot(req.params.id)) ?? reply.code(404).send(NoEncontrado(`El bot ${req.params.id}`)),
  );
  app.post(
    '/bots',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Registrar un bot',
        description: 'El servidor debe existir (422 si no).',
        security: seguridad,
        body: Bot,
        response: respuestas(Bot, 201),
      },
    },
    async (req, reply) => reply.code(201).send(await deps.catalogo.crearBot(req.body)),
  );
  app.patch(
    '/bots/:id',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Modificar un bot',
        security: seguridad,
        params: ParamId,
        body: CambiosBot,
        response: respuestas(Bot),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.actualizarBot(req.params.id, req.body)) ??
      reply.code(404).send(NoEncontrado(`El bot ${req.params.id}`)),
  );
  app.delete(
    '/bots/:id',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Dar de baja un bot',
        security: seguridad,
        params: ParamId,
        response: respuestas(Type.Null(), 204),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.eliminarBot(req.params.id))
        ? reply.code(204).send()
        : reply.code(404).send(NoEncontrado(`El bot ${req.params.id}`)),
  );

  // --- Colas --------------------------------------------------------------
  app.get('/colas', { schema: { tags, summary: 'Listar colas catalogadas', response: { 200: Type.Array(Cola) } } }, () =>
    deps.catalogo.listarColas(),
  );
  app.get(
    '/colas/:nombre',
    { schema: { tags, summary: 'Obtener una cola', params: ParamNombre, response: { 200: Cola, 404: ErrorRespuesta } } },
    async (req, reply) =>
      (await deps.catalogo.obtenerCola(req.params.nombre)) ?? reply.code(404).send(NoEncontrado(`La cola ${req.params.nombre}`)),
  );
  app.post(
    '/colas',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Catalogar una cola con sus umbrales',
        security: seguridad,
        body: Cola,
        response: respuestas(Cola, 201),
      },
    },
    async (req, reply) => reply.code(201).send(await deps.catalogo.crearCola(req.body)),
  );
  app.patch(
    '/colas/:nombre',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Ajustar umbrales de una cola',
        security: seguridad,
        params: ParamNombre,
        body: CambiosCola,
        response: respuestas(Cola),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.actualizarCola(req.params.nombre, req.body)) ??
      reply.code(404).send(NoEncontrado(`La cola ${req.params.nombre}`)),
  );
  app.delete(
    '/colas/:nombre',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Quitar una cola del catálogo',
        security: seguridad,
        params: ParamNombre,
        response: respuestas(Type.Null(), 204),
      },
    },
    async (req, reply) =>
      (await deps.catalogo.eliminarCola(req.params.nombre))
        ? reply.code(204).send()
        : reply.code(404).send(NoEncontrado(`La cola ${req.params.nombre}`)),
  );
}
