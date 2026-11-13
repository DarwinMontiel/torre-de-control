import { describe, expect, it } from 'vitest';
import type { MensajeTorre } from '../../src/api/puertos.ts';
import { latido, metrica } from '../ayudantes.ts';
import { armarApp, armarBanco } from './armar.ts';

function proximoMensaje(ws: { once: (e: 'message', f: (d: Buffer) => void) => void }): Promise<string> {
  return new Promise((ok) => ws.once('message', (d) => ok(d.toString())));
}

describe('WebSocket /api/v1/ws', () => {
  it('entrega la última instantánea al conectar y luego cada ciclo y cada alerta', async () => {
    const b = armarBanco();
    const app = await armarApp(b);
    for (const id of ['bot-1', 'bot-2', 'bot-3'])
      await b.estado.registrarLatido(latido({ botId: id, recibidoEn: b.reloj.ahora() }));
    await b.vigia.ciclo();

    let primero: Promise<string> = Promise.resolve('');
    const ws = await app.injectWS(
      '/api/v1/ws',
      {},
      {
        onInit: (s) => {
          primero = proximoMensaje(s);
        },
      },
    );
    expect((JSON.parse(await primero) as MensajeTorre).tipo).toBe('instantanea');

    const recibidos: MensajeTorre[] = [];
    ws.on('message', (d: Buffer) => {
      if (d.toString() !== 'pong') recibidos.push(JSON.parse(d.toString()) as MensajeTorre);
    });
    b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement.dlq', mensajes: 4, consumidores: 0 })];
    await b.vigia.ciclo();
    await new Promise((ok) => setTimeout(ok, 30));
    expect(recibidos.map((m) => (m.tipo === 'alerta' ? `${m.tipo}:${m.motivo}` : m.tipo))).toEqual([
      'alerta:abierta',
      'instantanea',
    ]);

    const pong = proximoMensaje(ws);
    ws.send('ping');
    expect(await pong).toBe('pong');

    ws.terminate();
    await app.close();
  });

  it('sin instantánea previa no envía nada al conectar', async () => {
    const b = armarBanco();
    const app = await armarApp(b);
    const ws = await app.injectWS('/api/v1/ws');
    const recibidos: string[] = [];
    ws.on('message', (d: Buffer) => recibidos.push(d.toString()));
    await new Promise((ok) => setTimeout(ok, 30));
    expect(recibidos).toEqual([]);
    ws.terminate();
    await app.close();
  });
});
