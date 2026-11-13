# Tablero: build estático con Vite servido por nginx, que además hace de proxy hacia la API
# (mismo origen para REST y WebSocket: sin CORS).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npx vite build

FROM nginx:1.27-alpine
COPY deploy/tablero/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/tablero /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ > /dev/null || exit 1
