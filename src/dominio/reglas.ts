/**
 * Motor de reglas de alerta.
 *
 * Es una función pura: recibe lo que se sabe del mundo en este instante y devuelve
 * los hallazgos (condiciones anómalas). No abre incidentes ni envía avisos; eso lo
 * hace `conciliarAlertas` y, más afuera, el vigía de la API. Así cada regla se
 * prueba con datos en memoria y la misma lógica corre en el navegador para la demo.
 */
import { botsDe, saludBot, saludServidor, segundosDesde } from './salud.ts';
import type { HistorialColas } from './tendencia.ts';
import { colaPorDefecto } from './topologia.ts';
import type { Catalogo, Cola, CodigoRegla, Hallazgo, Latido, MetricaCola } from './tipos.ts';

export interface ConfigReglas {
  /** Segundos sin latido para considerar a un bot caído. */
  ttlLatidoSeg: number;
  /** Minutos de historia mínima antes de juzgar la tendencia de una cola. */
  coberturaMinimaMin: number;
  /** Reglas apagadas por configuración. */
  desactivadas: readonly CodigoRegla[];
}

export const CONFIG_REGLAS_POR_DEFECTO: ConfigReglas = {
  ttlLatidoSeg: 45,
  coberturaMinimaMin: 3,
  desactivadas: [],
};

export interface ContextoEvaluacion {
  ahora: string;
  catalogo: Catalogo;
  /** Último latido conocido de cada bot (vigente o no). */
  latidos: ReadonlyMap<string, Latido>;
  metricas: readonly MetricaCola[];
  historial: HistorialColas;
}

export interface DescripcionRegla {
  codigo: CodigoRegla;
  nombre: string;
  descripcion: string;
}

export const DESCRIPCION_REGLAS: readonly DescripcionRegla[] = [
  {
    codigo: 'cola_creciendo',
    nombre: 'Cola creciendo',
    descripcion:
      'La pendiente de la cola principal supera su umbral de crecimiento (mensajes/min) durante la ventana. Crítica si además supera el umbral de mensajes.',
  },
  {
    codigo: 'cola_sin_consumidores',
    nombre: 'Cola sin consumidores',
    descripcion: 'La cola principal tiene mensajes y ningún bot conectado para consumirlos.',
  },
  {
    codigo: 'dlq_con_mensajes',
    nombre: 'DLQ con mensajes',
    descripcion: 'Hay mensajes muertos esperando revisión. Crítica si superan el umbral de la cola.',
  },
  {
    codigo: 'bot_sin_latido',
    nombre: 'Bot sin latido',
    descripcion: 'Un bot dejó de reportar sin anunciar parada. Se inhibe si todo su servidor está caído.',
  },
  {
    codigo: 'servidor_caido',
    nombre: 'Servidor caído',
    descripcion: 'Ninguno de los bots del servidor reporta latidos.',
  },
];

const formatoEntero = new Intl.NumberFormat('es-CO');
const formatoDecimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const num = (n: number) => formatoEntero.format(n);
const dec = (n: number) => formatoDecimal.format(n);

export function clave(regla: CodigoRegla, objetivo: string): string {
  return `${regla}:${objetivo}`;
}

function colaDe(catalogo: Catalogo, nombre: string): Cola | null {
  return catalogo.colas.find((c) => c.nombre === nombre) ?? colaPorDefecto(nombre);
}

function reglasDeColas(ctx: ContextoEvaluacion, cfg: ConfigReglas): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const m of ctx.metricas) {
    const cola = colaDe(ctx.catalogo, m.nombre);
    if (!cola) continue;

    if (cola.tipo === 'dlq' && m.mensajes > 0) {
      const critica = m.mensajes > cola.umbralMensajes;
      hallazgos.push({
        clave: clave('dlq_con_mensajes', m.nombre),
        regla: 'dlq_con_mensajes',
        severidad: critica ? 'critica' : 'advertencia',
        objetivo: m.nombre,
        titulo: `DLQ con ${num(m.mensajes)} mensaje${m.mensajes === 1 ? '' : 's'}`,
        detalle: `La cola ${m.nombre} acumula mensajes muertos del proceso ${cola.proceso}. Revisa el motivo y reprocesa o descarta.`,
        valor: m.mensajes,
      });
    }

    if (cola.tipo !== 'principal') continue;

    if (m.mensajes > 0 && m.consumidores === 0) {
      hallazgos.push({
        clave: clave('cola_sin_consumidores', m.nombre),
        regla: 'cola_sin_consumidores',
        severidad: 'critica',
        objetivo: m.nombre,
        titulo: 'Cola sin consumidores',
        detalle: `${num(m.mensajes)} mensajes esperan en ${m.nombre} y ningún bot está conectado.`,
        valor: m.mensajes,
      });
    }

    const cobertura = ctx.historial.cobertura(m.nombre);
    const pendiente = ctx.historial.pendiente(m.nombre);
    if (cobertura >= cfg.coberturaMinimaMin && pendiente > cola.umbralCrecimientoPorMin) {
      const saturada = m.mensajes > cola.umbralMensajes;
      hallazgos.push({
        clave: clave('cola_creciendo', m.nombre),
        regla: 'cola_creciendo',
        severidad: saturada ? 'critica' : 'advertencia',
        objetivo: m.nombre,
        titulo: `Cola creciendo +${num(Math.round(pendiente))} msg/min`,
        detalle: `${m.nombre} tiene ${num(m.mensajes)} mensajes y sube ${dec(pendiente)} por minuto (umbral ${dec(cola.umbralCrecimientoPorMin)}).`,
        valor: Math.round(pendiente * 10) / 10,
      });
    }
  }
  return hallazgos;
}

function reglasDeBots(ctx: ContextoEvaluacion, cfg: ConfigReglas): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const servidoresCaidos = new Set<string>();

  for (const servidor of ctx.catalogo.servidores) {
    const bots = botsDe(servidor, ctx.catalogo.bots);
    const salud = bots.map((b) => saludBot(ctx.latidos.get(b.id), ctx.ahora, cfg.ttlLatidoSeg));
    if (saludServidor(salud) !== 'caido') continue;
    servidoresCaidos.add(servidor.id);
    hallazgos.push({
      clave: clave('servidor_caido', servidor.id),
      regla: 'servidor_caido',
      severidad: 'critica',
      objetivo: servidor.id,
      titulo: `Servidor ${servidor.nombre} caído`,
      detalle: `Ninguno de sus ${bots.length} bots reporta latido (${bots.map((b) => b.alias).join(', ')}).`,
      valor: bots.length,
    });
  }

  for (const bot of ctx.catalogo.bots) {
    // Inhibición: si el servidor entero cayó, una sola alerta basta.
    if (servidoresCaidos.has(bot.servidorId)) continue;
    const latido = ctx.latidos.get(bot.id);
    const salud = saludBot(latido, ctx.ahora, cfg.ttlLatidoSeg);
    if (salud !== 'sin_latido' && salud !== 'nunca_visto') continue;
    const segundos = latido ? Math.round(segundosDesde(latido.recibidoEn, ctx.ahora)) : 0;
    hallazgos.push({
      clave: clave('bot_sin_latido', bot.id),
      regla: 'bot_sin_latido',
      severidad: salud === 'nunca_visto' ? 'advertencia' : 'critica',
      objetivo: bot.id,
      titulo: `${bot.alias} sin latido`,
      detalle: latido
        ? `Último latido hace ${segundos} s desde ${latido.hostname}; estaba ${latido.estado}${latido.tareaActual ? ` con la tarea ${latido.tareaActual}` : ''}.`
        : `El bot ${bot.id} está en el catálogo pero nunca ha reportado.`,
      valor: segundos,
    });
  }
  return hallazgos;
}

const ORDEN_SEVERIDAD = { critica: 0, advertencia: 1, informativa: 2 } as const;

export function evaluarReglas(ctx: ContextoEvaluacion, cfg: ConfigReglas = CONFIG_REGLAS_POR_DEFECTO): Hallazgo[] {
  return [...reglasDeColas(ctx, cfg), ...reglasDeBots(ctx, cfg)]
    .filter((h) => !cfg.desactivadas.includes(h.regla))
    .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] || a.clave.localeCompare(b.clave));
}
