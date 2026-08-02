# Implementation Plan: Plataforma Fintcart — Educación Financiera Interactiva

**Branch**: `001-fintcart-platform` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-fintcart-platform/spec.md`

**Constraints applied from**: `docs/anteproyecto/brief/technology.md`, `docs/anteproyecto/brief/scope.md`, `.specify/memory/constitution.md` (**v1.1.1**)

## Summary

Fintcart es una plataforma de educación financiera para el mercado colombiano. La arquitectura es un sistema de **microservicios poliglota** con ocho servicios backend de bounded context aislado más una SPA Angular. La comunicación interna es **gRPC con Protocol Buffers**; **REST/HTTP existe únicamente en el API Gateway** como borde externo. Cada servicio con estado posee su **propia base de datos PostgreSQL** (database-per-service). La mensajería asíncrona usa **RabbitMQ** y se dirige exclusivamente a **Notificación y Auditoría**. La consistencia entre dominios se logra mediante el **patrón Saga** coordinado por el Orquestador. La identidad se centraliza en el Servidor de Autenticación con **OAuth2 (Authorization Code + PKCE para la SPA, Client Credentials para M2M)** y JWT firmados, con revocación vía blacklist en Redis. **Todo valor monetario, tasa o resultado de simulación se representa con precisión decimal arbitraria** en todas las capas (NON-NEGOTIABLE, Principio VIII).

A partir de la enmienda constitucional **v1.1.0**, el plan incorpora además las convenciones de estructura y desarrollo derivadas del repositorio de referencia `github.com/dhij/ecomm` y generalizadas a los cinco stacks del proyecto: **arquitectura en capas `handler → server → storer`** con interfaz explícita en la persistencia y mapeo de tipos en cada frontera (Principio IX); **entrypoints delgados con configuración 100% por variables de entorno** (Principio X); **migraciones emparejadas con `golang-migrate` uniforme para todos los lenguajes** y helper de transacción centralizado (Principio XI); y una **interfaz de desarrollo local uniforme** vía `dev/build`, `dev/up`, `dev/migrate`, `dev/down` (Principio XII).

El enfoque técnico deriva de las restricciones del marco tecnológico (`technology.md`) y del alcance funcional (`scope.md`), validadas contra la Constitución de Fintcart. No existen incógnitas tecnológicas abiertas: la asignación de lenguaje, almacenamiento y topología de comunicación está fijada por la constitución; la fase de research consolida versiones concretas, librerías de precisión decimal y patrones de Saga/anonimización.

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

- **Go**: `google.golang.org/grpc`, `google.golang.org/protobuf`, `github.com/shopspring/decimal` (precisión arbitraria), `github.com/jackc/pgx/v5` (PostgreSQL), `github.com/jmoiron/sqlx` (acceso a datos en la capa `storer`), `github.com/golang-migrate/migrate` (migraciones), `github.com/go-chi/chi/v5` (router REST del Gateway), `github.com/redis/go-redis/v9` (Auth + Gateway), `github.com/rabbitmq/amqp091-go`, `github.com/golang-jwt/jwt/v5`, `golang.org/x/crypto/argon2` (hash de contraseñas), `github.com/DATA-DOG/go-sqlmock` (pruebas de persistencia).
- **Rust (Simulador)**: `tonic` (gRPC), `prost` (protobuf), `rust_decimal` (precisión arbitraria), `sqlx` (PostgreSQL), `tokio` (async/concurrencia), `thiserror` (envoltura de errores con causa).
- **NestJS (Aprendizaje)**: `@nestjs/microservices` + `@grpc/grpc-js`, `pg`, `decimal.js`, `class-validator`, `@golevelup/nestjs-rabbitmq` (publicación de eventos).
- **Notificación (Node)**: `amqplib` (consumidor RabbitMQ), `nodemailer` (email), `pg` (cola persistente con estado).
- **Angular (Frontend)**: `angular-oauth2-oidc` (Authorization Code + PKCE), `rxjs`, `big.js`/`decimal.js` (montos como string).

**Storage**:

- **PostgreSQL 16** — una instancia lógica por servicio con estado (Auth, Orquestador, Usuarios, Aprendizaje, Simulador, Notificación, Auditoría). Columnas monetarias `NUMERIC(p,s)`; prohibido `REAL`/`DOUBLE PRECISION`/`FLOAT`.
- **Redis 7.4** — exclusivamente: (a) blacklist JWT + refresh tokens en Auth; (b) rate limiting distribuido en API Gateway. Ningún otro servicio se conecta a Redis.
- **RabbitMQ 4.0** — broker AMQP; productores (Usuarios, Aprendizaje, Orquestador, Autenticación) → consumidores (Notificación, Auditoría) únicamente.

**Migraciones** (Principio XI): `golang-migrate` como **herramienta única para los cinco stacks**, ejecutada como contenedor contra la base de datos de cada servicio. Archivos emparejados `<YYYYMMDDHHMMSS>_<nombre>.{up,down}.sql` en `services/<svc>/migrations/`. Prohibido el auto-sincronizado de esquema por ORM (`synchronize: true` de TypeORM y equivalentes) en cualquier entorno. **Esta decisión supersede D-11 de `research.md`**, que asignaba una herramienta distinta por stack.

**Acceso a datos** (Principio XI): helper de transacción centralizado `execTx(ctx, fn)` por servicio; toda escritura multi-tabla ocurre dentro de una transacción; contexto de cancelación propagado en toda operación de E/S; errores envueltos preservando la causa (`%w` en Go, `thiserror`/`source` en Rust, `cause` en TypeScript).

**Testing**: `go test` + `testify` + `go-sqlmock` (Go); `cargo test` (Rust); `Jest` (NestJS y Notificación); `Jest`/`Karma` + `Playwright` e2e (Angular); `buf` para lint y detección de cambios incompatibles en `.proto`. Obligatorio por constitución §Calidad y Pruebas: pruebas de contrato productor↔consumidor (gRPC); **pruebas de persistencia contra driver SQL simulado** (sin BD viva); pruebas de la capa de aplicación contra un doble de la interfaz `storer`; pruebas de integración de Saga con escenarios de compensación; **los tres desenlaces de la cola de notificaciones** (éxito, fallo reintentable, fallo terminal); casos de borde numérico obligatorios en el Simulador.

**Target Platform**: contenedores Linux orquestados en **Kubernetes 1.31+** (escalamiento horizontal automático, health checks, gestión de configuración/secretos), con **mínimo 2 réplicas para los servicios de la ruta crítica de usuario** (Gateway, Auth, Usuarios, Aprendizaje, Simulador) para sostener el SLO de 99,9% (D-12, SC-012). Empaquetado con **Docker**: `Dockerfile` de producción multi-stage y `Dockerfile.dev` para desarrollo local. Entorno local vía `dev/docker-compose.yaml` operado con los scripts `dev/` (Principio XII).

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
- Capas `handler → server → storer` con dependencia unidireccional e inyección por constructor (Principio IX).
- Configuración solo por variables de entorno; descubrimiento por hostname; secretos fuera del repositorio (Principio X).
- Disponibilidad objetivo 99,9% mensual, excluyendo mantenimiento planificado (SC-012).
- Cumplimiento Ley 1581 (consulta ≤10 días hábiles; supresión ≤15 días hábiles) y retención de auditoría ≥ 5 años (FR-029–FR-031, SC-011).

**Scale/Scope**: 8 microservicios backend + 1 SPA; 9 entidades de dominio; 4 historias de usuario priorizadas (P1–P4); 5 calculadoras financieras; ≥ 5 categorías temáticas de contenido; alcance MVP.

## Constitution Check

*GATE: Debe pasar antes de Phase 0. Re-evaluado tras Phase 1.*

| # | Principio | Estado | Cómo lo cumple el diseño |
|---|-----------|--------|--------------------------|
| I | Bounded Contexts y Microservicios | ✅ PASS | 8 servicios con responsabilidad aislada; ningún acceso cruzado a BD/estado; interacción solo por gRPC o eventos. Los contratos `.proto` compartidos en `contracts/` no codifican reglas de negocio (solo formas de mensaje). |
| II | gRPC interno, REST en el borde | ✅ PASS | Único componente con REST es el API Gateway (traducción HTTP↔gRPC). Servicios internos exponen solo gRPC; Notificación/Auditoría no exponen gRPC (consumidores puros). |
| III | Database-per-service (PostgreSQL) | ✅ PASS | Una instancia lógica PostgreSQL por servicio con estado. Sin vistas, esquemas ni credenciales compartidas. Intercambio de datos solo por gRPC/eventos. `UsersService.GetActivityReport` obtiene `quizzes_attempted` y `simulations_run` por **fan-out gRPC** a Aprendizaje y Simulador, nunca por lectura cruzada de BD (ver §Notas de Diseño, N-02). |
| IV | Uso acotado de Redis | ✅ PASS | Redis solo en Auth (blacklist JWT + refresh tokens) y Gateway (rate limiting). Ningún otro servicio abre conexión a Redis. |
| V | RabbitMQ solo a Notificación/Auditoría | ✅ PASS | Productores: Usuarios, Aprendizaje, Orquestador, Autenticación. Consumidores: solo Notificación y Auditoría. El **Simulador no es productor**; la auditoría de simulaciones se emite vía el Orquestador (D-03). |
| VI | Saga vía Orquestador | ✅ PASS | Operaciones multi-dominio (registro, verificación de correo, calificación→progreso→notificar→auditar, simulación, anonimización) implementadas como Sagas con compensación explícita. Sin 2PC ni locks distribuidos. Orquestador sin lógica de dominio. |
| VII | Autenticación/autorización estandarizada | ✅ PASS | OAuth2 Authorization Code + PKCE (SPA) y Client Credentials (M2M); JWT firmados; revocación vía blacklist Redis; identidad centralizada en Auth. Middlewares explícitos de autenticación y de rol en la capa de transporte del Gateway; Argon2id y emisión de tokens aislados en `internal/util/` e `internal/token/` de Auth. Ningún servicio implementa auth propia. |
| VIII | Precisión aritmética monetaria (NON-NEGOTIABLE) | ✅ PASS | `NUMERIC` en PostgreSQL; `shopspring/decimal` (Go), `rust_decimal` (Rust), `decimal.js`/`big.js` (TS); `string` decimal canónica en proto y JSON. Conversión string↔decimal confinada a los módulos `mapping` de cada frontera. Lint anti-`float64`/`f64`/`number` en módulos financieros. Casos de borde numérico en pruebas. |
| IX | Arquitectura en capas y mapeo explícito | ✅ PASS | Cada servicio se estructura en `handler → server → storer` con dependencia unidireccional; `storer` se declara como interfaz e implementa `NewPostgresStorer(db)`; inyección por constructor sin globales. Módulos `mapping`/`types` en cada frontera; DTO ≠ tipo de dominio ≠ tipo de fila. Gateway y Auditoría son casos degenerados legítimos (ver §Notas de Diseño, N-01). |
| X | Entrypoints delgados y configuración por entorno | ✅ PASS | `cmd/<svc>/main.go`, `src/main.rs`, `src/main.ts` limitados a config + wiring + shutdown. Configuración por variables de entorno (`DB_ADDR`, `*_SVC_ADDR`, `REDIS_ADDR`, `AMQP_ADDR`, `JWT_*`); descubrimiento por hostname (nombre de servicio en compose / `Service` en k8s); secretos en Secrets de Kubernetes. |
| XI | Migraciones versionadas y disciplina de datos | ✅ PASS | `golang-migrate` uniforme para los cinco stacks; migraciones emparejadas `up`/`down` por servicio; sin auto-sync de ORM; `execTx(ctx, fn)` centralizado; contexto propagado; errores envueltos con causa. **Supersede D-11**. |
| XII | Flujo de desarrollo local uniforme | ✅ PASS | `dev/build`, `dev/up`, `dev/migrate`, `dev/down` + `dev/docker-compose.yaml` sobre red bridge nombrada; `Dockerfile.dev` por servicio; `README.md` y `quickstart.md` con comandos copiables que coinciden con los scripts; cero pasos manuales verificado en CI. |

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
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

Monorepo poliglota de microservicios. `contracts/` es la **única** dependencia compartida permitida (definiciones de interfaz versionadas, sin reglas de negocio); cada servicio genera sus propios stubs y **los versiona** (§Definición de Contratos). Los nombres de directorio siguen la tabla normativa de la constitución §"Convenciones de Estructura y Nomenclatura por Tecnología".

```text
contracts/                      # Contratos versionados — única superficie compartida
├── proto/fintcart/<svc>/v1/     # ruta canónica de buf: paquete ≡ directorio
│                               #   common, auth, users, learning, simulator, orchestrator
├── events/                     # esquemas de los 11 eventos RabbitMQ
├── openapi/                    # OpenAPI del borde REST
├── buf.yaml
├── buf.gen.go.yaml             # plugins LOCALES (el esquema no se sube a buf.build)
├── buf.gen.ts.yaml             # TS con stubs de servicio → solo Aprendizaje (sirve gRPC)
├── buf.gen.ts-messages.yaml    # TS solo-mensajes → Notificación y Frontend (sin grpc-js)
├── package.json                # fija protoc-gen-ts_proto
└── generate.sh

dev/                            # Interfaz de desarrollo local uniforme (Principio XII)
├── docker-compose.yaml         # 7× PostgreSQL, Redis, RabbitMQ, 8 servicios, frontend
├── build                       # construir imágenes de desarrollo
├── up                          # levantar la topología
├── migrate                     # aplicar migraciones de los 7 servicios con estado
└── down                        # detener y limpiar

services/
├── api-gateway/                # Go — borde REST↔gRPC (transporte puro: sin dominio ni BD)
│   ├── cmd/gateway/main.go
│   ├── internal/handler/       # handler.go, routes.go, middleware.go, types.go, mapping.go
│   ├── internal/grpcclient/    # clientes gRPC a los 6 servicios internos
│   ├── internal/ratelimit/     # rate limiting distribuido sobre Redis
│   ├── gen/                    # stubs generados (versionados)
│   ├── Dockerfile
│   └── Dockerfile.dev
├── auth-server/                # Go — OAuth2 (Auth Code+PKCE, Client Credentials), JWT
│   ├── cmd/auth/main.go
│   ├── internal/handler/       # transporte gRPC
│   ├── internal/server/        # oauth.go, credentials.go, verification.go, client_credentials.go, password.go, anonymize.go, mapping.go
│   ├── internal/storer/        # storer.go (interfaz), storer_postgres.go, redis_store.go, types.go
│   ├── internal/token/         # jwt_maker.go, claims.go
│   ├── internal/util/          # password.go (Argon2id)
│   ├── internal/events/        # productor RabbitMQ (auth.password_changed,
│   │                           # auth.security_alert, auth.session_revoked)
│   ├── migrations/             # credentials, oauth_clients, authorization_codes
│   ├── gen/
│   └── Dockerfile{,.dev}
├── orchestrator/               # Go — Saga + compensaciones (sin lógica de dominio)
│   ├── cmd/orchestrator/main.go
│   ├── internal/handler/
│   ├── internal/server/        # saga.go, server.go, steps/{registration,email_verification,grading,activity,simulation,anonymization}.go
│   ├── internal/storer/        # saga_state
│   ├── internal/outbox/        # outbox transaccional de eventos
│   ├── internal/events/        # topología RabbitMQ
│   ├── migrations/
│   ├── gen/
│   └── Dockerfile{,.dev}
├── users/                      # Go — perfiles, roles, progreso, historiales, bandeja in-app
│   ├── cmd/users/main.go
│   ├── internal/handler/
│   ├── internal/server/        # profile.go, authcontext.go, progress.go, inapp.go, report.go, anonymize.go, mapping.go
│   ├── internal/storer/        # storer.go (interfaz), storer_postgres.go, progress.go, preferences.go, types.go
│   ├── internal/events/        # productor RabbitMQ
│   ├── migrations/             # profiles, roles_assignment, preferences, progress,
│   │                           # quiz_best_score, article_views, inapp_notifications
│   ├── gen/
│   └── Dockerfile{,.dev}
├── learning/                   # TypeScript + NestJS — artículos, versiones, cuestionarios, calificación
│   ├── src/main.ts
│   ├── src/grpc/               # controllers + mapping (transporte)
│   ├── src/{articles,quizzes,grading,publishing}/   # *.service.ts + *.repository.ts
│   ├── src/events/             # productor RabbitMQ
│   ├── src/common/             # decimal-str.ts, tx.ts, errors.ts
│   ├── src/pb/                 # stubs generados
│   ├── migrations/
│   ├── test/
│   └── Dockerfile{,.dev}
├── simulator/                  # Rust — 5 calculadoras, precisión decimal, historial
│   ├── src/main.rs
│   ├── src/grpc/               # service.rs, mapping.rs (transporte)
│   ├── src/calculators/        # ahorro, credito, presupuesto, inversion, colombia, annuity
│   ├── src/domain/             # dispatch.rs, currency.rs, inputs.rs, decimal_str.rs, error.rs
│   ├── src/repo/               # simulations.rs (incl. anonimización), tx.rs
│   ├── src/pb/
│   ├── migrations/
│   ├── tests/
│   ├── Cargo.toml
│   └── Dockerfile{,.dev}
├── notification/               # TypeScript (Node puro) — consumidor RabbitMQ, canal EMAIL
│   ├── src/main.ts
│   ├── src/amqp/               # consumer.ts, mapping.ts (transporte AMQP)
│   ├── src/email/              # dispatcher.ts, templates.ts, smtp.ts (aplicación)
│   ├── src/repo/               # queue.ts, tx.ts (persistencia)
│   ├── src/pb/
│   ├── migrations/             # notification_events_queue + notification_states
│   ├── test/
│   └── Dockerfile{,.dev}
└── audit/                      # Go — consumidor RabbitMQ, log inmutable append-only
    ├── cmd/audit/main.go
    ├── internal/handler/       # consumer.go (transporte AMQP)
    ├── internal/storer/        # storer_postgres.go (solo INSERT)
    ├── migrations/             # audit_log particionado por año
    ├── gen/
    └── Dockerfile{,.dev}

frontend/                       # TypeScript + Angular 19 — SPA, OAuth2 PKCE
├── src/app/
│   ├── core/                   # auth PKCE, interceptores JWT, guards de rol
│   ├── features/{auth,learning,simulators,profile,notifications,editorial}/
│   ├── shared/                 # tipos, decimal-str.ts (montos como string)
│   └── pb/
├── src/environments/
├── e2e/                        # Playwright — una spec por historia de usuario
└── Dockerfile{,.dev}

deploy/
├── k8s/
│   ├── base/                   # Deployment, Service, HPA, probes; ≥2 réplicas en ruta crítica
│   └── overlays/{dev,prod}/    # configuración/secretos por entorno
└── loadtest/                   # k6-scenarios.js (SC-003, SC-005)
```

**Structure Decision**: Monorepo poliglota de microservicios. Cada servicio es un módulo desplegable independiente con su propio `Dockerfile`, migraciones y stubs gRPC generados y versionados localmente. La separación física por carpeta refuerza los límites de bounded context (Principio I) y la soberanía de datos (Principio III); la separación **interna** en `handler`/`server`/`storer` hace verificable el aislamiento de capas (Principio IX), reforzado en Go por `internal/`. Los contratos viven en `contracts/` —versionados y revisables— y son la única superficie compartida. El entorno local se opera exclusivamente por los verbos `dev/` (Principio XII).

## Notas de Diseño

Aclaraciones que resuelven ambigüedades detectadas en la revisión cruzada de artefactos. No son violaciones ni desviaciones; fijan la lectura correcta.

**N-01 — Capas degeneradas legítimas (Principio IX)**. Dos servicios no instancian las tres capas, y es correcto:

- **API Gateway** no tiene `server` ni `storer`: no posee dominio ni base de datos. Es transporte puro (`handler`) más clientes salientes (`grpcclient`) y rate limiting. Su módulo `mapping` es donde ocurre la conversión `string` decimal ↔ JSON del borde.
- **Auditoría** y **Notificación** no exponen `server` gRPC: son consumidores puros (Principio V). Su capa de transporte es el consumidor AMQP (`internal/handler/consumer.go` y `src/consumers/`).

**N-02 — Origen de los datos de `ActivityReport`**. El mensaje `UsersService.ActivityReport` incluye `quizzes_attempted` (dominio de Aprendizaje) y `simulations_run` (dominio del Simulador). `UsersService.GetActivityReport` DEBE obtener esos dos contadores mediante **llamadas gRPC salientes** a `LearningService` y `SimulatorService`; queda PROHIBIDO resolverlos por lectura cruzada de base de datos (Principio III). Consecuencia de planificación: la historia US3 adquiere una dependencia en tiempo de ejecución sobre los servicios de US1 y US2, aunque siga siendo probable de forma independiente con dobles de esos clientes gRPC.

**N-03 — Propiedad de la bandeja in-app**. La bandeja in-app (`inapp_notifications`) es propiedad del **Servicio de Usuarios**, no de Notificación (D-09). Notificación es consumidor puro sin gRPC y por tanto no puede servir lecturas al usuario; su responsabilidad es el canal **email**. Los eventos de actividad alimentan la bandeja mediante el paso gRPC `Users.AppendInAppNotification` de la saga de actividad coordinada por el Orquestador. Versiones anteriores de este plan asignaban `src/inapp/` y su migración a Notificación; **esa asignación queda corregida aquí**.

**N-04 — Cola de notificaciones con estado**. El canal email se implementa con las **dos** tablas exigidas por la constitución §"Entrega de Notificaciones": `notification_events_queue` (pendientes, con contador de intentos) y `notification_states` (`not_sent`/`sent`/`failed`, sobrevive al desencolado). Reemplaza la tabla única `email_outbox` de versiones anteriores del modelo de datos.

**N-05 — Herramienta de migraciones**. `golang-migrate` es la herramienta única para los cinco stacks (Principio XI). D-11 de `research.md`, que asignaba TypeORM migrations y `sqlx::migrate!` por stack, queda **superseded**.

## Complexity Tracking

> Sin violaciones a la constitución. No se requiere justificación de complejidad.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(ninguna)_ | — | — |
