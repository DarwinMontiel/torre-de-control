# ADR-0004: SQL explícito y migraciones con huella, sin ORM

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

El catálogo (servidores, bots, colas) y el historial de incidentes son pocas tablas con reglas importantes: unicidad de alertas abiertas, estados válidos y fechas coherentes.

## Decisión

Se escribe SQL explícito con `pg` y parámetros. Las migraciones son archivos `.sql` numerados que se aplican en orden, cada uno en su propia transacción, y el migrador guarda su huella SHA-256: si alguien edita una migración ya aplicada, el arranque falla en vez de dejar la base en un estado desconocido. Las reglas críticas viven también en la base (restricciones `CHECK` e índice único parcial de incidentes abiertos).

## Consecuencias

Más SQL escrito a mano y ninguna generación automática de esquema. A cambio, cada consulta es visible y revisable, y la base protege los invariantes aunque falle el código.
