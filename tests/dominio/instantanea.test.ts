import { describe, expect, it } from 'vitest';
import { construirInstantanea, type EntradaInstantanea } from '../../src/dominio/instantanea.ts';
import { catalogoMacondo } from '../../src/dominio/macondo.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { HistorialColas } from '../../src/dominio/tendencia.ts';
import { alerta, catalogoPequeno, en, latido, latidosVivos, metrica } from '../ayudantes.ts';

const AHORA = en(600);

function entrada(parcial: Partial<EntradaInstantanea> = {}): EntradaInstantanea {
  return {
    ahora: AHORA,
    catalogo: catalogoPequeno(),
    latidos: latidosVivos(['bot-1', 'bot-2', 'bot-3'], AHORA),
    metricas: [],
    historial: new HistorialColas(10),
    alertas: [],
    eventos: [],
    ttlLatidoSeg: 45,
    ...parcial,
  };
}

describe('construirInstantanea', () => {
  it('resume bots, servidores, colas, tareas y alertas', () => {
    const latidos = latidosVivos(['bot-1', 'bot-3'], AHORA);
    latidos.set('bot-1', latido({ botId: 'bot-1', recibidoEn: AHORA, estado: 'BUSY', tareasOk: 10, tareasFallidas: 1 }));
    latidos.set('bot-2', latido({ botId: 'bot-2', recibidoEn: en(0), tareasOk: 5 }));
    const i = construirInstantanea(
      entrada({
        latidos,
        metricas: [
          metrica({ nombre: 'rpa.payment_agreement', mensajes: 30, consumidores: 2 }),
          metrica({ nombre: 'rpa.payment_agreement.retry.10s', mensajes: 4, consumidores: 0 }),
          metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 2, consumidores: 0 }),
          metrica({ nombre: 'ajena', mensajes: 99 }),
        ],
        alertas: [
          alerta({ id: 'a1', severidad: 'critica' }),
          alerta({ id: 'a2', clave: 'k2', estado: 'reconocida' }),
          alerta({ id: 'a3', clave: 'k3', estado: 'resuelta', resueltaEn: en(10) }),
        ],
      }),
    );
    expect(i.resumen).toEqual({
      bots: { total: 3, enLinea: 2, ocupados: 1, sinLatido: 1 },
      servidores: { total: 2, operativos: 1, caidos: 0 },
      colas: { total: 3, pendientes: 34, enDlq: 2, consumidores: 2 },
      tareas: { ok: 15, fallidas: 1 },
      alertas: { criticas: 1, advertencias: 0, reconocidas: 1 },
    });
    expect(i.servidores.find((s) => s.id === 'srv-a')).toMatchObject({ salud: 'degradado', bots: 2, botsEnLinea: 1 });
    expect(i.colas.map((c) => c.tipo)).toEqual(['principal', 'reintento', 'dlq']);
    expect(i.colas.find((c) => c.tipo === 'reintento')?.catalogada).toBe(false);
    expect(i.alertas.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(i.bots.find((b) => b.id === 'bot-2')).toMatchObject({ salud: 'sin_latido', ultimoLatidoHaceSeg: 600, servidor: 'A' });
  });

  it('un bot sin latidos aparece como nunca visto con contadores en cero', () => {
    const i = construirInstantanea(entrada({ latidos: new Map() }));
    expect(i.bots[0]).toMatchObject({ salud: 'nunca_visto', estado: null, tareasOk: 0, ultimoLatidoHaceSeg: null });
    expect(i.servidores.every((s) => s.salud === 'caido')).toBe(true);
  });

  it('limita eventos y alertas resueltas', () => {
    const eventos = Array.from({ length: 80 }, (_, n) => ({
      id: `e${n}`,
      botId: 'bot-1',
      tipo: 'info' as const,
      mensaje: 'm',
      tareaId: null,
      ocurridoEn: en(n),
    }));
    const resueltas = Array.from({ length: 30 }, (_, n) =>
      alerta({ id: `r${n}`, clave: `k${n}`, estado: 'resuelta', resueltaEn: en(n) }),
    );
    const i = construirInstantanea(entrada({ eventos, alertas: resueltas, maxEventos: 10, maxResueltas: 5 }));
    expect(i.eventos.map((e) => e.id)).toEqual(['e79', 'e78', 'e77', 'e76', 'e75', 'e74', 'e73', 'e72', 'e71', 'e70']);
    expect(i.alertas.map((a) => a.id)).toEqual(['r29', 'r28', 'r27', 'r26', 'r25']);
  });

  it('el catálogo de Macondo es ficticio, coherente y cubre cada tipo de cola', () => {
    const c = catalogoMacondo();
    const servidores = new Set(c.servidores.map((s) => s.id));
    expect(c.bots.every((b) => servidores.has(b.servidorId))).toBe(true);
    expect(c.colas).toHaveLength(15);
    expect(new Set(c.colas.map((q) => q.tipo))).toEqual(new Set(['principal', 'reintento', 'dlq']));
    expect(c.servidores.every((s) => s.ip.startsWith('10.20.'))).toBe(true);
  });

  it('el simulador reporta las mismas colas que declararía colmena-rpa', () => {
    const sim = simuladorMacondo();
    sim.avanzar(60);
    const nombresCatalogo = catalogoMacondo()
      .colas.map((q) => q.nombre)
      .sort();
    expect(
      sim
        .metricas()
        .map((m) => m.nombre)
        .sort(),
    ).toEqual(nombresCatalogo);
  });
});
