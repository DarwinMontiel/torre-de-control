import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppTorre } from '../../src/api/app.ts';
import { metricasPrometheus } from '../../src/api/rutas/sistema.ts';
import { T0, latido, metrica } from '../ayudantes.ts';
import { armarApp, armarBanco, type Banco } from './armar.ts';

const ADMIN = { authorization: 'Bearer admin-de-prueba' };
const BOTS = { authorization: 'Bearer bots-de-prueba' };

const latidoEntrada = (botId: string, extra: Record<string, unknown> = {}) => ({
  botId,
  hostname: 'MAGDALENA-01',
  plataforma: 'Windows Server 2022',
  procesos: ['payment_agreement'],
  estado: 'BUSY',
  tareaActual: 'MAC-000001',
  tareasOk: 3,
  tareasFallidas: 0,
  version: '1.4.0',
  iniciadoEn: T0,
  ...extra,
});

describe('API', () => {
  let b: Banco;
  let app: AppTorre;

  beforeEach(async () => {
    b = armarBanco({ tokens: { admin: 'admin-de-prueba', bots: 'bots-de-prueba' } });
    app = await armarApp(b);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('sistema', () => {
    it('GET /salud y /salud/lista', async () => {
      expect((await app.inject('/api/v1/salud')).json()).toEqual({ estado: 'ok', version: '1.0.0' });
      const lista = await app.inject('/api/v1/salud/lista');
      expect(lista.statusCode).toBe(200);
      expect(lista.json()).toEqual({
        lista: true,
        componentes: { catalogo: 'ok', estado_vivo: 'ok', fuente_colas: 'falla: aún sin lectura' },
      });
    });

    it('/salud/lista responde 503 si el estado vivo no responde', async () => {
      b.deps.estado.ping = async () => false;
      const r = await app.inject('/api/v1/salud/lista');
      expect(r.statusCode).toBe(503);
      expect(r.json().componentes.estado_vivo).toBe('falla: sin respuesta');
    });

    it('publica OpenAPI en español con todas las rutas documentadas', async () => {
      const doc = (await app.inject('/docs/json')).json<{
        info: { title: string };
        paths: Record<string, Record<string, unknown>>;
      }>();
      expect(doc.info.title).toBe('Torre de Control · API');
      const operaciones = Object.values(doc.paths).flatMap((p) => Object.keys(p));
      expect(operaciones.length).toBeGreaterThanOrEqual(30);
      expect(doc.paths['/api/v1/latidos']?.['post']).toMatchObject({ summary: 'Reportar un latido', tags: ['SDK de bots'] });
      expect((await app.inject('/')).headers.location).toBe('/docs');
    });

    it('responde 404 en español para rutas inexistentes', async () => {
      const r = await app.inject('/api/v1/nada');
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'no_encontrado', mensaje: 'No existe la ruta GET /api/v1/nada.' });
    });
  });

  describe('estado', () => {
    it('antes del primer ciclo responde 503 y después la instantánea', async () => {
      expect((await app.inject('/api/v1/instantanea')).statusCode).toBe(503);
      expect((await app.inject('/api/v1/resumen')).json().error).toBe('sin_datos');
      b.fuente.metricas = [metrica({ nombre: 'rpa.payment_agreement', mensajes: 7, consumidores: 0 })];
      await b.vigia.ciclo();
      const i = (await app.inject('/api/v1/instantanea')).json();
      expect(i.colas[0]).toMatchObject({ nombre: 'rpa.payment_agreement', mensajes: 7, tipo: 'principal', catalogada: true });
      expect((await app.inject('/api/v1/resumen')).json().alertas.criticas).toBeGreaterThan(0);
      const metricas = await app.inject('/api/v1/metrics');
      expect(metricas.headers['content-type']).toMatch(/^text\/plain/);
      expect(metricas.body).toContain('torre_cola_mensajes{cola="rpa.payment_agreement",tipo="principal"} 7');
    });

    it('expone las reglas y el buzón de avisos', async () => {
      expect((await app.inject('/api/v1/reglas')).json()).toHaveLength(5);
      await b.vigia.ciclo();
      const avisos = (await app.inject('/api/v1/avisos?limite=2')).json<unknown[]>();
      expect(avisos).toHaveLength(2);
    });

    it('las métricas sin instantánea solo informan la versión', () => {
      expect(metricasPrometheus(null, '9.9.9')).toBe(
        '# HELP torre_info Versión de la Torre de Control.\n# TYPE torre_info gauge\ntorre_info{version="9.9.9"} 1\n',
      );
    });
  });

  describe('catálogo', () => {
    const servidor = { id: 'srv-nuevo-09', nombre: 'NUEVO-09', sistema: 'linux', ip: '10.20.0.99' };
    const conDescripcion = { ...servidor, descripcion: 'Ubuntu 24.04 · pruebas' };

    it('crea con valores por defecto, consulta, modifica y elimina', async () => {
      const creado = await app.inject({ method: 'POST', url: '/api/v1/servidores', headers: ADMIN, payload: servidor });
      expect(creado.statusCode).toBe(201);
      expect(creado.json()).toEqual({ ...servidor, ubicacion: '', descripcion: '' });
      expect((await app.inject('/api/v1/servidores/srv-nuevo-09')).json().nombre).toBe('NUEVO-09');
      const mod = await app.inject({
        method: 'PATCH',
        url: '/api/v1/servidores/srv-nuevo-09',
        headers: ADMIN,
        payload: { ubicacion: 'rack C' },
      });
      expect(mod.json()).toMatchObject({ ubicacion: 'rack C', nombre: 'NUEVO-09' });
      // Un PATCH no rellena con valores por defecto los campos que no envió.
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/servidores/srv-nuevo-09',
        headers: ADMIN,
        payload: { descripcion: conDescripcion.descripcion },
      });
      const otra = await app.inject({
        method: 'PATCH',
        url: '/api/v1/servidores/srv-nuevo-09',
        headers: ADMIN,
        payload: { nombre: 'NUEVO-10' },
      });
      expect(otra.json()).toMatchObject({ nombre: 'NUEVO-10', descripcion: conDescripcion.descripcion, ubicacion: 'rack C' });
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/servidores/srv-nuevo-09', headers: ADMIN })).statusCode).toBe(
        204,
      );
      expect((await app.inject('/api/v1/servidores/srv-nuevo-09')).statusCode).toBe(404);
    });

    it('exige el token de administración para escribir (el de bots no basta)', async () => {
      expect((await app.inject({ method: 'POST', url: '/api/v1/servidores', payload: servidor })).statusCode).toBe(401);
      const r = await app.inject({ method: 'POST', url: '/api/v1/servidores', headers: BOTS, payload: servidor });
      expect(r.statusCode).toBe(401);
      expect(r.json().mensaje).toBe('Falta el token o no es válido para esta operación.');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/v1/bots/bot-1',
            headers: { authorization: 'Bearer admin-de-prueba-x' },
          })
        ).statusCode,
      ).toBe(401);
    });

    it('valida la entrada con mensajes en español', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/servidores',
        headers: ADMIN,
        payload: { ...servidor, sistema: 'solaris', extra: 1 },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('solicitud_invalida');
      expect(r.json().mensaje).toMatch(/^La solicitud no es válida: .*(debe|no debe)/);
      const vacio = await app.inject({ method: 'PATCH', url: '/api/v1/bots/bot-1', headers: ADMIN, payload: {} });
      expect(vacio.statusCode).toBe(400);
    });

    it('traduce conflictos e integridad a 409 y 422', async () => {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/servidores', headers: ADMIN, payload: { ...servidor, id: 'srv-a' } }))
          .statusCode,
      ).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/servidores/srv-a', headers: ADMIN })).statusCode).toBe(409);
      const huerfano = await app.inject({
        method: 'POST',
        url: '/api/v1/bots',
        headers: ADMIN,
        payload: { id: 'bot-x', alias: 'Equis', proceso: 'payment_agreement', servidorId: 'srv-zzz' },
      });
      expect(huerfano.statusCode).toBe(422);
      expect(huerfano.json().mensaje).toBe('El servidor srv-zzz no existe en el catálogo.');
    });

    it('administra bots y colas', async () => {
      expect((await app.inject('/api/v1/bots')).json<unknown[]>().length).toBe(3);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/v1/bots/bot-1', headers: ADMIN, payload: { alias: 'Úrsula' } })).json()
          .alias,
      ).toBe('Úrsula');
      expect((await app.inject('/api/v1/bots/nada')).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/v1/bots/nada', headers: ADMIN, payload: { alias: 'x' } })).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/bots/bot-3', headers: ADMIN })).statusCode).toBe(204);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/bots/bot-3', headers: ADMIN })).statusCode).toBe(404);

      const cola = {
        nombre: 'rpa.support_download',
        proceso: 'support_download',
        tipo: 'principal',
        umbralMensajes: 300,
        umbralCrecimientoPorMin: 10,
      };
      expect((await app.inject({ method: 'POST', url: '/api/v1/colas', headers: ADMIN, payload: cola })).statusCode).toBe(201);
      expect((await app.inject('/api/v1/colas/rpa.support_download')).json()).toEqual(cola);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/v1/colas/rpa.support_download',
            headers: ADMIN,
            payload: { umbralMensajes: 50 },
          })
        ).json().umbralMensajes,
      ).toBe(50);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/v1/colas/nada', headers: ADMIN, payload: { umbralMensajes: 50 } }))
          .statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/colas/rpa.support_download', headers: ADMIN })).statusCode).toBe(
        204,
      );
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/colas/rpa.support_download', headers: ADMIN })).statusCode).toBe(
        404,
      );
      expect((await app.inject('/api/v1/colas/nada')).statusCode).toBe(404);
      expect((await app.inject('/api/v1/colas')).json<unknown[]>().length).toBe(2);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/v1/servidores/nada', headers: ADMIN, payload: { nombre: 'x' } }))
          .statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/servidores/nada', headers: ADMIN })).statusCode).toBe(404);
      expect((await app.inject('/api/v1/servidores')).json<unknown[]>().length).toBe(2);
    });
  });

  describe('SDK de bots', () => {
    it('recibe latidos con el reloj de la torre y los expone con su salud', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/v1/latidos', headers: BOTS, payload: latidoEntrada('bot-1') });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ recibidoEn: T0, ttlLatidoSeg: 45, registradoAhora: false });
      expect((await app.inject('/api/v1/bots/bot-1/latido')).json()).toMatchObject({
        salud: 'en_linea',
        latido: { estado: 'BUSY', recibidoEn: T0 },
      });
      b.reloj.avanzar(120);
      expect((await app.inject('/api/v1/bots/bot-1/latido')).json().salud).toBe('sin_latido');
      expect((await app.inject('/api/v1/bots/bot-2/latido')).statusCode).toBe(404);
    });

    it('el token de administración también sirve para los latidos', async () => {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/latidos', headers: ADMIN, payload: latidoEntrada('bot-1') }))
          .statusCode,
      ).toBe(202);
      expect((await app.inject({ method: 'POST', url: '/api/v1/latidos', payload: latidoEntrada('bot-1') })).statusCode).toBe(
        401,
      );
    });

    it('autorregistra un bot desconocido y su servidor a partir del hostname', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/latidos',
        headers: BOTS,
        payload: latidoEntrada('bot-nuevo-01', { hostname: 'ATRATO-04 (Ñ)', procesos: ['support_download'] }),
      });
      expect(r.json().registradoAhora).toBe(true);
      expect((await app.inject('/api/v1/bots/bot-nuevo-01')).json()).toMatchObject({
        proceso: 'support_download',
        servidorId: 'srv-atrato-04-n',
      });
      expect((await app.inject('/api/v1/servidores/srv-atrato-04-n')).json()).toMatchObject({
        sistema: 'windows',
        nombre: 'ATRATO-04 (Ñ)',
      });
      const otra = await app.inject({
        method: 'POST',
        url: '/api/v1/latidos',
        headers: BOTS,
        payload: latidoEntrada('bot-nuevo-02', { hostname: 'ATRATO-04 (Ñ)', procesos: [] }),
      });
      expect(otra.json().registradoAhora).toBe(true);
      expect((await app.inject('/api/v1/bots/bot-nuevo-02')).json().proceso).toBe('sin_proceso');
    });

    it('sin autorregistro rechaza bots desconocidos', async () => {
      const banco = armarBanco({ autoregistro: false });
      const otra = await armarApp(banco);
      const r = await otra.inject({ method: 'POST', url: '/api/v1/latidos', payload: latidoEntrada('bot-fantasma') });
      expect(r.statusCode).toBe(404);
      expect((await otra.inject({ method: 'POST', url: '/api/v1/latidos', payload: latidoEntrada('bot-1') })).statusCode).toBe(
        202,
      );
      await otra.close();
    });

    it('rechaza latidos con estados que no existen en colmena-rpa', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/latidos',
        headers: BOTS,
        payload: latidoEntrada('bot-1', { estado: 'DORMIDO' }),
      });
      expect(r.statusCode).toBe(400);
    });

    it('registra eventos de forma idempotente, individuales o en lote, y los difunde', async () => {
      const difundidos: string[] = [];
      await b.estado.suscribir((m) => difundidos.push(m.tipo));
      const evento = {
        id: 'evt-00000001',
        botId: 'bot-1',
        tipo: 'tarea_ok',
        mensaje: 'Acuerdo MAC-000001 registrado',
        tareaId: 'MAC-000001',
      };
      const r = await app.inject({ method: 'POST', url: '/api/v1/eventos', headers: BOTS, payload: evento });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ ...evento, ocurridoEn: T0 });
      await app.inject({ method: 'POST', url: '/api/v1/eventos', headers: BOTS, payload: evento });
      const lote = await app.inject({
        method: 'POST',
        url: '/api/v1/eventos/lote',
        headers: BOTS,
        payload: {
          eventos: [{ botId: 'bot-2', tipo: 'reintento', mensaje: 'Portal 503', ocurridoEn: '2026-12-01T03:00:05-05:00' }],
        },
      });
      expect(lote.json()).toEqual({ registrados: 1 });
      const lista = (await app.inject('/api/v1/eventos?limite=10')).json<{ id: string; ocurridoEn: string }[]>();
      expect(lista).toHaveLength(2);
      expect(lista[0]?.ocurridoEn).toBe('2026-12-01T08:00:05.000Z');
      expect((await app.inject('/api/v1/eventos?botId=bot-1')).json<unknown[]>().length).toBe(1);
      expect(difundidos.filter((t) => t === 'evento_bot')).toHaveLength(3);
    });
  });

  describe('alertas', () => {
    async function abrirAlerta() {
      await b.estado.registrarLatido(latido({ botId: 'bot-1', recibidoEn: T0 }));
      await b.estado.registrarLatido(latido({ botId: 'bot-3', recibidoEn: T0 }));
      await b.vigia.ciclo();
      const [a] = (await app.inject('/api/v1/alertas?estado=activa')).json<{ id: string; clave: string }[]>();
      return a;
    }

    it('lista, filtra y obtiene alertas', async () => {
      const a = await abrirAlerta();
      expect(a?.clave).toBe('bot_sin_latido:bot-2');
      expect((await app.inject('/api/v1/alertas?regla=servidor_caido')).json<unknown[]>().length).toBe(0);
      expect((await app.inject(`/api/v1/alertas/${a?.id}`)).json().clave).toBe('bot_sin_latido:bot-2');
      expect((await app.inject('/api/v1/alertas/00000000-0000-4000-8000-0000000000ff')).statusCode).toBe(404);
      expect((await app.inject('/api/v1/alertas?estado=rara')).statusCode).toBe(400);
    });

    it('reconoce una alerta activa una sola vez', async () => {
      const a = await abrirAlerta();
      b.reloj.avanzar(10);
      const r = await app.inject({ method: 'POST', url: `/api/v1/alertas/${a?.id}/reconocer`, payload: { operador: 'Rebeca' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ estado: 'reconocida', reconocidaPor: 'Rebeca' });
      const otra = await app.inject({
        method: 'POST',
        url: `/api/v1/alertas/${a?.id}/reconocer`,
        payload: { operador: 'Rebeca' },
      });
      expect(otra.statusCode).toBe(409);
      expect(otra.json().mensaje).toMatch(/solo se reconocen alertas activas/);
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/alertas/nada/reconocer', payload: { operador: 'Rebeca' } })).statusCode,
      ).toBe(404);
      // El siguiente ciclo del vigía no pisa el reconocimiento.
      await b.vigia.ciclo();
      expect((await app.inject(`/api/v1/alertas/${a?.id}`)).json().estado).toBe('reconocida');
    });
  });

  describe('errores internos', () => {
    it('ocultan el detalle técnico al cliente', async () => {
      b.deps.catalogo.listarBots = async () => Promise.reject(new Error('detalle sensible de la base'));
      const r = await app.inject('/api/v1/bots');
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ error: 'interno', mensaje: 'Error interno de la torre. Revisa los logs.' });
    });
  });
});

describe('API sin tokens configurados (modo desarrollo)', () => {
  it('permite escrituras sin autenticación', async () => {
    const app = await armarApp(armarBanco());
    const r = await app.inject({ method: 'POST', url: '/api/v1/latidos', payload: latidoEntrada('bot-1') });
    expect(r.statusCode).toBe(202);
    await app.close();
  });
});
