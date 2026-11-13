/**
 * Esquemas JSON (TypeBox) de la API. Validan la entrada, serializan la salida y
 * alimentan la documentación OpenAPI en /docs. Los tipos TypeScript del dominio y estos
 * esquemas se verifican entre sí en `tests/api/esquemas.test.ts`.
 */
import { Type, type Static, type TSchema } from 'typebox';
import { CODIGOS_REGLA, ESTADOS_ALERTA, ESTADOS_BOT, SEVERIDADES, SISTEMAS, TIPOS_COLA, TIPOS_EVENTO } from '../dominio/tipos.ts';

const literales = <const T extends string[]>(valores: readonly [...T], descripcion: string) =>
  Type.Enum(valores, { description: descripcion });

const Identificador = (descripcion: string, ejemplo: string) =>
  Type.String({ minLength: 2, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_.-]*$', description: descripcion, examples: [ejemplo] });
const Fecha = (descripcion: string) => Type.String({ format: 'date-time', description: descripcion });
const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);

/**
 * Esquema de PATCH: copia sin valores por defecto (si no, Ajv rellenaría con '' los
 * campos omitidos y un PATCH borraría datos), sin campos extra y con al menos un campo.
 */
function cambios<T extends TSchema>(esquema: T): T {
  const copia = structuredClone(esquema) as T & { properties: Record<string, Record<string, unknown>> };
  for (const p of Object.values(copia.properties)) delete p['default'];
  return Object.assign(copia, { additionalProperties: false, minProperties: 1 });
}

export const Sistema = literales(SISTEMAS, 'Sistema operativo del servidor');
export const EstadoBot = literales(ESTADOS_BOT, 'Estado reportado por el bot (mismos valores que colmena-rpa)');
export const TipoCola = literales(TIPOS_COLA, 'Tipo de cola según la convención de colmena-rpa');
export const Severidad = literales(SEVERIDADES, 'Severidad de la alerta');
export const EstadoAlerta = literales(ESTADOS_ALERTA, 'Estado de la alerta');
export const CodigoRegla = literales(CODIGOS_REGLA, 'Regla que originó la alerta');
export const TipoEvento = literales(TIPOS_EVENTO, 'Tipo de evento del bot');

export const ErrorRespuesta = Type.Object(
  {
    error: Type.String({ description: 'Código corto del error', examples: ['no_encontrado'] }),
    mensaje: Type.String({ description: 'Explicación para humanos, en español' }),
  },
  { title: 'ErrorRespuesta', description: 'Respuesta de error' },
);

// --- Catálogo --------------------------------------------------------------

export const Servidor = Type.Object(
  {
    id: Identificador('Identificador estable del servidor', 'srv-magdalena-01'),
    nombre: Type.String({ minLength: 1, maxLength: 80, examples: ['MAGDALENA-01'] }),
    sistema: Sistema,
    ip: Type.String({ minLength: 3, maxLength: 64, examples: ['10.20.0.11'] }),
    ubicacion: Type.String({ maxLength: 200, default: '' }),
    descripcion: Type.String({ maxLength: 500, default: '' }),
  },
  { title: 'Servidor', additionalProperties: false },
);
export const CambiosServidor = cambios(Type.Partial(Type.Omit(Servidor, ['id'])));

export const Bot = Type.Object(
  {
    id: Identificador('Identificador estable del bot (el mismo `worker_id` que usa en sus latidos)', 'bot-acuerdos-01'),
    alias: Type.String({ minLength: 1, maxLength: 60, description: 'Nombre memorable para operación', examples: ['Úrsula'] }),
    proceso: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_]*$', examples: ['payment_agreement'] }),
    servidorId: Identificador('Servidor donde corre', 'srv-magdalena-01'),
    descripcion: Type.String({ maxLength: 500, default: '' }),
  },
  { title: 'Bot', additionalProperties: false },
);
export const CambiosBot = cambios(Type.Partial(Type.Omit(Bot, ['id'])));

export const Cola = Type.Object(
  {
    nombre: Type.String({ minLength: 3, maxLength: 200, examples: ['rpa.payment_agreement'] }),
    proceso: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_]*$' }),
    tipo: TipoCola,
    umbralMensajes: Type.Integer({ minimum: 0, description: 'Mensajes a partir de los cuales la cola está saturada' }),
    umbralCrecimientoPorMin: Type.Number({ minimum: 0, description: 'Crecimiento sostenido (msg/min) que dispara la alerta' }),
  },
  { title: 'Cola', additionalProperties: false },
);
export const CambiosCola = cambios(Type.Partial(Type.Omit(Cola, ['nombre'])));

// --- SDK: latidos y eventos -------------------------------------------------

export const LatidoEntrada = Type.Object(
  {
    botId: Identificador('Identificador del bot', 'bot-acuerdos-01'),
    hostname: Type.String({ minLength: 1, maxLength: 120 }),
    plataforma: Type.String({ maxLength: 120, default: '' }),
    procesos: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20, default: [] }),
    estado: EstadoBot,
    tareaActual: Nullable(Type.String({ maxLength: 120 })),
    tareasOk: Type.Integer({ minimum: 0 }),
    tareasFallidas: Type.Integer({ minimum: 0 }),
    version: Type.String({ maxLength: 40, default: '' }),
    iniciadoEn: Fecha('Cuándo arrancó el proceso del bot'),
  },
  { title: 'LatidoEntrada', additionalProperties: false },
);

export const Latido = Type.Object(
  {
    ...LatidoEntrada.properties,
    recibidoEn: Fecha('Cuándo lo recibió la torre (reloj de la torre)'),
  },
  { title: 'Latido' },
);

export const EventoEntrada = Type.Object(
  {
    id: Type.Optional(
      Type.String({ minLength: 8, maxLength: 64, description: 'Id generado por el bot; hace idempotente el reenvío' }),
    ),
    botId: Identificador('Identificador del bot', 'bot-acuerdos-01'),
    tipo: TipoEvento,
    mensaje: Type.String({ minLength: 1, maxLength: 1000 }),
    tareaId: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
    ocurridoEn: Type.Optional(Fecha('Momento del evento según el bot; si falta, se usa el de la torre')),
  },
  { title: 'EventoEntrada', additionalProperties: false },
);

export const EventoBot = Type.Object(
  {
    id: Type.String(),
    botId: Type.String(),
    tipo: TipoEvento,
    mensaje: Type.String(),
    tareaId: Nullable(Type.String()),
    ocurridoEn: Fecha('Momento del evento'),
  },
  { title: 'EventoBot' },
);

// --- Estado ------------------------------------------------------------------

export const Alerta = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    clave: Type.String({ examples: ['cola_creciendo:rpa.payment_agreement'] }),
    regla: CodigoRegla,
    severidad: Severidad,
    objetivo: Type.String(),
    titulo: Type.String(),
    detalle: Type.String(),
    valor: Type.Number(),
    estado: EstadoAlerta,
    abiertaEn: Fecha('Apertura'),
    actualizadaEn: Fecha('Último cambio'),
    reconocidaEn: Nullable(Fecha('Reconocimiento')),
    reconocidaPor: Nullable(Type.String()),
    resueltaEn: Nullable(Fecha('Resolución')),
  },
  { title: 'Alerta' },
);

export const MetricaCola = Type.Object({
  nombre: Type.String(),
  mensajes: Type.Integer(),
  listos: Type.Integer(),
  sinConfirmar: Type.Integer(),
  consumidores: Type.Integer(),
  tasaEntrada: Type.Number(),
  tasaSalida: Type.Number(),
});

export const VistaCola = Type.Object(
  {
    ...Cola.properties,
    ...MetricaCola.properties,
    pendientePorMin: Type.Number({ description: 'Tendencia en mensajes por minuto (mínimos cuadrados sobre la ventana)' }),
    serie: Type.Array(Type.Number(), { description: 'Profundidad reciente, de la más antigua a la más nueva' }),
    catalogada: Type.Boolean({ description: 'Falso si la torre la descubrió sola por su nombre' }),
  },
  { title: 'VistaCola' },
);

export const VistaBot = Type.Object(
  {
    ...Bot.properties,
    salud: literales(['en_linea', 'sin_latido', 'detenido', 'nunca_visto'] as const, 'Salud calculada por la torre'),
    estado: Nullable(EstadoBot),
    servidor: Type.String(),
    hostname: Nullable(Type.String()),
    version: Nullable(Type.String()),
    tareaActual: Nullable(Type.String()),
    tareasOk: Type.Integer(),
    tareasFallidas: Type.Integer(),
    ultimoLatidoHaceSeg: Nullable(Type.Number()),
  },
  { title: 'VistaBot' },
);

export const VistaServidor = Type.Object(
  {
    ...Servidor.properties,
    salud: literales(['operativo', 'degradado', 'caido', 'sin_bots'] as const, 'Salud calculada'),
    bots: Type.Integer(),
    botsEnLinea: Type.Integer(),
  },
  { title: 'VistaServidor' },
);

const Conteo = (campos: readonly string[]) => Type.Object(Object.fromEntries(campos.map((c) => [c, Type.Integer()])));

export const Resumen = Type.Object(
  {
    bots: Conteo(['total', 'enLinea', 'ocupados', 'sinLatido']),
    servidores: Conteo(['total', 'operativos', 'caidos']),
    colas: Conteo(['total', 'pendientes', 'enDlq', 'consumidores']),
    tareas: Conteo(['ok', 'fallidas']),
    alertas: Conteo(['criticas', 'advertencias', 'reconocidas']),
  },
  { title: 'Resumen' },
);

export const Instantanea = Type.Object(
  {
    generadaEn: Fecha('Momento de la foto'),
    resumen: Resumen,
    colas: Type.Array(VistaCola),
    bots: Type.Array(VistaBot),
    servidores: Type.Array(VistaServidor),
    alertas: Type.Array(Alerta),
    eventos: Type.Array(EventoBot),
  },
  { title: 'Instantanea' },
);

export const Aviso = Type.Object(
  {
    canal: literales(['webhook', 'correo'] as const, 'Canal por el que salió'),
    asunto: Type.String(),
    cuerpo: Type.String(),
    alertaId: Type.String(),
    enviadoEn: Fecha('Envío'),
  },
  { title: 'Aviso' },
);

export type TServidor = Static<typeof Servidor>;
export type TBot = Static<typeof Bot>;
export type TCola = Static<typeof Cola>;
export type TLatidoEntrada = Static<typeof LatidoEntrada>;
export type TEventoEntrada = Static<typeof EventoEntrada>;
