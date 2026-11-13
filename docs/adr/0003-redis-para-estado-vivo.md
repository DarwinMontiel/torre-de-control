# ADR-0003: Redis para el estado vivo; el reloj lo pone la torre

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

Los latidos de los bots llegan cada pocos segundos y deben expirar solos; el tablero necesita enterarse de los cambios sin sondear; y si hay varias réplicas de la API, solo una debe evaluar las reglas para no duplicar alertas.

## Decisión

Redis guarda el último latido de cada bot con TTL, publica eventos por pub/sub (que el servidor reenvía al tablero por WebSocket) y aloja un candado de liderazgo con TTL (`torre:vigia:lider`). La marca de tiempo de cada latido la asigna la torre al recibirlo, no el bot, para que relojes desfasados en los servidores no produzcan falsas alertas.

## Consecuencias

El estado vivo se pierde si Redis se reinicia, lo cual es aceptable: se reconstruye con los siguientes latidos. La renovación del candado no es atómica; el peor caso es un ciclo de evaluación duplicado, cubierto por el índice único de incidentes (ver _Límites conocidos_ en la arquitectura).
