# syntax=docker/dockerfile:1.7
# Imagen de PRODUCCIÓN del Servicio de Usuarios: perfiles, progreso y bandeja in-app (plan.md N-03).
#
# El contexto de build es la RAÍZ del monorepo (`context: ..` en
# `dev/docker-compose.yaml`), no el directorio del servicio. Por eso todas las rutas
# de COPY empiezan por `services/`. `.dockerignore` mantiene ese contexto pequeño.
#
# Multi-stage: el toolchain de Go pesa cientos de megabytes y no hace ninguna falta
# para EJECUTAR un binario estático. Lo que se despliega es la segunda etapa, que no
# lleva compilador, ni shell, ni gestor de paquetes — así, un atacante que consiga
# ejecución dentro del contenedor no encuentra herramientas con las que moverse.

ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src

# Las dependencias van en su propia capa ANTES del código: cambiar una línea de
# `main.go` no debe invalidar la descarga de todo el árbol de módulos.
COPY services/users/go.mod services/users/go.sum ./
RUN go mod download

COPY services/users/ ./

# CGO_ENABLED=0 produce un binario ESTÁTICO, que es lo que permite la imagen
# `distroless/static` de la etapa siguiente. Con CGO, el binario dependería de la
# libc de Alpine y no arrancaría allí.
#
# `-trimpath` quita las rutas absolutas de la máquina de build del binario (no son
# reproducibles y filtran la estructura del sistema de compilación); `-s -w` quita
# la tabla de símbolos y la información de depuración.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/users ./cmd/users

# `static-debian12` no incluye shell ni libc: solo el binario, los certificados raíz
# y la información de zonas horarias. Los certificados hacen falta para TLS saliente
# y `tzdata` para que las marcas de tiempo en UTC se formateen bien.
FROM gcr.io/distroless/static-debian12:nonroot

# Usuario sin privilegios. La imagen `:nonroot` ya lo trae; declararlo explícitamente
# deja constancia de que NO se ejecuta como root y evita que un cambio de etiqueta lo
# revierta en silencio.
USER nonroot:nonroot

COPY --from=build /out/users /usr/local/bin/users

EXPOSE 9090

# Sin shell en la imagen, `ENTRYPOINT` debe ir en forma exec (lista JSON): la forma
# de cadena invocaría `/bin/sh -c`, que aquí no existe. La forma exec además hace que
# el proceso reciba SIGTERM directamente, que es lo que dispara el apagado ordenado.
ENTRYPOINT ["/usr/local/bin/users"]
