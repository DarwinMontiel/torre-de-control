# La noche del cierre

> Todo en esta historia es ficticio: la empresa, el banco, las personas, las cédulas y los
> servidores. Los nombres de los bots vienen de la literatura; los de los servidores, de ríos.

Es 30 de noviembre. En **Cobranzas Macondo S.A.S.** hay que registrar todos los acuerdos de pago
del mes en el portal del **Banco de Macondo** antes de las 6:00 a. m., cuando el banco cierra el
corte. Lo que no entre esta noche se pierde para el indicador del mes.

**Rebeca**, la operadora del turno de noche, tiene siete bots repartidos en cuatro servidores y
una pantalla: la Torre de Control.

| Bot                  | Proceso                                      | Servidor               |
| -------------------- | -------------------------------------------- | ---------------------- |
| Úrsula, José Arcadio | Acuerdos de pago (`rpa.payment_agreement`)   | MAGDALENA-01 (Windows) |
| Aureliano            | Acuerdos de pago                             | CAUCA-02 (Windows)     |
| Amaranta             | Gestiones de cobro (`rpa.collection_update`) | CAUCA-02 (Windows)     |
| Remedios, Pilar      | Gestiones de cobro                           | SINÚ-03 (Linux)        |
| Melquíades           | Soportes de pago (`rpa.support_download`)    | ATRATO-04 (Linux)      |

## Capítulos

Cada capítulo está escrito en [`src/dominio/historia.ts`](../src/dominio/historia.ts) como datos
(minuto de la noche + efectos sobre la simulación) y la prueba
[`noche-del-cierre.test.ts`](../tests/dominio/noche-del-cierre.test.ts) verifica que cada uno
dispare exactamente la alerta que se cuenta aquí.

| Hora  | Capítulo                              | Qué pasa                                                                                                    | Qué hace la torre                                                                                                |
| ----- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 22:00 | **Empieza el turno**                  | Llegan 1.800 acuerdos, 1.200 gestiones y 300 soportes.                                                      | Todo verde. Las colas bajan.                                                                                     |
| 22:40 | **El portal del banco se pone lento** | El portal responde en 9 s en vez de 2: la capacidad cae al 20 %.                                            | `cola_creciendo` a las 22:48 (advertencia) y **escala a crítica** a las 23:17 cuando la cola pasa de 1.500.      |
| 23:30 | **CAUCA-02 se reinicia sin avisar**   | Una actualización automática apaga a Aureliano y Amaranta.                                                  | Una sola alerta `servidor_caido` a los 45 s. **Inhibe** las dos de `bot_sin_latido`: misma causa, un solo aviso. |
| 23:50 | **El banco se recupera**              | El portal vuelve y CAUCA-02 regresa.                                                                        | Ambas alertas se resuelven solas y salen avisos de `[RESUELTA]` con la duración.                                 |
| 00:20 | **Cédulas que no existen**            | Un lote tardío trae 37 cédulas mal digitadas. Son errores de negocio: van directo a la DLQ, sin reintentos. | `dlq_con_mensajes` abre como advertencia y escala a crítica al superar 25.                                       |
| 01:10 | **Rebeca reprocesa la DLQ**           | Cartera corrige los datos y Rebeca devuelve los 37 mensajes.                                                | La DLQ queda en cero y la alerta se resuelve.                                                                    |
| 01:45 | **Melquíades se actualiza**           | Melquíades anuncia `STOPPING` para instalar la v1.4.1.                                                      | **No** es una caída (parada ordenada), pero `cola_sin_consumidores` avisa que nadie atiende los soportes.        |
| 03:10 | **Pilar se queda colgada**            | Un navegador zombi la deja sin responder.                                                                   | `bot_sin_latido` para Pilar; SINÚ-03 queda **degradado**, no caído, porque Remedios sigue en pie.                |
| 05:30 | **Cierre logrado**                    | Todas las colas en cero.                                                                                    | Ninguna alerta vigente. Rebeca apaga la cafetera.                                                                |

## Lo que la historia enseña

- **Una causa, un aviso.** Si cae el servidor, no sirve recibir una alerta por cada bot.
- **Parar no es caer.** Un bot que anuncia su parada no despierta a nadie; una cola sin
  consumidores, sí.
- **Tendencia, no foto.** Una cola con 2.000 mensajes que baja a 40 por minuto está bien; una con
  300 que sube a 30 por minuto, no.
- **Errores de negocio a la DLQ, sin reintentos.** Reintentar una cédula inexistente solo gasta
  tiempo del portal; la DLQ con su motivo es la lista de trabajo de cartera.
- **Las alertas se cierran solas.** Reconocer dice "ya lo estoy viendo"; resolver lo decide la
  condición, no una persona.

Mírala en vivo: [demo en GitHub Pages](https://darwinmontiel.github.io/torre-de-control/). Los
puntos de la línea de tiempo saltan a cada capítulo.
