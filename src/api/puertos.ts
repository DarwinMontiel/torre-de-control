/**
 * Puertos (interfaces) que separan la lógica de la torre de su infraestructura.
 *
 * Cada puerto tiene un adaptador real (PostgreSQL, Redis, RabbitMQ, HTTP) y uno en
 * memoria. Las pruebas por defecto usan los de memoria o dobles (pg-mem, ioredis-mock),
 * así que corren sin servicios externos.
 */
import type { Instantanea } from '../dominio/instantanea.ts';
import type {
  Alerta,
  Aviso,
  Bot,
  Catalogo,
  Cola,
  EstadoAlerta,
  EventoBot,
  Latido,
  MetricaCola,
  Servidor,
  CodigoRegla,
} from '../dominio/tipos.ts';

export class ErrorConflicto extends Error {}
export class ErrorNoEncontrado extends Error {}
export class ErrorValidacion extends Error {}

export interface RepositorioCatalogo {
  catalogo(): Promise<Catalogo>;

  listarServidores(): Promise<Servidor[]>;
  obtenerServidor(id: string): Promise<Servidor | null>;
  crearServidor(s: Servidor): Promise<Servidor>;
  actualizarServidor(id: string, cambios: Partial<Omit<Servidor, 'id'>>): Promise<Servidor | null>;
  eliminarServidor(id: string): Promise<boolean>;

  listarBots(): Promise<Bot[]>;
  obtenerBot(id: string): Promise<Bot | null>;
  crearBot(b: Bot): Promise<Bot>;
  actualizarBot(id: string, cambios: Partial<Omit<Bot, 'id'>>): Promise<Bot | null>;
  eliminarBot(id: string): Promise<boolean>;

  listarColas(): Promise<Cola[]>;
  obtenerCola(nombre: string): Promise<Cola | null>;
  crearCola(c: Cola): Promise<Cola>;
  actualizarCola(nombre: string, cambios: Partial<Omit<Cola, 'nombre'>>): Promise<Cola | null>;
  eliminarCola(nombre: string): Promise<boolean>;
}

export interface FiltroAlertas {
  estado?: EstadoAlerta | undefined;
  regla?: CodigoRegla | undefined;
  objetivo?: string | undefined;
  limite: number;
}

export interface RepositorioIncidentes {
  /** Alertas activas o reconocidas. */
  vigentes(): Promise<Alerta[]>;
  /** Inserta o actualiza por `id`. */
  guardar(alertas: readonly Alerta[]): Promise<void>;
  obtener(id: string): Promise<Alerta | null>;
  listar(filtro: FiltroAlertas): Promise<Alerta[]>;
}

export interface FiltroEventos {
  botId?: string | undefined;
  limite: number;
}

export interface RepositorioEventos {
  registrar(eventos: readonly EventoBot[]): Promise<void>;
  recientes(filtro: FiltroEventos): Promise<EventoBot[]>;
}

/** Mensajes que la torre difunde a todas las réplicas de la API y, de ahí, al tablero. */
export type MensajeTorre =
  | { tipo: 'instantanea'; datos: Instantanea }
  | { tipo: 'alerta'; motivo: 'abierta' | 'escalada' | 'resuelta' | 'reconocida'; datos: Alerta }
  | { tipo: 'evento_bot'; datos: EventoBot };

export interface EstadoVivo {
  registrarLatido(latido: Latido): Promise<void>;
  /** Último latido conocido de cada bot (incluye los vencidos hasta que expira la retención). */
  ultimosLatidos(): Promise<Map<string, Latido>>;
  guardarInstantanea(i: Instantanea): Promise<void>;
  ultimaInstantanea(): Promise<Instantanea | null>;
  publicar(m: MensajeTorre): Promise<void>;
  /** Devuelve una función para cancelar la suscripción. */
  suscribir(manejador: (m: MensajeTorre) => void): Promise<() => Promise<void>>;
  /** Candado de líder para que un solo vigía evalúe reglas aunque haya varias réplicas. */
  tomarLiderazgo(nodo: string, ttlMs: number): Promise<boolean>;
  ping(): Promise<boolean>;
}

export interface FuenteColas {
  readonly descripcion: string;
  leer(): Promise<MetricaCola[]>;
}

export interface Notificador {
  readonly canal: Aviso['canal'];
  enviar(aviso: Aviso): Promise<void>;
}

export interface Reloj {
  ahora(): string;
}

export const relojDelSistema: Reloj = { ahora: () => new Date().toISOString() };
