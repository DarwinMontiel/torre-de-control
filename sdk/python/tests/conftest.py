"""Una torre falsa: servidor HTTP local que registra lo que recibe y responde lo que se le pide."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest


@dataclass
class Peticion:
    ruta: str
    cabeceras: dict[str, str]
    cuerpo: dict[str, Any]


@dataclass
class TorreFalsa:
    url: str
    peticiones: list[Peticion] = field(default_factory=list)
    # Códigos a devolver en orden; cuando se agotan, 202.
    respuestas: list[int] = field(default_factory=list)

    def rutas(self) -> list[str]:
        return [p.ruta for p in self.peticiones]


@pytest.fixture
def torre() -> Iterator[TorreFalsa]:
    estado = TorreFalsa(url="")

    class Manejador(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            largo = int(self.headers.get("content-length", "0"))
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")
            estado.peticiones.append(
                Peticion(self.path, {k.lower(): v for k, v in self.headers.items()}, cuerpo)
            )
            codigo = estado.respuestas.pop(0) if estado.respuestas else 202
            respuesta: dict[str, Any]
            if codigo >= 400:
                respuesta = {"error": "x", "mensaje": f"La torre respondió {codigo} a propósito."}
            elif self.path == "/api/v1/latidos":
                respuesta = {
                    "recibidoEn": "2026-12-01T03:00:00.000Z",
                    "ttlLatidoSeg": 45,
                    "registradoAhora": False,
                }
            else:
                respuesta = {"registrados": len(cuerpo.get("eventos", [cuerpo]))}
            datos = json.dumps(respuesta).encode()
            self.send_response(codigo)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
    estado.url = f"http://127.0.0.1:{servidor.server_address[1]}"
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    yield estado
    servidor.shutdown()
    servidor.server_close()
