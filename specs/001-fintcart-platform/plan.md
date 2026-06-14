# Implementation Plan: Plataforma Fintcart — Educación Financiera Interactiva

**Branch**: `001-fintcart-platform` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-fintcart-platform/spec.md`

**Constraints applied from**: `docs/anteproyecto/brief/technology.md`, `docs/anteproyecto/brief/scope.md`, `.specify/memory/constitution.md` (v1.0.0)

## Summary

Fintcart es una plataforma de educación financiera para el mercado colombiano. La arquitectura es un sistema de **microservicios poliglota** con ocho servicios backend de bounded context aislado más una SPA Angular. La comunicación interna es **gRPC con Protocol Buffers**; **REST/HTTP existe únicamente en el API Gateway** como borde externo. Cada servicio con estado posee su **propia base de datos PostgreSQL** (database-per-service). La mensajería asíncrona usa **RabbitMQ** y se dirige exclusivamente a **Notificación y Auditoría**. La consistencia entre dominios se logra mediante el **patrón Saga** coordinado por el Orquestador. La identidad se centraliza en el Servidor de Autenticación con **OAuth2 (Authorization Code + PKCE para la SPA, Client Credentials para M2M)** y JWT firmados, con revocación vía blacklist en Redis. **Todo valor monetario, tasa o resultado de simulación se representa con precisión decimal arbitraria** en todas las capas (NON-NEGOTIABLE, Principio VIII).

El enfoque técnico deriva directamente de las restricciones del marco tecnológico (`technology.md`) y del alcance funcional (`scope.md`), validadas contra la Constitución de Fintcart. No existen incógnitas tecnológicas abiertas: la asignación de lenguaje, almacenamiento y topología de comunicación está fijada por la constitución; la fase de research consolida versiones concretas, librerías de precisión decimal y patrones de Saga/anonimización.

## Technical Context

**Language/Version** (poliglota, asignación fijada por la constitución §Restricciones Tecnológicas):

| Servicio | Lenguaje / Versión |
|----------|--------------------|
| API Gateway, Servidor de Autenticación, Orquestador, Usuarios, Auditoría | **Go 1.24** |
| Simulador | **Rust 1.85 (stable edition 2021)** |
| Aprendizaje | **TypeScript 5.6 + NestJS 11** sobre Node.js 22 LTS |
| Notificación | **TypeScript 5.6 (Node.js 22 LTS puro)** |
| Frontend (SPA) | **TypeScript 5.6 + Angular 19** |

**Primary Dependencies**:
- **Go**: `google.golang.org/grpc`, `google.golang.org/protobuf`, `github.com/shopspring/decimal` (precisión arbitraria), `github.com/jackc/pgx/v5` (PostgreSQL), `github.com/golang-migrate/migrate` (migraciones), `github.com/redis/go-redis/v9` (Auth + Gateway), `github.com/rabbitmq/amqp091-go`, `github.com/golang-jwt/jwt/v5`, `golang.org/x/crypto/argon2` (hash de contraseñas).
- **Rust (Simulador)**: `tonic` (gRPC), `prost` (protobuf), `rust_decimal` (precisión arbitraria), `sqlx` (PostgreSQL), `tokio` (async/concurrencia).
- **NestJS (Aprendizaje)**: `@nestjs/microservices` + `@grpc/grpc-js`, `@nestjs/typeorm` + `pg`, `decimal.js`, `class-validator`, `@golevelup/nestjs-rabbitmq` (publicación de eventos).
- **Notificación (Node)**: `amqplib` (consumidor RabbitMQ), `nodemailer` (email), `pg` (bandeja in-app).
- **Angular (Frontend)**: `angular-oauth2-oidc` (Authorization Code + PKCE), `rxjs`, `big.js`/`decimal.js` (montos como string).

**Storage**:
- **PostgreSQL 16** — una instancia lógica por servicio con estado (Auth, Orquestador, Usuarios, Aprendizaje, Simulador, Notificación, Auditoría). Columnas monetarias `NUMERIC(p,s)`; prohibido `REAL`/`DOUBLE PRECISION`/`FLOAT`.
- **Redis 7.4** — exclusivamente: (a) blacklist JWT + refresh tokens en Auth; (b) rate limiting distribuido en API Gateway. Ningún otro servicio se conecta a Redis.
- **RabbitMQ 4.0** — broker AMQP; productores (Usuarios, Aprendizaje, Orquestador, Autenticación) → consumidores (Notificación, Auditoría) únicamente.

**Testing**: `go test` + `testify` (Go); `cargo test` (Rust); `Jest` (NestJS y Notificación); `Jest`/`Karma` + `Playwright` e2e (Angular); `buf` para lint y detección de cambios incompatibles en `.proto`; pruebas de contrato productor↔consumidor (gRPC); pruebas de integración de Saga con escenarios de compensación; casos de borde numérico obligatorios en el Simulador.

**Target Platform**: contenedores Linux orquestados en **Kubernetes 1.31+** (escalamiento horizontal automático, health checks, gestión de configuración/secretos). Empaquetado con **Docker**. Entorno local vía `docker-compose`.

**Project Type**: Web — backend de microservicios poliglota + SPA Angular (frontend + backend detectados).

**Performance Goals**:
- ≥ 1.000 usuarios concurrentes con respuesta percibida < 2 s (SC-005).
- Lecturas de progreso/historial/catálogo < 1 s bajo carga normal (SC-003).
- Notificaciones disponibles < 2 min desde el evento de origen (SC-007).
- Cero divergencias por redondeo binario en simuladores (SC-004).

**Constraints**:
- **Precisión decimal arbitraria NON-NEGOTIABLE** en todas las capas (Principio VIII / FR-028).
- REST solo en el borde; gRPC interno obligatorio (Principio II).
- Database-per-service sin acceso cruzado (Principio III).
- Redis acotado a dos usos (Principio IV); RabbitMQ solo a Notificación/Auditoría (Principio V).
- Consistencia distribuida solo vía Saga con compensaciones; sin 2PC ni locks distribuidos (Principio VI).
- Disponibilidad objetivo 99,9% mensual, excluyendo mantenimiento planificado (SC-012).
- Cumplimiento Ley 1581 (consulta ≤10 días hábiles; supresión ≤15 días hábiles) y retención de auditoría ≥ 5 años (FR-029–FR-031, SC-011).

**Scale/Scope**: 8 microservicios backend + 1 SPA; 9 entidades de dominio; 4 historias de usuario priorizadas (P1–P4); 5 calculadoras financieras; ≥ 5 categorías temáticas de contenido; alcance MVP.

## Constitution Check

*GATE: Debe pasar antes de Phase 0. Re-evaluado tras Phase 1.*

| # | Principio | Estado | Cómo lo cumple el diseño |
|---|-----------|--------|--------------------------|
| I | Bounded Contexts y Microservicios | ✅ PASS | 8 servicios con responsabilidad aislada; ningún acceso cruzado a BD/estado; interacción solo por gRPC o eventos. Los contratos `.proto` compartidos en `contracts/` no codifican reglas de negocio (solo formas de mensaje). |
| II | gRPC interno, REST en el borde | ✅ PASS | Único componente con REST es el API Gateway (traducción HTTP↔gRPC). Servicios internos exponen solo gRPC; Notificación/Auditoría no exponen gRPC (consumidores puros). |
| III | Database-per-service (PostgreSQL) | ✅ PASS | Una instancia lógica PostgreSQL por servicio con estado. Sin vistas, esquemas ni credenciales compartidas. Intercambio de datos solo por gRPC/eventos. |
| IV | Uso acotado de Redis | ✅ PASS | Redis solo en Auth (blacklist JWT + refresh tokens) y Gateway (rate limiting). Ningún otro servicio abre conexión a Redis. |
| V | RabbitMQ solo a Notificación/Auditoría | ✅ PASS | Productores: Usuarios, Aprendizaje, Orquestador, Autenticación. Consumidores: solo Notificación y Auditoría. El **Simulador no es productor**; la auditoría de simulaciones se emite vía el Orquestador (ver research, decisión D-03). |
| VI | Saga vía Orquestador | ✅ PASS | Operaciones multi-dominio (registro, verificación de correo, calificación→progreso→notificar→auditar, eliminación/anonimización) implementadas como Sagas con compensación explícita. Sin 2PC ni locks distribuidos. Orquestador sin lógica de dominio. |
| VII | Autenticación/autorización estandarizada | ✅ PASS | OAuth2 Authorization Code + PKCE (SPA) y Client Credentials (M2M); JWT firmados; revocación vía blacklist Redis; identidad centralizada en Auth. Ningún servicio implementa auth propia. |
| VIII | Precisión aritmética monetaria (NON-NEGOTIABLE) | ✅ PASS | `NUMERIC` en PostgreSQL; `shopspring/decimal` (Go), `rust_decimal` (Rust), `decimal.js`/`big.js` (TS); `string` decimal canónica en proto y JSON. Lint anti-`float64`/`f64`/`number` en módulos financieros. Casos de borde numérico en pruebas. |

**Resultado del gate**: ✅ **PASS** — sin violaciones. No se requiere Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-fintcart-platform/
├── plan.md              # Este archivo (/speckit-plan)
├── research.md          # Phase 0 — decisiones técnicas consolidadas
├── data-model.md        # Phase 1 — entidades, relaciones, propiedad por servicio
├── quickstart.md        # Phase 1 — arranque local y verificación
├── contracts/           # Phase 1 — contratos de interfaz
│   ├── proto/           # gRPC: common, auth, users, learning, simulator, orchestrator
│   ├── events/          # esquemas de eventos RabbitMQ (productor/consumidores)
│   └── openapi/         # OpenAPI del API Gateway (borde REST)
├── checklists/
│   └── requirements.md  # checklist de calidad de la spec
└── tasks.md             # Phase 2 (/speckit-tasks — NO generado por /speckit-plan)
```

### Source Code (repository root)

Monorepo poliglota de microservicios. `contracts/` es la **única** dependencia compartida permitida (definiciones de interfaz versionadas, sin reglas de negocio); cada servicio genera sus propios stubs.

```text
contracts/                      # Contratos versionados (gRPC .proto, eventos, OpenAPI)
├── proto/
├── events/
└── openapi/

services/
├── api-gateway/                # Go — REST↔gRPC, CORS, rate limiting (Redis), validación JWT
│   ├── cmd/gateway/
│   ├── internal/{rest,grpcclient,middleware,ratelimit}/
│   ├── gen/                    # stubs generados desde contracts/proto
│   └── Dockerfile
├── auth-server/                # Go — OAuth2 (Auth Code+PKCE, Client Credentials), JWT, refresh, blacklist
│   ├── cmd/auth/
│   ├── internal/{oauth,token,credential,redisstore,grpc}/
│   ├── migrations/
│   ├── gen/
│   └── Dockerfile
├── orchestrator/               # Go — Saga + compensaciones (sin lógica de dominio)
│   ├── cmd/orchestrator/
│   ├── internal/{saga,steps,events}/
│   ├── migrations/             # saga_state (log/estado de sagas)
│   ├── gen/
│   └── Dockerfile
├── users/                      # Go — registro, perfiles, roles, progreso, historiales, estadísticas
│   ├── cmd/users/
│   ├── internal/{domain,grpc,repo,events}/
│   ├── migrations/
│   ├── gen/
│   └── Dockerfile
├── learning/                   # TypeScript + NestJS — artículos, versiones, cuestionarios, calificación, aprobación
│   ├── src/{articles,quizzes,grading,publishing,common,grpc,events}/
│   ├── migrations/
│   ├── test/
│   └── Dockerfile
├── simulator/                  # Rust — 5 calculadoras, precisión decimal, historial
│   ├── src/{calculators,domain,grpc,repo}/
│   ├── migrations/
│   ├── tests/
│   ├── Cargo.toml
│   └── Dockerfile
├── notification/               # TypeScript (Node puro) — consumidor RabbitMQ, email + bandeja in-app
│   ├── src/{consumers,email,inapp,common}/
│   ├── migrations/             # bandeja in-app
│   ├── test/
│   └── Dockerfile
└── audit/                      # Go — consumidor RabbitMQ, log inmutable append-only
    ├── cmd/audit/
    ├── internal/{consumer,repo}/
    ├── migrations/
    ├── gen/
    └── Dockerfile

frontend/                       # TypeScript + Angular 19 — SPA, OAuth2 PKCE
├── src/app/
│   ├── core/                   # auth PKCE, interceptores JWT, guards de rol
│   ├── features/{learning,simulators,profile,notifications,editorial}/
│   └── shared/                 # tipos, wrappers decimal.js (montos como string)
├── src/environments/
└── Dockerfile

deploy/
├── docker/
│   └── docker-compose.yml      # entorno local: 7× PostgreSQL, Redis, RabbitMQ
└── k8s/
    ├── base/                   # manifiestos por servicio (Deployment, Service, HPA, health checks)
    └── overlays/{dev,prod}/    # configuración/secretos por entorno
```

**Structure Decision**: Monorepo poliglota de microservicios. Cada servicio es un módulo desplegable independiente con su propio `Dockerfile`, migraciones y stubs gRPC generados localmente. La separación física por carpeta refuerza los límites de bounded context (Principio I) y la soberanía de datos (Principio III). Los contratos viven en `contracts/` —versionados y revisables (Disciplina de Desarrollo §Definición de Contratos)— y son la única superficie compartida.

## Complexity Tracking

> Sin violaciones a la constitución. No se requiere justificación de complejidad.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(ninguna)_ | — | — |
