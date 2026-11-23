# torre_sdk

SDK mínimo para que un bot RPA en Python reporte latidos y eventos a la
[Torre de Control](../../README.md). Solo usa la biblioteca estándar (Python 3.11 o superior).

```python
from torre_sdk import ClienteTorre, ReportadorLatidos

torre = ClienteTorre("http://localhost:3000", token="...")
reportador = ReportadorLatidos(torre, bot_id="obrera-01", procesos=["payment_agreement"], version="2.0.0")
reportador.iniciar()                 # evento de inicio y latido cada 15 s en un hilo aparte
with reportador.tarea("MAC-000123"):
    registrar_acuerdo()              # una excepción cuenta como tarea fallida y se propaga
reportador.detener()                 # anuncia STOPPING: la torre no lo toma como caída
```

- **Reportar nunca tumba al bot.** Si la torre no responde, el latido se pierde (el siguiente lo
  reemplaza) y los eventos esperan en un búfer acotado que se reenvía en lotes de hasta 100.
  Con `ClienteTorre(..., estricto=True)` los errores se propagan.
- **Reenvíos idempotentes.** Cada evento lleva un `id` generado en el bot.
- **Compatible con colmena-rpa.** `latido_desde_colmena()` convierte su latido al formato de la torre.

Ejemplo completo en [`ejemplos/bot_minimo.py`](ejemplos/bot_minimo.py).

## Desarrollo

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check . && mypy && pytest --cov
```
