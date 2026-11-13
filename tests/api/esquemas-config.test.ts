import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { ErrorConfig, leerConfig } from '../../src/api/config.ts';
import { Alerta, Bot, Cola, Instantanea, LatidoEntrada, Servidor } from '../../src/api/esquemas.ts';
import { catalogoMacondo } from '../../src/dominio/macondo.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { TorreLocal } from '../../src/dominio/torre-local.ts';

describe('esquemas de la API frente a los tipos del dominio', () => {
  it('una instantánea real de la noche del cierre cumple el esquema publicado', () => {
    const torre = new TorreLocal(simuladorMacondo());
    torre.ciclo(100 * 60); // en plena caída de CAUCA-02: hay alertas, eventos y bots sin latido
    const i = torre.instantanea();
    expect(i.alertas.length).toBeGreaterThan(0);
    expect([...Value.Errors(Instantanea, i)]).toEqual([]);
    expect(i.alertas.every((a) => Value.Check(Alerta, a))).toBe(true);
  });

  it('el catálogo ficticio cumple los esquemas de alta', () => {
    const c = catalogoMacondo();
    expect(c.servidores.every((s) => Value.Check(Servidor, s))).toBe(true);
    expect(c.bots.every((b) => Value.Check(Bot, b))).toBe(true);
    expect(c.colas.every((q) => Value.Check(Cola, q))).toBe(true);
  });

  it('el latido del simulador (sin recibidoEn) es un latido de entrada válido para el SDK', () => {
    const sim = simuladorMacondo();
    sim.avanzar(30);
    for (const l of sim.latidos().values()) {
      const { recibidoEn: _, ...entrada } = l;
      expect(Value.Check(LatidoEntrada, entrada)).toBe(true);
    }
  });
});

describe('leerConfig', () => {
  it('tiene valores por defecto razonables para desarrollo', () => {
    const c = leerConfig({});
    expect(c).toMatchObject({
      puerto: 3000,
      almacen: 'postgres',
      fuenteColas: 'simulada',
      ttlLatidoSeg: 45,
      redisUrl: null,
      tokenAdmin: null,
      autoregistro: true,
      correoDestinatarios: ['turno-noche@macondo.example'],
    });
  });

  it('lee y convierte cada variable', () => {
    const c = leerConfig({
      TORRE_PUERTO: '8080',
      TORRE_ALMACEN: 'memoria',
      TORRE_FUENTE_COLAS: 'rabbitmq',
      TORRE_REDIS_URL: 'redis://redis:6379',
      TORRE_REGLAS_DESACTIVADAS: 'cola_creciendo, dlq_con_mensajes',
      TORRE_AUTOREGISTRO: 'no',
      TORRE_SEMBRAR_MACONDO: 'sí',
      TORRE_TOKEN_BOTS: '  secreto  ',
      TORRE_CORREO_DESTINATARIOS: 'a@x.example,b@x.example',
      TORRE_NODO: 'torre-1',
    });
    expect(c).toMatchObject({
      puerto: 8080,
      almacen: 'memoria',
      fuenteColas: 'rabbitmq',
      redisUrl: 'redis://redis:6379',
      reglasDesactivadas: ['cola_creciendo', 'dlq_con_mensajes'],
      autoregistro: false,
      sembrarMacondo: true,
      tokenBots: 'secreto',
      correoDestinatarios: ['a@x.example', 'b@x.example'],
      nodo: 'torre-1',
    });
  });

  it.each([
    [{ TORRE_PUERTO: 'ochenta' }, 'TORRE_PUERTO debe ser un entero entre 1 y 65535 (recibido: "ochenta").'],
    [{ TORRE_ALMACEN: 'mysql' }, 'TORRE_ALMACEN debe ser uno de: postgres, memoria (recibido: "mysql").'],
    [{ TORRE_AUTOREGISTRO: 'quizas' }, 'TORRE_AUTOREGISTRO debe ser true o false (recibido: "quizas").'],
    [
      { TORRE_REGLAS_DESACTIVADAS: 'regla_inventada' },
      'TORRE_REGLAS_DESACTIVADAS contiene una regla desconocida: "regla_inventada".',
    ],
    [
      { TORRE_TTL_LATIDO_SEG: '600', TORRE_RETENCION_LATIDO_SEG: '120' },
      'TORRE_RETENCION_LATIDO_SEG no puede ser menor que TORRE_TTL_LATIDO_SEG.',
    ],
  ])('rechaza configuraciones inválidas con un mensaje claro: %o', (env, mensaje) => {
    expect(() => leerConfig(env)).toThrow(new ErrorConfig(mensaje));
  });
});
