import { describe, expect, it } from 'vitest';
import {
  CONFIG_REGLAS_POR_DEFECTO,
  DESCRIPCION_REGLAS,
  evaluarReglas,
  type ContextoEvaluacion,
} from '../../src/dominio/reglas.ts';
import { saludBot, saludServidor } from '../../src/dominio/salud.ts';
import { HistorialColas } from '../../src/dominio/tendencia.ts';
import { CODIGOS_REGLA } from '../../src/dominio/tipos.ts';
import { catalogoPequeno, en, historialLineal, latido, latidosVivos, metrica, T0 } from '../ayudantes.ts';

const AHORA = en(600);
const TODOS = ['bot-1', 'bot-2', 'bot-3'];

function contexto(parcial: Partial<ContextoEvaluacion> = {}): ContextoEvaluacion {
  return {
    ahora: AHORA,
    catalogo: catalogoPequeno(),
    latidos: latidosVivos(TODOS, AHORA),
    metricas: [],
    historial: new HistorialColas(10),
    ...parcial,
  };
}

const reglas = (ctx: ContextoEvaluacion) => evaluarReglas(ctx).map((h) => h.clave);

describe('salud', () => {
  it('distingue en línea, sin latido, detenido y nunca visto', () => {
    expect(saludBot(undefined, AHORA, 45)).toBe('nunca_visto');
    expect(saludBot(latido({ botId: 'x', recibidoEn: en(560) }), AHORA, 45)).toBe('en_linea');
    expect(saludBot(latido({ botId: 'x', recibidoEn: en(500) }), AHORA, 45)).toBe('sin_latido');
    expect(saludBot(latido({ botId: 'x', recibidoEn: en(500), estado: 'STOPPING' }), AHORA, 45)).toBe('detenido');
  });

  it('el borde del TTL todavía cuenta como en línea', () => {
    expect(saludBot(latido({ botId: 'x', recibidoEn: en(555) }), AHORA, 45)).toBe('en_linea');
  });

  it('un servidor solo está caído si ninguno de sus bots vive', () => {
    expect(saludServidor([])).toBe('sin_bots');
    expect(saludServidor(['en_linea', 'detenido'])).toBe('operativo');
    expect(saludServidor(['en_linea', 'sin_latido'])).toBe('degradado');
    expect(saludServidor(['sin_latido', 'nunca_visto'])).toBe('caido');
  });
});

describe('evaluarReglas', () => {
  it('no encuentra nada en una operación sana', () => {
    const ctx = contexto({ metricas: [metrica({ nombre: 'rpa.payment_agreement', mensajes: 40, consumidores: 3 })] });
    expect(evaluarReglas(ctx)).toEqual([]);
  });

  describe('dlq_con_mensajes', () => {
    it('es advertencia con pocos mensajes y crítica sobre el umbral de la cola', () => {
      const pocos = evaluarReglas(
        contexto({ metricas: [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 1, consumidores: 0 })] }),
      );
      expect(pocos).toMatchObject([{ regla: 'dlq_con_mensajes', severidad: 'advertencia', titulo: 'DLQ con 1 mensaje' }]);
      const muchos = evaluarReglas(
        contexto({ metricas: [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 6, consumidores: 0 })] }),
      );
      expect(muchos[0]?.severidad).toBe('critica');
    });

    it('descubre DLQ que no están en el catálogo por su nombre', () => {
      const h = evaluarReglas(
        contexto({ metricas: [metrica({ nombre: 'rpa.support_download.dlq', mensajes: 2, consumidores: 0 })] }),
      );
      expect(h.map((x) => x.clave)).toEqual(['dlq_con_mensajes:rpa.support_download.dlq']);
    });

    it('ignora colas que no siguen la convención', () => {
      expect(evaluarReglas(contexto({ metricas: [metrica({ nombre: 'facturas.dlq', mensajes: 9 })] }))).toEqual([]);
    });
  });

  describe('cola_sin_consumidores', () => {
    it('salta si hay mensajes y nadie consume la cola principal', () => {
      const ctx = contexto({ metricas: [metrica({ nombre: 'rpa.payment_agreement', mensajes: 3, consumidores: 0 })] });
      expect(reglas(ctx)).toEqual(['cola_sin_consumidores:rpa.payment_agreement']);
    });

    it('una cola vacía sin consumidores no es problema, ni una cola de reintento', () => {
      const ctx = contexto({
        metricas: [
          metrica({ nombre: 'rpa.payment_agreement', mensajes: 0, consumidores: 0 }),
          metrica({ nombre: 'rpa.payment_agreement.retry.10s', mensajes: 7, consumidores: 0 }),
        ],
      });
      expect(evaluarReglas(ctx)).toEqual([]);
    });
  });

  describe('cola_creciendo', () => {
    const nombre = 'rpa.payment_agreement';

    it('salta con crecimiento sostenido sobre el umbral', () => {
      const ctx = contexto({ historial: historialLineal(nombre, 10, 15, 5), metricas: [metrica({ nombre, mensajes: 85 })] });
      expect(evaluarReglas(ctx)).toMatchObject([{ regla: 'cola_creciendo', severidad: 'advertencia', valor: 15 }]);
    });

    it('es crítica si además la cola está saturada', () => {
      const ctx = contexto({ historial: historialLineal(nombre, 60, 15, 5), metricas: [metrica({ nombre, mensajes: 135 })] });
      expect(evaluarReglas(ctx)[0]?.severidad).toBe('critica');
    });

    it('no juzga con menos historia que la cobertura mínima', () => {
      const ctx = contexto({ historial: historialLineal(nombre, 10, 50, 2), metricas: [metrica({ nombre, mensajes: 110 })] });
      expect(evaluarReglas(ctx)).toEqual([]);
    });

    it('una cola grande que baja no alerta', () => {
      const ctx = contexto({ historial: historialLineal(nombre, 900, -20, 8), metricas: [metrica({ nombre, mensajes: 740 })] });
      expect(evaluarReglas(ctx)).toEqual([]);
    });
  });

  describe('bots y servidores', () => {
    it('alerta por un bot sin latido con su último estado y tarea', () => {
      const latidos = latidosVivos(TODOS, AHORA);
      latidos.set(
        'bot-2',
        latido({ botId: 'bot-2', recibidoEn: en(480), estado: 'BUSY', tareaActual: 'MAC-000042', hostname: 'A' }),
      );
      const [h, ...resto] = evaluarReglas(contexto({ latidos }));
      expect(resto).toEqual([]);
      expect(h).toMatchObject({ clave: 'bot_sin_latido:bot-2', severidad: 'critica', valor: 120 });
      expect(h?.detalle).toContain('MAC-000042');
    });

    it('no alerta por un bot que anunció su parada', () => {
      const latidos = latidosVivos(TODOS, AHORA);
      latidos.set('bot-3', latido({ botId: 'bot-3', recibidoEn: en(100), estado: 'STOPPING' }));
      expect(evaluarReglas(contexto({ latidos }))).toEqual([]);
    });

    it('un bot catalogado que nunca reportó es advertencia', () => {
      const latidos = latidosVivos(['bot-1', 'bot-3'], AHORA);
      expect(evaluarReglas(contexto({ latidos }))).toMatchObject([{ clave: 'bot_sin_latido:bot-2', severidad: 'advertencia' }]);
    });

    it('inhibe las alertas de bots cuando cae todo su servidor', () => {
      const latidos = latidosVivos(['bot-3'], AHORA);
      latidos.set('bot-1', latido({ botId: 'bot-1', recibidoEn: T0 }));
      latidos.set('bot-2', latido({ botId: 'bot-2', recibidoEn: T0 }));
      expect(reglas(contexto({ latidos }))).toEqual(['servidor_caido:srv-a']);
    });

    it('si solo cae uno de los bots del servidor, la alerta es del bot', () => {
      const latidos = latidosVivos(['bot-1', 'bot-3'], AHORA);
      latidos.set('bot-2', latido({ botId: 'bot-2', recibidoEn: T0 }));
      expect(reglas(contexto({ latidos }))).toEqual(['bot_sin_latido:bot-2']);
    });
  });

  it('ordena por severidad y respeta reglas desactivadas', () => {
    const latidos = latidosVivos(['bot-1', 'bot-3'], AHORA);
    const ctx = contexto({ latidos, metricas: [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 2, consumidores: 0 })] });
    expect(evaluarReglas(ctx).map((h) => h.severidad)).toEqual(['advertencia', 'advertencia']);
    const sinDlq = evaluarReglas(ctx, { ...CONFIG_REGLAS_POR_DEFECTO, desactivadas: ['dlq_con_mensajes'] });
    expect(sinDlq.map((h) => h.regla)).toEqual(['bot_sin_latido']);
  });

  it('documenta todas las reglas que existen', () => {
    expect(DESCRIPCION_REGLAS.map((d) => d.codigo).sort()).toEqual([...CODIGOS_REGLA].sort());
  });
});
