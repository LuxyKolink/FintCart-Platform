#!/usr/bin/env bash
# Definiciones compartidas por los verbos de dev/ (Constitución Principio XII).
# No es un verbo: no ejecutar directamente.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEV_DIR/.." && pwd)"
COMPOSE_FILE="$DEV_DIR/docker-compose.yaml"

# Servicios con estado → (contenedor postgres, base de datos, ruta de migraciones).
# El orden fija el orden de dev/migrate.
STATEFUL_SERVICES=(
  "auth-server:postgres-auth:auth_db"
  "users:postgres-users:users_db"
  "learning:postgres-learning:learning_db"
  "simulator:postgres-simulator:simulator_db"
  "notification:postgres-notification:notification_db"
  "audit:postgres-audit:audit_db"
  "orchestrator:postgres-orchestrator:orchestrator_db"
)

PG_USER="fintcart"
PG_PASSWORD="dev_only_password"
MIGRATE_IMAGE="migrate/migrate:v4.17.0"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || die "Docker no está instalado. Es el único prerrequisito para levantar Fintcart."
  docker info >/dev/null 2>&1 \
    || die "El demonio de Docker no responde. ¿Está Docker Desktop en ejecución?"
}
