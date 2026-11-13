/**
 * Genera las capturas del README a partir de la demo (build estático) con Chrome o Edge
 * en modo headless. Requiere haber corrido `npm run build:demo`.
 *
 *   npm run captura
 *
 * Cada captura es un momento de la noche del cierre (parámetro ?minuto=) con la
 * simulación en pausa, así que el resultado es reproducible.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { preview } from 'vite';

const RAIZ = resolve(import.meta.dirname, '..');
const SALIDA = join(RAIZ, 'docs', 'imagenes');

const CANDIDATOS = [
  process.env['CHROME'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((x): x is string => Boolean(x));

const CAPTURAS = [
  { archivo: 'resumen.png', ruta: '?minuto=100&pausa=1&tema=claro#/resumen', ancho: 1440, alto: 1180 },
  { archivo: 'resumen-oscuro.png', ruta: '?minuto=100&pausa=1&tema=oscuro#/resumen', ancho: 1440, alto: 1180 },
  { archivo: 'colas.png', ruta: '?minuto=165&pausa=1&tema=claro#/colas', ancho: 1440, alto: 1300 },
  { archivo: 'bots.png', ruta: '?minuto=318&pausa=1&tema=oscuro#/bots', ancho: 1440, alto: 1000 },
  { archivo: 'alertas.png', ruta: '?minuto=232&pausa=1&tema=claro#/alertas', ancho: 1440, alto: 1100 },
] as const;

function ejecutar(comando: string, argumentos: string[]): Promise<number | null> {
  return new Promise((ok, falla) => {
    // stdio ignorado: los procesos auxiliares de Chrome heredan las tuberías y no las cierran.
    const p = spawn(comando, argumentos, { stdio: 'ignore', timeout: 60_000 });
    p.on('error', falla);
    p.on('exit', (codigo) => ok(codigo));
  });
}

const navegador = CANDIDATOS.find((c) => existsSync(c));
if (!navegador) throw new Error('No se encontró Chrome ni Edge. Indica la ruta con la variable CHROME.');
if (!existsSync(join(RAIZ, 'dist', 'demo', 'index.html'))) throw new Error('Primero ejecuta npm run build:demo.');

mkdirSync(SALIDA, { recursive: true });
const servidor = await preview({
  root: join(RAIZ, 'src', 'tablero'),
  mode: 'demo',
  preview: { port: 4321, strictPort: true },
  build: { outDir: join(RAIZ, 'dist', 'demo') },
});
try {
  for (const c of CAPTURAS) {
    const destino = join(SALIDA, c.archivo);
    // Asíncrono a propósito: spawnSync bloquearía el servidor de vista previa de este mismo proceso.
    const codigo = await ejecutar(navegador, [
      '--headless=new',
      // Perfil aparte: no choca con un Chrome abierto del usuario.
      `--user-data-dir=${join(tmpdir(), 'torre-captura-perfil')}`,
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${c.ancho},${c.alto}`,
      '--no-first-run',
      `--screenshot=${destino}`,
      `http://localhost:4321/${c.ruta}`,
    ]);
    if (codigo !== 0 || !existsSync(destino)) throw new Error(`Falló la captura ${c.archivo} (código ${String(codigo)}).`);
    console.info(`Captura lista: docs/imagenes/${c.archivo}`);
  }
} finally {
  await new Promise<void>((ok) => servidor.httpServer.close(() => ok()));
}
