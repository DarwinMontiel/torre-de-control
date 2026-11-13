import { describe, expect, it } from 'vitest';
import type { Instantanea } from '../../src/dominio/instantanea.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { TorreLocal } from '../../src/dominio/torre-local.ts';
import { duracion, entero, hace, horaBogota, nombreProceso, tendencia } from '../../src/tablero/formato.ts';
import { puntosSparkline, sparkline } from '../../src/tablero/graficos.ts';
import { crudo, escapar, html } from '../../src/tablero/html.ts';
import { insignia, PANTALLAS, VISTAS, vistaAlertas, vistaBots, vistaColas, vistaResumen } from '../../src/tablero/vistas.ts';

function fotoEn(minuto: number): Instantanea {
  const torre = new TorreLocal(simuladorMacondo());
  while (torre.simulador.minuto < minuto) torre.ciclo(15);
  return torre.instantanea();
}

describe('html seguro', () => {
  it('escapa todo lo interpolado salvo fragmentos Html', () => {
    const nombre = '<img src=x onerror="alert(1)">';
    expect(html`<b>${nombre}</b>${crudo('<i>ok</i>')}`.valor).toBe(
      '<b>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</b><i>ok</i>',
    );
    expect(html`${['a', html`<br />`, 'b&c']}`.valor).toBe('a<br />b&amp;c');
    expect(html`${null}${undefined}${false}${0}`.valor).toBe('0');
    expect(escapar("O'Neil")).toBe('O&#39;Neil');
  });

  it('un bot con nombre malicioso no inyecta HTML en el tablero', () => {
    const i = fotoEn(1);
    const malicioso: Instantanea = {
      ...i,
      bots: i.bots.map((b, n) => (n === 0 ? { ...b, alias: '<script>robar()</script>' } : b)),
    };
    const salida = vistaBots(malicioso).valor;
    expect(salida).not.toContain('<script>');
    expect(salida).toContain('&lt;script&gt;robar()&lt;/script&gt;');
  });
});

describe('formatos en español', () => {
  it('números, horas de Bogotá, duraciones y tendencias', () => {
    expect(entero(12345)).toBe('12.345');
    expect(horaBogota('2026-12-01T03:40:00.000Z')).toBe('22:40');
    expect(hace(null)).toBe('nunca');
    expect(hace(12)).toBe('hace 12 s');
    expect(hace(185)).toBe('hace 3 min');
    expect(hace(7300)).toBe('hace 2 h');
    expect(duracion('2026-12-01T03:00:00Z', '2026-12-01T03:12:00Z')).toBe('12 min');
    expect(duracion('2026-12-01T03:00:00Z', '2026-12-01T04:05:00Z')).toBe('1 h 05 min');
    expect(tendencia(0.2)).toBe('estable');
    expect(tendencia(12.5)).toBe('+12,5/min');
    expect(tendencia(-3)).toBe('−3/min');
    expect(nombreProceso('payment_agreement')).toBe('Acuerdos de pago');
    expect(nombreProceso('otro_proceso')).toBe('otro_proceso');
  });
});

describe('sparkline', () => {
  it('escala del mínimo al máximo y dibuja series planas de forma legible', () => {
    expect(puntosSparkline([], 100, 20)).toBe('');
    expect(puntosSparkline([5], 100, 20)).toBe('50.0,10.0');
    expect(puntosSparkline([10, 20], 100, 20)).toBe('0.0,19.0 100.0,1.0');
    expect(puntosSparkline([0, 0], 100, 20)).toBe('0.0,19.0 100.0,19.0');
    expect(puntosSparkline([7, 7], 100, 20)).toBe('0.0,10.0 100.0,10.0');
  });

  it('es accesible y no permite inyectar atributos por el título', () => {
    expect(sparkline([1, 2], { titulo: 'Cola "x"<' }).valor).toContain('aria-label="Cola x"');
    expect(sparkline([], { titulo: 'vacía' }).valor).toContain('sin datos');
  });
});

describe('vistas', () => {
  it('cada pantalla se pinta con una foto real de la noche', () => {
    const i = fotoEn(100);
    for (const p of PANTALLAS) expect(VISTAS[p.id](i).valor.length).toBeGreaterThan(200);
  });

  it('el resumen muestra KPIs, alertas vigentes con botón de reconocer y colas principales', () => {
    const i = fotoEn(100); // 23:40, CAUCA-02 caído y cola de acuerdos creciendo
    const r = vistaResumen(i).valor;
    expect(r).toContain('Bots en línea');
    expect(r).toContain('5/7');
    expect(r).toContain('Servidor CAUCA-02 caído');
    expect(r).toMatch(/data-reconocer="00000000-0000-4000-8000-\d{12}"/);
    expect(r).toContain('Acuerdos de pago');
  });

  it('las colas resaltan la DLQ con mensajes y ordenan los reintentos por espera', () => {
    const c = vistaColas(fotoEn(165)).valor;
    expect(c).toMatch(/fila-aviso[\s\S]*rpa\.collection_update\.dlq/);
    expect(c.indexOf('retry.10s')).toBeLessThan(c.indexOf('retry.60s'));
    expect(c.indexOf('retry.60s')).toBeLessThan(c.indexOf('retry.300s'));
  });

  it('las alertas separan vigentes de resueltas y muestran quién reconoció', () => {
    const torre = new TorreLocal(simuladorMacondo());
    while (torre.simulador.minuto < 100) torre.ciclo(15);
    const activa = torre.alertas.find((a) => a.estado === 'activa');
    torre.reconocer(activa?.id ?? '', 'Rebeca');
    while (torre.simulador.minuto < 120) torre.ciclo(15);
    const v = vistaAlertas(torre.instantanea()).valor;
    expect(v).toContain('Resueltas recientemente');
    expect(v).toContain('reconocida por <strong>Rebeca</strong>');
    expect(v).toContain('duró');
  });

  it('pantallas vacías explican qué falta', () => {
    const vacia: Instantanea = { ...fotoEn(1), colas: [], bots: [], servidores: [], alertas: [], eventos: [] };
    expect(VISTAS.colas(vacia).valor).toContain('Aún no hay lecturas de RabbitMQ.');
    expect(VISTAS.bots(vacia).valor).toContain('Se registran solos con su primer latido.');
    expect(VISTAS.servidores(vacia).valor).toContain('No hay servidores');
    expect(VISTAS.alertas(vacia).valor).toContain('Ninguna alerta vigente.');
    expect(VISTAS.bitacora(vacia).valor).toContain('Sin eventos todavía.');
  });

  it('las insignias de las pestañas señalan dónde mirar', () => {
    const i = fotoEn(100);
    expect(insignia('alertas', i)).toEqual({ texto: '2', nivel: 'mal' });
    expect(insignia('bots', i)).toEqual({ texto: '2', nivel: 'mal' });
    expect(insignia('servidores', i)).toEqual({ texto: '1', nivel: 'mal' });
    expect(insignia('resumen', i)).toBeNull();
    const calma = fotoEn(400);
    expect(insignia('alertas', calma)).toBeNull();
    expect(insignia('colas', fotoEn(165))).toEqual({ texto: '37', nivel: 'aviso' });
  });
});
