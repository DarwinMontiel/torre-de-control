/** Formatos para humanos en español de Colombia y hora de Bogotá. */

const numero = new Intl.NumberFormat('es-CO');
const decimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const hora = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Bogota',
});
const horaSeg = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Bogota',
});

export const entero = (n: number): string => numero.format(n);
export const unDecimal = (n: number): string => decimal.format(n);
export const horaBogota = (iso: string): string => hora.format(new Date(iso));
export const horaBogotaSeg = (iso: string): string => horaSeg.format(new Date(iso));

/** "hace 5 s", "hace 3 min", "hace 2 h". */
export function hace(segundos: number | null): string {
  if (segundos === null) return 'nunca';
  if (segundos < 60) return `hace ${Math.round(segundos)} s`;
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`;
  return `hace ${Math.floor(segundos / 3600)} h`;
}

/** Duración entre dos instantes: "12 min", "1 h 05 min". */
export function duracion(desde: string, hasta: string): string {
  const min = Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** "+12,5/min", "−3/min", "estable". */
export function tendencia(porMin: number): string {
  if (Math.abs(porMin) < 0.5) return 'estable';
  return `${porMin > 0 ? '+' : '−'}${decimal.format(Math.abs(porMin))}/min`;
}

export const ETIQUETAS = {
  salud: {
    en_linea: 'En línea',
    sin_latido: 'Sin latido',
    detenido: 'Detenido',
    nunca_visto: 'Nunca visto',
    operativo: 'Operativo',
    degradado: 'Degradado',
    caido: 'Caído',
    sin_bots: 'Sin bots',
  },
  estadoBot: { IDLE: 'Libre', BUSY: 'Trabajando', STOPPING: 'Deteniéndose' },
  tipoCola: { principal: 'Principal', reintento: 'Reintento', dlq: 'DLQ' },
  severidad: { critica: 'Crítica', advertencia: 'Advertencia', informativa: 'Info' },
  estadoAlerta: { activa: 'Activa', reconocida: 'Reconocida', resuelta: 'Resuelta' },
  evento: {
    inicio: 'Inicio',
    parada: 'Parada',
    tarea_ok: 'Tareas',
    tarea_fallida: 'Fallida',
    reintento: 'Reintento',
    lote: 'Lote',
    info: 'Info',
    error: 'Error',
  },
} as const;

export const PROCESOS: Record<string, string> = {
  payment_agreement: 'Acuerdos de pago',
  collection_update: 'Gestiones de cobro',
  support_download: 'Soportes de pago',
};

export const nombreProceso = (p: string): string => PROCESOS[p] ?? p;
