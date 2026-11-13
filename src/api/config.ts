/**
 * Configuración por variables de entorno (prefijo TORRE_). Se valida al arrancar: un
 * valor inválido detiene el proceso con un mensaje claro en lugar de fallar a las 3 a. m.
 */
import { hostname } from 'node:os';
import { CODIGOS_REGLA, type CodigoRegla } from '../dominio/tipos.ts';

export interface Config {
  puerto: number;
  host: string;
  nivelLog: string;
  nodo: string;
  almacen: 'postgres' | 'memoria';
  databaseUrl: string;
  redisUrl: string | null;
  fuenteColas: 'rabbitmq' | 'simulada';
  rabbit: { url: string; usuario: string; clave: string; vhost: string; prefijo: string };
  aceleracionSimulador: number;
  intervaloVigiaMs: number;
  ttlLatidoSeg: number;
  retencionLatidoSeg: number;
  ventanaTendenciaMin: number;
  coberturaMinimaMin: number;
  reglasDesactivadas: CodigoRegla[];
  tokenBots: string | null;
  tokenAdmin: string | null;
  autoregistro: boolean;
  webhookUrl: string | null;
  correoDestinatarios: string[];
  sembrarMacondo: boolean;
}

export class ErrorConfig extends Error {}

type Entorno = Record<string, string | undefined>;

function entero(env: Entorno, nombre: string, defecto: number, min: number, max: number): number {
  const crudo = env[nombre];
  if (crudo === undefined || crudo === '') return defecto;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErrorConfig(`${nombre} debe ser un entero entre ${min} y ${max} (recibido: "${crudo}").`);
  }
  return n;
}

function opcion<T extends string>(env: Entorno, nombre: string, opciones: readonly T[], defecto: T): T {
  const crudo = env[nombre];
  if (crudo === undefined || crudo === '') return defecto;
  if (!(opciones as readonly string[]).includes(crudo)) {
    throw new ErrorConfig(`${nombre} debe ser uno de: ${opciones.join(', ')} (recibido: "${crudo}").`);
  }
  return crudo as T;
}

function booleano(env: Entorno, nombre: string, defecto: boolean): boolean {
  const crudo = env[nombre]?.toLowerCase();
  if (crudo === undefined || crudo === '') return defecto;
  if (['1', 'true', 'si', 'sí'].includes(crudo)) return true;
  if (['0', 'false', 'no'].includes(crudo)) return false;
  throw new ErrorConfig(`${nombre} debe ser true o false (recibido: "${crudo}").`);
}

const lista = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const textoONulo = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function leerConfig(env: Entorno = process.env): Config {
  const reglasDesactivadas = lista(env['TORRE_REGLAS_DESACTIVADAS']);
  for (const r of reglasDesactivadas) {
    if (!(CODIGOS_REGLA as readonly string[]).includes(r)) {
      throw new ErrorConfig(`TORRE_REGLAS_DESACTIVADAS contiene una regla desconocida: "${r}".`);
    }
  }
  const ttlLatidoSeg = entero(env, 'TORRE_TTL_LATIDO_SEG', 45, 5, 3600);
  const config: Config = {
    puerto: entero(env, 'TORRE_PUERTO', 3000, 1, 65535),
    host: env['TORRE_HOST'] ?? '0.0.0.0',
    nivelLog: opcion(env, 'TORRE_NIVEL_LOG', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], 'info'),
    nodo: env['TORRE_NODO'] ?? `${hostname()}-${process.pid}`,
    almacen: opcion(env, 'TORRE_ALMACEN', ['postgres', 'memoria'], 'postgres'),
    databaseUrl: env['TORRE_DATABASE_URL'] ?? 'postgres://torre:torre@localhost:5432/torre',
    redisUrl: textoONulo(env['TORRE_REDIS_URL']),
    fuenteColas: opcion(env, 'TORRE_FUENTE_COLAS', ['rabbitmq', 'simulada'], 'simulada'),
    rabbit: {
      url: env['TORRE_RABBITMQ_URL'] ?? 'http://localhost:15672',
      usuario: env['TORRE_RABBITMQ_USUARIO'] ?? 'guest',
      clave: env['TORRE_RABBITMQ_CLAVE'] ?? 'guest',
      vhost: env['TORRE_RABBITMQ_VHOST'] ?? '/',
      prefijo: env['TORRE_RABBITMQ_PREFIJO'] ?? 'rpa.',
    },
    aceleracionSimulador: entero(env, 'TORRE_ACELERACION_SIMULADOR', 10, 1, 600),
    intervaloVigiaMs: entero(env, 'TORRE_INTERVALO_VIGIA_MS', 5000, 250, 300_000),
    ttlLatidoSeg,
    retencionLatidoSeg: entero(env, 'TORRE_RETENCION_LATIDO_SEG', 6 * 3600, 60, 30 * 86400),
    ventanaTendenciaMin: entero(env, 'TORRE_VENTANA_TENDENCIA_MIN', 10, 1, 240),
    coberturaMinimaMin: entero(env, 'TORRE_COBERTURA_MINIMA_MIN', 3, 0, 240),
    reglasDesactivadas: reglasDesactivadas as CodigoRegla[],
    tokenBots: textoONulo(env['TORRE_TOKEN_BOTS']),
    tokenAdmin: textoONulo(env['TORRE_TOKEN_ADMIN']),
    autoregistro: booleano(env, 'TORRE_AUTOREGISTRO', true),
    webhookUrl: textoONulo(env['TORRE_WEBHOOK_URL']),
    correoDestinatarios: lista(env['TORRE_CORREO_DESTINATARIOS'] ?? 'turno-noche@macondo.example'),
    sembrarMacondo: booleano(env, 'TORRE_SEMBRAR_MACONDO', false),
  };
  if (config.retencionLatidoSeg < ttlLatidoSeg) {
    throw new ErrorConfig('TORRE_RETENCION_LATIDO_SEG no puede ser menor que TORRE_TTL_LATIDO_SEG.');
  }
  return config;
}
