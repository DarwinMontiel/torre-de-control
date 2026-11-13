/**
 * Instantánea: la foto completa que pinta el tablero.
 *
 * La construye el vigía de la API en cada ciclo y la empuja por WebSocket; en la demo
 * de GitHub Pages la construye el navegador con el simulador. Es la misma función en
 * ambos casos, así que lo que se ve en la demo es exactamente lo que vería operación.
 */
import { esVigente } from './alertas.ts';
import { botsDe, saludBot, saludServidor, segundosDesde } from './salud.ts';
import type { HistorialColas } from './tendencia.ts';
import { colaPorDefecto, inferirCola } from './topologia.ts';
import type {
  Alerta,
  Bot,
  Catalogo,
  Cola,
  EstadoBot,
  EventoBot,
  Latido,
  MetricaCola,
  SaludBot,
  SaludServidor,
  Servidor,
} from './tipos.ts';

export interface VistaCola extends Cola, Omit<MetricaCola, 'nombre'> {
  pendientePorMin: number;
  serie: number[];
  catalogada: boolean;
}

export interface VistaBot extends Bot {
  salud: SaludBot;
  estado: EstadoBot | null;
  servidor: string;
  hostname: string | null;
  version: string | null;
  tareaActual: string | null;
  tareasOk: number;
  tareasFallidas: number;
  ultimoLatidoHaceSeg: number | null;
}

export interface VistaServidor extends Servidor {
  salud: SaludServidor;
  bots: number;
  botsEnLinea: number;
}

export interface Resumen {
  bots: { total: number; enLinea: number; ocupados: number; sinLatido: number };
  servidores: { total: number; operativos: number; caidos: number };
  colas: { total: number; pendientes: number; enDlq: number; consumidores: number };
  tareas: { ok: number; fallidas: number };
  alertas: { criticas: number; advertencias: number; reconocidas: number };
}

export interface Instantanea {
  generadaEn: string;
  resumen: Resumen;
  colas: VistaCola[];
  bots: VistaBot[];
  servidores: VistaServidor[];
  /** Vigentes primero, luego las resueltas más recientes. */
  alertas: Alerta[];
  eventos: EventoBot[];
}

export interface EntradaInstantanea {
  ahora: string;
  catalogo: Catalogo;
  latidos: ReadonlyMap<string, Latido>;
  metricas: readonly MetricaCola[];
  historial: HistorialColas;
  alertas: readonly Alerta[];
  eventos: readonly EventoBot[];
  ttlLatidoSeg: number;
  maxEventos?: number;
  maxResueltas?: number;
}

export function construirInstantanea(e: EntradaInstantanea): Instantanea {
  const servidoresPorId = new Map(e.catalogo.servidores.map((s) => [s.id, s]));

  const bots: VistaBot[] = e.catalogo.bots.map((b) => {
    const l = e.latidos.get(b.id);
    return {
      ...b,
      salud: saludBot(l, e.ahora, e.ttlLatidoSeg),
      estado: l?.estado ?? null,
      servidor: servidoresPorId.get(b.servidorId)?.nombre ?? b.servidorId,
      hostname: l?.hostname ?? null,
      version: l?.version ?? null,
      tareaActual: l?.tareaActual ?? null,
      tareasOk: l?.tareasOk ?? 0,
      tareasFallidas: l?.tareasFallidas ?? 0,
      ultimoLatidoHaceSeg: l ? Math.round(segundosDesde(l.recibidoEn, e.ahora)) : null,
    };
  });
  const saludPorBot = new Map(bots.map((b) => [b.id, b.salud]));

  const servidores: VistaServidor[] = e.catalogo.servidores.map((s) => {
    const suyos = botsDe(s, e.catalogo.bots).map((b) => saludPorBot.get(b.id) ?? 'nunca_visto');
    return {
      ...s,
      salud: saludServidor(suyos),
      bots: suyos.length,
      botsEnLinea: suyos.filter((x) => x === 'en_linea').length,
    };
  });

  const colas: VistaCola[] = [];
  for (const m of e.metricas) {
    const catalogada = e.catalogo.colas.find((c) => c.nombre === m.nombre);
    const cola = catalogada ?? colaPorDefecto(m.nombre);
    if (!cola) continue;
    colas.push({
      ...cola,
      ...m,
      pendientePorMin: Math.round(e.historial.pendiente(m.nombre) * 10) / 10,
      serie: e.historial.muestras(m.nombre).map((x) => x.v),
      catalogada: Boolean(catalogada),
    });
  }
  const ordenTipo = { principal: 0, reintento: 1, dlq: 2 } as const;
  const espera = (nombre: string) => inferirCola(nombre)?.esperaSeg ?? 0;
  colas.sort(
    (a, b) =>
      a.proceso.localeCompare(b.proceso) ||
      ordenTipo[a.tipo] - ordenTipo[b.tipo] ||
      espera(a.nombre) - espera(b.nombre) ||
      a.nombre.localeCompare(b.nombre),
  );

  const vigentes = e.alertas.filter(esVigente);
  const resueltas = e.alertas
    .filter((a) => !esVigente(a))
    .sort((a, b) => (b.resueltaEn ?? '').localeCompare(a.resueltaEn ?? ''))
    .slice(0, e.maxResueltas ?? 20);

  const activas = vigentes.filter((a) => a.estado === 'activa');
  const resumen: Resumen = {
    bots: {
      total: bots.length,
      enLinea: bots.filter((b) => b.salud === 'en_linea').length,
      ocupados: bots.filter((b) => b.salud === 'en_linea' && b.estado === 'BUSY').length,
      sinLatido: bots.filter((b) => b.salud === 'sin_latido' || b.salud === 'nunca_visto').length,
    },
    servidores: {
      total: servidores.length,
      operativos: servidores.filter((s) => s.salud === 'operativo').length,
      caidos: servidores.filter((s) => s.salud === 'caido').length,
    },
    colas: {
      total: colas.length,
      pendientes: colas.filter((c) => c.tipo !== 'dlq').reduce((n, c) => n + c.mensajes, 0),
      enDlq: colas.filter((c) => c.tipo === 'dlq').reduce((n, c) => n + c.mensajes, 0),
      consumidores: colas.reduce((n, c) => n + c.consumidores, 0),
    },
    tareas: {
      ok: bots.reduce((n, b) => n + b.tareasOk, 0),
      fallidas: bots.reduce((n, b) => n + b.tareasFallidas, 0),
    },
    alertas: {
      criticas: activas.filter((a) => a.severidad === 'critica').length,
      advertencias: activas.filter((a) => a.severidad === 'advertencia').length,
      reconocidas: vigentes.filter((a) => a.estado === 'reconocida').length,
    },
  };

  return {
    generadaEn: e.ahora,
    resumen,
    colas,
    bots,
    servidores,
    alertas: [...vigentes, ...resueltas],
    eventos: [...e.eventos].sort((a, b) => b.ocurridoEn.localeCompare(a.ocurridoEn)).slice(0, e.maxEventos ?? 50),
  };
}
