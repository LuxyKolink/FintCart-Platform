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

# Igual que en `Dockerfile.dev`: `Cargo.lock` arrastra crates que exigen 1.86 o
# superior, así que 1.85 no compila este árbol. Se fija la misma versión que el
# toolchain de desarrollo para que un build que pasa en local no falle aquí.
ARG RUST_VERSION=1.97

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
#
# `src/bin/seed.rs` va en la lista por la misma razón y no por simetría: es un target
# PROPIO que la capa de dependencias no compiló —allí solo existían `main.rs` y
# `lib.rs`—, así que sin el `touch` podría quedar con una marca de tiempo anterior y
# Cargo reutilizaría lo que hubiera. El síntoma sería una imagen sin el binario de
# siembra, y eso no se nota hasta el despliegue.
RUN touch src/main.rs src/lib.rs src/bin/seed.rs && cargo build --release

# `cc-debian12` y no `static`: el binario enlaza dinámicamente con glibc. Compilarlo
# estático con musl es posible, pero `rust_decimal` y `sqlx` con rustls no lo exigen y
# el objetivo musl cambia el asignador de memoria por uno notablemente más lento.
FROM gcr.io/distroless/cc-debian12:nonroot

USER nonroot:nonroot

COPY --from=build /src/target/release/fintcart-simulator /usr/local/bin/fintcart-simulator

# El binario de SIEMBRA viaja en la imagen y NO se ejecuta al arrancar (Principio X:
# el entrypoint solo hace config, wiring y shutdown). Lo invoca el paso de despliegue
# `deploy/vps/seed` una vez por entorno, y las siete definiciones semilla son
# contenido —no esquema—, así que no pueden ir en una migración (research D-28).
#
# No estaba, y su ausencia no se notaba en desarrollo: allí el sembrado usa
# `/src/target/debug/seed`, que existe porque la imagen de desarrollo compila el árbol
# entero. En producción `cargo build --release` TAMBIÉN lo construye —es un target de
# `src/bin/`—, pero sin este COPY se quedaba fuera de la imagen final y el paso de
# siembra habría fallado con «executable file not found» la primera vez que alguien lo
# ejecutara de verdad.
COPY --from=build /src/target/release/seed /usr/local/bin/fintcart-seed

EXPOSE 9090

# Forma exec (lista JSON): sin shell en la imagen, la forma de cadena no funcionaría,
# y además así el proceso recibe SIGTERM directamente y `serve_with_shutdown` puede
# drenar los RPC en vuelo.
ENTRYPOINT ["/usr/local/bin/fintcart-simulator"]
