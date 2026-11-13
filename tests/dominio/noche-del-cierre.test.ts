/**
 * La noche del cierre, de principio a fin.
 *
 * Recorre las ocho horas simuladas con la torre local (simulador + reglas + conciliación)
 * y verifica que cada capítulo del guion dispara exactamente la alerta que cuenta la
 * historia, en el momento esperado, y que todas se resuelven solas. Es la prueba de que
 * la demo publicada no miente.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { GUION, horaDeMinuto } from '../../src/dominio/historia.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { TorreLocal } from '../../src/dominio/torre-local.ts';

interface Hito {
  minuto: number;
  tipo: 'abre' | 'escala' | 'resuelve';
  clave: string;
  severidad: string;
}

function recorrerNoche(semilla?: number) {
  const torre = new TorreLocal(simuladorMacondo(semilla === undefined ? {} : { semilla }));
  const hitos: Hito[] = [];
  const colasPorMinuto = new Map<number, Record<string, number>>();
  while (!torre.simulador.terminado) {
    const r = torre.ciclo(15);
    const minuto = torre.simulador.minuto;
    for (const a of r.abiertas) hitos.push({ minuto, tipo: 'abre', clave: a.clave, severidad: a.severidad });
    for (const a of r.escaladas) hitos.push({ minuto, tipo: 'escala', clave: a.clave, severidad: a.severidad });
    for (const a of r.resueltas) hitos.push({ minuto, tipo: 'resuelve', clave: a.clave, severidad: a.severidad });
    if (Number.isInteger(minuto)) {
      colasPorMinuto.set(minuto, Object.fromEntries(torre.simulador.metricas().map((m) => [m.nombre, m.mensajes])));
    }
  }
  return { torre, hitos, colasPorMinuto };
}

describe('La noche del cierre', () => {
  let noche: ReturnType<typeof recorrerNoche>;
  const hito = (tipo: Hito['tipo'], clave: string) => noche.hitos.find((h) => h.tipo === tipo && h.clave === clave);
  const claves = () => new Set(noche.hitos.map((h) => h.clave));

  beforeAll(() => {
    noche = recorrerNoche();
  });

  it('22:40 · el portal lento hace crecer la cola de acuerdos y la alerta escala al saturarse', () => {
    const abre = hito('abre', 'cola_creciendo:rpa.payment_agreement');
    const escala = hito('escala', 'cola_creciendo:rpa.payment_agreement');
    expect(abre?.minuto).toBeGreaterThan(40);
    expect(abre?.minuto).toBeLessThan(55);
    expect(abre?.severidad).toBe('advertencia');
    expect(escala?.severidad).toBe('critica');
    expect(escala?.minuto).toBeLessThan(90);
  });

  it('23:30 · CAUCA-02 cae: una sola alerta de servidor, ninguna de sus bots (inhibición)', () => {
    const abre = hito('abre', 'servidor_caido:srv-cauca-02');
    expect(abre?.minuto).toBeGreaterThanOrEqual(90.75); // 90 min + 45 s de TTL
    expect(abre?.minuto).toBeLessThan(92);
    expect(hito('resuelve', 'servidor_caido:srv-cauca-02')?.minuto).toBeLessThan(114);
    expect(claves().has('bot_sin_latido:bot-acuerdos-03')).toBe(false);
    expect(claves().has('bot_sin_latido:bot-gestiones-01')).toBe(false);
  });

  it('00:20 · las cédulas inválidas llegan a la DLQ (crítica con 37) y el reproceso de las 01:10 la resuelve', () => {
    expect(hito('escala', 'dlq_con_mensajes:rpa.collection_update.dlq')?.severidad).toBe('critica');
    expect(noche.colasPorMinuto.get(180)?.['rpa.collection_update.dlq']).toBe(37);
    expect(hito('resuelve', 'dlq_con_mensajes:rpa.collection_update.dlq')?.minuto).toBeCloseTo(190, 0);
  });

  it('01:45 · la parada ordenada de Melquíades no es caída, pero la cola se queda sin consumidores', () => {
    expect(claves().has('bot_sin_latido:bot-soportes-01')).toBe(false);
    const abre = hito('abre', 'cola_sin_consumidores:rpa.support_download');
    expect(abre?.minuto).toBeGreaterThanOrEqual(225);
    expect(hito('resuelve', 'cola_sin_consumidores:rpa.support_download')?.minuto).toBeLessThan(240);
  });

  it('03:10 · Pilar se cuelga: alerta del bot y no del servidor, porque Remedios sigue en pie', () => {
    expect(hito('abre', 'bot_sin_latido:bot-gestiones-03')?.severidad).toBe('critica');
    expect(claves().has('servidor_caido:srv-sinu-03')).toBe(false);
    expect(hito('resuelve', 'bot_sin_latido:bot-gestiones-03')?.minuto).toBeLessThan(327);
  });

  it('05:30 · cierre logrado: colas en cero y ninguna alerta vigente', () => {
    const colas = noche.colasPorMinuto.get(450) ?? {};
    expect(Object.values(colas).every((n) => n === 0)).toBe(true);
    expect(noche.torre.alertas.filter((a) => a.estado !== 'resuelta')).toEqual([]);
  });

  it('cada alerta que se abre se resuelve sola y nunca hay dos vigentes del mismo problema', () => {
    const abiertas = new Map<string, number>();
    for (const h of noche.hitos) {
      if (h.tipo === 'abre') {
        expect(abiertas.has(h.clave)).toBe(false);
        abiertas.set(h.clave, h.minuto);
      }
      if (h.tipo === 'resuelve') abiertas.delete(h.clave);
    }
    expect([...abiertas.keys()]).toEqual([]);
  });

  it('no hay alertas que la historia no cuente', () => {
    const permitidas = new Set([
      'cola_creciendo:rpa.payment_agreement',
      'cola_creciendo:rpa.collection_update', // el lote tardío de las 00:20 la hace subir un momento
      'servidor_caido:srv-cauca-02',
      'dlq_con_mensajes:rpa.collection_update.dlq',
      'cola_sin_consumidores:rpa.support_download',
      'bot_sin_latido:bot-gestiones-03',
    ]);
    expect([...claves()].filter((c) => !permitidas.has(c))).toEqual([]);
  });

  it('es reproducible con la misma semilla y cambia con otra', () => {
    const otra = recorrerNoche();
    expect(otra.hitos).toEqual(noche.hitos);
    const mensajes = (semilla: number) => {
      const t = new TorreLocal(simuladorMacondo({ semilla }));
      t.ciclo(30 * 60);
      return t.instantanea().eventos.map((e) => e.mensaje);
    };
    expect(mensajes(7)).not.toEqual(mensajes(3011));
  });

  it('el guion está en orden y todos sus capítulos ocurren', () => {
    const minutos = GUION.map((c) => c.minuto);
    expect(minutos).toEqual([...minutos].sort((a, b) => a - b));
    expect(noche.torre.simulador.capitulos).toHaveLength(GUION.length);
    expect(horaDeMinuto(0)).toBe('22:00');
    expect(horaDeMinuto(130)).toBe('00:10');
    expect(horaDeMinuto(450)).toBe('05:30');
  });
});

describe('TorreLocal', () => {
  it('permite reconocer una alerta activa una sola vez', () => {
    const torre = new TorreLocal(simuladorMacondo());
    while (!torre.alertas.some((a) => a.estado === 'activa')) torre.ciclo(30);
    const activa = torre.alertas.find((a) => a.estado === 'activa');
    expect(activa).toBeDefined();
    const id = activa?.id ?? '';
    expect(torre.reconocer(id, 'Rebeca')?.reconocidaPor).toBe('Rebeca');
    expect(torre.reconocer(id, 'Rebeca')).toBeNull();
    expect(torre.reconocer('no-existe', 'Rebeca')).toBeNull();
    expect(torre.instantanea().resumen.alertas.reconocidas).toBe(1);
  });

  it('expone eventos de bots en la instantánea, del más reciente al más antiguo', () => {
    const torre = new TorreLocal(simuladorMacondo());
    torre.ciclo(120);
    const eventos = torre.instantanea().eventos;
    expect(eventos.length).toBeGreaterThan(5);
    expect(eventos.map((e) => e.ocurridoEn)).toEqual([...eventos.map((e) => e.ocurridoEn)].sort().reverse());
    expect(eventos.some((e) => e.tipo === 'lote')).toBe(true);
  });
});
