# syntax=docker/dockerfile:1.7
# Imagen de PRODUCCIÓN del Servicio Simulador (Rust).
#
# El contexto de build es la RAÍZ del monorepo (`context: ..`), por eso las rutas de
# COPY empiezan por `services/`.
#
# NO se necesita `protoc` en esta imagen. Los stubs de `src/pb/` están VERSIONADOS
# (§Definición de Contratos) y `build.rs` solo los regenera con
# `FINTCART_REGEN_PROTO=1`. Es la diferencia entre un build reproducible y uno que
# depende de tener la versión correcta de un compilador de protobuf en cada máquina.

ARG RUST_VERSION=1.85

FROM rust:${RUST_VERSION}-slim-bookworm AS build
WORKDIR /src

# Las dependencias van en su propia capa: `cargo build` de este árbol compila más de
# trescientas crates, y no debe repetirse porque cambie una línea de una calculadora.
# El truco del `main.rs` de mentira es el estándar en Rust — no hay equivalente de
# `go mod download` que compile solo las dependencias.
COPY services/simulator/Cargo.toml services/simulator/Cargo.lock ./
RUN mkdir -p src \
    && echo 'fn main() {}' > src/main.rs \
    && echo '' > src/lib.rs \
    && cargo build --release \
    && rm -rf src

COPY services/simulator/ ./

# `touch` fuerza a Cargo a recompilar los targets propios: si las marcas de tiempo
# quedaran por detrás de las de la capa anterior, reutilizaría el binario de mentira
# y la imagen final no contendría el servicio.
RUN touch src/main.rs src/lib.rs && cargo build --release

# `cc-debian12` y no `static`: el binario enlaza dinámicamente con glibc. Compilarlo
# estático con musl es posible, pero `rust_decimal` y `sqlx` con rustls no lo exigen y
# el objetivo musl cambia el asignador de memoria por uno notablemente más lento.
FROM gcr.io/distroless/cc-debian12:nonroot

USER nonroot:nonroot

COPY --from=build /src/target/release/fintcart-simulator /usr/local/bin/fintcart-simulator

EXPOSE 9090

# Forma exec (lista JSON): sin shell en la imagen, la forma de cadena no funcionaría,
# y además así el proceso recibe SIGTERM directamente y `serve_with_shutdown` puede
# drenar los RPC en vuelo.
ENTRYPOINT ["/usr/local/bin/fintcart-simulator"]
