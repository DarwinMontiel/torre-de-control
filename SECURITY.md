# Política de seguridad

## Reportar una vulnerabilidad

Usa el [reporte privado de vulnerabilidades](https://github.com/DarwinMontiel/torre-de-control/security/advisories/new)
de GitHub. No abras un issue público. Responderé en un plazo de 7 días.

## Consideraciones conocidas

- Los tokens de `docker-compose.yml` (`token-bots-solo-para-desarrollo` y
  `token-admin-solo-para-desarrollo`) son **solo para desarrollo**. En cualquier otro entorno
  define `TORRE_TOKEN_BOTS` y `TORRE_TOKEN_ADMIN` con valores aleatorios largos.
- Las escrituras al catálogo exigen el token de administración y los latidos exigen el token de
  bots. **El reconocimiento de alertas no exige autenticación de usuario**: está pensado para una
  red interna de operación. Antes de exponer la torre fuera de ella, ponla detrás de un proxy
  con autenticación.
- El usuario de RabbitMQ que usa la torre solo necesita la etiqueta `monitoring` (lectura).
- El tablero escapa todo dato que viene de la API o de los bots antes de insertarlo en la página.
