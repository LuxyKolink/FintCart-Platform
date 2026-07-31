# syntax=docker/dockerfile:1.7
# Imagen de PRODUCCIÓN del Servicio de Aprendizaje (NestJS).
#
# El contexto de build es la RAÍZ del monorepo (`context: ..`), por eso las rutas de
# COPY empiezan por `services/` y se puede copiar también `contracts/`.
#
# `contracts/proto` VIAJA EN LA IMAGEN y no es opcional: el transporte gRPC de NestJS
# carga los `.proto` en tiempo de EJECUCIÓN con `@grpc/proto-loader`, así que los
# stubs generados no bastan. Sin ellos el proceso arranca y falla al declarar el
# servidor, que es el peor momento para descubrirlo.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Las dependencias van en su propia capa: cambiar una línea de código no debe
# reinstalar el árbol de node_modules.
#
# `npm ci` y NO `npm install`: instala EXACTAMENTE lo que fija `package-lock.json` y
# falla si el lock no cuadra con el manifiesto. `npm install` actualizaría el lock
# dentro de la imagen, de modo que lo que se despliega no sería lo que se probó.
COPY services/learning/package.json services/learning/package-lock.json ./
RUN npm ci

COPY services/learning/ ./
RUN npm run build

# Segunda instalación, solo con dependencias de producción. `npm prune --omit=dev`
# sobre el árbol anterior dejaría restos; una instalación limpia es la única forma
# fiable de que en la imagen final no queden ni el compilador de TypeScript ni Jest.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY services/learning/package.json services/learning/package-lock.json ./
RUN npm ci --omit=dev

FROM node:${NODE_VERSION}-alpine
WORKDIR /app

# `NODE_ENV=production` no es cosmético: desactiva comprobaciones caras de varias
# librerías y es lo que consultan para elegir sus valores por defecto.
ENV NODE_ENV=production

# Ruta de los `.proto` dentro de la imagen; la lee `common/config.ts`.
ENV PROTO_DIR=/app/contracts/proto

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/learning/package.json ./
COPY contracts/proto ./contracts/proto

# La imagen de Node trae un usuario `node` sin privilegios. Ejecutar como root un
# proceso expuesto a datos de red es un riesgo que no compra nada.
USER node

EXPOSE 9090

# Forma exec para que el proceso reciba SIGTERM directamente: envuelto en `npm start`,
# la señal llegaría a npm y no a Node, y `enableShutdownHooks` no se dispararía —el
# pool de `pg` quedaría con conexiones abiertas en cada despliegue.
ENTRYPOINT ["node", "dist/main.js"]
