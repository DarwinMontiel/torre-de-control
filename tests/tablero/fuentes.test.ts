// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Instantanea } from '../../src/dominio/instantanea.ts';
import { simuladorMacondo } from '../../src/dominio/simulador.ts';
import { TorreLocal } from '../../src/dominio/torre-local.ts';
import { montarDemo, plantillaDemo } from '../../src/tablero/demo.ts';
import {
  FuenteDemo,
  FuenteEnVivo,
  RETARDOS_RECONEXION_MS,
  type EstadoConexion,
  type EstadoDemo,
  type SocketMinimo,
  type Suscriptor,
} from '../../src/tablero/fuentes.ts';

function suscriptor() {
  const fotos: Instantanea[] = [];
  const conexiones: string[] = [];
  const demos: EstadoDemo[] = [];
  const s: Suscriptor = {
    alInstantanea: (i) => fotos.push(i),
    alConexion: (e: EstadoConexion, d?: string) => conexiones.push(d ? `${e}:${d}` : e),
    alDemo: (e) => demos.push(e),
  };
  return { s, fotos, conexiones, demos };
}

class SocketFalso implements SocketMinimo {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  cerrado = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    this.cerrado = true;
  }
}

const aTexto = (u: RequestInfo | URL): string => (typeof u === 'string' ? u : u instanceof URL ? u.href : u.url);

function fotoReal(): Instantanea {
  const t = new TorreLocal(simuladorMacondo());
  t.ciclo(60);
  return t.instantanea();
}

describe('FuenteEnVivo', () => {
  function armar(respuestaFoto: Response | Error = new Response(JSON.stringify(fotoReal()), { status: 200 })) {
    const sockets: SocketFalso[] = [];
    const programados: { fn: () => void; ms: number }[] = [];
    const fetchFalso = vi.fn<typeof fetch>(async (url) => {
      if (aTexto(url).endsWith('/instantanea')) {
        if (respuestaFoto instanceof Error) throw respuestaFoto;
        return respuestaFoto.clone();
      }
      return new Response(JSON.stringify({ mensaje: 'La alerta x está reconocida; solo se reconocen alertas activas.' }), {
        status: 409,
      });
    });
    const fuente = new FuenteEnVivo('https://torre.macondo.example/', {
      fetch: fetchFalso,
      crearSocket: (url) => {
        const s = new SocketFalso(url);
        sockets.push(s);
        return s;
      },
      programar: (fn, ms) => programados.push({ fn, ms }),
      cancelar: vi.fn(),
    });
    return { fuente, sockets, programados, fetchFalso };
  }

  it('carga la foto por REST, abre el WebSocket y entrega cada instantánea', async () => {
    const { fuente, sockets } = armar();
    const { s, fotos, conexiones } = suscriptor();
    fuente.iniciar(s);
    await vi.waitFor(() => expect(fotos).toHaveLength(1));
    expect(sockets[0]?.url).toBe('wss://torre.macondo.example/api/v1/ws');
    sockets[0]?.onopen?.();
    sockets[0]?.onmessage?.({ data: JSON.stringify({ tipo: 'instantanea', datos: fotos[0] }) });
    sockets[0]?.onmessage?.({ data: JSON.stringify({ tipo: 'evento_bot', datos: {} }) });
    sockets[0]?.onmessage?.({ data: 'pong' });
    sockets[0]?.onmessage?.({ data: '{roto' });
    expect(fotos).toHaveLength(2);
    expect(conexiones).toEqual(['conectando', 'en_vivo']);
  });

  it('reconecta con espera exponencial y la reinicia al conectar', () => {
    const { fuente, sockets, programados } = armar(new Error('sin red'));
    const { s, conexiones } = suscriptor();
    fuente.iniciar(s);
    for (let i = 0; i < 7; i++) {
      sockets.at(-1)?.onclose?.();
      programados.at(-1)?.fn();
    }
    expect(programados.map((p) => p.ms)).toEqual([...RETARDOS_RECONEXION_MS, 15000, 15000]);
    expect(conexiones.at(-1)).toBe('reconectando:Reintento en 15 s');
    sockets.at(-1)?.onopen?.();
    sockets.at(-1)?.onclose?.();
    expect(programados.at(-1)?.ms).toBe(1000);
  });

  it('al detenerse no intenta reconectar', () => {
    const { fuente, sockets, programados } = armar();
    fuente.iniciar(suscriptor().s);
    fuente.detener();
    expect(sockets[0]?.cerrado).toBe(true);
    sockets[0]?.onclose?.();
    expect(programados).toEqual([]);
  });

  it('reconocer envía el operador y muestra el mensaje de la torre si falla', async () => {
    const { fuente, fetchFalso } = armar();
    fuente.iniciar(suscriptor().s);
    await expect(fuente.reconocer('a b', 'Rebeca')).rejects.toThrow('solo se reconocen alertas activas');
    const llamada = fetchFalso.mock.calls.find(([u]) => aTexto(u).includes('/reconocer'));
    expect(llamada ? aTexto(llamada[0]) : '').toBe('https://torre.macondo.example/api/v1/alertas/a%20b/reconocer');
    expect(llamada?.[1]?.body).toBe(JSON.stringify({ operador: 'Rebeca' }));
  });
});

describe('FuenteDemo', () => {
  const opciones = (extra: Partial<ConstructorParameters<typeof FuenteDemo>[0]> = {}) => ({
    velocidad: 60,
    pasoMs: 1000,
    minutoInicial: 0,
    pausado: false,
    programarIntervalo: vi.fn(() => 1),
    cancelarIntervalo: vi.fn(),
    ...extra,
  });

  it('avanza un minuto simulado por segundo real a ×60', () => {
    const demo = new FuenteDemo(opciones());
    const { s, demos, conexiones } = suscriptor();
    demo.iniciar(s);
    const inicio = demos.at(-1)?.minuto ?? 0;
    demo.tic();
    expect((demos.at(-1)?.minuto ?? 0) - inicio).toBeCloseTo(1, 5);
    expect(conexiones).toEqual(['demo']);
    expect(demos.at(-1)?.capitulo?.titulo).toBe('Empieza el turno');
  });

  it('se pausa, cambia de velocidad y salta a un capítulo', () => {
    const demo = new FuenteDemo(opciones());
    const { s, demos } = suscriptor();
    demo.iniciar(s);
    demo.pausar(true);
    const m = demos.at(-1)?.minuto;
    demo.tic();
    expect(demos.at(-1)?.minuto).toBe(m);
    demo.pausar(false);
    demo.cambiarVelocidad(600);
    demo.tic();
    expect((demos.at(-1)?.minuto ?? 0) - (m ?? 0)).toBeCloseTo(10, 5);
    demo.irA(91);
    expect(demos.at(-1)?.capitulo?.titulo).toBe('CAUCA-02 se reinicia sin avisar');
    demo.irA(9999);
    expect(demos.at(-1)?.terminado).toBe(true);
    demo.tic(); // terminada: no avanza ni falla
  });

  it('reconoce alertas en el navegador y rechaza las que ya no están activas', async () => {
    const demo = new FuenteDemo(opciones({ minutoInicial: 95 }));
    const { s, fotos } = suscriptor();
    demo.iniciar(s);
    const activa = fotos.at(-1)?.alertas.find((a) => a.estado === 'activa');
    await demo.reconocer(activa?.id ?? '', 'Rebeca');
    expect(fotos.at(-1)?.alertas.find((a) => a.id === activa?.id)?.reconocidaPor).toBe('Rebeca');
    await expect(demo.reconocer(activa?.id ?? '', 'Rebeca')).rejects.toThrow('La alerta ya no está activa.');
  });

  it('detener cancela el intervalo', () => {
    const op = opciones();
    const demo = new FuenteDemo(op);
    demo.iniciar(suscriptor().s);
    demo.detener();
    expect(op.cancelarIntervalo).toHaveBeenCalledWith(1);
  });
});

describe('franja de la demo', () => {
  it('pinta el reloj, el capítulo y responde a los controles', () => {
    document.body.innerHTML = '<section id="demo" hidden></section>';
    const raiz = document.getElementById('demo') as HTMLElement;
    const demo = new FuenteDemo({
      velocidad: 60,
      pasoMs: 1000,
      minutoInicial: 0,
      pausado: false,
      programarIntervalo: () => 1,
      cancelarIntervalo: () => undefined,
    });
    const actualizar = montarDemo(raiz, demo);
    expect(raiz.hidden).toBe(false);
    actualizar(demo.estadoDemo());
    expect(raiz.querySelector('#demo-hora')?.textContent).toBe('22:00');

    const irA = vi.spyOn(demo, 'irA');
    (raiz.querySelectorAll('.hito')[2] as HTMLButtonElement).click();
    expect(irA).toHaveBeenCalledWith(90.5);
    actualizar(demo.estadoDemo());
    expect(raiz.querySelector('#demo-titulo')?.textContent).toBe('CAUCA-02 se reinicia sin avisar');
    expect(raiz.querySelector('#demo-hora')?.textContent).toBe('23:30');

    const pausar = vi.spyOn(demo, 'pausar');
    (raiz.querySelector('#demo-pausa') as HTMLButtonElement).click();
    expect(pausar).toHaveBeenCalledWith(true);
    const velocidad = raiz.querySelector('#demo-velocidad') as HTMLSelectElement;
    velocidad.value = '600';
    velocidad.dispatchEvent(new Event('change'));
    expect(demo.estadoDemo().velocidad).toBe(600);
    (raiz.querySelector('#demo-reiniciar') as HTMLButtonElement).click();
    expect(irA).toHaveBeenLastCalledWith(0);
    expect(plantillaDemo()).toContain('Cobranzas Macondo S.A.S. (ficticia)');
  });
});
