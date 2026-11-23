/**
 * WebSocket del tablero.
 *
 * Cada réplica de la API mantiene una sola suscripción al canal de Redis y reparte los
 * mensajes a sus clientes conectados. Al conectarse, el cliente recibe de inmediato la
 * última instantánea para no esperar al siguiente ciclo del vigía.
 */
import type { WebSocket } from 'ws';

type ClienteTiempoReal = Pick<WebSocket, 'readyState' | 'OPEN' | 'send' | 'close'>;
import type { AppTorre, DependenciasApp } from '../app.ts';
import type { MensajeTorre } from '../puertos.ts';

export async function rutasTiempoReal(app: AppTorre, deps: DependenciasApp): Promise<void> {
  // Solo se usa lo que el tablero necesita del socket. Un tipo estructural (y no la clase de
  // `ws`) evita depender de que @fastify/websocket construya la misma clase que importamos.
  const clientes = new Set<ClienteTiempoReal>();
  let cancelar: (() => Promise<void>) | null = null;

  const difundir = (m: MensajeTorre) => {
    const texto = JSON.stringify(m);
    for (const ws of clientes) {
      if (ws.readyState === ws.OPEN) ws.send(texto);
    }
  };

  app.addHook('onReady', async () => {
    cancelar = await deps.estado.suscribir(difundir);
  });
  app.addHook('onClose', async () => {
    for (const ws of clientes) ws.close(1001, 'La torre se está apagando');
    await cancelar?.();
  });

  app.get(
    '/ws',
    {
      websocket: true,
      schema: {
        tags: ['Estado'],
        summary: 'Flujo en tiempo real (WebSocket)',
        description:
          'Mensajes JSON `{ tipo, ... }`: `instantanea` en cada ciclo del vigía, `alerta` (abierta, escalada, resuelta, reconocida) y `evento_bot`. El cliente puede enviar `ping` y recibe `pong`.',
      },
    },
    async (socket) => {
      clientes.add(socket);
      socket.on('close', () => clientes.delete(socket));
      socket.on('message', (datos) => {
        if (Buffer.isBuffer(datos) && datos.toString('utf8') === 'ping') socket.send('pong');
      });
      const ultima = await deps.estado.ultimaInstantanea();
      if (ultima && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ tipo: 'instantanea', datos: ultima } satisfies MensajeTorre));
      }
    },
  );
}
