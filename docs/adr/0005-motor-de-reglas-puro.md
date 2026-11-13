# ADR-0005: Motor de alertas puro con identidad, escalamiento e inhibición

- **Estado:** aceptada
- **Fecha:** 2026-11-12

## Contexto

Las alertas son la razón de ser de la torre. Si se mezclan con Redis, PostgreSQL o el reloj del sistema, son difíciles de probar, y una noche de fallas en cadena genera una avalancha de avisos repetidos.

## Decisión

El motor de reglas es una función pura: recibe una instantánea del sistema (colas, latidos, servidores) y las alertas vigentes, y devuelve las que se abren, cambian o se resuelven. Cada alerta tiene una identidad estable (regla + objeto), se escala de advertencia a crítica cuando empeora y se inhibe cuando su causa ya está cubierta (por ejemplo, `servidor_caido` inhibe los `bot_sin_latido` de ese servidor).

## Consecuencias

Las reglas se prueban con datos, sin servicios; la historia de _La noche del cierre_ es una prueba que verifica capítulo a capítulo qué alerta debe dispararse. Agregar una regla exige pensar su identidad y su relación de inhibición.
