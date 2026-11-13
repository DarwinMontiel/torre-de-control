/**
 * Integración contra servicios reales (opcional). No corre con `npm test`.
 *
 *   docker compose up -d postgres redis rabbitmq
 *   npm run test:integracion
 *
 * Variables: TORRE_IT_DATABASE_URL, TORRE_IT_REDIS_URL, TORRE_IT_RABBITMQ_URL (management).
 * Verifica justo lo que los dobles no pueden garantizar: códigos de error de PostgreSQL,
 * el índice único parcial, el ON CONFLICT con CASE, la expiración real de Redis y el
 * formato real de la API de management de RabbitMQ.
 */
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leerMigraciones, migrar } from '../../src/api/adaptadores/postgres/migrador.ts';
import { CatalogoPg, EventosPg, IncidentesPg } from '../../src/api/adaptadores/postgres/repositorios.ts';
import { FuenteColasManagement } from '../../src/api/adaptadores/rabbitmq.ts';
import { CLAVES, EstadoVivoRedis } from '../../src/api/adaptadores/redis.ts';
import { ErrorConflicto, ErrorValidacion, type MensajeTorre } from '../../src/api/puertos.ts';
import { sembrarMacondo } from '../../src/api/semilla.ts';
import { alerta, en, latido } from '../ayudantes.ts';

const DATABASE_URL = process.env['TORRE_IT_DATABASE_URL'] ?? 'postgres://torre:torre@localhost:5432/torre';
const REDIS_URL = process.env['TORRE_IT_REDIS_URL'] ?? 'redis://localhost:6379';
const RABBIT_URL = process.env['TORRE_IT_RABBITMQ_URL'] ?? 'http://localhost:15672';
const BASE_PRUEBAS = 'torre_integracion';
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('PostgreSQL real', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${BASE_PRUEBAS} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${BASE_PRUEBAS}`);
    await admin.end();
    const url = new URL(DATABASE_URL);
    url.pathname = `/${BASE_PRUEBAS}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('aplica las migraciones una sola vez', async () => {
    const migraciones = await leerMigraciones();
    expect(await migrar(pool, migraciones)).toHaveLength(migraciones.length);
    expect(await migrar(pool, migraciones)).toEqual([]);
  });

  it('traduce los códigos de error reales (23505, 23503) a errores del dominio', async () => {
    const catalogo = new CatalogoPg(pool);
    const c = await sembrarMacondo(catalogo);
    expect(c?.bots).toHaveLength(7);
    await expect(catalogo.crearServidor(c!.servidores[0]!)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(catalogo.crearBot({ ...c!.bots[0]!, id: 'bot-x', servidorId: 'srv-no-existe' })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
    await expect(catalogo.eliminarServidor('srv-cauca-02')).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await catalogo.actualizarCola('rpa.payment_agreement', { umbralMensajes: 2000 })).toMatchObject({
      umbralMensajes: 2000,
    });
  });

  it('el índice único parcial y el ON CONFLICT protegen las alertas', async () => {
    const incidentes = new IncidentesPg(pool);
    await incidentes.guardar([alerta({ id: UUID(1) })]);
    await expect(incidentes.guardar([alerta({ id: UUID(2) })])).rejects.toBeInstanceOf(ErrorConflicto);
    await incidentes.guardar([alerta({ id: UUID(1), estado: 'reconocida', reconocidaPor: 'Rebeca', reconocidaEn: en(5) })]);
    await incidentes.guardar([alerta({ id: UUID(1), estado: 'activa', valor: 9 })]);
    expect(await incidentes.obtener(UUID(1))).toMatchObject({ estado: 'reconocida', reconocidaPor: 'Rebeca', valor: 9 });
    await incidentes.guardar([alerta({ id: UUID(2) }), alerta({ id: UUID(1), estado: 'resuelta', resueltaEn: en(60) })]);
    expect((await incidentes.vigentes()).map((a) => a.id)).toEqual([UUID(2)]);
  });

  it('los eventos son idempotentes por id', async () => {
    const eventos = new EventosPg(pool);
    const e = {
      id: 'evt-integracion-1',
      botId: 'bot-acuerdos-01',
      tipo: 'info' as const,
      mensaje: 'hola',
      tareaId: null,
      ocurridoEn: en(1),
    };
    await eventos.registrar([e, e]);
    expect(await eventos.recientes({ limite: 10, botId: 'bot-acuerdos-01' })).toEqual([e]);
  });
});

describe('Redis real', () => {
  const clientes: Redis[] = [];
  const nuevo = () => {
    const r = new Redis(REDIS_URL);
    clientes.push(r);
    return r;
  };
  afterAll(async () => {
    const r = nuevo();
    await r.del(CLAVES.latido('bot-integracion'), CLAVES.lider);
    for (const c of clientes) c.disconnect();
  });

  it('guarda latidos con expiración, difunde por pub/sub y reparte el liderazgo', async () => {
    const cliente = nuevo();
    const estado = new EstadoVivoRedis({ cliente, crearSuscriptor: nuevo, retencionLatidoSeg: 120 });
    await estado.registrarLatido(latido({ botId: 'bot-integracion' }));
    expect((await estado.ultimosLatidos()).get('bot-integracion')?.hostname).toBe('SRV-PRUEBA');
    expect(await cliente.ttl(CLAVES.latido('bot-integracion'))).toBeGreaterThan(100);

    const recibidos: MensajeTorre[] = [];
    const cancelar = await estado.suscribir((m) => recibidos.push(m));
    await estado.publicar({ tipo: 'alerta', motivo: 'abierta', datos: alerta() });
    await new Promise((ok) => setTimeout(ok, 200));
    expect(recibidos).toHaveLength(1);
    await cancelar();

    await cliente.del(CLAVES.lider);
    expect(await estado.tomarLiderazgo('nodo-a', 300)).toBe(true);
    expect(await estado.tomarLiderazgo('nodo-b', 300)).toBe(false);
    await new Promise((ok) => setTimeout(ok, 400));
    expect(await estado.tomarLiderazgo('nodo-b', 300)).toBe(true);
    expect(await estado.ping()).toBe(true);
  });
});

describe('RabbitMQ real (API de management)', () => {
  const cola = `rpa.integracion_${Date.now()}`;
  const auth = `Basic ${Buffer.from('guest:guest').toString('base64')}`;
  const api = (ruta: string, init: RequestInit = {}) =>
    fetch(new URL(ruta, RABBIT_URL), { ...init, headers: { authorization: auth, 'content-type': 'application/json' } });

  afterAll(async () => {
    await api(`/api/queues/%2F/${encodeURIComponent(cola)}`, { method: 'DELETE' });
  });

  it('lee mensajes y consumidores de una cola con nombre de colmena-rpa', async () => {
    expect(
      (await api(`/api/queues/%2F/${encodeURIComponent(cola)}`, { method: 'PUT', body: JSON.stringify({ durable: false }) })).ok,
    ).toBe(true);
    for (let i = 0; i < 3; i++) {
      await api('/api/exchanges/%2F/amq.default/publish', {
        method: 'POST',
        body: JSON.stringify({ properties: {}, routing_key: cola, payload: `tarea ${i}`, payload_encoding: 'string' }),
      });
    }
    const fuente = new FuenteColasManagement({
      url: RABBIT_URL,
      usuario: 'guest',
      clave: 'guest',
      vhost: '/',
      prefijo: 'rpa.integracion_',
      timeoutMs: 3000,
    });
    // Las estadísticas de management se refrescan cada pocos segundos.
    await expect
      .poll(async () => (await fuente.leer()).find((m) => m.nombre === cola)?.mensajes, { timeout: 15_000, interval: 1000 })
      .toBe(3);
    const m = (await fuente.leer()).find((x) => x.nombre === cola);
    expect(m).toMatchObject({ consumidores: 0, listos: 3, sinConfirmar: 0 });
  });
});
