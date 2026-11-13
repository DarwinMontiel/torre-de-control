/**
 * «La noche del cierre» — guion de la demo.
 *
 * 30 de noviembre, 10:00 p. m. En Cobranzas Macondo (ficticia) hay que registrar todos
 * los acuerdos de pago del mes antes de las 6:00 a. m., cuando el Banco de Macondo
 * (ficticio) cierra el corte. Rebeca, la operadora del turno de noche, tiene siete bots,
 * cuatro servidores y una torre de control. Esto es lo que pasa.
 *
 * Cada capítulo ocurre en un minuto de la noche (0 = 22:00) y produce efectos sobre la
 * simulación. Los efectos están diseñados para que cada regla de alerta se dispare
 * al menos una vez y vuelva a la normalidad.
 */
import type { ProcesoMacondo } from './macondo.ts';

export type Efecto =
  | { tipo: 'lote'; proceso: ProcesoMacondo; cantidad: number; erroneos: number }
  | { tipo: 'lentitud'; proceso: ProcesoMacondo; factor: number; hasta: number }
  | { tipo: 'servidor_caido'; servidorId: string; hasta: number }
  | { tipo: 'bot_colgado'; botId: string; hasta: number }
  | { tipo: 'parada_bot'; botId: string; hasta: number; nuevaVersion: string }
  | { tipo: 'reproceso_dlq'; proceso: ProcesoMacondo };

export interface Capitulo {
  minuto: number;
  titulo: string;
  relato: string;
  efectos: Efecto[];
}

export interface PerfilProceso {
  /** Tareas por minuto que completa un bot con el portal en condiciones normales. */
  capacidadPorBotMin: number;
  /** Goteo de tareas nuevas: [desdeMin, hastaMin, tareasPorMin]. */
  llegadas: readonly (readonly [number, number, number])[];
  /** Probabilidad de error transitorio (timeout, 503) que manda la tarea a reintento. */
  probTransitoria: number;
}

export const DURACION_NOCHE_MIN = 480;
/** 30 de noviembre de 2026, 22:00 en Bogotá (UTC-5). */
export const INICIO_NOCHE = '2026-12-01T03:00:00.000Z';

export const PERFILES: Record<ProcesoMacondo, PerfilProceso> = {
  payment_agreement: {
    capacidadPorBotMin: 30,
    llegadas: [[0, 240, 50]],
    probTransitoria: 0.02,
  },
  collection_update: {
    capacidadPorBotMin: 25,
    llegadas: [[0, 300, 20]],
    probTransitoria: 0.015,
  },
  support_download: {
    capacidadPorBotMin: 12,
    llegadas: [[0, 420, 6]],
    probTransitoria: 0.03,
  },
};

export const GUION: readonly Capitulo[] = [
  {
    minuto: 0,
    titulo: 'Empieza el turno',
    relato:
      'Rebeca enciende la torre. Llegan los lotes del cierre: 1.800 acuerdos de pago, 1.200 gestiones y 300 soportes. Siete bots despiertan en cuatro servidores.',
    efectos: [
      { tipo: 'lote', proceso: 'payment_agreement', cantidad: 1800, erroneos: 0 },
      { tipo: 'lote', proceso: 'collection_update', cantidad: 1200, erroneos: 0 },
      { tipo: 'lote', proceso: 'support_download', cantidad: 300, erroneos: 0 },
    ],
  },
  {
    minuto: 40,
    titulo: 'El portal del banco se pone lento',
    relato:
      'El portal del Banco de Macondo empieza a responder en 9 segundos en vez de 2. Los acuerdos siguen llegando y los bots no dan abasto: la cola de acuerdos empieza a crecer.',
    efectos: [{ tipo: 'lentitud', proceso: 'payment_agreement', factor: 0.2, hasta: 110 }],
  },
  {
    minuto: 90,
    titulo: 'CAUCA-02 se reinicia sin avisar',
    relato:
      'Una actualización automática reinicia CAUCA-02. Aureliano y Amaranta se quedan mudos. La torre abre una sola alerta de servidor caído en lugar de dos de bots: es la misma causa.',
    efectos: [{ tipo: 'servidor_caido', servidorId: 'srv-cauca-02', hasta: 112 }],
  },
  {
    minuto: 110,
    titulo: 'El banco se recupera',
    relato:
      'El portal vuelve a responder rápido y CAUCA-02 regresa. Rebeca reconoce las alertas y mira cómo la cola de acuerdos empieza a bajar.',
    efectos: [],
  },
  {
    minuto: 140,
    titulo: 'Cédulas que no existen',
    relato:
      'Llega un lote tardío de 400 gestiones. 37 traen cédulas ficticias mal digitadas que el CRM rechaza: son errores de negocio y van directo a la DLQ, sin reintentos inútiles.',
    efectos: [{ tipo: 'lote', proceso: 'collection_update', cantidad: 400, erroneos: 37 }],
  },
  {
    minuto: 190,
    titulo: 'Rebeca reprocesa la DLQ',
    relato:
      'Con las cédulas corregidas por el equipo de cartera, Rebeca devuelve los 37 mensajes a la cola principal. La DLQ queda en cero y la alerta se resuelve sola.',
    efectos: [{ tipo: 'reproceso_dlq', proceso: 'collection_update' }],
  },
  {
    minuto: 225,
    titulo: 'Melquíades se actualiza',
    relato:
      'Melquíades anuncia su parada para instalar la versión 1.4.1. La torre no lo trata como caída, pero sí avisa que la cola de soportes se quedó sin consumidores.',
    efectos: [{ tipo: 'parada_bot', botId: 'bot-soportes-01', hasta: 238, nuevaVersion: '1.4.1' }],
  },
  {
    minuto: 310,
    titulo: 'Pilar se queda colgada',
    relato:
      'Un navegador zombi deja a Pilar sin responder. SINÚ-03 sigue en pie gracias a Remedios, así que la alerta es solo del bot y el servidor queda degradado.',
    efectos: [{ tipo: 'bot_colgado', botId: 'bot-gestiones-03', hasta: 326 }],
  },
  {
    minuto: 450,
    titulo: 'Cierre logrado',
    relato:
      'A las 5:30 a. m. todas las colas están en cero. Rebeca envía el reporte del cierre y apaga la cafetera. Ningún acuerdo se registró dos veces.',
    efectos: [],
  },
];

/** "22:40" a partir del minuto de la noche. */
export function horaDeMinuto(minuto: number): string {
  const total = (22 * 60 + Math.floor(minuto)) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
