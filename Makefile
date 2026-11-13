.DEFAULT_GOAL := help
PY ?= sdk/python/.venv/bin/python

help: ## Lista los comandos disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Dependencias de Node y entorno del SDK de Python
	npm ci
	python -m venv sdk/python/.venv
	$(PY) -m pip install -e "sdk/python[dev]" pika==1.3.2

verificar: lint typecheck test sdk ## Todo lo que corre el CI (sin integración)

typecheck: ## TypeScript estricto
	npm run typecheck

lint: ## ESLint (perfil estricto con tipos) y Prettier
	npm run lint

test: ## Pruebas de Vitest con cobertura
	npm run test:cobertura

sdk: ## SDK de Python: ruff, mypy y pytest
	cd sdk/python && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy && .venv/bin/pytest --cov

integracion: ## Pruebas contra PostgreSQL, Redis y RabbitMQ reales (requiere `make infra`)
	npm run test:integracion

infra: ## Levanta solo PostgreSQL, Redis y RabbitMQ
	docker compose up -d postgres redis rabbitmq

up: ## Plataforma completa con siete bots simulados
	docker compose up --build -d

down: ## Detiene la plataforma y borra volúmenes
	docker compose down -v

dev: ## API en modo memoria + simulador (sin Docker) y tablero con recarga
	TORRE_ALMACEN=memoria TORRE_SEMBRAR_MACONDO=true TORRE_FUENTE_COLAS=simulada node --watch src/api/main.ts & npx vite

demo: ## Demo autónoma del tablero (la torre corre en el navegador)
	npm run dev:demo

capturas: ## Regenera las capturas del README (requiere Chrome o Edge)
	npm run build:demo && npm run captura

.PHONY: help install verificar typecheck lint test sdk integracion infra up down dev demo capturas
