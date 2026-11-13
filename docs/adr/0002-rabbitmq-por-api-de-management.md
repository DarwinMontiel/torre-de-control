# ADR-0002: Leer RabbitMQ por la API de management, no por AMQP

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

La torre necesita saber cuántos mensajes y consumidores tiene cada cola (principal, reintentos y DLQ de colmena-rpa). Conectarse por AMQP para inspeccionar colas obliga a declararlas o tocarlas, y un error podría consumir mensajes de producción.

## Decisión

Se consulta `GET /api/queues/<vhost>` del plugin de management con un usuario de solo lectura. El adaptador traduce cada cola al modelo del dominio usando las convenciones de nombres de colmena-rpa (`rpa.<proceso>`, `rpa.<proceso>.retry.<N>s`, `rpa.<proceso>.dlq`).

## Consecuencias

La torre nunca abre conexiones AMQP ni puede alterar una cola. Depende de que el plugin de management esté activo, y los datos llegan con el retraso propio de las estadísticas de RabbitMQ (segundos), suficiente para monitoreo.
