import { describe, expect, it, vi } from 'vitest';
import {
  BuzonAvisos,
  ErrorWebhook,
  NotificadorCorreoSimulado,
  NotificadorWebhook,
} from '../../src/api/adaptadores/notificadores.ts';
import {
  aMetrica,
  ErrorFuenteColas,
  FuenteColasManagement,
  FuenteColasSimulada,
  inyectorDeSimulacion,
} from '../../src/api/adaptadores/rabbitmq.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import type { Aviso, EventoBot, Latido } from '../../src/dominio/tipos.ts';
import { T0 } from '../ayudantes.ts';

const respuesta = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

function fuente(fetchFalso: typeof fetch) {
  return new FuenteColasManagement({
    url: 'http://rabbitmq:15672',
    usuario: 'torre',
    clave: 'secreta',
    vhost: '/',
    prefijo: 'rpa.',
    timeoutMs: 1000,
    fetch: fetchFalso,
  });
}

describe('FuenteColasManagement', () => {
  it('consulta /api/queues del vhost con autenticación básica y filtra por prefijo', async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      respuesta(200, [
        {
          name: 'rpa.b',
          messages: 3,
          messages_ready: 2,
          messages_unacknowledged: 1,
          consumers: 2,
          message_stats: { publish_details: { rate: 1.5 }, ack_details: { rate: 0.5 } },
        },
        { name: 'rpa.a.dlq' },
        { name: 'facturacion', messages: 99 },
      ]),
    );
    const metricas = await fuente(fetchFalso).leer();
    expect(metricas).toEqual([
      { nombre: 'rpa.a.dlq', mensajes: 0, listos: 0, sinConfirmar: 0, consumidores: 0, tasaEntrada: 0, tasaSalida: 0 },
      { nombre: 'rpa.b', mensajes: 3, listos: 2, sinConfirmar: 1, consumidores: 2, tasaEntrada: 1.5, tasaSalida: 0.5 },
    ]);
    const [url, init] = fetchFalso.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : url).toMatch(/^http:\/\/rabbitmq:15672\/api\/queues\/%2F\?columns=/);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('torre:secreta').toString('base64')}`);
  });

  it.each([
    [respuesta(401, {}), /credenciales/],
    [respuesta(503, {}), /respondió 503/],
    [respuesta(200, { error: 'x' }), /se esperaba una lista/],
  ])('traduce respuestas inválidas a ErrorFuenteColas en español', async (r, mensaje) => {
    await expect(fuente(async () => r).leer()).rejects.toThrow(mensaje);
  });

  it('explica cuando RabbitMQ no está disponible', async () => {
    const error = await fuente(async () => Promise.reject(new TypeError('fetch failed')))
      .leer()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorFuenteColas);
    expect((error as Error).message).toBe('No se pudo contactar a RabbitMQ en rabbitmq:15672: fetch failed');
  });

  it('describe de dónde lee', () => {
    expect(fuente(fetch).descripcion).toBe('RabbitMQ management en rabbitmq:15672 (vhost /)');
    expect(aMetrica({ name: 'rpa.x' }).consumidores).toBe(0);
  });
});

describe('FuenteColasSimulada', () => {
  it('avanza la simulación según el tiempo real transcurrido por la aceleración', async () => {
    let ahora = 0;
    const f = new FuenteColasSimulada({ crear: () => simuladorMacondo(), aceleracion: 60, ahoraMs: () => ahora });
    await f.leer();
    expect(f.simulador.minuto).toBe(0);
    ahora = 10_000; // 10 s reales × 60 = 10 min simulados
    const metricas = await f.leer();
    expect(f.simulador.minuto).toBeCloseTo(10, 5);
    expect(metricas.find((m) => m.nombre === 'rpa.payment_agreement')?.consumidores).toBe(3);
  });

  it('vuelve a empezar la noche cuando termina', async () => {
    let ahora = 0;
    const f = new FuenteColasSimulada({ crear: () => simuladorMacondo(), aceleracion: 600, ahoraMs: () => ahora });
    ahora = 50 * 60_000; // 500 h simuladas: más que la noche entera
    await f.leer();
    expect(f.simulador.minuto).toBe(0);
  });

  it('el inyector re-sella latidos con el reloj real y solo cuando el bot simulado latió', async () => {
    const latidos: Latido[] = [];
    const eventos: EventoBot[] = [];
    const inyectar = inyectorDeSimulacion({
      registrarLatido: async (l) => void latidos.push(l),
      registrarEventos: async (e) => void eventos.push(...e),
      ahora: () => T0,
    });
    const sim = simuladorMacondo({ inicio: '2030-01-01T00:00:00.000Z' });
    sim.avanzar(20);
    await inyectar(sim);
    expect(latidos).toHaveLength(7);
    expect(latidos.every((l) => l.recibidoEn === T0)).toBe(true);
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos.every((e) => e.ocurridoEn === T0)).toBe(true);
    await inyectar(sim);
    expect(latidos).toHaveLength(7);
  });
});

describe('notificadores', () => {
  const aviso: Aviso = {
    canal: 'webhook',
    asunto: '[CRÍTICA] Cola sin consumidores',
    cuerpo: 'detalle',
    alertaId: 'a1',
    enviadoEn: T0,
  };

  it('el correo simulado deja el aviso en el buzón, el más reciente primero', async () => {
    const buzon = new BuzonAvisos(2);
    const correo = new NotificadorCorreoSimulado(buzon, ['turno@macondo.example']);
    await correo.enviar({ ...aviso, asunto: '1' });
    await correo.enviar({ ...aviso, asunto: '2' });
    await correo.enviar({ ...aviso, asunto: '3' });
    expect(buzon.listar().map((a) => a.asunto)).toEqual(['3', '2']);
    expect(correo.destinatarios).toEqual(['turno@macondo.example']);
  });

  it('el webhook envía JSON con el texto listo para chat', async () => {
    const buzon = new BuzonAvisos();
    const fetchFalso = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await new NotificadorWebhook({
      url: 'http://hooks.example/torre',
      intentos: 3,
      timeoutMs: 100,
      esperaEntreIntentosMs: 1,
      buzon,
      fetch: fetchFalso,
    }).enviar(aviso);
    const cuerpo = JSON.parse(fetchFalso.mock.calls[0]?.[1]?.body as string) as { texto: string };
    expect(cuerpo.texto).toBe('[CRÍTICA] Cola sin consumidores\n\ndetalle');
    expect(buzon.listar()).toHaveLength(1);
  });

  it('reintenta errores 5xx y de red, y se rinde con un error claro', async () => {
    const fetchFalso = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await new NotificadorWebhook({
      url: 'http://x',
      intentos: 3,
      timeoutMs: 100,
      esperaEntreIntentosMs: 1,
      fetch: fetchFalso,
    }).enviar(aviso);
    expect(fetchFalso).toHaveBeenCalledTimes(3);

    const siempreFalla = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
    await expect(
      new NotificadorWebhook({
        url: 'http://x',
        intentos: 2,
        timeoutMs: 100,
        esperaEntreIntentosMs: 1,
        fetch: siempreFalla,
      }).enviar(aviso),
    ).rejects.toThrow(new ErrorWebhook('El webhook rechazó el aviso «[CRÍTICA] Cola sin consumidores»: HTTP 500'));
  });

  it('no reintenta un 4xx (salvo 429)', async () => {
    const f400 = vi.fn<typeof fetch>(async () => new Response(null, { status: 400 }));
    await expect(
      new NotificadorWebhook({ url: 'http://x', intentos: 3, timeoutMs: 100, esperaEntreIntentosMs: 1, fetch: f400 }).enviar(
        aviso,
      ),
    ).rejects.toThrow(/HTTP 400/);
    expect(f400).toHaveBeenCalledTimes(1);
    const f429 = vi.fn<typeof fetch>(async () => new Response(null, { status: 429 }));
    await expect(
      new NotificadorWebhook({ url: 'http://x', intentos: 2, timeoutMs: 100, esperaEntreIntentosMs: 1, fetch: f429 }).enviar(
        aviso,
      ),
    ).rejects.toThrow(/HTTP 429/);
    expect(f429).toHaveBeenCalledTimes(2);
  });
});
