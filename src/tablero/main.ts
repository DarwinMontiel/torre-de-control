/**
 * Arranque del tablero.
 *
 *   npm run dev:tablero   → en vivo contra la API (Vite redirige /api al puerto 3000)
 *   npm run dev:demo      → demo autónoma: la torre corre en el navegador
 *
 * Parámetros de URL útiles en la demo: ?minuto=95 (salta a las 23:35), ?velocidad=180,
 * ?pausa=1 y ?tema=oscuro. Los usa también el script que genera las capturas del README.
 */
import type { Instantanea } from '../dominio/instantanea.ts';
import { montarDemo } from './demo.ts';
import { horaBogotaSeg } from './formato.ts';
import {
  FuenteDemo,
  FuenteEnVivo,
  type EstadoConexion,
  type EstadoDemo,
  type FuenteDatos,
  type SocketMinimo,
} from './fuentes.ts';
import { html } from './html.ts';
import { insignia, PANTALLAS, VISTAS, type Pantalla } from './vistas.ts';

const params = new URLSearchParams(location.search);
const esDemo = import.meta.env.MODE === 'demo' || params.has('demo');

const guardar = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // almacenamiento bloqueado: no pasa nada
  }
};
const leer = (clave: string): string | null => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};

// --- Tema ----------------------------------------------------------------------
const temaUrl = params.get('tema');
if (temaUrl === 'oscuro' || temaUrl === 'claro') document.documentElement.dataset['tema'] = temaUrl;
document.getElementById('tema')?.addEventListener('click', () => {
  const actual =
    document.documentElement.dataset['tema'] ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro');
  const nuevo = actual === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.dataset['tema'] = nuevo;
  guardar('torre.tema', nuevo);
});

// --- Navegación -----------------------------------------------------------------
const pantallaActual = (): Pantalla => {
  const id = location.hash.replace(/^#\/?/, '');
  return PANTALLAS.some((p) => p.id === id) ? (id as Pantalla) : 'resumen';
};

const nav = document.getElementById('nav');
const contenido = document.getElementById('contenido');
const conexion = document.getElementById('conexion');
let ultima: Instantanea | null = null;

function pintar(): void {
  const actual = pantallaActual();
  if (nav) {
    nav.innerHTML = html`${PANTALLAS.map((p) => {
      const i = ultima ? insignia(p.id, ultima) : null;
      return html`<a href="#/${p.id}" ${p.id === actual ? html`aria-current="page"` : ''}
        >${p.titulo}${i ? html`<span class="insignia insignia-${i.nivel}">${i.texto}</span>` : ''}</a
      >`;
    })}`.valor;
  }
  if (!contenido) return;
  if (!ultima) {
    contenido.innerHTML = html`<p class="vacio">Esperando la primera foto de la torre…</p>`.valor;
    return;
  }
  contenido.innerHTML = VISTAS[actual](ultima).valor;
  const titulo = PANTALLAS.find((p) => p.id === actual)?.titulo ?? '';
  const n = ultima.resumen.alertas.criticas;
  document.title = `${n ? `(${n}) ` : ''}${titulo} · Torre de Control`;
  const pie = document.getElementById('pie-hora');
  if (pie) pie.textContent = `Foto de las ${horaBogotaSeg(ultima.generadaEn)} (hora de Bogotá)`;
}

window.addEventListener('hashchange', () => {
  pintar();
  contenido?.focus({ preventScroll: true });
});

const TEXTO_CONEXION: Record<EstadoConexion, string> = {
  conectando: 'Conectando…',
  en_vivo: 'En vivo',
  reconectando: 'Reconectando',
  demo: 'Demo · datos simulados',
};

// --- Fuente de datos -------------------------------------------------------------
let fuente: FuenteDatos;
let alDemo: ((e: EstadoDemo) => void) | undefined;

if (esDemo) {
  const demo = new FuenteDemo({
    velocidad: Number(params.get('velocidad') ?? 60),
    pasoMs: 1000,
    minutoInicial: Number(params.get('minuto') ?? 0),
    pausado: params.get('pausa') === '1',
    programarIntervalo: (fn, ms) => setInterval(fn, ms),
    cancelarIntervalo: (id) => clearInterval(id as number),
  });
  const raizDemo = document.getElementById('demo');
  if (raizDemo) alDemo = montarDemo(raizDemo, demo);
  fuente = demo;
  const sub = document.getElementById('subtitulo');
  if (sub) sub.textContent = 'Cobranzas Macondo (ficticia) · turno de noche';
  const pieModo = document.getElementById('pie-modo');
  if (pieModo) pieModo.textContent = 'simulados en tu navegador';
} else {
  fuente = new FuenteEnVivo(location.origin, {
    fetch: (...a) => fetch(...a),
    // El WebSocket del navegador cumple SocketMinimo; el cast solo ajusta la firma de los manejadores.
    crearSocket: (url) => new WebSocket(url) as unknown as SocketMinimo,
    programar: (fn, ms) => setTimeout(fn, ms),
    cancelar: (id) => clearTimeout(id as number),
  });
}

contenido?.addEventListener('click', (ev) => {
  const boton = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-reconocer]');
  if (!boton) return;
  let operador = esDemo ? 'Rebeca' : leer('torre.operador');
  if (!operador) {
    operador = prompt('¿Quién atiende la alerta? (se guarda en este navegador)')?.trim() ?? '';
    if (operador.length < 2) return;
    guardar('torre.operador', operador);
  }
  boton.disabled = true;
  fuente.reconocer(boton.dataset['reconocer'] ?? '', operador).catch((e: unknown) => {
    boton.disabled = false;
    alert((e as Error).message);
  });
});

fuente.iniciar({
  alInstantanea: (i) => {
    ultima = i;
    pintar();
  },
  alConexion: (estado, detalle) => {
    if (!conexion) return;
    conexion.textContent = detalle ? `${TEXTO_CONEXION[estado]} · ${detalle}` : TEXTO_CONEXION[estado];
    conexion.dataset['estado'] = estado;
  },
  ...(alDemo ? { alDemo } : {}),
});
pintar();
