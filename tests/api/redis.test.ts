import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { EstadoVivoEnMemoria } from '../../src/api/adaptadores/memoria.ts';
import { CLAVES, EstadoVivoRedis } from '../../src/api/adaptadores/redis.ts';
import type { EstadoVivo, MensajeTorre } from '../../src/api/puertos.ts';
import { TorreLocal } from '../../src/dominio/torre-local.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { alerta, latido } from '../ayudantes.ts';

const clientes: Redis[] = [];
function nuevoRedis(): Redis {
  const r = new RedisMock();
  clientes.push(r);
  return r;
}

afterEach(async () => {
  await nuevoRedis().flushall();
  for (const c of clientes.splice(0)) c.disconnect();
});

const implementaciones: [string, () => { estado: EstadoVivo; redis?: Redis }][] = [
  [
    'redis (ioredis-mock)',
    () => {
      const redis = nuevoRedis();
      return { redis, estado: new EstadoVivoRedis({ cliente: redis, crearSuscriptor: nuevoRedis, retencionLatidoSeg: 3600 }) };
    },
  ],
  ['memoria', () => ({ estado: new EstadoVivoEnMemoria() })],
];

describe.each(implementaciones)('estado vivo · %s', (_n, crear) => {
  it('guarda el último latido de cada bot', async () => {
    const { estado } = crear();
    await estado.registrarLatido(latido({ botId: 'bot-1', tareasOk: 1 }));
    await estado.registrarLatido(latido({ botId: 'bot-1', tareasOk: 2 }));
    await estado.registrarLatido(latido({ botId: 'bot-2' }));
    const mapa = await estado.ultimosLatidos();
    expect([...mapa.keys()].sort()).toEqual(['bot-1', 'bot-2']);
    expect(mapa.get('bot-1')?.tareasOk).toBe(2);
  });

  it('guarda y devuelve la última instantánea', async () => {
    const { estado } = crear();
    expect(await estado.ultimaInstantanea()).toBeNull();
    const torre = new TorreLocal(simuladorMacondo());
    torre.ciclo(60);
    const i = torre.instantanea();
    await estado.guardarInstantanea(i);
    expect(await estado.ultimaInstantanea()).toEqual(i);
  });

  it('difunde mensajes a los suscriptores y deja de hacerlo al cancelar', async () => {
    const { estado } = crear();
    const recibidos: MensajeTorre[] = [];
    const cancelar = await estado.suscribir((m) => recibidos.push(m));
    const m: MensajeTorre = { tipo: 'alerta', motivo: 'abierta', datos: alerta() };
    await estado.publicar(m);
    await new Promise((ok) => setTimeout(ok, 20));
    expect(recibidos).toEqual([m]);
    await cancelar();
    await estado.publicar(m);
    await new Promise((ok) => setTimeout(ok, 20));
    expect(recibidos).toHaveLength(1);
  });

  it('un solo nodo es líder; puede renovar y otro toma el relevo cuando vence', async () => {
    const { estado } = crear();
    expect(await estado.tomarLiderazgo('nodo-a', 60)).toBe(true);
    expect(await estado.tomarLiderazgo('nodo-b', 60)).toBe(false);
    expect(await estado.tomarLiderazgo('nodo-a', 60)).toBe(true);
    await new Promise((ok) => setTimeout(ok, 90));
    expect(await estado.tomarLiderazgo('nodo-b', 60)).toBe(true);
    expect(await estado.ping()).toBe(true);
  });
});

describe('EstadoVivoRedis', () => {
  it('guarda cada latido con expiración de retención', async () => {
    const redis = nuevoRedis();
    const estado = new EstadoVivoRedis({ cliente: redis, crearSuscriptor: nuevoRedis, retencionLatidoSeg: 120 });
    await estado.registrarLatido(latido({ botId: 'bot-9' }));
    const ttl = await redis.ttl(CLAVES.latido('bot-9'));
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('ignora mensajes malformados en el canal sin romper la suscripción', async () => {
    const redis = nuevoRedis();
    const estado = new EstadoVivoRedis({ cliente: redis, crearSuscriptor: nuevoRedis, retencionLatidoSeg: 120 });
    const recibidos: MensajeTorre[] = [];
    await estado.suscribir((m) => recibidos.push(m));
    await redis.publish(CLAVES.canal, '{no es json');
    await redis.publish('otro-canal', JSON.stringify({ tipo: 'x' }));
    await estado.publicar({ tipo: 'alerta', motivo: 'resuelta', datos: alerta() });
    await new Promise((ok) => setTimeout(ok, 20));
    expect(recibidos.map((m) => m.tipo)).toEqual(['alerta']);
  });

  it('reporta falla de ping si Redis no responde', async () => {
    const redis = nuevoRedis();
    const estado = new EstadoVivoRedis({ cliente: redis, crearSuscriptor: nuevoRedis, retencionLatidoSeg: 120 });
    redis.ping = (() => Promise.reject(new Error('sin conexión'))) as Redis['ping'];
    expect(await estado.ping()).toBe(false);
  });
});
