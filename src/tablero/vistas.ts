/**
 * Las seis pantallas del tablero. Cada vista es una función pura
 * `Instantanea → Html`: fácil de probar y de pintar desde la API o desde la demo.
 */
import type { Instantanea, VistaBot, VistaCola } from '../dominio/instantanea.ts';
import type { Alerta, EventoBot } from '../dominio/tipos.ts';
import { duracion, entero, ETIQUETAS, hace, horaBogota, horaBogotaSeg, nombreProceso, tendencia, unDecimal } from './formato.ts';
import { sparkline } from './graficos.ts';
import { html, type Html } from './html.ts';

export type Pantalla = 'resumen' | 'colas' | 'bots' | 'servidores' | 'alertas' | 'bitacora';

export const PANTALLAS: readonly { id: Pantalla; titulo: string }[] = [
  { id: 'resumen', titulo: 'Resumen' },
  { id: 'colas', titulo: 'Colas' },
  { id: 'bots', titulo: 'Bots' },
  { id: 'servidores', titulo: 'Servidores' },
  { id: 'alertas', titulo: 'Alertas' },
  { id: 'bitacora', titulo: 'Bitácora' },
];

const nivelSalud = (s: string): string =>
  ({
    en_linea: 'ok',
    operativo: 'ok',
    detenido: 'neutro',
    sin_bots: 'neutro',
    degradado: 'aviso',
    sin_latido: 'mal',
    nunca_visto: 'aviso',
    caido: 'mal',
  })[s] ?? 'neutro';

function chip(texto: string, nivel: string): Html {
  return html`<span class="chip chip-${nivel}">${texto}</span>`;
}

function chipSalud(salud: keyof typeof ETIQUETAS.salud): Html {
  return chip(ETIQUETAS.salud[salud], nivelSalud(salud));
}

function kpi(titulo: string, valor: string, detalle: string, nivel = 'neutro'): Html {
  return html`<article class="kpi kpi-${nivel}">
    <h3>${titulo}</h3>
    <p class="kpi-valor">${valor}</p>
    <p class="kpi-detalle">${detalle}</p>
  </article>`;
}

function vacio(texto: string): Html {
  return html`<p class="vacio">${texto}</p>`;
}

// --- Resumen ---------------------------------------------------------------

export function vistaResumen(i: Instantanea): Html {
  const r = i.resumen;
  const vigentes = i.alertas.filter((a) => a.estado !== 'resuelta');
  const principales = i.colas.filter((c) => c.tipo === 'principal');
  return html` <section class="kpis" aria-label="Indicadores">
      ${kpi('Bots en línea', `${r.bots.enLinea}/${r.bots.total}`, `${r.bots.ocupados} trabajando · ${r.bots.sinLatido} sin latido`, r.bots.sinLatido ? 'mal' : 'ok')}
      ${kpi('Servidores', `${r.servidores.operativos}/${r.servidores.total}`, r.servidores.caidos ? `${r.servidores.caidos} caído(s)` : 'todos operativos', r.servidores.caidos ? 'mal' : 'ok')}
      ${kpi('Mensajes pendientes', entero(r.colas.pendientes), `${r.colas.consumidores} consumidores conectados`)}
      ${kpi('En DLQ', entero(r.colas.enDlq), r.colas.enDlq ? 'requieren revisión' : 'sin mensajes muertos', r.colas.enDlq ? 'aviso' : 'ok')}
      ${kpi('Tareas del turno', entero(r.tareas.ok), `${entero(r.tareas.fallidas)} fallidas`)}
      ${kpi('Alertas', String(r.alertas.criticas + r.alertas.advertencias), `${r.alertas.criticas} críticas · ${r.alertas.reconocidas} reconocidas`, r.alertas.criticas ? 'mal' : r.alertas.advertencias ? 'aviso' : 'ok')}
    </section>
    <div class="rejilla-2">
      <section class="panel">
        <h2>Alertas vigentes</h2>
        ${
          vigentes.length
            ? html`<ul class="lista-alertas">
                ${vigentes.map((a) => filaAlerta(a, i.generadaEn))}
              </ul>`
            : vacio('Todo en calma. Ninguna alerta vigente.')
        }
      </section>
      <section class="panel">
        <h2>Colas principales</h2>
        <div class="desplazable">
          <table class="tabla">
            <thead>
              <tr>
                <th>Proceso</th>
                <th class="num">Mensajes</th>
                <th>Tendencia</th>
                <th class="num">Consumidores</th>
              </tr>
            </thead>
            <tbody>
              ${principales.map(
                (c) =>
                  html`<tr>
                    <td><strong>${nombreProceso(c.proceso)}</strong><br /><code>${c.nombre}</code></td>
                    <td class="num">${entero(c.mensajes)}</td>
                    <td>
                      ${sparkline(c.serie, { titulo: `Profundidad de ${c.nombre}`, ancho: 110 })}<span
                        class="tendencia ${c.pendientePorMin > 0.5 ? 'sube' : ''}"
                        >${tendencia(c.pendientePorMin)}</span
                      >
                    </td>
                    <td class="num">${c.consumidores}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <section class="panel">
      <h2>Últimos eventos</h2>
      ${listaEventos(i.eventos.slice(0, 8), i)}
    </section>`;
}

// --- Colas -------------------------------------------------------------------

function filaCola(c: VistaCola): Html {
  const nivel =
    c.tipo === 'dlq' && c.mensajes > 0 ? 'aviso' : c.tipo === 'principal' && c.mensajes > 0 && c.consumidores === 0 ? 'mal' : '';
  return html`<tr class="${nivel ? `fila-${nivel}` : ''}">
    <td>
      <code>${c.nombre}</code
      >${c.catalogada ? '' : html` <span class="chip chip-neutro" title="Descubierta por su nombre">auto</span>`}
    </td>
    <td>${chip(ETIQUETAS.tipoCola[c.tipo], c.tipo === 'dlq' ? 'aviso' : 'neutro')}</td>
    <td class="num">${entero(c.mensajes)}</td>
    <td class="num">${entero(c.listos)} / ${entero(c.sinConfirmar)}</td>
    <td class="num">${c.consumidores}</td>
    <td class="num">${unDecimal(c.tasaEntrada)} / ${unDecimal(c.tasaSalida)}</td>
    <td>${sparkline(c.serie, { titulo: `Profundidad de ${c.nombre}` })}</td>
    <td class="num"><span class="tendencia ${c.pendientePorMin > 0.5 ? 'sube' : ''}">${tendencia(c.pendientePorMin)}</span></td>
    <td class="num tenue">${entero(c.umbralMensajes)} · ${unDecimal(c.umbralCrecimientoPorMin)}/min</td>
  </tr>`;
}

export function vistaColas(i: Instantanea): Html {
  if (i.colas.length === 0) return vacio('Aún no hay lecturas de RabbitMQ.');
  const procesos = [...new Set(i.colas.map((c) => c.proceso))];
  return html`${procesos.map(
    (p) =>
      html`<section class="panel">
        <h2>${nombreProceso(p)} <code class="tenue">${p}</code></h2>
        <div class="desplazable">
          <table class="tabla">
            <thead>
              <tr>
                <th>Cola</th>
                <th>Tipo</th>
                <th class="num">Mensajes</th>
                <th class="num">Listos / sin ack</th>
                <th class="num">Consumidores</th>
                <th class="num">Entrada / salida (msg/s)</th>
                <th>Últimos minutos</th>
                <th class="num">Tendencia</th>
                <th class="num">Umbrales</th>
              </tr>
            </thead>
            <tbody>
              ${i.colas.filter((c) => c.proceso === p).map(filaCola)}
            </tbody>
          </table>
        </div>
      </section>`,
  )}`;
}

// --- Bots --------------------------------------------------------------------

function tarjetaBot(b: VistaBot): Html {
  return html`<article class="tarjeta tarjeta-${nivelSalud(b.salud)}">
    <header>
      <div>
        <h3>${b.alias}</h3>
        <code class="tenue">${b.id}</code>
      </div>
      ${chipSalud(b.salud)}
    </header>
    <dl>
      <div>
        <dt>Proceso</dt>
        <dd>${nombreProceso(b.proceso)}</dd>
      </div>
      <div>
        <dt>Servidor</dt>
        <dd>${b.servidor}</dd>
      </div>
      <div>
        <dt>Estado</dt>
        <dd>${b.estado ? ETIQUETAS.estadoBot[b.estado] : '—'}</dd>
      </div>
      <div>
        <dt>Tarea actual</dt>
        <dd><code>${b.tareaActual ?? '—'}</code></dd>
      </div>
      <div>
        <dt>Hechas / fallidas</dt>
        <dd>${entero(b.tareasOk)} / ${entero(b.tareasFallidas)}</dd>
      </div>
      <div>
        <dt>Último latido</dt>
        <dd>${hace(b.ultimoLatidoHaceSeg)}</dd>
      </div>
      <div>
        <dt>Versión</dt>
        <dd>${b.version ?? '—'}</dd>
      </div>
    </dl>
    ${b.descripcion ? html`<p class="tenue">${b.descripcion}</p>` : ''}
  </article>`;
}

export function vistaBots(i: Instantanea): Html {
  if (i.bots.length === 0) return vacio('No hay bots en el catálogo. Se registran solos con su primer latido.');
  return html`<section class="tarjetas">${i.bots.map(tarjetaBot)}</section>`;
}

// --- Servidores --------------------------------------------------------------

export function vistaServidores(i: Instantanea): Html {
  if (i.servidores.length === 0) return vacio('No hay servidores en el catálogo.');
  return html`<section class="tarjetas">
    ${i.servidores.map((s) => {
      const bots = i.bots.filter((b) => b.servidorId === s.id);
      return html`<article class="tarjeta tarjeta-${nivelSalud(s.salud)}">
        <header>
          <div>
            <h3>${s.nombre}</h3>
            <code class="tenue">${s.id} · ${s.ip}</code>
          </div>
          ${chipSalud(s.salud)}
        </header>
        <p>${s.sistema === 'windows' ? 'Windows' : 'Linux'} · ${s.descripcion}</p>
        <p class="tenue">${s.ubicacion}</p>
        <ul class="mini-bots">
          ${bots.map((b) => html`<li><span class="punto punto-${nivelSalud(b.salud)}" aria-hidden="true"></span>${b.alias} <span class="tenue">· ${nombreProceso(b.proceso)}</span></li>`)}
        </ul>
        <p class="tenue">${s.botsEnLinea} de ${s.bots} bots en línea</p>
      </article>`;
    })}
  </section>`;
}

// --- Alertas -----------------------------------------------------------------

function filaAlerta(a: Alerta, ahora: string): Html {
  return html`<li class="alerta alerta-${a.severidad} alerta-${a.estado}">
    <div class="alerta-cuerpo">
      <p class="alerta-titulo">
        ${chip(ETIQUETAS.severidad[a.severidad], a.severidad === 'critica' ? 'mal' : 'aviso')} <strong>${a.titulo}</strong>
      </p>
      <p>${a.detalle}</p>
      <p class="tenue">
        <code>${a.objetivo}</code> · abierta ${horaBogota(a.abiertaEn)} ·
        ${a.resueltaEn ? `duró ${duracion(a.abiertaEn, a.resueltaEn)}` : `lleva ${duracion(a.abiertaEn, ahora)}`}
        ${a.reconocidaPor ? html` · reconocida por <strong>${a.reconocidaPor}</strong>` : ''}
      </p>
    </div>
    <div class="alerta-acciones">
      ${a.estado === 'activa' ? html`<button type="button" class="boton" data-reconocer="${a.id}">Reconocer</button>` : chip(ETIQUETAS.estadoAlerta[a.estado], a.estado === 'resuelta' ? 'ok' : 'neutro')}
    </div>
  </li>`;
}

export function vistaAlertas(i: Instantanea): Html {
  const vigentes = i.alertas.filter((a) => a.estado !== 'resuelta');
  const resueltas = i.alertas.filter((a) => a.estado === 'resuelta');
  return html` <section class="panel">
      <h2>Vigentes (${vigentes.length})</h2>
      ${
        vigentes.length
          ? html`<ul class="lista-alertas">
              ${vigentes.map((a) => filaAlerta(a, i.generadaEn))}
            </ul>`
          : vacio('Ninguna alerta vigente.')
      }
    </section>
    <section class="panel">
      <h2>Resueltas recientemente</h2>
      ${
        resueltas.length
          ? html`<ul class="lista-alertas">
              ${resueltas.map((a) => filaAlerta(a, i.generadaEn))}
            </ul>`
          : vacio('Todavía no se ha resuelto ninguna alerta.')
      }
    </section>`;
}

// --- Bitácora ----------------------------------------------------------------

function listaEventos(eventos: readonly EventoBot[], i: Instantanea): Html {
  if (eventos.length === 0) return vacio('Sin eventos todavía.');
  const alias = new Map(i.bots.map((b) => [b.id, b.alias]));
  const nivel = (t: EventoBot['tipo']) =>
    t === 'tarea_fallida' || t === 'error'
      ? 'mal'
      : t === 'reintento' || t === 'parada'
        ? 'aviso'
        : t === 'inicio'
          ? 'ok'
          : 'neutro';
  return html`<ol class="bitacora">
    ${eventos.map(
      (e) =>
        html`<li>
          <time datetime="${e.ocurridoEn}">${horaBogotaSeg(e.ocurridoEn)}</time>
          ${chip(ETIQUETAS.evento[e.tipo], nivel(e.tipo))}
          <strong>${alias.get(e.botId) ?? e.botId}</strong>
          <span>${e.mensaje}</span>
        </li>`,
    )}
  </ol>`;
}

export function vistaBitacora(i: Instantanea): Html {
  return html`<section class="panel">
    <h2>Bitácora de eventos</h2>
    ${listaEventos(i.eventos, i)}
  </section>`;
}

export const VISTAS: Record<Pantalla, (i: Instantanea) => Html> = {
  resumen: vistaResumen,
  colas: vistaColas,
  bots: vistaBots,
  servidores: vistaServidores,
  alertas: vistaAlertas,
  bitacora: vistaBitacora,
};

/** Número que acompaña a cada pestaña (para ver de un vistazo dónde mirar). */
export function insignia(p: Pantalla, i: Instantanea): { texto: string; nivel: string } | null {
  switch (p) {
    case 'alertas': {
      const n = i.resumen.alertas.criticas + i.resumen.alertas.advertencias;
      return n ? { texto: String(n), nivel: i.resumen.alertas.criticas ? 'mal' : 'aviso' } : null;
    }
    case 'bots':
      return i.resumen.bots.sinLatido ? { texto: String(i.resumen.bots.sinLatido), nivel: 'mal' } : null;
    case 'servidores':
      return i.resumen.servidores.caidos ? { texto: String(i.resumen.servidores.caidos), nivel: 'mal' } : null;
    case 'colas':
      return i.resumen.colas.enDlq ? { texto: entero(i.resumen.colas.enDlq), nivel: 'aviso' } : null;
    default:
      return null;
  }
}
