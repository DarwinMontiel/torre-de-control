# Simulador de bots: usa el SDK de Python del repositorio y RabbitMQ real.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY sdk/python /tmp/sdk
COPY simulador/requirements.txt ./
RUN pip install --no-cache-dir /tmp/sdk -r requirements.txt && rm -rf /tmp/sdk

COPY simulador/simulador_bots.py ./
RUN useradd --create-home --uid 10001 bot
USER bot

CMD ["python", "simulador_bots.py"]
