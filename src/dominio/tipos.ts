/**
 * Tipos del dominio de la Torre de Control.
 *
 * Todo lo que viaja por la API, por Redis o por el WebSocket tiene una de estas formas.
 * Las fechas son cadenas ISO 8601 en UTC para que el mismo objeto sirva en Node, en el
 * navegador y en el SDK de Python sin conversiones.
 */

/** Estado que reporta el propio bot. Son los mismos valores que usa colmena-rpa. */
export const ESTADOS_BOT = ['IDLE', 'BUSY', 'STOPPING'] as const;
export type EstadoBot = (typeof ESTADOS_BOT)[number];

/** Salud que calcula la torre a partir del último latido. */
export type SaludBot = 'en_linea' | 'sin_latido' | 'detenido' | 'nunca_visto';
export type SaludServidor = 'operativo' | 'degradado' | 'caido' | 'sin_bots';

export const SISTEMAS = ['windows', 'linux'] as const;
export type SistemaOperativo = (typeof SISTEMAS)[number];

export const TIPOS_COLA = ['principal', 'reintento', 'dlq'] as const;
export type TipoCola = (typeof TIPOS_COLA)[number];

export const SEVERIDADES = ['critica', 'advertencia', 'informativa'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const ESTADOS_ALERTA = ['activa', 'reconocida', 'resuelta'] as const;
export type EstadoAlerta = (typeof ESTADOS_ALERTA)[number];

export const CODIGOS_REGLA = [
  'cola_creciendo',
  'cola_sin_consumidores',
  'dlq_con_mensajes',
  'bot_sin_latido',
  'servidor_caido',
] as const;
export type CodigoRegla = (typeof CODIGOS_REGLA)[number];

export const TIPOS_EVENTO = ['inicio', 'parada', 'tarea_ok', 'tarea_fallida', 'reintento', 'lote', 'info', 'error'] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

// ---------------------------------------------------------------------------
// Catálogo (vive en PostgreSQL)
// ---------------------------------------------------------------------------

export interface Servidor {
  id: string;
  nombre: string;
  sistema: SistemaOperativo;
  ip: string;
  ubicacion: string;
  descripcion: string;
}

export interface Bot {
  id: string;
  /** Nombre memorable que usa operación en el turno ("Úrsula"). */
  alias: string;
  /** Proceso que ejecuta; coincide con la cola `rpa.<proceso>` de colmena-rpa. */
  proceso: string;
  servidorId: string;
  descripcion: string;
}

export interface Cola {
  nombre: string;
  proceso: string;
  tipo: TipoCola;
  /** Por encima de este número de mensajes la cola se considera saturada. */
  umbralMensajes: number;
  /** Crecimiento sostenido (mensajes por minuto) que dispara la alerta de tendencia. */
  umbralCrecimientoPorMin: number;
}

export interface Catalogo {
  servidores: Servidor[];
  bots: Bot[];
  colas: Cola[];
}

// ---------------------------------------------------------------------------
// Estado vivo (vive en Redis)
// ---------------------------------------------------------------------------

/** Latido que envía cada bot (ver sdk/python). Compatible con el latido de colmena-rpa. */
export interface Latido {
  botId: string;
  hostname: string;
  plataforma: string;
  procesos: string[];
  estado: EstadoBot;
  tareaActual: string | null;
  tareasOk: number;
  tareasFallidas: number;
  version: string;
  iniciadoEn: string;
  /** Lo fija la torre al recibirlo; nunca se confía en el reloj del bot. */
  recibidoEn: string;
}

/** Métricas de una cola tal como las entrega la API de management de RabbitMQ. */
export interface MetricaCola {
  nombre: string;
  mensajes: number;
  listos: number;
  sinConfirmar: number;
  consumidores: number;
  /** Mensajes publicados por segundo. */
  tasaEntrada: number;
  /** Mensajes confirmados (ack) por segundo. */
  tasaSalida: number;
}

export interface EventoBot {
  id: string;
  botId: string;
  tipo: TipoEvento;
  mensaje: string;
  tareaId: string | null;
  ocurridoEn: string;
}

// ---------------------------------------------------------------------------
// Alertas (incidentes en PostgreSQL)
// ---------------------------------------------------------------------------

/** Resultado de evaluar una regla: una condición anómala observada ahora. */
export interface Hallazgo {
  /** Identidad estable del problema: `<regla>:<objetivo>`. Sirve para deduplicar. */
  clave: string;
  regla: CodigoRegla;
  severidad: Severidad;
  objetivo: string;
  titulo: string;
  detalle: string;
  valor: number;
}

export interface Alerta extends Hallazgo {
  id: string;
  estado: EstadoAlerta;
  abiertaEn: string;
  actualizadaEn: string;
  reconocidaEn: string | null;
  reconocidaPor: string | null;
  resueltaEn: string | null;
}

export interface Aviso {
  canal: 'webhook' | 'correo';
  asunto: string;
  cuerpo: string;
  alertaId: string;
  enviadoEn: string;
}
