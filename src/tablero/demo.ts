/** Franja de la historia en modo demo: reloj de la noche, capítulo actual y controles. */
import { DURACION_NOCHE_MIN, GUION, horaDeMinuto } from '../dominio/historia.ts';
import { EMPRESA_FICTICIA } from '../dominio/macondo.ts';
import type { EstadoDemo, FuenteDemo } from './fuentes.ts';
import { html } from './html.ts';

export const VELOCIDADES = [
  { valor: 30, texto: '×30' },
  { valor: 60, texto: '×60 · 1 min/s' },
  { valor: 180, texto: '×180' },
  { valor: 600, texto: '×600' },
] as const;

export function plantillaDemo(): string {
  return html` <div class="demo-reloj">
      <span class="demo-etiqueta">La noche del cierre · ${EMPRESA_FICTICIA}</span>
      <strong id="demo-hora" class="demo-hora">22:00</strong>
    </div>
    <div class="demo-relato">
      <h2 id="demo-titulo">Empieza el turno</h2>
      <p id="demo-texto"></p>
      <div class="linea-tiempo" role="group" aria-label="Capítulos de la noche">
        <div class="linea-tiempo-pista"><div id="demo-progreso" class="linea-tiempo-progreso"></div></div>
        ${GUION.map(
          (c) =>
            html`<button
              type="button"
              class="hito"
              data-minuto="${c.minuto}"
              style="left:${((c.minuto / DURACION_NOCHE_MIN) * 100).toFixed(2)}%"
              title="${horaDeMinuto(c.minuto)} · ${c.titulo}"
              aria-label="Ir a las ${horaDeMinuto(c.minuto)}: ${c.titulo}"
            ></button>`,
        )}
      </div>
    </div>
    <div class="demo-controles">
      <button id="demo-pausa" type="button" class="boton">Pausar</button>
      <label
        >Velocidad
        <select id="demo-velocidad">
          ${VELOCIDADES.map((v) => html`<option value="${v.valor}">${v.texto}</option>`)}
        </select>
      </label>
      <button id="demo-reiniciar" type="button" class="boton boton-secundario">Desde el inicio</button>
    </div>`.valor;
}

export function montarDemo(raiz: HTMLElement, fuente: FuenteDemo): (e: EstadoDemo) => void {
  raiz.hidden = false;
  raiz.innerHTML = plantillaDemo();
  const $ = (id: string) => raiz.querySelector<HTMLElement>(`#${id}`);
  const pausa = raiz.querySelector<HTMLButtonElement>('#demo-pausa');
  const velocidad = raiz.querySelector<HTMLSelectElement>('#demo-velocidad');
  let ultimo: EstadoDemo | null = null;

  pausa?.addEventListener('click', () => fuente.pausar(!(ultimo?.pausado ?? false)));
  velocidad?.addEventListener('change', () => fuente.cambiarVelocidad(Number(velocidad.value)));
  $('demo-reiniciar')?.addEventListener('click', () => fuente.irA(0));
  raiz
    .querySelectorAll<HTMLButtonElement>('.hito')
    .forEach((b) => b.addEventListener('click', () => fuente.irA(Number(b.dataset['minuto']) + 0.5)));

  return (e) => {
    ultimo = e;
    const hora = $('demo-hora');
    const titulo = $('demo-titulo');
    const texto = $('demo-texto');
    const progreso = $('demo-progreso');
    if (hora) hora.textContent = horaDeMinuto(e.minuto);
    if (titulo) titulo.textContent = e.terminado ? 'Fin del turno' : (e.capitulo?.titulo ?? '');
    if (texto) texto.textContent = e.capitulo?.relato ?? '';
    if (progreso) progreso.style.width = `${Math.min(100, (e.minuto / DURACION_NOCHE_MIN) * 100).toFixed(2)}%`;
    if (pausa) pausa.textContent = e.pausado ? 'Continuar' : 'Pausar';
    if (velocidad && document.activeElement !== velocidad) velocidad.value = String(e.velocidad);
    raiz.querySelectorAll<HTMLButtonElement>('.hito').forEach((b) => {
      b.classList.toggle('hito-pasado', Number(b.dataset['minuto']) <= e.minuto);
      b.classList.toggle('hito-actual', Number(b.dataset['minuto']) === e.capitulo?.minuto);
    });
  };
}
