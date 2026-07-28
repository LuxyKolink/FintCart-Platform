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

command -v buf >/dev/null 2>&1 || {
  echo "error: 'buf' no está instalado — https://buf.build/docs/installation" >&2
  exit 1
}

echo "==> lint"
buf lint

# --- Go: un módulo por servicio, cada uno con su propio gen/ ---------------
# El prefijo de paquete Go debe apuntar al módulo destino, así que se reescribe
# la plantilla por servicio en un archivo temporal.
GO_SERVICES=(api-gateway auth-server orchestrator users audit)
for svc in "${GO_SERVICES[@]}"; do
  out="$ROOT/services/$svc/gen"
  tmpl="$(mktemp)"
  sed "s#github.com/fintcart/platform/gen#github.com/fintcart/platform/services/$svc/gen#" \
    buf.gen.go.yaml > "$tmpl"
  echo "==> go: services/$svc/gen"
  rm -rf "$out" && mkdir -p "$out"
  buf generate --template "$tmpl" --output "$out"
  rm -f "$tmpl"
done

# --- TypeScript: NestJS, Node y Angular -----------------------------------
TS_TARGETS=(
  "$ROOT/services/learning/src/pb"
  "$ROOT/services/notification/src/pb"
  "$ROOT/frontend/src/app/pb"
)
for out in "${TS_TARGETS[@]}"; do
  echo "==> ts: ${out#"$ROOT/"}"
  rm -rf "$out" && mkdir -p "$out"
  buf generate --template buf.gen.ts.yaml --output "$out"
done

# --- Rust ------------------------------------------------------------------
# El Simulador genera sus stubs con tonic-build desde services/simulator/build.rs,
# que lee contracts/proto directamente en cada `cargo build`. No requiere buf.
echo "==> rust: generado por services/simulator/build.rs durante cargo build"

echo "OK — stubs regenerados. Commitear en un commit separado de la lógica."
