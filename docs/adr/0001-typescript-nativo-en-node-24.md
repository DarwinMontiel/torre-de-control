# ADR-0001: TypeScript nativo en Node 24, sin compilar

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

La API y el vigía son un servicio pequeño que se despliega en contenedor. Un paso de compilación (tsc o un bundler) agrega artefactos, mapas de fuente y una fuente más de diferencias entre desarrollo y producción.

## Decisión

Node 24 ejecuta TypeScript directamente quitando los tipos (_type stripping_). El código usa solo sintaxis compatible con esa modalidad (importaciones con extensión `.ts`, sin `enum` ni `namespace`) y `tsc --noEmit` se usa únicamente para el tipado estricto en CI. El tablero sí pasa por Vite porque va al navegador.

## Consecuencias

Arranque directo con `node src/api/main.ts`, sin `dist/` para la API. A cambio, no se pueden usar construcciones de TypeScript que generan código, y el proyecto exige Node 24 o superior (`engines`).
