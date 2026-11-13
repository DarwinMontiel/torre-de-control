from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pytest
from conftest import TorreFalsa

from torre_sdk import (
    ClienteTorre,
    ErrorTorre,
    EstadoBot,
    Evento,
    Latido,
    ReportadorLatidos,
    TipoEvento,
    latido_desde_colmena,
)

INICIO = datetime(2026, 12, 1, 3, 0, tzinfo=UTC)


def latido(**cambios: object) -> Latido:
    base: dict[str, object] = {
        "bot_id": "bot-acuerdos-01",
        "hostname": "MAGDALENA-01",
        "plataforma": "Windows Server 2022",
        "procesos": ("payment_agreement",),
        "estado": EstadoBot.BUSY,
        "tarea_actual": "MAC-000001",
        "tareas_ok": 3,
        "tareas_fallidas": 1,
        "version": "1.4.0",
        "iniciado_en": INICIO,
    }
    base.update(cambios)
    return Latido(**base)  # type: ignore[arg-type]


def sin_espera(_: float) -> None:
    return None


class TestContrato:
    def test_el_latido_usa_los_nombres_de_campo_de_la_api(self) -> None:
        assert latido().a_json() == {
            "botId": "bot-acuerdos-01",
            "hostname": "MAGDALENA-01",
            "plataforma": "Windows Server 2022",
            "procesos": ["payment_agreement"],
            "estado": "BUSY",
            "tareaActual": "MAC-000001",
            "tareasOk": 3,
            "tareasFallidas": 1,
            "version": "1.4.0",
            "iniciadoEn": "2026-12-01T03:00:00.000Z",
        }

    def test_cada_evento_trae_un_id_propio_para_reenvios_idempotentes(self) -> None:
        a = Evento("bot-1", TipoEvento.INFO, "x" * 2000)
        b = Evento("bot-1", TipoEvento.INFO, "hola")
        assert a.id != b.id
        UUID(a.id)
        assert len(a.a_json()["mensaje"]) == 1000

    def test_convierte_el_latido_de_colmena_rpa(self) -> None:
        @dataclass
        class HeartbeatColmena:
            worker_id: str = "worker-linux-1"
            hostname: str = "srv-01"
            platform: str = "Linux 6.8"
            processes: list[str] | None = None
            state: str = "BUSY"
            current_task_id: UUID | None = None
            tasks_ok: int = 10
            tasks_failed: int = 2
            version: str = "1.0.0"
            started_at: datetime = INICIO

        hb = HeartbeatColmena(
            processes=["payment_agreement"], current_task_id=UUID("12345678-1234-5678-1234-567812345678")
        )
        convertido = latido_desde_colmena(hb)  # type: ignore[arg-type]
        assert convertido.a_json()["botId"] == "worker-linux-1"
        assert convertido.estado is EstadoBot.BUSY
        assert convertido.tarea_actual == "12345678-1234-5678-1234-567812345678"
        sin_tarea = latido_desde_colmena(HeartbeatColmena(processes=[], current_task_id=None, state="IDLE"))  # type: ignore[arg-type]
        assert sin_tarea.tarea_actual is None


class TestCliente:
    def test_envia_el_latido_con_el_token(self, torre: TorreFalsa) -> None:
        r = ClienteTorre(torre.url, token="secreto").latido(latido())
        assert r is not None
        assert r.ttl_latido_seg == 45
        p = torre.peticiones[0]
        assert p.ruta == "/api/v1/latidos"
        assert p.cabeceras["authorization"] == "Bearer secreto"
        assert p.cuerpo["estado"] == "BUSY"

    def test_sin_token_no_envia_cabecera(self, torre: TorreFalsa) -> None:
        ClienteTorre(torre.url).latido(latido())
        assert "authorization" not in torre.peticiones[0].cabeceras

    def test_reintenta_errores_5xx_con_espera_creciente(self, torre: TorreFalsa) -> None:
        esperas: list[float] = []
        torre.respuestas = [503, 502]
        r = ClienteTorre(torre.url, reintentos=2, espera_reintento_seg=0.5, dormir=esperas.append).latido(
            latido()
        )
        assert r is not None
        assert len(torre.peticiones) == 3
        assert esperas == [0.5, 1.0]

    def test_no_reintenta_un_401_y_no_tumba_al_bot(
        self, torre: TorreFalsa, caplog: pytest.LogCaptureFixture
    ) -> None:
        torre.respuestas = [401]
        with caplog.at_level(logging.WARNING, logger="torre_sdk"):
            assert ClienteTorre(torre.url, dormir=sin_espera).latido(latido()) is None
        assert len(torre.peticiones) == 1
        assert "HTTP 401: La torre respondió 401 a propósito." in caplog.text

    def test_en_modo_estricto_propaga_el_error(self, torre: TorreFalsa) -> None:
        torre.respuestas = [422]
        with pytest.raises(ErrorTorre) as e:
            ClienteTorre(torre.url, estricto=True, dormir=sin_espera).latido(latido())
        assert e.value.estado_http == 422

    def test_sin_conexion_devuelve_none(self) -> None:
        cliente = ClienteTorre("http://127.0.0.1:9", timeout_seg=0.2, reintentos=1, dormir=sin_espera)
        assert cliente.latido(latido()) is None

    def test_rechaza_urls_sin_esquema(self) -> None:
        with pytest.raises(ValueError, match="debe empezar por http"):
            ClienteTorre("torre:3000")

    def test_guarda_eventos_si_la_torre_no_responde_y_los_reenvia_en_lote(self, torre: TorreFalsa) -> None:
        cliente = ClienteTorre(torre.url, reintentos=0, dormir=sin_espera)
        torre.respuestas = [500, 500, 500]
        for n in range(3):
            assert (
                cliente.evento("bot-1", TipoEvento.REINTENTO, f"Portal 503 #{n}", tarea_id=f"MAC-{n}")
                is False
            )
        assert cliente.eventos_pendientes == 3
        assert cliente.latido(latido()) is not None  # la torre volvió: el latido vacía el búfer
        assert cliente.eventos_pendientes == 0
        lote = torre.peticiones[-1]
        assert lote.ruta == "/api/v1/eventos/lote"
        assert [e["mensaje"] for e in lote.cuerpo["eventos"]] == [
            "Portal 503 #0",
            "Portal 503 #1",
            "Portal 503 #2",
        ]

    def test_el_bufer_de_eventos_es_acotado(self, torre: TorreFalsa) -> None:
        cliente = ClienteTorre(torre.url, reintentos=0, max_eventos_pendientes=2, dormir=sin_espera)
        torre.respuestas = [500] * 3
        for n in range(3):
            cliente.evento("bot-1", TipoEvento.INFO, f"e{n}")
        assert cliente.eventos_pendientes == 2
        assert cliente.vaciar_eventos() is True
        assert [e["mensaje"] for e in torre.peticiones[-1].cuerpo["eventos"]] == ["e1", "e2"]


class TestReportador:
    def crear(self, torre: TorreFalsa, **op: object) -> ReportadorLatidos:
        cliente = ClienteTorre(torre.url, dormir=sin_espera)
        return ReportadorLatidos(
            cliente,
            "bot-acuerdos-01",
            ["payment_agreement"],
            version="1.4.0",
            hostname="MAGDALENA-01",
            plataforma="Windows Server 2022",
            **op,  # type: ignore[arg-type]
        )

    def test_una_tarea_exitosa_pasa_por_busy_e_idle_y_cuenta(self, torre: TorreFalsa) -> None:
        r = self.crear(torre)
        with r.tarea("MAC-000123"):
            assert r.instantanea().estado is EstadoBot.BUSY
        estados = [p.cuerpo["estado"] for p in torre.peticiones if p.ruta == "/api/v1/latidos"]
        assert estados == ["BUSY", "IDLE"]
        assert torre.peticiones[0].cuerpo["tareaActual"] == "MAC-000123"
        assert r.instantanea().tareas_ok == 1

    def test_una_excepcion_cuenta_como_fallida_y_se_propaga(self, torre: TorreFalsa) -> None:
        r = self.crear(torre)
        with pytest.raises(LookupError), r.tarea("MAC-000124"):
            raise LookupError("cédula ficticia inexistente")
        fallo = next(p for p in torre.peticiones if p.ruta == "/api/v1/eventos")
        assert fallo.cuerpo["tipo"] == "tarea_fallida"
        assert fallo.cuerpo["mensaje"] == "LookupError: cédula ficticia inexistente"
        assert fallo.cuerpo["tareaId"] == "MAC-000124"
        assert r.instantanea().tareas_fallidas == 1

    def test_reintento_no_cuenta_ni_como_ok_ni_como_fallida(self, torre: TorreFalsa) -> None:
        r = self.crear(torre)
        r.ocupado("MAC-1")
        r.reintento("MAC-1", "El portal respondió 503")
        snap = r.instantanea()
        assert (snap.tareas_ok, snap.tareas_fallidas, snap.estado) == (0, 0, EstadoBot.IDLE)
        assert any(p.cuerpo.get("tipo") == "reintento" for p in torre.peticiones)

    def test_reporta_hitos_de_tareas_completadas(self, torre: TorreFalsa) -> None:
        r = self.crear(torre, eventos_ok_cada=2)
        for n in range(4):
            with r.tarea(f"MAC-{n}"):
                pass
        hitos = [p.cuerpo["mensaje"] for p in torre.peticiones if p.cuerpo.get("tipo") == "tarea_ok"]
        assert hitos == ["bot-acuerdos-01 completó 2 tareas.", "bot-acuerdos-01 completó 4 tareas."]

    def test_ciclo_de_vida_anuncia_inicio_late_periodicamente_y_se_detiene_con_stopping(
        self, torre: TorreFalsa
    ) -> None:
        r = self.crear(torre, intervalo_seg=0.05)
        r.iniciar()
        r.iniciar()  # idempotente
        time.sleep(0.3)
        r.detener("actualización a v1.4.1")
        latidos = [p.cuerpo for p in torre.peticiones if p.ruta == "/api/v1/latidos"]
        assert len(latidos) >= 3
        assert latidos[-1]["estado"] == "STOPPING"
        tipos = [p.cuerpo.get("tipo") for p in torre.peticiones if p.ruta == "/api/v1/eventos"]
        assert tipos[0] == "inicio"
        assert tipos[-1] == "parada"
        assert r.bot_id == "bot-acuerdos-01"
