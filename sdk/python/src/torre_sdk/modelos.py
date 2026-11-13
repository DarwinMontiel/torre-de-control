"""Contrato de datos con la Torre de Control (ver ``POST /api/v1/latidos`` y ``/eventos``)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol


def ahora_utc() -> datetime:
    return datetime.now(UTC)


def iso(momento: datetime) -> str:
    """ISO 8601 en UTC con milisegundos y sufijo Z, como lo produce la torre."""
    return momento.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class EstadoBot(StrEnum):
    """Mismos valores que ``WorkerState`` de colmena-rpa."""

    IDLE = "IDLE"
    BUSY = "BUSY"
    STOPPING = "STOPPING"


class TipoEvento(StrEnum):
    INICIO = "inicio"
    PARADA = "parada"
    TAREA_OK = "tarea_ok"
    TAREA_FALLIDA = "tarea_fallida"
    REINTENTO = "reintento"
    LOTE = "lote"
    INFO = "info"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class Latido:
    bot_id: str
    hostname: str
    plataforma: str
    procesos: tuple[str, ...]
    estado: EstadoBot
    tarea_actual: str | None
    tareas_ok: int
    tareas_fallidas: int
    version: str
    iniciado_en: datetime

    def a_json(self) -> dict[str, Any]:
        return {
            "botId": self.bot_id,
            "hostname": self.hostname,
            "plataforma": self.plataforma,
            "procesos": list(self.procesos),
            "estado": self.estado.value,
            "tareaActual": self.tarea_actual,
            "tareasOk": self.tareas_ok,
            "tareasFallidas": self.tareas_fallidas,
            "version": self.version,
            "iniciadoEn": iso(self.iniciado_en),
        }


@dataclass(frozen=True, slots=True)
class Evento:
    bot_id: str
    tipo: TipoEvento
    mensaje: str
    tarea_id: str | None = None
    ocurrido_en: datetime = field(default_factory=ahora_utc)
    # Generado en el bot: si la red falla y se reenvía, la torre no lo duplica.
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def a_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "botId": self.bot_id,
            "tipo": self.tipo.value,
            "mensaje": self.mensaje[:1000],
            "tareaId": self.tarea_id,
            "ocurridoEn": iso(self.ocurrido_en),
        }


class LatidoColmena(Protocol):
    """Forma del ``Heartbeat`` de colmena-rpa (``rpa_orchestrator.persistence.repository``)."""

    @property
    def worker_id(self) -> str: ...
    @property
    def hostname(self) -> str: ...
    @property
    def platform(self) -> str: ...
    @property
    def processes(self) -> list[str]: ...
    @property
    def state(self) -> str: ...
    @property
    def current_task_id(self) -> object | None: ...
    @property
    def tasks_ok(self) -> int: ...
    @property
    def tasks_failed(self) -> int: ...
    @property
    def version(self) -> str: ...
    @property
    def started_at(self) -> datetime: ...


def latido_desde_colmena(hb: LatidoColmena) -> Latido:
    """Convierte el latido de un worker de colmena-rpa al formato de la torre.

    Permite que colmena reporte a la torre sin cambiar su ``HeartbeatService``: basta con
    llamar a ``ClienteTorre.latido(latido_desde_colmena(servicio.snapshot()))``.
    """
    return Latido(
        bot_id=hb.worker_id,
        hostname=hb.hostname,
        plataforma=hb.platform,
        procesos=tuple(hb.processes),
        estado=EstadoBot(str(hb.state)),
        tarea_actual=None if hb.current_task_id is None else str(hb.current_task_id),
        tareas_ok=hb.tasks_ok,
        tareas_fallidas=hb.tasks_failed,
        version=hb.version,
        iniciado_en=hb.started_at,
    )
