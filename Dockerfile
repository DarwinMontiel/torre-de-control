# API de la Torre de Control. Node 24 ejecuta TypeScript de forma nativa (ADR-0001):
# no hay paso de compilación, la imagen lleva el código fuente tal cual se probó.
FROM node:25-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:25-alpine
ENV NODE_ENV=production \
    TORRE_PUERTO=3000
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json ./
COPY src/dominio ./src/dominio
COPY src/api ./src/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/salud > /dev/null || exit 1
CMD ["node", "src/api/main.ts"]
