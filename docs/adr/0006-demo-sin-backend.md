# ADR-0006: Demo sin backend: la misma torre en el navegador

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

Un reclutador o revisor debe poder ver la torre funcionando sin instalar Docker, y una demo con datos inventados aparte del código real no demuestra nada.

## Decisión

El modo demo del tablero ejecuta en el navegador el mismo dominio (reglas, salud, tendencias) sobre un simulador determinista con semilla que reproduce _La noche del cierre_. Vite lo construye como sitio estático y GitHub Pages lo publica.

## Consecuencias

La demo usa el mismo código de reglas que producción, con controles de velocidad y saltos entre capítulos. No ejercita la API, Redis ni PostgreSQL; eso lo cubren las pruebas de integración y `docker compose`.
