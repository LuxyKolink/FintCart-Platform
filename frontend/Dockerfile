# syntax=docker/dockerfile:1.7
# Imagen de PRODUCCIÓN del Frontend (SPA Angular).
#
# El contexto de build es la RAÍZ del monorepo (`context: ..`), por eso las rutas de
# COPY empiezan por `frontend/`.
#
# Lo que se despliega es HTML, CSS y JavaScript ESTÁTICOS servidos por nginx. No hay
# Node en la imagen final, y eso no es solo tamaño: un SPA no ejecuta nada en el
# servidor, así que tener ahí un runtime capaz de hacerlo solo añade superficie.
#
# **Principio II**: el SPA habla REST contra el API Gateway y NO participa en el plano
# gRPC interno. Por eso aquí no hay `contracts/proto` ni `@grpc/grpc-js`.

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# `npm ci` y NO `npm install`: instala exactamente lo que fija `package-lock.json`.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Angular 17+ emite en `dist/<proyecto>/browser`, y las versiones anteriores en
# `dist/<proyecto>`. El nombre del proyecto lo fija `angular.json`, que llega con la
# fase Angular, así que la ruta se resuelve aquí en lugar de codificarla: una ruta
# equivocada produciría una imagen con un `index.html` que no existe y un 404 en la
# raíz, sin ningún error durante el build.
RUN npm run build \
    && mkdir -p /out \
    && if [ -d dist ]; then \
         if ls -d dist/*/browser >/dev/null 2>&1; then cp -r dist/*/browser/. /out/; \
         else cp -r dist/*/. /out/; fi; \
       else echo "ERROR: 'npm run build' no produjo dist/" >&2; exit 1; fi

# `nginx-unprivileged` y no `nginx`: la imagen oficial arranca como root para poder
# escuchar en el puerto 80 y luego degrada los workers. Esta variante corre entera sin
# privilegios y escucha en 8080. Servir ficheros estáticos no necesita root en ningún
# momento, y no necesitarlo es la forma más barata de no tenerlo.
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine

# Las capas de configuración escriben en `/etc/nginx` y `/docker-entrypoint.d`, que
# pertenecen a root. Se vuelve al usuario sin privilegios antes de terminar.
USER root

# Configuración de nginx para un SPA con enrutado de cliente.
#
# `try_files $uri $uri/ /index.html` es la línea imprescindible: sin ella, recargar el
# navegador en `/catalog/articles/123` devuelve 404, porque esa ruta solo existe en el
# router de Angular y no como fichero. Con ella, nginx sirve `index.html` y el router
# resuelve la ruta en el cliente.
COPY <<'NGINX_CONF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Los ficheros con hash en el nombre son inmutables: se pueden cachear para
    # siempre. `index.html` NO, porque es el que apunta a los hashes nuevos — con
    # caché larga, un despliegue no llegaría al navegador hasta que expirara.
    location ~* \.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location = /config.js {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_CONF

# Configuración en tiempo de EJECUCIÓN, no de build (Principio X regla 2).
#
# Un SPA compilado no puede leer variables de entorno: el JavaScript corre en el
# navegador. La alternativa habitual —hornear la URL de la API durante el build— crea
# una imagen distinta por entorno, así que lo que se despliega en producción no es lo
# que se probó en staging. Este script escribe `config.js` al arrancar el contenedor,
# de modo que la MISMA imagen sirve para todos los entornos.
COPY <<'ENTRYPOINT_SH' /docker-entrypoint.d/40-fintcart-config.sh
#!/bin/sh
set -eu
: "${API_BASE_URL:?falta la variable de entorno API_BASE_URL}"
cat > /usr/share/nginx/html/config.js <<EOF
window.__FINTCART_CONFIG__ = { apiBaseUrl: "${API_BASE_URL}" };
EOF
ENTRYPOINT_SH
RUN chmod +x /docker-entrypoint.d/40-fintcart-config.sh

COPY --from=build /out /usr/share/nginx/html

# `101` es el uid del usuario `nginx` en la imagen unprivileged. Se indica por número
# y no por nombre para que la comprobación de «no corre como root» de un orquestador
# (`runAsNonRoot`) pueda verificarlo sin resolver `/etc/passwd`.
USER 101

# Puerto 8080 y no 80: por debajo de 1024 hacen falta privilegios para escuchar.
EXPOSE 8080
