"""Cliente HTTP de la Torre de Control, solo con la biblioteca estándar.

Principio de diseño: **reportar nunca debe tumbar al bot**. Si la torre no responde, el
latido se pierde (el siguiente lo reemplaza) y los eventos se guardan en un búfer
acotado que se reenvía en lote cuando la torre vuelve. Con ``estricto=True`` los errores
se propagan, útil en pruebas de humo de un despliegue.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from torre_sdk.modelos import Evento, Latido, TipoEvento

log = logging.getLogger("torre_sdk")

MAX_LOTE = 100


class ErrorTorre(Exception):
    """La torre rechazó la solicitud o no se pudo contactar."""

    def __init__(self, mensaje: str, estado_http: int | None = None) -> None:
        super().__init__(mensaje)
        self.estado_http = estado_http


@dataclass(frozen=True, slots=True)
class RespuestaLatido:
    recibido_en: str
    ttl_latido_seg: int
    registrado_ahora: bool


class ClienteTorre:
    def __init__(
        self,
        url: str,
        token: str | None = None,
        *,
        timeout_seg: float = 3.0,
        reintentos: int = 2,
        espera_reintento_seg: float = 0.5,
        max_eventos_pendientes: int = 1000,
        estricto: bool = False,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"La URL de la torre debe empezar por http:// o https:// (recibida: {url!r}).")
        self._base = url.rstrip("/")
        self._token = token
        self._timeout = timeout_seg
        self._reintentos = reintentos
        self._espera = espera_reintento_seg
        self._estricto = estricto
        self._dormir = dormir
        self._pendientes: deque[Evento] = deque(maxlen=max_eventos_pendientes)
        self._candado = threading.Lock()

    # --- API pública -----------------------------------------------------------

    def latido(self, latido: Latido) -> RespuestaLatido | None:
        """Envía un latido. Devuelve ``None`` si no se pudo (salvo en modo estricto)."""
        try:
            cuerpo = self._post("/api/v1/latidos", latido.a_json())
        except ErrorTorre as e:
            self._fallo(f"No se pudo enviar el latido de {latido.bot_id}: {e}", e)
            return None
        self.vaciar_eventos()
        return RespuestaLatido(
            recibido_en=str(cuerpo.get("recibidoEn", "")),
            ttl_latido_seg=int(cuerpo.get("ttlLatidoSeg", 0)),
            registrado_ahora=bool(cuerpo.get("registradoAhora", False)),
        )

    def evento(self, bot_id: str, tipo: TipoEvento, mensaje: str, tarea_id: str | None = None) -> bool:
        """Registra un evento. Si la torre no responde, queda pendiente para el próximo envío."""
        e = Evento(bot_id=bot_id, tipo=tipo, mensaje=mensaje, tarea_id=tarea_id)
        with self._candado:
            self._pendientes.append(e)
        return self.vaciar_eventos()

    @property
    def eventos_pendientes(self) -> int:
        with self._candado:
            return len(self._pendientes)

    def vaciar_eventos(self) -> bool:
        """Envía los eventos pendientes en lotes de hasta 100. Devuelve ``True`` si no quedó ninguno."""
        while True:
            with self._candado:
                lote = [self._pendientes[i] for i in range(min(MAX_LOTE, len(self._pendientes)))]
            if not lote:
                return True
            try:
                if len(lote) == 1:
                    self._post("/api/v1/eventos", lote[0].a_json())
                else:
                    self._post("/api/v1/eventos/lote", {"eventos": [e.a_json() for e in lote]})
            except ErrorTorre as e:
                self._fallo(f"Eventos en espera ({self.eventos_pendientes}): {e}", e)
                return False
            with self._candado:
                for _ in lote:
                    if self._pendientes:
                        self._pendientes.popleft()

    # --- Interno -----------------------------------------------------------------

    def _fallo(self, mensaje: str, error: ErrorTorre) -> None:
        if self._estricto:
            raise error
        log.warning(mensaje)

    def _post(self, ruta: str, cuerpo: dict[str, Any]) -> dict[str, Any]:
        datos = json.dumps(cuerpo).encode("utf-8")
        cabeceras = {"content-type": "application/json", "accept": "application/json"}
        if self._token:
            cabeceras["authorization"] = f"Bearer {self._token}"
        ultimo: ErrorTorre | None = None
        for intento in range(self._reintentos + 1):
            peticion = urllib.request.Request(self._base + ruta, data=datos, headers=cabeceras, method="POST")  # noqa: S310
            try:
                with urllib.request.urlopen(peticion, timeout=self._timeout) as r:  # noqa: S310
                    texto = r.read().decode("utf-8") or "{}"
                    resultado: dict[str, Any] = json.loads(texto)
                    return resultado
            except urllib.error.HTTPError as e:
                mensaje = _mensaje_de(e)
                ultimo = ErrorTorre(f"HTTP {e.code}: {mensaje}", e.code)
                # 4xx no mejora reintentando (token inválido, datos mal formados).
                if e.code < 500 and e.code != 429:  # noqa: PLR2004
                    raise ultimo from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                ultimo = ErrorTorre(f"sin conexión con {self._base}: {e}")
            if intento < self._reintentos:
                self._dormir(self._espera * (2**intento))
        assert ultimo is not None  # noqa: S101 - el bucle siempre asigna antes de salir
        raise ultimo


def _mensaje_de(e: urllib.error.HTTPError) -> str:
    try:
        cuerpo = json.loads(e.read().decode("utf-8"))
        return str(cuerpo.get("mensaje", e.reason))
    except (ValueError, OSError):
        return str(e.reason)
