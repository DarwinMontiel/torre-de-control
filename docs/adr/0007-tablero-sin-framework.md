# ADR-0007: Tablero en TypeScript sin framework

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

El tablero tiene unas pocas vistas (resumen, colas, bots, servidores, alertas y bitácora) que se actualizan por WebSocket. Un framework de UI agrega dependencias y tamaño para un problema pequeño.

## Decisión

Se usan módulos TypeScript con plantillas en cadenas que escapan todo valor por defecto (`escapar`), gráficos SVG propios y CSS con variables para modo claro y oscuro. Ningún dato que venga de la API o de los bots se inserta sin escapar.

## Consecuencias

El paquete de la demo pesa unos 40 kB de JavaScript (14 kB comprimido). Hay más código manual para el renderizado, y una vista mucho más compleja justificaría revisar la decisión.
