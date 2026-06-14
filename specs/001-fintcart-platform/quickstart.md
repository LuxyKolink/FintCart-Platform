# Quickstart — Plataforma Fintcart

**Feature**: Plataforma Fintcart | **Branch**: `001-fintcart-platform` | **Date**: 2026-06-13

Guía para levantar el entorno local poliglota y verificar el flujo principal (User Story 1).
Refleja las restricciones de la Constitución v1.0.0 y del marco tecnológico.

## Prerrequisitos

| Herramienta | Versión |
|-------------|---------|
| Go | 1.24+ |
| Rust | 1.85+ (stable) |
| Node.js | 22 LTS |
| Angular CLI | 19 |
| Docker + Docker Compose | reciente |
| `buf` (contratos gRPC) | reciente |
| `protoc` / plugins gRPC por lenguaje | — |

## 1. Infraestructura local

```powershell
# Levanta 7× PostgreSQL (uno por servicio con estado), Redis y RabbitMQ
docker compose -f deploy/docker/docker-compose.yml up -d
```

Servicios de infraestructura:
- PostgreSQL: `auth_db`, `users_db`, `learning_db`, `simulator_db`, `notification_db`, `audit_db`, `orchestrator_db` (instancias lógicas aisladas — Principio III).
- Redis: blacklist JWT + refresh (Auth), rate limiting (Gateway) — Principio IV.
- RabbitMQ: exchange topic; colas `notification.q`, `audit.q` — Principio V.

## 2. Generar stubs desde los contratos

```powershell
# Valida y compila los .proto compartidos hacia cada servicio
buf lint contracts/proto
buf generate contracts/proto   # genera gen/ por lenguaje (Go, Rust/tonic, TS)
```

## 3. Migraciones (por servicio, sin esquema compartido)

```powershell
# Go (golang-migrate), NestJS (TypeORM), Rust (sqlx) — cada uno contra SU base
make migrate-auth migrate-users migrate-learning migrate-simulator `
     migrate-notification migrate-audit migrate-orchestrator
```

## 4. Arrancar los servicios

```powershell
# Backend (cada uno en su contenedor o proceso)
make run-gateway run-auth run-orchestrator run-users `
     run-learning run-simulator run-notification run-audit

# Frontend SPA
cd frontend; npm install; npm start   # http://localhost:4200
```

Health checks: `GET /healthz` y `/readyz` por servicio (consumidos por Kubernetes en prod).

## 5. Verificación del flujo principal (User Story 1 — P1)

```powershell
# (a) Registro → inicia Saga de registro (Users.CreateProfile + Auth.CreateCredential + email)
curl -X POST http://localhost:8080/v1/auth/register `
  -H "Content-Type: application/json" `
  -d '{ "email": "ana@example.co", "password": "S3gura!2026", "display_name": "Ana" }'
# 202 Accepted; revisar email de verificación en la UI de RabbitMQ/Mailhog

# (b) Verificar correo → Saga de verificación (Users.MarkEmailVerified + Auth.ActivateCredential)
curl -X POST http://localhost:8080/v1/auth/verify-email `
  -d '{ "user_id": "...", "verification_token": "..." }'

# (c) Login OAuth2 Authorization Code + PKCE → la SPA obtiene access + refresh JWT
#     (flujo de navegador; el Gateway valida el token en cada request contra blacklist Redis)

# (d) Catálogo y lectura (FR-010/FR-011)
curl http://localhost:8080/v1/catalog/articles -H "Authorization: Bearer <jwt>"

# (e) Enviar cuestionario → Saga calificación→progreso→notificar→auditar (FR-027)
curl -X POST http://localhost:8080/v1/quizzes/<quizId>/attempts `
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" `
  -d '{ "answers": { "q1": "b", "q2": "a" } }'
# 201; respuesta incluye score (string decimal), attempt_no y points_after

# (f) Progreso actualizado (FR-014)
curl http://localhost:8080/v1/me/progress -H "Authorization: Bearer <jwt>"
```

**Criterio de aceptación**: tras (a)–(f), `points` refleja el mejor puntaje del cuestionario,
el intento queda en el historial (FR-016), Auditoría registró `quiz.graded`, y la bandeja
in-app muestra `resultado_cuestionario` (FR-023).

## 6. Verificaciones de cumplimiento (gates)

- **Precisión (Principio VIII)**: ejecutar la suite de borde numérico del Simulador
  (`cargo test -p simulator -- numeric_edge`) → cero divergencias por redondeo binario (SC-004).
  Confirmar que ningún payload monetario viaja como número JSON (lint de contrato).
- **Database-per-service (III)**: verificar que cada servicio solo posee credenciales
  de SU base (sin cadenas de conexión cruzadas en config/secretos).
- **Redis acotado (IV)**: solo Auth y Gateway tienen `REDIS_URL`.
- **RabbitMQ (V)**: solo `notification.q` y `audit.q` tienen consumidores enlazados.
- **Saga (VI)**: pruebas de integración con inyección de fallo por paso
  (`make test-saga`) → compensación/reintento correctos.

## 7. Pruebas

```powershell
make test-go        # go test + testify
cargo test          # Simulador (incluye casos de borde numérico)
make test-node      # Jest (Aprendizaje, Notificación)
cd frontend; npm test; npm run e2e   # Jest/Karma + Playwright
buf breaking contracts/proto --against '.git#branch=main'   # contratos sin cambios incompatibles
```
