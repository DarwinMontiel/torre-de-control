"""Reportador de latidos para un bot (mismo ciclo de vida que el HeartbeatService de colmena-rpa).

Uso típico::

    torre = ClienteTorre("http://torre:3000", token=os.environ["TORRE_TOKEN_BOTS"])
    reportador = ReportadorLatidos(torre, bot_id="bot-acuerdos-01", procesos=["payment_agreement"])
    reportador.iniciar()
    for tarea in tareas:
        with reportador.tarea(tarea.id):
            registrar_acuerdo(tarea)       # si lanza excepción, cuenta como fallida
    reportador.detener()                    # anuncia STOPPING: la torre no lo tomará como caída
"""

from __future__ import annotations

import platform
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from torre_sdk.cliente import ClienteTorre
from torre_sdk.modelos import EstadoBot, Latido, TipoEvento, ahora_utc


class ReportadorLatidos:
    def __init__(
        self,
        cliente: ClienteTorre,
        bot_id: str,
        procesos: list[str],
        *,
        intervalo_seg: float = 15.0,
        version: str = "0.0.0",
        hostname: str | None = None,
        plataforma: str | None = None,
        eventos_ok_cada: int = 100,
    ) -> None:
        self._cliente = cliente
        self._bot_id = bot_id
        self._procesos = tuple(procesos)
        self._intervalo = intervalo_seg
        self._version = version
        self._hostname = hostname or socket.gethostname()
        self._plataforma = plataforma or f"{platform.system()} {platform.release()}"
        self._eventos_ok_cada = eventos_ok_cada
        self._candado = threading.Lock()
        self._estado = EstadoBot.IDLE
        self._tarea: str | None = None
        self._ok = 0
        self._fallidas = 0
        self._iniciado_en: datetime = ahora_utc()
        self._parar = threading.Event()
        self._hilo: threading.Thread | None = None

    @property
    def bot_id(self) -> str:
        return self._bot_id

    def instantanea(self) -> Latido:
        with self._candado:
            return Latido(
                bot_id=self._bot_id,
                hostname=self._hostname,
                plataforma=self._plataforma,
                procesos=self._procesos,
                estado=self._estado,
                tarea_actual=self._tarea,
                tareas_ok=self._ok,
                tareas_fallidas=self._fallidas,
                version=self._version,
                iniciado_en=self._iniciado_en,
            )

    def latir(self) -> None:
        self._cliente.latido(self.instantanea())

    # --- Cambios de estado ---------------------------------------------------------

    def ocupado(self, tarea_id: str) -> None:
        with self._candado:
            self._estado, self._tarea = EstadoBot.BUSY, tarea_id
        self.latir()

    def libre(self, exito: bool | None) -> None:
        """``True`` terminada, ``False`` fallida definitiva, ``None`` reintento programado."""
        with self._candado:
            self._estado, self._tarea = EstadoBot.IDLE, None
            if exito is True:
                self._ok += 1
            elif exito is False:
                self._fallidas += 1
            hito = exito is True and self._ok % self._eventos_ok_cada == 0
            ok = self._ok
        if hito:
            self._cliente.evento(self._bot_id, TipoEvento.TAREA_OK, f"{self._bot_id} completó {ok} tareas.")
        self.latir()

    @contextmanager
    def tarea(self, tarea_id: str) -> Iterator[None]:
        """Marca al bot como ocupado mientras dura el bloque y cuenta el resultado.

        Una excepción cuenta como tarea fallida, se reporta como evento y se propaga:
        decidir si es error de negocio o de sistema sigue siendo trabajo del bot.
        """
        self.ocupado(tarea_id)
        try:
            yield
        except Exception as e:
            self._cliente.evento(
                self._bot_id, TipoEvento.TAREA_FALLIDA, f"{type(e).__name__}: {e}", tarea_id=tarea_id
            )
            self.libre(False)
            raise
        self.libre(True)

    def reintento(self, tarea_id: str, motivo: str) -> None:
        self._cliente.evento(self._bot_id, TipoEvento.REINTENTO, motivo, tarea_id=tarea_id)
        self.libre(None)

    # --- Ciclo de vida -------------------------------------------------------------

    def iniciar(self) -> None:
        if self._hilo is not None:
            return
        self._parar.clear()
        self._cliente.evento(
            self._bot_id, TipoEvento.INICIO, f"{self._bot_id} inició en {self._hostname} (v{self._version})."
        )
        self.latir()
        self._hilo = threading.Thread(target=self._bucle, name=f"latidos-{self._bot_id}", daemon=True)
        self._hilo.start()

    def detener(self, motivo: str = "parada ordenada") -> None:
        """Anuncia ``STOPPING`` (la torre no lo tratará como caída) y detiene el hilo."""
        with self._candado:
            self._estado = EstadoBot.STOPPING
        self._cliente.evento(self._bot_id, TipoEvento.PARADA, f"{self._bot_id} se detiene: {motivo}.")
        self.latir()
        self._parar.set()
        if self._hilo is not None:
            self._hilo.join(timeout=self._intervalo + 1)
            self._hilo = None

    def _bucle(self) -> None:
        while not self._parar.wait(self._intervalo):
            self.latir()
