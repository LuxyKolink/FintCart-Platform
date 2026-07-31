# syntax=docker/dockerfile:1.7
# Imagen de PRODUCCIÓN del Servicio de Notificación (Node, ESM).
#
# El contexto de build es la RAÍZ del monorepo (`context: ..`), por eso las rutas de
# COPY empiezan por `services/`.
#
# A diferencia de Aprendizaje, aquí NO se copia `contracts/proto`: Notificación es un
# CONSUMIDOR PURO (Principio V) sin superficie gRPC, y solo usa los tipos de mensaje
# generados —que ya están en `src/pb/`— para tipar los payloads de los eventos.
#
# El paquete es ESM (`"type": "module"`) y arranca con `node dist/main.js`, sin
# bundler. La resolución de Node en ESM no completa extensiones, así que los imports
# relativos llevan `.js` explícito, tanto en el código como en los stubs generados
# (`importSuffix=.js` en `contracts/buf.gen.ts-messages.yaml`).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# `npm ci` y NO `npm install`: instala exactamente lo que fija `package-lock.json` y
# falla si el lock no cuadra con el manifiesto.
COPY services/notification/package.json services/notification/package-lock.json ./
RUN npm ci

COPY services/notification/ ./
RUN npm run build

# Instalación limpia solo con dependencias de producción; ver el comentario
# equivalente en `services/learning/Dockerfile`.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY services/notification/package.json services/notification/package-lock.json ./
RUN npm ci --omit=dev

FROM node:${NODE_VERSION}-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# `package.json` DEBE viajar a la imagen final: lleva `"type": "module"`, y sin él
# Node interpretaría los `.js` de `dist/` como CommonJS y fallaría en el primer
# `import`.
COPY services/notification/package.json ./

USER node

# Sin EXPOSE: no escucha en ningún puerto. Consume de RabbitMQ y escribe en PostgreSQL
# y en SMTP, las tres conexiones SALIENTES.

# Forma exec para que el proceso reciba SIGTERM directamente: es lo que dispara el
# `AbortController` del apagado ordenado. Con `npm start` de por medio, la señal
# llegaría a npm y el canal AMQP se cerraría de golpe, devolviendo a la cola mensajes
# sin ack que se reenviarían por duplicado.
ENTRYPOINT ["node", "dist/main.js"]
