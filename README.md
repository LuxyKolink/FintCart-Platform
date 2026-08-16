# Fintcart

> Plataforma de educación financiera interactiva para el mercado colombiano: contenido curado, simuladores financieros con precisión decimal arbitraria y seguimiento de progreso, sobre microservicios poliglota coordinados por Saga.

## Qué resuelve

Fintcart le da a una persona sin formación financiera un camino guiado: leer contenido curado por un cuerpo editorial (US4), resolver cuestionarios que califican y suman progreso (US1), proyectar decisiones reales — ahorro, crédito, inversión — en simuladores que nunca redondean con binario (US2), y ejercer sus derechos sobre sus propios datos bajo la Ley 1581 de Colombia (US3). Las cuatro historias son independientemente entregables y probables; el detalle funcional completo vive en [`specs/001-fintcart-platform/spec.md`](specs/001-fintcart-platform/spec.md).

## Arquitectura

Ocho servicios backend de bounded context aislado + una SPA Angular. gRPC es el único transporte interno; REST existe solo en el borde (API Gateway). Cada servicio con estado posee su propia base PostgreSQL — sin acceso cruzado. RabbitMQ conecta productores (Usuarios, Aprendizaje, Orquestador, Autenticación) con sus únicos consumidores (Notificación, Auditoría). La consistencia entre dominios se logra vía Saga (Orquestador), nunca 2PC ni locks distribuidos.

```mermaid
flowchart LR
    Browser["SPA Angular<br/>:4200"] -->|REST| GW["API Gateway<br/>Go · :8080"]

    GW -->|gRPC| AUTH["Auth Server<br/>Go"]
    GW -->|gRPC| USERS["Usuarios<br/>Go"]
    GW -->|gRPC| LEARN["Aprendizaje<br/>NestJS"]
    GW -->|gRPC| SIM["Simulador<br/>Rust"]
    GW -->|gRPC| ORCH["Orquestador<br/>Go (Sagas)"]

    ORCH -->|gRPC| AUTH
    ORCH -->|gRPC| USERS
    ORCH -->|gRPC| LEARN
    ORCH -->|gRPC| SIM

    USERS -->|evento| MQ[["RabbitMQ<br/>fintcart.events"]]
    LEARN -->|evento| MQ
    ORCH -->|evento| MQ
    AUTH -->|evento| MQ

    MQ -->|notification.q| NOTIF["Notificación<br/>Node (consumidor puro)"]
    MQ -->|audit.q| AUDIT["Auditoría<br/>Go (consumidor puro)"]

    AUTH -.-> PGA[(auth_db)]
    USERS -.-> PGU[(users_db)]
    LEARN -.-> PGL[(learning_db)]
    SIM -.-> PGS[(simulator_db)]
    ORCH -.-> PGO[(orchestrator_db)]
    NOTIF -.-> PGN[(notification_db)]
    AUDIT -.-> PGD[(audit_db)]

    AUTH -.->|blacklist + refresh| REDIS[(Redis)]
    GW -.->|rate limiting| REDIS
```

| Servicio | Lenguaje | Responsabilidad | Base propia |
|---|---|---|---|
| `api-gateway` | Go 1.24 | Único borde REST↔gRPC; auth de transporte, rate limiting, OpenAPI | — (sin dominio ni BD) |
| `auth-server` | Go 1.24 | Identidad OAuth2 (Authorization Code+PKCE, Client Credentials), JWT, Argon2id | `auth_db` |
| `users` | Go 1.24 | Perfiles, progreso, bandeja in-app, preferencias, derechos Ley 1581 | `users_db` |
| `learning` | TS 5.6 + NestJS 11 | Catálogo, cuestionarios, flujo editorial (borrador→revisión→publicado) | `learning_db` |
| `simulator` | Rust 1.85 | 5 calculadoras financieras con `rust_decimal`, cero redondeo binario | `simulator_db` |
| `orchestrator` | Go 1.24 | Sagas con compensación explícita; sin lógica de dominio propia | `orchestrator_db` |
| `notification` | Node 22 (TS) | Consumidor puro de RabbitMQ; cola persistente de email | `notification_db` |
| `audit` | Go 1.24 | Consumidor puro de RabbitMQ; registro inmutable y particionado | `audit_db` |
| `frontend` | TS 5.6 + Angular 19 | SPA — único cliente del API Gateway | — |

Las restricciones no negociables detrás de este diagrama están en la [Constitución v1.1.1](.specify/memory/constitution.md) y resumidas para el desarrollo diario en [`CLAUDE.md`](CLAUDE.md).

## Empezar

Único requisito: Docker + Docker Compose.

```bash
dev/build      # construye las imágenes de desarrollo de los 8 servicios + frontend
dev/up         # levanta la topología y espera los health checks
dev/migrate    # aplica las migraciones de las 7 bases con estado
dev/seed       # cliente OAuth + contenido mínimo sin el cual el sistema no se puede usar
dev/demo       # recorre el sistema de punta a punta y enseña qué mirar
```

Cero pasos manuales adicionales (Principio XII). Para detener y limpiar: `dev/down`. La guía completa — health checks, herramientas de inspección (Swagger UI, Mailhog, RabbitMQ, Adminer), regeneración de contratos, migraciones, verificación paso a paso del flujo principal y gates de cumplimiento — está en [`specs/001-fintcart-platform/quickstart.md`](specs/001-fintcart-platform/quickstart.md), que estos mismos comandos deben coincidir exactamente con los scripts de `dev/` (verificado en CI).

## Estructura del repositorio

```text
fintcart-platform/
├── contracts/            # .proto (única superficie compartida) + OpenAPI del Gateway + eventos
├── dev/                  # build, up, migrate, seed, demo, down — flujo local uniforme
├── services/
│   ├── api-gateway/      # Go — borde REST
│   ├── auth-server/      # Go — identidad OAuth2
│   ├── users/             # Go — perfiles, progreso, bandeja, Ley 1581
│   ├── learning/          # NestJS — catálogo, cuestionarios, editorial
│   ├── simulator/         # Rust — 5 calculadoras financieras
│   ├── orchestrator/       # Go — Sagas
│   ├── notification/       # Node — consumidor de email
│   └── audit/               # Go — consumidor de auditoría inmutable
├── frontend/              # Angular — SPA
├── deploy/                # Kubernetes, k6
├── docs/                  # anteproyecto, diagramas y RF originales del proyecto académico
└── specs/001-fintcart-platform/   # spec, plan, research, data-model, quickstart, tasks
```

## Pruebas

```bash
go test ./...                              # Go (por servicio) — persistencia contra go-sqlmock
cargo test                                 # Simulador — incluye casos de borde numérico
npm test --workspace services/learning
npm test --workspace services/notification
cd frontend && npm test && npm run e2e     # Jest/Karma + Playwright — una spec por historia
buf breaking contracts/proto --against '.git#branch=main'   # sin cambios incompatibles
```

CI (`.github/workflows/ci.yml`) ejecuta lo anterior por servicio, además de `dev/build && dev/up && dev/migrate` de punta a punta y la verificación de que esta documentación coincide con `dev/` (Principio XII, regla 5).

## Documentación

| Documento | Contenido |
|---|---|
| [`specs/001-fintcart-platform/spec.md`](specs/001-fintcart-platform/spec.md) | Especificación funcional (FR, historias de usuario, criterios de éxito) |
| [`specs/001-fintcart-platform/plan.md`](specs/001-fintcart-platform/plan.md) | Plan técnico, stack, gate constitucional |
| [`specs/001-fintcart-platform/data-model.md`](specs/001-fintcart-platform/data-model.md) | Entidades y relaciones |
| [`specs/001-fintcart-platform/quickstart.md`](specs/001-fintcart-platform/quickstart.md) | Entorno local, verificación end-to-end, gates de cumplimiento |
| [`specs/001-fintcart-platform/tasks.md`](specs/001-fintcart-platform/tasks.md) | Desglose de tareas y estado de implementación |
| [`contracts/events/events-catalog.md`](contracts/events/events-catalog.md) | Los 11 eventos de dominio, productores y consumidores |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Los doce principios no negociables del proyecto |
| [`docs/anteproyecto/`](docs/anteproyecto/) | Propuesta y marco académico original del proyecto |

## Licencia

Ver [LICENSE](LICENSE).
