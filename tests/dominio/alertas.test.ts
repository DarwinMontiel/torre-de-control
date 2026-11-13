import { describe, expect, it } from 'vitest';
import { conciliarAlertas, duracionMin, ErrorTransicion, reconocer } from '../../src/dominio/alertas.ts';
import { redactarAviso } from '../../src/dominio/avisos.ts';
import { alerta, en, hallazgo, T0 } from '../ayudantes.ts';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('conciliarAlertas', () => {
  it('abre una alerta por cada hallazgo nuevo', () => {
    const r = conciliarAlertas([], [hallazgo(), hallazgo({ clave: 'otra', objetivo: 'otra' })], T0, ids());
    expect(r.abiertas.map((a) => [a.id, a.estado, a.abiertaEn])).toEqual([
      ['id-1', 'activa', T0],
      ['id-2', 'activa', T0],
    ]);
    expect(r.vigentes).toHaveLength(2);
  });

  it('no duplica ni reescribe si el problema sigue igual', () => {
    const previa = alerta();
    const r = conciliarAlertas([previa], [hallazgo()], en(60), ids());
    expect(r.abiertas).toEqual([]);
    expect(r.actualizadas).toEqual([]);
    expect(r.vigentes).toEqual([previa]);
  });

  it('actualiza el valor sin volver a avisar cuando no sube la severidad', () => {
    const r = conciliarAlertas([alerta()], [hallazgo({ valor: 4, titulo: 'DLQ con 4 mensajes' })], en(60), ids());
    expect(r.actualizadas).toMatchObject([{ id: alerta().id, valor: 4, actualizadaEn: en(60), abiertaEn: T0 }]);
    expect(r.escaladas).toEqual([]);
  });

  it('escala cuando la severidad sube y conserva el reconocimiento', () => {
    const previa = alerta({ estado: 'reconocida', reconocidaPor: 'Rebeca', reconocidaEn: en(30) });
    const r = conciliarAlertas([previa], [hallazgo({ severidad: 'critica', valor: 40 })], en(60), ids());
    expect(r.escaladas).toMatchObject([{ severidad: 'critica', estado: 'reconocida', reconocidaPor: 'Rebeca' }]);
  });

  it('resuelve las vigentes cuyo hallazgo desapareció, incluidas las reconocidas', () => {
    const r = conciliarAlertas([alerta({ estado: 'reconocida' })], [], en(600), ids());
    expect(r.resueltas).toMatchObject([{ estado: 'resuelta', resueltaEn: en(600) }]);
    expect(r.vigentes).toEqual([]);
  });

  it('ignora alertas ya resueltas: el mismo problema vuelve a abrir una nueva', () => {
    const r = conciliarAlertas([alerta({ estado: 'resuelta', resueltaEn: en(10) })], [hallazgo()], en(60), ids());
    expect(r.abiertas).toHaveLength(1);
    expect(r.abiertas[0]?.id).toBe('id-1');
  });
});

describe('reconocer', () => {
  it('marca quién y cuándo', () => {
    expect(reconocer(alerta(), 'Rebeca', en(5))).toMatchObject({
      estado: 'reconocida',
      reconocidaPor: 'Rebeca',
      reconocidaEn: en(5),
    });
  });

  it.each(['reconocida', 'resuelta'] as const)('rechaza reconocer una alerta %s', (estado) => {
    expect(() => reconocer(alerta({ estado }), 'Rebeca', en(5))).toThrow(ErrorTransicion);
  });
});

describe('avisos', () => {
  it('redacta el aviso de apertura con severidad en el asunto', () => {
    const { asunto, cuerpo } = redactarAviso(alerta({ severidad: 'critica' }), 'abierta', T0);
    expect(asunto).toBe('[CRÍTICA] DLQ con 3 mensajes · rpa.x.dlq');
    expect(cuerpo).toContain('Regla: dlq_con_mensajes');
    expect(cuerpo).not.toContain('Duración');
  });

  it('marca el escalamiento y, al resolver, la duración y quién atendió', () => {
    expect(redactarAviso(alerta(), 'escalada', T0).asunto).toMatch(/^\[ADVERTENCIA\]\[ESCALÓ\]/);
    const resuelta = alerta({ estado: 'resuelta', resueltaEn: en(25 * 60), reconocidaPor: 'Rebeca' });
    const { asunto, cuerpo } = redactarAviso(resuelta, 'resuelta', en(25 * 60));
    expect(asunto).toMatch(/^\[RESUELTA\]/);
    expect(cuerpo).toContain('Duración: 25 min');
    expect(cuerpo).toContain('Reconocida por: Rebeca');
  });

  it('calcula la duración de una alerta abierta contra el reloj actual', () => {
    expect(duracionMin(alerta(), en(90))).toBe(2);
  });
});
