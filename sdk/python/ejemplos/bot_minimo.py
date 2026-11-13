"""Un bot mínimo que reporta a la Torre de Control.

    TORRE_URL=http://localhost:3000 TORRE_TOKEN_BOTS=... python ejemplos/bot_minimo.py

Procesa diez tareas ficticias; una de cada cinco falla con un error de negocio.
"""

from __future__ import annotations

import logging
import os
import random
import time

from torre_sdk import ClienteTorre, ReportadorLatidos


class ClienteInexistente(Exception):
    """Error de negocio: no tiene sentido reintentar."""


def registrar_acuerdo(tarea: str) -> None:
    time.sleep(random.uniform(0.2, 0.6))
    if random.random() < 0.2:
        raise ClienteInexistente(f"La cédula de la tarea {tarea} no existe (dato ficticio).")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    torre = ClienteTorre(
        os.environ.get("TORRE_URL", "http://localhost:3000"), token=os.environ.get("TORRE_TOKEN_BOTS")
    )
    reportador = ReportadorLatidos(
        torre, bot_id="bot-ejemplo-01", procesos=["payment_agreement"], version="1.0.0", intervalo_seg=5
    )
    reportador.iniciar()
    try:
        for n in range(1, 11):
            tarea = f"MAC-{n:06d}"
            try:
                with reportador.tarea(tarea):
                    registrar_acuerdo(tarea)
            except ClienteInexistente as e:
                logging.warning("Tarea %s enviada a revisión: %s", tarea, e)
    finally:
        reportador.detener("fin del lote de ejemplo")


if __name__ == "__main__":
    main()
