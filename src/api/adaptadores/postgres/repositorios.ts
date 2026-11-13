/** Repositorios sobre PostgreSQL. SQL explícito y parametrizado; sin ORM (ver ADR-0004). */
import type { Alerta, Bot, Catalogo, Cola, EventoBot, Servidor } from '../../../dominio/tipos.ts';
import {
  ErrorConflicto,
  ErrorValidacion,
  type FiltroAlertas,
  type FiltroEventos,
  type RepositorioCatalogo,
  type RepositorioEventos,
  type RepositorioIncidentes,
} from '../../puertos.ts';
import type { ConexionPg } from './tipos.ts';

type Fila = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoONulo = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function codigo(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}
function esLlaveForanea(error: unknown): boolean {
  return codigo(error) === '23503' || /foreign key/i.test((error as Error).message);
}
function esDuplicado(error: unknown): boolean {
  return codigo(error) === '23505';
}

const aServidor = (f: Fila): Servidor => ({
  id: texto(f['id']),
  nombre: texto(f['nombre']),
  sistema: f['sistema'] === 'windows' ? 'windows' : 'linux',
  ip: texto(f['ip']),
  ubicacion: texto(f['ubicacion']),
  descripcion: texto(f['descripcion']),
});
const aBot = (f: Fila): Bot => ({
  id: texto(f['id']),
  alias: texto(f['alias']),
  proceso: texto(f['proceso']),
  servidorId: texto(f['servidor_id']),
  descripcion: texto(f['descripcion']),
});
const aCola = (f: Fila): Cola => ({
  nombre: texto(f['nombre']),
  proceso: texto(f['proceso']),
  tipo: f['tipo'] as Cola['tipo'],
  umbralMensajes: Number(f['umbral_mensajes']),
  umbralCrecimientoPorMin: Number(f['umbral_crecimiento_por_min']),
});

/** Construye `SET a = $2, b = $3` solo con las columnas presentes. */
function asignaciones(cambios: Record<string, unknown>, columnas: Record<string, string>) {
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const [campo, columna] of Object.entries(columnas)) {
    if (cambios[campo] === undefined) continue;
    valores.push(cambios[campo]);
    sets.push(`${columna} = $${valores.length + 1}`);
  }
  sets.push('actualizado_en = now()');
  return { sets: sets.join(', '), valores };
}

export class CatalogoPg implements RepositorioCatalogo {
  readonly #db: ConexionPg;

  constructor(db: ConexionPg) {
    this.#db = db;
  }

  async catalogo(): Promise<Catalogo> {
    const [servidores, bots, colas] = await Promise.all([this.listarServidores(), this.listarBots(), this.listarColas()]);
    return { servidores, bots, colas };
  }

  async listarServidores() {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM servidores ORDER BY id');
    return rows.map(aServidor);
  }
  async obtenerServidor(id: string) {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM servidores WHERE id = $1', [id]);
    return rows[0] ? aServidor(rows[0]) : null;
  }
  async crearServidor(s: Servidor) {
    try {
      await this.#db.query(
        'INSERT INTO servidores (id, nombre, sistema, ip, ubicacion, descripcion) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, s.nombre, s.sistema, s.ip, s.ubicacion, s.descripcion],
      );
      return s;
    } catch (e) {
      if (esDuplicado(e)) throw new ErrorConflicto(`Ya existe el servidor ${s.id}.`, { cause: e });
      throw e;
    }
  }
  async actualizarServidor(id: string, cambios: Partial<Omit<Servidor, 'id'>>) {
    const { sets, valores } = asignaciones(cambios, {
      nombre: 'nombre',
      sistema: 'sistema',
      ip: 'ip',
      ubicacion: 'ubicacion',
      descripcion: 'descripcion',
    });
    const { rows } = await this.#db.query<Fila>(`UPDATE servidores SET ${sets} WHERE id = $1 RETURNING *`, [id, ...valores]);
    return rows[0] ? aServidor(rows[0]) : null;
  }
  async eliminarServidor(id: string) {
    try {
      const r = await this.#db.query('DELETE FROM servidores WHERE id = $1', [id]);
      return (r.rowCount ?? 0) > 0;
    } catch (e) {
      if (esLlaveForanea(e)) {
        throw new ErrorConflicto(`El servidor ${id} tiene bots asignados; reasígnalos antes de eliminarlo.`, { cause: e });
      }
      throw e;
    }
  }

  async listarBots() {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM bots ORDER BY id');
    return rows.map(aBot);
  }
  async obtenerBot(id: string) {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM bots WHERE id = $1', [id]);
    return rows[0] ? aBot(rows[0]) : null;
  }
  async crearBot(b: Bot) {
    try {
      await this.#db.query('INSERT INTO bots (id, alias, proceso, servidor_id, descripcion) VALUES ($1, $2, $3, $4, $5)', [
        b.id,
        b.alias,
        b.proceso,
        b.servidorId,
        b.descripcion,
      ]);
      return b;
    } catch (e) {
      if (esDuplicado(e)) throw new ErrorConflicto(`Ya existe el bot ${b.id}.`, { cause: e });
      if (esLlaveForanea(e)) throw new ErrorValidacion(`El servidor ${b.servidorId} no existe en el catálogo.`, { cause: e });
      throw e;
    }
  }
  async actualizarBot(id: string, cambios: Partial<Omit<Bot, 'id'>>) {
    const { sets, valores } = asignaciones(cambios, {
      alias: 'alias',
      proceso: 'proceso',
      servidorId: 'servidor_id',
      descripcion: 'descripcion',
    });
    try {
      const { rows } = await this.#db.query<Fila>(`UPDATE bots SET ${sets} WHERE id = $1 RETURNING *`, [id, ...valores]);
      return rows[0] ? aBot(rows[0]) : null;
    } catch (e) {
      if (esLlaveForanea(e))
        throw new ErrorValidacion(`El servidor ${String(cambios.servidorId)} no existe en el catálogo.`, { cause: e });
      throw e;
    }
  }
  async eliminarBot(id: string) {
    const r = await this.#db.query('DELETE FROM bots WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async listarColas() {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM colas ORDER BY nombre');
    return rows.map(aCola);
  }
  async obtenerCola(nombre: string) {
    const { rows } = await this.#db.query<Fila>('SELECT * FROM colas WHERE nombre = $1', [nombre]);
    return rows[0] ? aCola(rows[0]) : null;
  }
  async crearCola(c: Cola) {
    try {
      await this.#db.query(
        'INSERT INTO colas (nombre, proceso, tipo, umbral_mensajes, umbral_crecimiento_por_min) VALUES ($1, $2, $3, $4, $5)',
        [c.nombre, c.proceso, c.tipo, c.umbralMensajes, c.umbralCrecimientoPorMin],
      );
      return c;
    } catch (e) {
      if (esDuplicado(e)) throw new ErrorConflicto(`Ya existe la cola ${c.nombre}.`, { cause: e });
      throw e;
    }
  }
  async actualizarCola(nombre: string, cambios: Partial<Omit<Cola, 'nombre'>>) {
    const { sets, valores } = asignaciones(cambios, {
      proceso: 'proceso',
      tipo: 'tipo',
      umbralMensajes: 'umbral_mensajes',
      umbralCrecimientoPorMin: 'umbral_crecimiento_por_min',
    });
    const { rows } = await this.#db.query<Fila>(`UPDATE colas SET ${sets} WHERE nombre = $1 RETURNING *`, [nombre, ...valores]);
    return rows[0] ? aCola(rows[0]) : null;
  }
  async eliminarCola(nombre: string) {
    const r = await this.#db.query('DELETE FROM colas WHERE nombre = $1', [nombre]);
    return (r.rowCount ?? 0) > 0;
  }
}

const aAlerta = (f: Fila): Alerta => ({
  id: texto(f['id']),
  clave: texto(f['clave']),
  regla: f['regla'] as Alerta['regla'],
  severidad: f['severidad'] as Alerta['severidad'],
  objetivo: texto(f['objetivo']),
  titulo: texto(f['titulo']),
  detalle: texto(f['detalle']),
  valor: Number(f['valor']),
  estado: f['estado'] as Alerta['estado'],
  abiertaEn: iso(f['abierta_en']),
  actualizadaEn: iso(f['actualizada_en']),
  reconocidaEn: isoONulo(f['reconocida_en']),
  reconocidaPor: f['reconocida_por'] === null || f['reconocida_por'] === undefined ? null : texto(f['reconocida_por']),
  resueltaEn: isoONulo(f['resuelta_en']),
});

export class IncidentesPg implements RepositorioIncidentes {
  readonly #db: ConexionPg;

  constructor(db: ConexionPg) {
    this.#db = db;
  }

  async vigentes() {
    const { rows } = await this.#db.query<Fila>("SELECT * FROM incidentes WHERE estado <> 'resuelta' ORDER BY abierta_en");
    return rows.map(aAlerta);
  }

  async guardar(alertas: readonly Alerta[]) {
    if (alertas.length === 0) return;
    const cliente = await this.#db.connect();
    try {
      await cliente.query('BEGIN');
      // Primero las que se resuelven: liberan su clave en el índice único parcial.
      const ordenadas = [...alertas].sort((a, b) => Number(b.estado === 'resuelta') - Number(a.estado === 'resuelta'));
      for (const a of ordenadas) {
        await cliente.query(
          `INSERT INTO incidentes (id, clave, regla, severidad, objetivo, titulo, detalle, valor, estado,
             abierta_en, actualizada_en, reconocida_en, reconocida_por, resuelta_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (id) DO UPDATE SET
             severidad = EXCLUDED.severidad, titulo = EXCLUDED.titulo, detalle = EXCLUDED.detalle,
             valor = EXCLUDED.valor, actualizada_en = EXCLUDED.actualizada_en, resuelta_en = EXCLUDED.resuelta_en,
             -- Un reconocimiento concurrente no se pierde si el vigía escribe con una copia vieja.
             estado = CASE WHEN incidentes.estado = 'reconocida' AND EXCLUDED.estado = 'activa'
                           THEN incidentes.estado ELSE EXCLUDED.estado END,
             reconocida_en = COALESCE(EXCLUDED.reconocida_en, incidentes.reconocida_en),
             reconocida_por = COALESCE(EXCLUDED.reconocida_por, incidentes.reconocida_por)`,
          [
            a.id,
            a.clave,
            a.regla,
            a.severidad,
            a.objetivo,
            a.titulo,
            a.detalle,
            a.valor,
            a.estado,
            a.abiertaEn,
            a.actualizadaEn,
            a.reconocidaEn,
            a.reconocidaPor,
            a.resueltaEn,
          ],
        );
      }
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK');
      if (esDuplicado(e)) throw new ErrorConflicto('Ya existe una alerta vigente con esa clave.', { cause: e });
      throw e;
    } finally {
      cliente.release();
    }
  }

  async obtener(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.#db.query<Fila>('SELECT * FROM incidentes WHERE id = $1', [id]);
    return rows[0] ? aAlerta(rows[0]) : null;
  }

  async listar(f: FiltroAlertas) {
    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const agregar = (columna: string, valor: unknown) => {
      valores.push(valor);
      condiciones.push(`${columna} = $${valores.length}`);
    };
    if (f.estado) agregar('estado', f.estado);
    if (f.regla) agregar('regla', f.regla);
    if (f.objetivo) agregar('objetivo', f.objetivo);
    valores.push(f.limite);
    const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await this.#db.query<Fila>(
      `SELECT * FROM incidentes ${donde} ORDER BY abierta_en DESC, id DESC LIMIT $${valores.length}`,
      valores,
    );
    return rows.map(aAlerta);
  }
}

const aEvento = (f: Fila): EventoBot => ({
  id: texto(f['id']),
  botId: texto(f['bot_id']),
  tipo: f['tipo'] as EventoBot['tipo'],
  mensaje: texto(f['mensaje']),
  tareaId: f['tarea_id'] === null || f['tarea_id'] === undefined ? null : texto(f['tarea_id']),
  ocurridoEn: iso(f['ocurrido_en']),
});

export class EventosPg implements RepositorioEventos {
  readonly #db: ConexionPg;

  constructor(db: ConexionPg) {
    this.#db = db;
  }

  async registrar(eventos: readonly EventoBot[]) {
    for (const e of eventos) {
      await this.#db.query(
        `INSERT INTO eventos_bot (id, bot_id, tipo, mensaje, tarea_id, ocurrido_en)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.botId, e.tipo, e.mensaje, e.tareaId, e.ocurridoEn],
      );
    }
  }

  async recientes(f: FiltroEventos) {
    const { rows } = f.botId
      ? await this.#db.query<Fila>('SELECT * FROM eventos_bot WHERE bot_id = $1 ORDER BY ocurrido_en DESC, id DESC LIMIT $2', [
          f.botId,
          f.limite,
        ])
      : await this.#db.query<Fila>('SELECT * FROM eventos_bot ORDER BY ocurrido_en DESC, id DESC LIMIT $1', [f.limite]);
    return rows.map(aEvento);
  }
}
