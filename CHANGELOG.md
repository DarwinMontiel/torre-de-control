# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[SemVer](https://semver.org/lang/es/).

## [1.0.0] - 2026-11-13

Primera versión pública.

### Agregado

- Dominio puro: instantánea del sistema, salud de servidores (en línea, degradado, caído),
  tendencias de colas y motor de alertas con identidad estable, escalamiento e inhibición
  (`cola_creciendo`, `dlq_con_mensajes`, `cola_sin_consumidores`, `bot_sin_latido`,
  `servidor_caido`).
- API Fastify con esquemas TypeBox, OpenAPI/Swagger en español, tokens para bots y para
  administración, catálogo de servidores, bots y colas, reconocimiento de alertas y canal
  WebSocket de eventos.
- Adaptadores: RabbitMQ por la API de management, Redis (latidos con TTL, pub/sub y candado de
  liderazgo) y PostgreSQL con migraciones versionadas por huella SHA-256.
- Avisos por webhook y correo simulado, con aviso de resolución y duración.
- Tablero en TypeScript sin framework: resumen, colas, bots, servidores, alertas y bitácora,
  gráficos SVG, modo claro y oscuro, diseño adaptable a celular.
- Modo demo sin backend con un simulador determinista de _La noche del cierre_.
- SDK de Python (`torre_sdk`) con cliente y reportador de latidos, y simulador de siete bots.
- `docker compose` con todo el sistema, CI (tipos, lint, pruebas con umbral de cobertura,
  integración con servicios reales, SDK e imágenes Docker) y publicación de la demo en Pages.

[1.0.0]: https://github.com/DarwinMontiel/torre-de-control/releases/tag/v1.0.0
