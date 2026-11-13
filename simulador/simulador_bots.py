"""Simulador de bots para docker compose: la noche del cierre, pero con RabbitMQ de verdad.

- Declara la misma topología que colmena-rpa (cola principal quorum, colas de reintento
  con TTL que devuelven al exchange y DLQ) para cada proceso de Cobranzas Macondo.
- Un productor publica tareas ficticias con goteo constante y lotes cada pocos minutos.
- Siete bots consumen con ``prefetch=1`` y ``ack`` manual, y reportan latidos y eventos a
  la torre con el SDK (``torre_sdk``). Los errores transitorios van a reintento y los de
  negocio a la DLQ.
- Con ``SIMULADOR_CAOS=true`` cada tanto un bot "se congela": deja de latir y de consumir
  durante un rato, para que se vean las alertas en el tablero.

Todo dato es ficticio.
"""

from __future__ import annotations

import json
import logging
import os
import random
import signal
import threading
import time
import uuid
from dataclasses import dataclass

import pika
from pika.adapters.blocking_connection import BlockingChannel
from torre_sdk import ClienteTorre, ReportadorLatidos, TipoEvento

log = logging.getLogger("simulador")

EXCHANGE = "rpa.tasks"
ESPERAS = (10, 60, 300)


@dataclass(frozen=True)
class BotSimulado:
    id: str
    alias: str
    proceso: str
    hostname: str
    plataforma: str
    segundos_por_tarea: float


BOTS = (
    BotSimulado("bot-acuerdos-01", "Úrsula", "payment_agreement", "MAGDALENA-01", "Windows Server 2022", 1.2),
    BotSimulado("bot-acuerdos-02", "José Arcadio", "payment_agreement", "MAGDALENA-01", "Windows Server 2022", 1.0),
    BotSimulado("bot-acuerdos-03", "Aureliano", "payment_agreement", "CAUCA-02", "Windows Server 2022", 1.4),
    BotSimulado("bot-gestiones-01", "Amaranta", "collection_update", "CAUCA-02", "Windows Server 2022", 1.5),
    BotSimulado("bot-gestiones-02", "Remedios", "collection_update", "SINÚ-03", "Linux 6.8 (Ubuntu 24.04)", 1.3),
    BotSimulado("bot-gestiones-03", "Pilar", "collection_update", "SINÚ-03", "Linux 6.8 (Ubuntu 24.04)", 1.6),
    BotSimulado("bot-soportes-01", "Melquíades", "support_download", "ATRATO-04", "Linux 6.8 (Ubuntu 24.04)", 3.0),
)

# Tareas por segundo que llegan en goteo a cada proceso.
GOTEO = {"payment_agreement": 1.6, "collection_update": 1.0, "support_download": 0.25}


def entero_env(nombre: str, defecto: int) -> int:
    return int(os.environ.get(nombre, str(defecto)))


def conectar() -> pika.BlockingConnection:
    url = os.environ.get("SIMULADOR_AMQP_URL", "amqp://guest:guest@localhost:5672/%2F")
    for intento in range(30):
        try:
            return pika.BlockingConnection(pika.URLParameters(url))
        except pika.exceptions.AMQPConnectionError:
            log.info("RabbitMQ aún no responde (intento %s); se reintenta en 2 s", intento + 1)
            time.sleep(2)
    raise SystemExit("No se pudo conectar a RabbitMQ.")


def declarar_topologia(canal: BlockingChannel, proceso: str) -> None:
    """Igual que ``ProcessTopology.declare`` de colmena-rpa."""
    dlx = f"{EXCHANGE}.dlx"
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="direct", durable=True)
    canal.exchange_declare(exchange=dlx, exchange_type="direct", durable=True)
    principal = f"rpa.{proceso}"
    canal.queue_declare(
        queue=principal,
        durable=True,
        arguments={"x-queue-type": "quorum", "x-dead-letter-exchange": dlx, "x-dead-letter-routing-key": proceso},
    )
    canal.queue_bind(queue=principal, exchange=EXCHANGE, routing_key=proceso)
    canal.queue_declare(queue=f"{principal}.dlq", durable=True, arguments={"x-queue-type": "quorum"})
    canal.queue_bind(queue=f"{principal}.dlq", exchange=dlx, routing_key=proceso)
    for s in ESPERAS:
        canal.queue_declare(
            queue=f"{principal}.retry.{s}s",
            durable=True,
            arguments={
                "x-message-ttl": s * 1000,
                "x-dead-letter-exchange": EXCHANGE,
                "x-dead-letter-routing-key": proceso,
            },
        )


def publicar(canal: BlockingChannel, proceso: str, cantidad: int, erroneas: float = 0.02) -> None:
    for _ in range(cantidad):
        tarea = {
            "task_id": str(uuid.uuid4()),
            "process": proceso,
            "payload": {"cedula_ficticia": f"CC 000{random.randint(0, 9_999_999):07d}"},
            "attempt": 1,
            "simular_error_negocio": random.random() < erroneas,
        }
        canal.basic_publish(
            exchange=EXCHANGE,
            routing_key=proceso,
            body=json.dumps(tarea).encode(),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        )


def productor(parar: threading.Event) -> None:
    conexion = conectar()
    canal = conexion.channel()
    acumulado = dict.fromkeys(GOTEO, 0.0)
    siguiente_lote = time.monotonic() + 20
    publicar(canal, "payment_agreement", 300)
    publicar(canal, "collection_update", 150)
    while not parar.is_set():
        for proceso, tasa in GOTEO.items():
            acumulado[proceso] += tasa
            n = int(acumulado[proceso])
            acumulado[proceso] -= n
            publicar(canal, proceso, n)
        if time.monotonic() >= siguiente_lote:
            proceso = random.choice(list(GOTEO))
            cantidad = random.randint(80, 250)
            log.info("Llega un lote de %s tareas a rpa.%s", cantidad, proceso)
            publicar(canal, proceso, cantidad, erroneas=0.08)
            siguiente_lote = time.monotonic() + random.randint(120, 300)
        conexion.sleep(1.0)
    conexion.close()


class Bot(threading.Thread):
    def __init__(self, datos: BotSimulado, torre: ClienteTorre, parar: threading.Event, caos: bool) -> None:
        super().__init__(name=datos.id, daemon=True)
        self.datos = datos
        self.torre = torre
        self.parar = parar
        self.caos = caos
        self.reportador = ReportadorLatidos(
            torre,
            datos.id,
            [datos.proceso],
            version="1.4.0",
            hostname=datos.hostname,
            plataforma=datos.plataforma,
            eventos_ok_cada=50,
        )
        self.congelado_hasta = 0.0

    def run(self) -> None:
        # Un bot real sobrevive a caídas del broker: reconecta en lugar de morir.
        while not self.parar.is_set():
            try:
                self.turno()
            except pika.exceptions.AMQPError as e:
                log.warning("%s perdió la conexión con RabbitMQ (%s); reconecta en 3 s", self.datos.alias, e)
                time.sleep(3)
        self.reportador.detener("el simulador se apaga")

    def turno(self) -> None:
        conexion = conectar()
        cola = f"rpa.{self.datos.proceso}"
        canal: BlockingChannel | None = None
        ultimo_latido = 0.0
        self.torre.evento(self.datos.id, TipoEvento.INICIO, f"{self.datos.alias} inició en {self.datos.hostname}.")

        def al_mensaje(ch: BlockingChannel, metodo: pika.spec.Basic.Deliver, _p: object, cuerpo: bytes) -> None:
            self.procesar(ch, metodo.delivery_tag, cuerpo)

        while not self.parar.is_set():
            if self.caos and time.monotonic() > self.congelado_hasta and random.random() < 0.0015:
                duracion = random.randint(60, 150)
                self.congelado_hasta = time.monotonic() + duracion
                log.warning("%s se congela %s s (caos)", self.datos.alias, duracion)
            if time.monotonic() < self.congelado_hasta:
                # Congelado: ni late ni consume (se cierra el canal y RabbitMQ lo ve sin consumidor).
                if canal is not None and canal.is_open:
                    canal.close()
                conexion.sleep(1.0)
                continue
            if canal is None or not canal.is_open:
                recuperado = canal is not None
                canal = conexion.channel()
                canal.basic_qos(prefetch_count=1)
                canal.basic_consume(queue=cola, on_message_callback=al_mensaje)
                if recuperado:
                    self.torre.evento(self.datos.id, TipoEvento.INICIO, f"{self.datos.alias} se recuperó.")
            if time.monotonic() - ultimo_latido >= 5:
                self.reportador.latir()
                ultimo_latido = time.monotonic()
            conexion.process_data_events(time_limit=1.0)
        conexion.close()

    def procesar(self, canal: BlockingChannel, etiqueta: int, cuerpo: bytes) -> None:
        tarea = json.loads(cuerpo)
        tarea_id = f"MAC-{tarea['task_id'][:8]}"
        proceso = self.datos.proceso
        if tarea.get("simular_error_negocio"):
            try:
                with self.reportador.tarea(tarea_id):
                    raise LookupError(f"La cédula {tarea['payload']['cedula_ficticia']} (ficticia) no existe.")
            except LookupError:
                canal.basic_publish(exchange=f"{EXCHANGE}.dlx", routing_key=proceso, body=cuerpo)
            canal.basic_ack(etiqueta)
            return
        self.reportador.ocupado(tarea_id)
        time.sleep(random.uniform(0.6, 1.4) * self.datos.segundos_por_tarea)
        if random.random() < 0.03:
            espera = random.choice(ESPERAS[:2])
            canal.basic_publish(exchange="", routing_key=f"rpa.{proceso}.retry.{espera}s", body=cuerpo)
            self.reportador.reintento(tarea_id, f"El portal respondió 503. Reintento en {espera} s.")
        else:
            self.reportador.libre(True)
        canal.basic_ack(etiqueta)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    torre = ClienteTorre(
        os.environ.get("TORRE_URL", "http://localhost:3000"),
        token=os.environ.get("TORRE_TOKEN_BOTS") or None,
    )
    caos = os.environ.get("SIMULADOR_CAOS", "true").lower() in {"1", "true", "si", "sí"}
    parar = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    signal.signal(signal.SIGINT, lambda *_: parar.set())

    # La topología se declara antes de arrancar a los bots: consumir una cola que aún no existe cierra el canal.
    conexion = conectar()
    canal = conexion.channel()
    for proceso in GOTEO:
        declarar_topologia(canal, proceso)
    conexion.close()

    hilos: list[threading.Thread] = [threading.Thread(target=productor, args=(parar,), name="productor", daemon=True)]
    hilos += [Bot(b, torre, parar, caos) for b in BOTS[: entero_env("SIMULADOR_BOTS", len(BOTS))]]
    for h in hilos:
        h.start()
    log.info("Simulador en marcha: %s bots (caos=%s). Ctrl+C para detener.", len(hilos) - 1, caos)
    while not parar.is_set():
        parar.wait(1.0)
    for h in hilos:
        h.join(timeout=10)


if __name__ == "__main__":
    main()
