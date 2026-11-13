/**
 * Pruebas de contrato: la misma batería corre contra el adaptador en memoria y contra
 * PostgreSQL (pg-mem con las migraciones reales). Si ambos pasan, son intercambiables.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogoEnMemoria, EventosEnMemoria, IncidentesEnMemoria } from '../../src/api/adaptadores/memoria.ts';
import { CatalogoPg, EventosPg, IncidentesPg } from '../../src/api/adaptadores/postgres/repositorios.ts';
import {
  ErrorConflicto,
  ErrorValidacion,
  type RepositorioCatalogo,
  type RepositorioEventos,
  type RepositorioIncidentes,
} from '../../src/api/puertos.ts';
import { sembrarMacondo } from '../../src/api/semilla.ts';
import { alerta, catalogoPequeno, en, T0 } from '../ayudantes.ts';
import { baseMigrada } from './pg-mem.ts';

interface Repos {
  catalogo: RepositorioCatalogo;
  incidentes: RepositorioIncidentes;
  eventos: RepositorioEventos;
}

const implementaciones: [string, () => Promise<Repos>][] = [
  [
    'memoria',
    async () => ({ catalogo: new CatalogoEnMemoria(), incidentes: new IncidentesEnMemoria(), eventos: new EventosEnMemoria() }),
  ],
  [
    'postgres (pg-mem)',
    async () => {
      const db = await baseMigrada();
      return { catalogo: new CatalogoPg(db), incidentes: new IncidentesPg(db), eventos: new EventosPg(db) };
    },
  ],
];

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe.each(implementaciones)('contrato de repositorios · %s', (_nombre, crear) => {
  let r: Repos;
  const c = catalogoPequeno();

  beforeEach(async () => {
    r = await crear();
    for (const s of c.servidores) await r.catalogo.crearServidor(s);
    for (const b of c.bots) await r.catalogo.crearBot(b);
    for (const q of c.colas) await r.catalogo.crearCola(q);
  });

  describe('catálogo', () => {
    it('lista todo ordenado por identificador', async () => {
      const cat = await r.catalogo.catalogo();
      expect(cat.servidores.map((s) => s.id)).toEqual(['srv-a', 'srv-b']);
      expect(cat.bots.map((b) => b.id)).toEqual(['bot-1', 'bot-2', 'bot-3']);
      expect(cat.colas).toEqual([...c.colas].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    });

    it('obtiene, actualiza parcialmente y elimina', async () => {
      expect(await r.catalogo.obtenerServidor('srv-b')).toEqual(c.servidores[1]);
      expect(await r.catalogo.actualizarServidor('srv-b', { nombre: 'B-NUEVO' })).toMatchObject({
        id: 'srv-b',
        nombre: 'B-NUEVO',
        ip: '10.0.0.2',
      });
      expect(await r.catalogo.actualizarBot('bot-3', { alias: 'Tercero', servidorId: 'srv-a' })).toMatchObject({
        alias: 'Tercero',
        servidorId: 'srv-a',
      });
      expect(await r.catalogo.actualizarCola('rpa.payment_agreement', { umbralMensajes: 7 })).toMatchObject({
        umbralMensajes: 7,
        tipo: 'principal',
      });
      expect(await r.catalogo.eliminarBot('bot-3')).toBe(true);
      expect(await r.catalogo.eliminarBot('bot-3')).toBe(false);
      expect(await r.catalogo.eliminarServidor('srv-b')).toBe(true);
      expect(await r.catalogo.eliminarCola('rpa.payment_agreement.dlq')).toBe(true);
      expect(await r.catalogo.obtenerCola('rpa.payment_agreement.dlq')).toBeNull();
    });

    it('devuelve null al actualizar algo que no existe', async () => {
      expect(await r.catalogo.actualizarServidor('nada', { nombre: 'x' })).toBeNull();
      expect(await r.catalogo.actualizarBot('nada', { alias: 'x' })).toBeNull();
      expect(await r.catalogo.actualizarCola('nada', { umbralMensajes: 1 })).toBeNull();
      expect(await r.catalogo.obtenerBot('nada')).toBeNull();
    });

    it('rechaza duplicados con ErrorConflicto', async () => {
      await expect(r.catalogo.crearServidor(c.servidores[0]!)).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(r.catalogo.crearBot(c.bots[0]!)).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(r.catalogo.crearCola(c.colas[0]!)).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('protege la integridad: no hay bots en servidores inexistentes ni servidores con bots huérfanos', async () => {
      await expect(r.catalogo.crearBot({ ...c.bots[0]!, id: 'bot-x', servidorId: 'srv-zzz' })).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
      await expect(r.catalogo.actualizarBot('bot-1', { servidorId: 'srv-zzz' })).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(r.catalogo.eliminarServidor('srv-a')).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('la semilla de Macondo solo se aplica a un catálogo vacío', async () => {
      expect(await sembrarMacondo(r.catalogo)).toBeNull();
      const vacio = await crear();
      const sembrado = await sembrarMacondo(vacio.catalogo);
      expect(sembrado?.bots).toHaveLength(7);
      expect(await vacio.catalogo.listarColas()).toHaveLength(15);
    });
  });

  describe('incidentes', () => {
    it('guarda, actualiza por id y separa vigentes de resueltas', async () => {
      await r.incidentes.guardar([alerta({ id: UUID(1) }), alerta({ id: UUID(2), clave: 'k2', abiertaEn: en(60) })]);
      await r.incidentes.guardar([alerta({ id: UUID(1), estado: 'resuelta', resueltaEn: en(120), valor: 9 })]);
      expect((await r.incidentes.vigentes()).map((a) => a.id)).toEqual([UUID(2)]);
      expect(await r.incidentes.obtener(UUID(1))).toMatchObject({
        estado: 'resuelta',
        resueltaEn: en(120),
        valor: 9,
        abiertaEn: T0,
      });
    });

    it('filtra y ordena del más reciente al más antiguo', async () => {
      await r.incidentes.guardar([
        alerta({ id: UUID(1), abiertaEn: en(0), clave: 'a' }),
        alerta({ id: UUID(2), abiertaEn: en(60), clave: 'b', regla: 'bot_sin_latido', objetivo: 'bot-1' }),
        alerta({ id: UUID(3), abiertaEn: en(30), clave: 'c', estado: 'resuelta', resueltaEn: en(40) }),
      ]);
      expect((await r.incidentes.listar({ limite: 10 })).map((a) => a.id)).toEqual([UUID(2), UUID(3), UUID(1)]);
      expect((await r.incidentes.listar({ limite: 1 })).map((a) => a.id)).toEqual([UUID(2)]);
      expect((await r.incidentes.listar({ limite: 10, estado: 'resuelta' })).map((a) => a.id)).toEqual([UUID(3)]);
      expect((await r.incidentes.listar({ limite: 10, regla: 'bot_sin_latido', objetivo: 'bot-1' })).map((a) => a.id)).toEqual([
        UUID(2),
      ]);
    });

    it('impide dos alertas vigentes con la misma clave', async () => {
      await r.incidentes.guardar([alerta({ id: UUID(1) })]);
      await expect(r.incidentes.guardar([alerta({ id: UUID(2) })])).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('permite reabrir un problema resuelto en la misma operación en que se resuelve el anterior', async () => {
      await r.incidentes.guardar([alerta({ id: UUID(1) })]);
      await r.incidentes.guardar([alerta({ id: UUID(2) }), alerta({ id: UUID(1), estado: 'resuelta', resueltaEn: en(5) })]);
      expect((await r.incidentes.vigentes()).map((a) => a.id)).toEqual([UUID(2)]);
    });

    it('no pierde un reconocimiento si el vigía escribe con una copia vieja', async () => {
      await r.incidentes.guardar([alerta({ id: UUID(1) })]);
      await r.incidentes.guardar([alerta({ id: UUID(1), estado: 'reconocida', reconocidaPor: 'Rebeca', reconocidaEn: en(10) })]);
      await r.incidentes.guardar([alerta({ id: UUID(1), estado: 'activa', valor: 8, actualizadaEn: en(20) })]);
      expect(await r.incidentes.obtener(UUID(1))).toMatchObject({ estado: 'reconocida', reconocidaPor: 'Rebeca', valor: 8 });
    });

    it('devuelve null para ids inexistentes o mal formados', async () => {
      expect(await r.incidentes.obtener(UUID(99))).toBeNull();
      expect(await r.incidentes.obtener('no-es-uuid')).toBeNull();
      await r.incidentes.guardar([]);
    });
  });

  describe('eventos', () => {
    it('registra de forma idempotente y lista los recientes por bot', async () => {
      const ev = (id: string, botId: string, s: number) => ({
        id,
        botId,
        tipo: 'info' as const,
        mensaje: id,
        tareaId: null,
        ocurridoEn: en(s),
      });
      await r.eventos.registrar([ev('e-0001', 'bot-1', 1), ev('e-0002', 'bot-2', 2), ev('e-0003', 'bot-1', 3)]);
      await r.eventos.registrar([ev('e-0001', 'bot-1', 1)]);
      expect((await r.eventos.recientes({ limite: 10 })).map((e) => e.id)).toEqual(['e-0003', 'e-0002', 'e-0001']);
      expect((await r.eventos.recientes({ limite: 10, botId: 'bot-1' })).map((e) => e.id)).toEqual(['e-0003', 'e-0001']);
      expect(await r.eventos.recientes({ limite: 1 })).toMatchObject([{ id: 'e-0003', tareaId: null, ocurridoEn: en(3) }]);
    });
  });
});
