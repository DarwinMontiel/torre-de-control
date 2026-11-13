import { describe, expect, it, vi } from 'vitest';
import type { MensajeTorre, Notificador } from '../../src/api/puertos.ts';
import { latido, metrica } from '../ayudantes.ts';
import { armarBanco, type Banco } from './armar.ts';

async function latenTodos(b: Banco, ids = ['bot-1', 'bot-2', 'bot-3']) {
  for (const id of ids) await b.estado.registrarLatido(latido({ botId: id, recibidoEn: b.reloj.ahora() }));
}

describe('Vigia', () => {
  it('con todo sano construye la instantánea y no abre alertas', async () => {
    const b = armarBanco();
    await latenTodos(b);
    b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement', mensajes: 12, consumidores: 3 })];
    const r = await b.vigia.ciclo();
    expect(r?.cambios.abiertas).toEqual([]);
    expect(r?.instantanea.resumen.bots.enLinea).toBe(3);
    expect(await b.estado.ultimaInstantanea()).toEqual(r?.instantanea);
    expect(b.vigia.estadoFuente).toMatchObject({ ok: true, error: null, ultimaLecturaOk: b.reloj.ahora() });
  });

  it('abre, persiste, avisa y difunde; luego resuelve y vuelve a avisar', async () => {
    const b = armarBanco();
    const difundidos: MensajeTorre[] = [];
    await b.estado.suscribir((m) => difundidos.push(m));
    await latenTodos(b);
    b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 3, consumidores: 0 })];

    const r1 = await b.vigia.ciclo();
    expect(r1?.cambios.abiertas.map((a) => a.clave)).toEqual(['dlq_con_mensajes:rpa.payment_agreement.dlq']);
    expect((await b.deps.incidentes.vigentes()).map((a) => a.clave)).toEqual(['dlq_con_mensajes:rpa.payment_agreement.dlq']);
    expect(b.buzon.listar()[0]?.asunto).toBe('[ADVERTENCIA] DLQ con 3 mensajes · rpa.payment_agreement.dlq');
    expect(difundidos.map((m) => (m.tipo === 'alerta' ? `alerta:${m.motivo}` : m.tipo))).toEqual([
      'alerta:abierta',
      'instantanea',
    ]);

    b.reloj.avanzar(30);
    await latenTodos(b);
    await b.vigia.ciclo(); // mismo problema: no repite el aviso
    expect(b.buzon.listar()).toHaveLength(1);

    b.reloj.avanzar(30);
    await latenTodos(b);
    b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 0, consumidores: 0 })];
    const r3 = await b.vigia.ciclo();
    expect(r3?.cambios.resueltas).toHaveLength(1);
    expect(b.buzon.listar()[0]?.asunto).toMatch(/^\[RESUELTA\]/);
    expect(r3?.instantanea.alertas[0]?.estado).toBe('resuelta');
  });

  it('detecta un bot sin latido con el paso del tiempo', async () => {
    const b = armarBanco();
    await latenTodos(b);
    await b.vigia.ciclo();
    b.reloj.avanzar(60);
    await latenTodos(b, ['bot-1', 'bot-3']);
    const r = await b.vigia.ciclo();
    expect(r?.cambios.abiertas.map((a) => a.clave)).toEqual(['bot_sin_latido:bot-2']);
  });

  it('si RabbitMQ falla conserva las últimas métricas y lo informa una sola vez', async () => {
    const b = armarBanco();
    await latenTodos(b);
    b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement', mensajes: 5, consumidores: 0 })];
    await b.vigia.ciclo();
    b.fuente.error = new Error('No se pudo contactar a RabbitMQ');
    const r = await b.vigia.ciclo();
    await b.vigia.ciclo();
    expect(r?.instantanea.colas[0]?.mensajes).toBe(5);
    expect(b.vigia.estadoFuente).toMatchObject({ ok: false, error: 'No se pudo contactar a RabbitMQ' });
    expect(b.log.mensajes.filter((m) => m.includes('RabbitMQ'))).toHaveLength(1);
  });

  it('un canal de aviso caído no impide los demás ni detiene el ciclo', async () => {
    const enviados: string[] = [];
    const roto: Notificador = { canal: 'webhook', enviar: async () => Promise.reject(new Error('webhook caído')) };
    const sano: Notificador = { canal: 'correo', enviar: async (a) => void enviados.push(a.asunto) };
    const b = armarBanco({ notificadores: [roto, sano] });
    await latenTodos(b, ['bot-1', 'bot-2']);
    const r = await b.vigia.ciclo();
    expect(r?.cambios.abiertas).toHaveLength(1);
    expect(enviados).toEqual(['[CRÍTICA] Servidor B caído · srv-b']);
    expect(b.log.mensajes).toContain('webhook caído');
  });

  it('una réplica que no es líder no evalúa ni publica', async () => {
    const b = armarBanco();
    await b.estado.tomarLiderazgo('otro-nodo', 60_000);
    expect(await b.vigia.ciclo()).toBeNull();
    expect(await b.estado.ultimaInstantanea()).toBeNull();
  });

  it('iniciar ejecuta ciclos periódicos y detener espera el ciclo en curso', async () => {
    vi.useFakeTimers();
    try {
      const b = armarBanco();
      const ciclo = vi.spyOn(b.vigia, 'ciclo');
      b.vigia.iniciar();
      b.vigia.iniciar(); // idempotente
      await vi.advanceTimersByTimeAsync(2500);
      await b.vigia.detener();
      const llamadas = ciclo.mock.calls.length;
      expect(llamadas).toBeGreaterThanOrEqual(3);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ciclo.mock.calls.length).toBe(llamadas);
    } finally {
      vi.useRealTimers();
    }
  });

  it('un ciclo que falla se registra y no detiene el temporizador', async () => {
    vi.useFakeTimers();
    try {
      const b = armarBanco();
      vi.spyOn(b.deps.catalogo, 'catalogo').mockRejectedValue(new Error('PostgreSQL no responde'));
      b.vigia.iniciar();
      await vi.advanceTimersByTimeAsync(1500);
      await b.vigia.detener();
      expect(b.log.mensajes.filter((m) => m.startsWith('El ciclo del vigía falló'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
