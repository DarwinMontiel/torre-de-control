import { describe, expect, it } from 'vitest';
import { Acumulador, crearAzar } from '../../src/dominio/azar.ts';
import { HistorialColas, pendientePorMinuto } from '../../src/dominio/tendencia.ts';
import { colaPorDefecto, inferirCola, nombresDeProceso } from '../../src/dominio/topologia.ts';
import { metrica, T0 } from '../ayudantes.ts';

const t = (min: number) => Date.parse(T0) + min * 60_000;

describe('pendientePorMinuto', () => {
  it('es 0 con menos de dos muestras o sin variación de tiempo', () => {
    expect(pendientePorMinuto([])).toBe(0);
    expect(pendientePorMinuto([{ t: 0, v: 5 }])).toBe(0);
    expect(
      pendientePorMinuto([
        { t: 0, v: 5 },
        { t: 0, v: 9 },
      ]),
    ).toBe(0);
  });

  it('recupera la pendiente exacta de una serie lineal', () => {
    const serie = [0, 1, 2, 3, 4].map((m) => ({ t: t(m), v: 100 + 12 * m }));
    expect(pendientePorMinuto(serie)).toBeCloseTo(12, 10);
  });

  it('es robusta al ruido: una lectura atípica no cambia el signo de una cola que baja', () => {
    const serie = [0, 1, 2, 3, 4, 5].map((m) => ({ t: t(m), v: 1000 - 30 * m }));
    serie[3] = { t: t(3), v: 1100 };
    expect(pendientePorMinuto(serie)).toBeLessThan(0);
  });
});

describe('HistorialColas', () => {
  it('descarta muestras fuera de la ventana y calcula cobertura', () => {
    const h = new HistorialColas(5);
    for (let m = 0; m <= 10; m++) h.registrar(t(m), [metrica({ nombre: 'rpa.x', mensajes: m })]);
    const muestras = h.muestras('rpa.x');
    expect(muestras[0]?.v).toBe(5);
    expect(muestras).toHaveLength(6);
    expect(h.cobertura('rpa.x')).toBe(5);
    expect(h.pendiente('rpa.x')).toBeCloseTo(1);
  });

  it('respeta el máximo de muestras aunque la ventana sea amplia', () => {
    const h = new HistorialColas(60, 3);
    for (let s = 0; s < 10; s++) h.registrar(Date.parse(T0) + s * 1000, [metrica({ nombre: 'q', mensajes: s })]);
    expect(h.muestras('q').map((m) => m.v)).toEqual([7, 8, 9]);
  });

  it('una cola desconocida no tiene historia', () => {
    const h = new HistorialColas(5);
    expect(h.muestras('nada')).toEqual([]);
    expect(h.cobertura('nada')).toBe(0);
    expect(h.pendiente('nada')).toBe(0);
  });
});

describe('topología de colmena-rpa', () => {
  it.each([
    ['rpa.payment_agreement', { proceso: 'payment_agreement', tipo: 'principal', esperaSeg: null }],
    ['rpa.payment_agreement.dlq', { proceso: 'payment_agreement', tipo: 'dlq', esperaSeg: null }],
    ['rpa.payment_agreement.retry.60s', { proceso: 'payment_agreement', tipo: 'reintento', esperaSeg: 60 }],
  ])('infiere %s', (nombre, esperado) => {
    expect(inferirCola(nombre)).toEqual(esperado);
  });

  it.each(['otra.cola', 'rpa.', 'rpa.Mayusculas', 'rpa.x.retry.abc', 'rpa.x.dlq.extra'])('ignora %s', (nombre) => {
    expect(inferirCola(nombre)).toBeNull();
    expect(colaPorDefecto(nombre)).toBeNull();
  });

  it('genera los mismos nombres que declara colmena-rpa', () => {
    expect(nombresDeProceso('collection_update')).toEqual({
      principal: 'rpa.collection_update',
      dlq: 'rpa.collection_update.dlq',
      reintentos: ['rpa.collection_update.retry.10s', 'rpa.collection_update.retry.60s', 'rpa.collection_update.retry.300s'],
    });
  });

  it('asigna umbrales por defecto más estrictos a la DLQ', () => {
    expect(colaPorDefecto('rpa.x.dlq')?.umbralMensajes).toBeLessThan(colaPorDefecto('rpa.x')?.umbralMensajes ?? 0);
  });
});

describe('azar reproducible', () => {
  it('la misma semilla produce la misma secuencia en [0, 1)', () => {
    const a = crearAzar(42);
    const b = crearAzar(42);
    const sa = Array.from({ length: 100 }, a);
    expect(sa).toEqual(Array.from({ length: 100 }, b));
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(Array.from({ length: 5 }, crearAzar(43))).not.toEqual(sa.slice(0, 5));
  });

  it('el acumulador no pierde fracciones', () => {
    const acc = new Acumulador();
    let total = 0;
    for (let i = 0; i < 30; i++) total += acc.tomar(0.1);
    expect(total).toBe(3);
  });
});
