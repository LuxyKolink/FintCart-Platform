#!/usr/bin/env bash
# Regenera los stubs gRPC de los contratos hacia cada servicio.
#
# Los stubs generados SE COMMITEAN al repositorio (Constitución §Definición de
# Contratos): compilar un servicio no debe exigir tener buf ni protoc instalados.
# Ejecutar este script solo al cambiar un `.proto`, y commitear el resultado en un
# commit separado del cambio de lógica de negocio.
#
# Uso:  contracts/generate.sh
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

# Los plugins de protoc se ejecutan en LOCAL, no en el servicio alojado de
# buf.build: la imagen del esquema (servicios, RPC, campos y comentarios) no sale
# de la máquina. Requiere tener los binarios en el PATH.
#
# `protoc-gen-ts_proto` se instala como devDependency de este directorio, así que
# basta añadir su bin/ al PATH; los binarios Go los coloca `go install` en
# $(go env GOPATH)/bin, que se añade si no estuviera ya.
PATH="$PWD/node_modules/.bin:$PATH"
if command -v go >/dev/null 2>&1; then
  PATH="$PATH:$(go env GOPATH)/bin"
fi
export PATH

missing=()
check_tool() {
  command -v "$1" >/dev/null 2>&1 || missing+=("$1 → $2")
}
check_tool buf                 "go install github.com/bufbuild/buf/cmd/buf@v1.47.2"
check_tool protoc-gen-go       "go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11"
check_tool protoc-gen-go-grpc  "go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1"
check_tool protoc-gen-ts_proto "npm install --prefix contracts"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: faltan herramientas de generación:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "==> lint"
buf lint

# --- Go: un módulo por servicio, cada uno con su propio gen/ ---------------
# El prefijo de paquete Go debe apuntar al módulo destino, así que se reescribe
# la plantilla por servicio en un archivo temporal.
# La plantilla temporal se escribe con una ruta RELATIVA dentro de contracts/, no
# con mktemp: en Git Bash sobre Windows, MSYS traduce `/tmp/...` a una ruta que
# buf no resuelve, y como `--template` acepta tanto un fichero como YAML en
# línea, buf acaba intentando parsear la propia ruta como si fuera el contenido.
# Una ruta relativa no sufre esa traducción.
TMPL=".buf.gen.go.tmp.yaml"
trap 'rm -f "$TMPL"' EXIT

GO_SERVICES=(api-gateway auth-server orchestrator users audit)
for svc in "${GO_SERVICES[@]}"; do
  out="$ROOT/services/$svc/gen"
  sed "s#github.com/fintcart/platform/gen#github.com/fintcart/platform/services/$svc/gen#" \
    buf.gen.go.yaml > "$TMPL"
  echo "==> go: services/$svc/gen"
  rm -rf "$out" && mkdir -p "$out"
  buf generate --template "$TMPL" --output "$out"
done
rm -f "$TMPL"

# --- TypeScript: NestJS, Node y Angular -----------------------------------
# Dos plantillas, no una. Solo Aprendizaje (NestJS) sirve gRPC y necesita stubs
# de servicio; Notificación es consumidor puro de RabbitMQ y el Frontend habla
# REST contra el Gateway (Principio II). Generarles stubs de servicio les metería
# `@grpc/grpc-js`, que es exclusivo de Node y no funciona en un navegador.
# Ver la cabecera de buf.gen.ts-messages.yaml.
echo "==> ts (con servicios): services/learning/src/pb"
out="$ROOT/services/learning/src/pb"
rm -rf "$out" && mkdir -p "$out"
buf generate --template buf.gen.ts.yaml --output "$out"

TS_MESSAGE_TARGETS=(
  "$ROOT/services/notification/src/pb"
  "$ROOT/frontend/src/app/pb"
)
for out in "${TS_MESSAGE_TARGETS[@]}"; do
  echo "==> ts (solo mensajes): ${out#"$ROOT/"}"
  rm -rf "$out" && mkdir -p "$out"
  buf generate --template buf.gen.ts-messages.yaml --output "$out"
done

# --- Rust ------------------------------------------------------------------
# El Simulador genera sus stubs con tonic-build desde services/simulator/build.rs,
# que lee contracts/proto directamente en cada `cargo build`. No requiere buf.
echo "==> rust: generado por services/simulator/build.rs durante cargo build"

echo "OK — stubs regenerados. Commitear en un commit separado de la lógica."
