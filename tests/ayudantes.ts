/** Fábricas de datos de prueba. Todo es ficticio. */
import { HistorialColas } from '../src/dominio/tendencia.ts';
import type { Alerta, Catalogo, Hallazgo, Latido, MetricaCola } from '../src/dominio/tipos.ts';

export const T0 = '2026-12-01T03:00:00.000Z';

/** ISO de `T0 + segundos`. */
export function en(segundos: number, base = T0): string {
  return new Date(Date.parse(base) + segundos * 1000).toISOString();
}

export function latido(parcial: Partial<Latido> & { botId: string }): Latido {
  return {
    hostname: 'SRV-PRUEBA',
    plataforma: 'Linux',
    procesos: ['payment_agreement'],
    estado: 'IDLE',
    tareaActual: null,
    tareasOk: 0,
    tareasFallidas: 0,
    version: '1.0.0',
    iniciadoEn: T0,
    recibidoEn: T0,
    ...parcial,
  };
}

export function metrica(parcial: Partial<MetricaCola> & { nombre: string }): MetricaCola {
  return { mensajes: 0, listos: 0, sinConfirmar: 0, consumidores: 1, tasaEntrada: 0, tasaSalida: 0, ...parcial };
}

export function hallazgo(parcial: Partial<Hallazgo> = {}): Hallazgo {
  return {
    clave: 'dlq_con_mensajes:rpa.x.dlq',
    regla: 'dlq_con_mensajes',
    severidad: 'advertencia',
    objetivo: 'rpa.x.dlq',
    titulo: 'DLQ con 3 mensajes',
    detalle: 'detalle',
    valor: 3,
    ...parcial,
  };
}

export function alerta(parcial: Partial<Alerta> = {}): Alerta {
  return {
    ...hallazgo(),
    id: '00000000-0000-4000-8000-000000000001',
    estado: 'activa',
    abiertaEn: T0,
    actualizadaEn: T0,
    reconocidaEn: null,
    reconocidaPor: null,
    resueltaEn: null,
    ...parcial,
  };
}

/** Catálogo mínimo: 2 servidores, 3 bots, colas de un proceso. */
export function catalogoPequeno(): Catalogo {
  return {
    servidores: [
      { id: 'srv-a', nombre: 'A', sistema: 'windows', ip: '10.0.0.1', ubicacion: '', descripcion: '' },
      { id: 'srv-b', nombre: 'B', sistema: 'linux', ip: '10.0.0.2', ubicacion: '', descripcion: '' },
    ],
    bots: [
      { id: 'bot-1', alias: 'Uno', proceso: 'payment_agreement', servidorId: 'srv-a', descripcion: '' },
      { id: 'bot-2', alias: 'Dos', proceso: 'payment_agreement', servidorId: 'srv-a', descripcion: '' },
      { id: 'bot-3', alias: 'Tres', proceso: 'payment_agreement', servidorId: 'srv-b', descripcion: '' },
    ],
    colas: [
      {
        nombre: 'rpa.payment_agreement',
        proceso: 'payment_agreement',
        tipo: 'principal',
        umbralMensajes: 100,
        umbralCrecimientoPorMin: 10,
      },
      {
        nombre: 'rpa.payment_agreement.dlq',
        proceso: 'payment_agreement',
        tipo: 'dlq',
        umbralMensajes: 5,
        umbralCrecimientoPorMin: 1,
      },
    ],
  };
}

/** Historial con una serie lineal: `inicio + pendiente * minuto` durante `minutos`. */
export function historialLineal(nombre: string, inicio: number, pendiente: number, minutos: number): HistorialColas {
  const h = new HistorialColas(60);
  for (let m = 0; m <= minutos; m++) {
    h.registrar(Date.parse(T0) + m * 60_000, [metrica({ nombre, mensajes: inicio + pendiente * m })]);
  }
  return h;
}

/** Latidos frescos (a `ahora`) para todos los bots indicados. */
export function latidosVivos(botIds: readonly string[], ahora: string): Map<string, Latido> {
  return new Map(botIds.map((id) => [id, latido({ botId: id, recibidoEn: ahora })]));
}
