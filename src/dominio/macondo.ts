/**
 * Catálogo de demostración: «Cobranzas Macondo S.A.S.», una casa de cobranza que no
 * existe. Los bots llevan nombres de personajes de ficción, los servidores nombres de
 * ríos y las IP son de una red privada de ejemplo. Ningún dato corresponde a una
 * empresa, banco o persona real.
 */
import { nombresDeProceso } from './topologia.ts';
import type { Catalogo, Cola } from './tipos.ts';

export const EMPRESA_FICTICIA = 'Cobranzas Macondo S.A.S. (ficticia)';
export const BANCO_FICTICIO = 'Banco de Macondo (ficticio)';

export const PROCESOS = {
  payment_agreement: 'Registrar acuerdos de pago en el portal del banco',
  collection_update: 'Actualizar gestiones de cobro en el CRM',
  support_download: 'Descargar soportes de pago',
} as const;
export type ProcesoMacondo = keyof typeof PROCESOS;

const UMBRALES: Record<ProcesoMacondo, { mensajes: number; crecimiento: number }> = {
  payment_agreement: { mensajes: 1500, crecimiento: 25 },
  collection_update: { mensajes: 800, crecimiento: 20 },
  support_download: { mensajes: 300, crecimiento: 10 },
};

function colasDe(proceso: ProcesoMacondo): Cola[] {
  const n = nombresDeProceso(proceso);
  const u = UMBRALES[proceso];
  return [
    { nombre: n.principal, proceso, tipo: 'principal', umbralMensajes: u.mensajes, umbralCrecimientoPorMin: u.crecimiento },
    ...n.reintentos.map((nombre): Cola => ({
      nombre,
      proceso,
      tipo: 'reintento',
      umbralMensajes: 200,
      umbralCrecimientoPorMin: 30,
    })),
    { nombre: n.dlq, proceso, tipo: 'dlq', umbralMensajes: 25, umbralCrecimientoPorMin: 5 },
  ];
}

export function catalogoMacondo(): Catalogo {
  return {
    servidores: [
      {
        id: 'srv-magdalena-01',
        nombre: 'MAGDALENA-01',
        sistema: 'windows',
        ip: '10.20.0.11',
        ubicacion: 'Centro de datos ficticio · rack A',
        descripcion: 'Windows Server 2022 · bots de acuerdos de pago',
      },
      {
        id: 'srv-cauca-02',
        nombre: 'CAUCA-02',
        sistema: 'windows',
        ip: '10.20.0.12',
        ubicacion: 'Centro de datos ficticio · rack A',
        descripcion: 'Windows Server 2022 · acuerdos y gestiones',
      },
      {
        id: 'srv-sinu-03',
        nombre: 'SINÚ-03',
        sistema: 'linux',
        ip: '10.20.0.13',
        ubicacion: 'Centro de datos ficticio · rack B',
        descripcion: 'Ubuntu 24.04 · bots de gestiones',
      },
      {
        id: 'srv-atrato-04',
        nombre: 'ATRATO-04',
        sistema: 'linux',
        ip: '10.20.0.14',
        ubicacion: 'Centro de datos ficticio · rack B',
        descripcion: 'Ubuntu 24.04 · descarga de soportes',
      },
    ],
    bots: [
      {
        id: 'bot-acuerdos-01',
        alias: 'Úrsula',
        proceso: 'payment_agreement',
        servidorId: 'srv-magdalena-01',
        descripcion: 'La más veterana del turno; nunca ha dejado un acuerdo a medias.',
      },
      {
        id: 'bot-acuerdos-02',
        alias: 'José Arcadio',
        proceso: 'payment_agreement',
        servidorId: 'srv-magdalena-01',
        descripcion: 'Rápido e impaciente con los portales lentos.',
      },
      {
        id: 'bot-acuerdos-03',
        alias: 'Aureliano',
        proceso: 'payment_agreement',
        servidorId: 'srv-cauca-02',
        descripcion: 'Trabaja en silencio; cuando calla, preocupa.',
      },
      {
        id: 'bot-gestiones-01',
        alias: 'Amaranta',
        proceso: 'collection_update',
        servidorId: 'srv-cauca-02',
        descripcion: 'Registra cada gestión de cobro con puntada fina.',
      },
      {
        id: 'bot-gestiones-02',
        alias: 'Remedios',
        proceso: 'collection_update',
        servidorId: 'srv-sinu-03',
        descripcion: 'Ligera y constante.',
      },
      {
        id: 'bot-gestiones-03',
        alias: 'Pilar',
        proceso: 'collection_update',
        servidorId: 'srv-sinu-03',
        descripcion: 'Adivina qué cliente va a fallar antes de abrirlo.',
      },
      {
        id: 'bot-soportes-01',
        alias: 'Melquíades',
        proceso: 'support_download',
        servidorId: 'srv-atrato-04',
        descripcion: 'Trae los soportes de pago de lugares lejanos.',
      },
    ],
    colas: (Object.keys(PROCESOS) as ProcesoMacondo[]).flatMap(colasDe),
  };
}
