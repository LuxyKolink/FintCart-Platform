---

description: "Task list for Plataforma Fintcart — Educación Financiera Interactiva"
---

# Tasks: Plataforma Fintcart — Educación Financiera Interactiva

**Input**: Design documents from `/specs/001-fintcart-platform/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Constitución aplicada**: `.specify/memory/constitution.md` **v1.1.1** (Principios I–XII)

**Tests**: INCLUIDOS. La spec no los solicita explícitamente, pero la Constitución v1.1.1
§"Disciplina de Desarrollo y Cumplimiento → Calidad y Pruebas" los declara obligatorios
(pruebas de contrato gRPC, pruebas de persistencia contra driver SQL simulado, pruebas de la capa
de aplicación contra un doble de la interfaz `storer`, integración de Saga con compensación, casos
de borde numérico, y los tres desenlaces de la cola de notificaciones). La constitución prevalece
sobre otras prácticas (§Governance), por lo que las tareas de prueba NO son opcionales.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y
prueba independientes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia de usuario a la que pertenece (US1, US2, US3, US4)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Monorepo poliglota. Rutas normativas según `plan.md` §Project Structure y la Constitución v1.1.1
§"Convenciones de Estructura y Nomenclatura por Tecnología" (Principio IX) — capas
`handler` → `server` → `storer`:

- **Go** (Gateway, Auth, Orquestador, Usuarios, Auditoría): `services/<svc>/cmd/<bin>/main.go`,
  `services/<svc>/internal/{handler,server,storer}/`, `services/<svc>/migrations/`, `services/<svc>/gen/`
- **Rust** (Simulador): `services/simulator/src/{grpc,domain,calculators,repo,pb}/`, `migrations/`, `tests/`
- **NestJS** (Aprendizaje): `services/learning/src/{grpc,articles,quizzes,grading,publishing,events,common,pb}/`, `migrations/`, `test/`
- **Node** (Notificación): `services/notification/src/{consumers,email,repo,pb}/`, `migrations/`, `test/`
- **Angular** (Frontend): `frontend/src/app/{core,features,shared}/`, `frontend/e2e/`
- **Contratos**: `contracts/{proto,events,openapi}/` — única superficie compartida
- **Dev local**: `dev/{build,up,down,migrate,docker-compose.yaml}` (Principio XII)
- **Despliegue**: `deploy/k8s/{base,overlays}/`, `deploy/loadtest/`

> **Estado de reconciliación**: `plan.md`, `research.md`, `data-model.md`, `quickstart.md` y
> `contracts/events/` ya fueron alineados con la Constitución v1.1.1. Las decisiones vigentes que
> estas tareas asumen —y que difieren de versiones anteriores de esos documentos— son:
>
> 1. **Migraciones**: `golang-migrate` uniforme para los cinco stacks; prohibido el auto-sync de
>    ORM (Principio XI; supersede D-11 — ya anotado en `research.md`).
> 2. **Entorno local**: verbos `dev/build`, `dev/up`, `dev/migrate`, `dev/down` (Principio XII).
> 3. **Cola de notificaciones**: dos tablas `notification_events_queue` + `notification_states`,
>    donde el estado sobrevive al desencolado.
> 4. **Bandeja in-app**: propiedad del **Servicio de Usuarios**, no de Notificación
>    (`plan.md` N-03). Notificación gestiona únicamente el canal **email**.
> 5. **`ActivityReport`**: `quizzes_attempted` y `simulations_run` se obtienen por **fan-out gRPC**
>    a Aprendizaje y Simulador, nunca por lectura cruzada de BD (`plan.md` N-02, Principio III).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esqueleto del monorepo, contratos versionados y la interfaz de desarrollo local
uniforme exigida por el Principio XII.

- [X] T001 Crear el esqueleto de directorios del monorepo (`contracts/`, `services/`, `frontend/`, `dev/`, `deploy/k8s/`, `deploy/loadtest/`) según `plan.md` §Project Structure
- [X] T002 Promover los contratos de `specs/001-fintcart-platform/contracts/` a `contracts/` en la raíz (`proto/`, `events/`, `openapi/`) como única superficie compartida del monorepo (Principio I)
- [X] T003 [P] Configurar `buf` en `contracts/buf.yaml` y `contracts/buf.gen.yaml` con `buf lint` y `buf breaking` para los seis `.proto` (`common`, `auth`, `users`, `learning`, `simulator`, `orchestrator`)
- [X] T004 Escribir `dev/docker-compose.yaml` declarando la topología completa sobre la red bridge `fintcart`: 7× PostgreSQL 16 (`auth_db`, `users_db`, `learning_db`, `simulator_db`, `notification_db`, `audit_db`, `orchestrator_db`), Redis 7.4, RabbitMQ 4.0, Mailhog, los 8 servicios y el frontend, con `depends_on` explícito y configuración 100% por variables de entorno (Principios X, XII)
- [X] T005 Crear el script ejecutable `dev/build` que construya las imágenes de desarrollo de los 8 servicios y el frontend desde sus `Dockerfile.dev`
- [X] T006 [P] Crear el script ejecutable `dev/up` que levante `dev/docker-compose.yaml` en modo detached y espere los health checks de PostgreSQL, Redis y RabbitMQ
- [X] T007 [P] Crear el script ejecutable `dev/down` que detenga y limpie contenedores, red y volúmenes de la composición
- [X] T008 Crear el script ejecutable `dev/migrate` que aplique las migraciones de los 7 servicios con estado ejecutando la imagen `migrate/migrate` contra cada base, y que acepte los subcomandos `up` y `down` (Principio XI: herramienta uniforme para todos los lenguajes)
- [X] T009 [P] Inicializar el módulo Go 1.24 y el `go.work` para los cinco servicios Go en `services/{api-gateway,auth-server,orchestrator,users,audit}/go.mod`
- [X] T010 [P] Inicializar el crate Rust 1.85 del Simulador en `services/simulator/Cargo.toml` con `tonic`, `prost`, `rust_decimal`, `sqlx`, `tokio`, `thiserror`
- [X] T011 [P] Inicializar el proyecto NestJS 11 del Aprendizaje en `services/learning/package.json` con `@nestjs/microservices`, `@grpc/grpc-js`, `pg`, `decimal.js`, `class-validator`, `@golevelup/nestjs-rabbitmq`
- [X] T012 [P] Inicializar el proyecto Node 22 puro de Notificación en `services/notification/package.json` con `amqplib`, `nodemailer`, `pg`
- [X] T013 [P] Inicializar la SPA Angular 19 en `frontend/package.json` con `angular-oauth2-oidc`, `rxjs`, `big.js`
- [X] T014 [P] Configurar linting y formato por stack: `golangci-lint` en `.golangci.yml`, `clippy` en `services/simulator/clippy.toml`, `eslint`+`prettier` en `services/learning/.eslintrc.cjs`, `services/notification/.eslintrc.cjs` y `frontend/.eslintrc.json`
- [X] T015 Añadir reglas de análisis estático que PROHÍBAN `float32`/`float64` (Go), `f32`/`f64` (Rust) y `number` (TS) en los módulos financieros, en las configuraciones creadas en T014 (Principio VIII, NON-NEGOTIABLE)
- [X] T016 [P] Configurar el pipeline de CI en `.github/workflows/ci.yml` con: `buf lint` + `buf breaking`, lint por stack, pruebas por stack, y verificación de que `dev/build && dev/up && dev/migrate` completa sin pasos manuales (Principio XII regla 4)

**Checkpoint**: `dev/build && dev/up && dev/migrate` levanta la infraestructura completa.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura transversal que TODAS las historias requieren: stubs gRPC, capas del
Principio IX, precisión decimal, identidad OAuth2, borde REST, motor de Saga, auditoría y cola de
notificaciones.

**⚠️ CRITICAL**: Ninguna historia de usuario puede comenzar hasta completar esta fase.

### Stubs de contrato y precisión decimal

- [X] T017 [P] Generar y versionar los stubs gRPC de Go desde `contracts/proto/` hacia `services/{api-gateway,auth-server,orchestrator,users,audit}/gen/` (los stubs generados se commitean, §Definición de Contratos)
  - 11 ficheros por servicio; los cinco módulos compilan (`go build ./gen/...`). Cero
    ocurrencias de `float32`/`float64` en los stubs y `Money.amount` es `string` (Principio VIII).
- [X] T018 [P] Generar y versionar los stubs gRPC de Rust desde `contracts/proto/` hacia `services/simulator/src/pb/`
  - Los stubs salen ahora a `src/pb/` (versionado), no a `OUT_DIR`, y la generación es
    **opt-in** (`FINTCART_REGEN_PROTO`): `tonic-build` no empaqueta `protoc`, así que generar
    en cada `cargo build` habría exigido `protoc` para compilar —contradiciendo los stubs
    versionados— y habría dejado rojo el job de Rust de CI, que no instala `protoc`.
  - Verificado en ejecución: `cargo build` **sin `protoc` en el entorno** compila los stubs
    versionados; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` y
    `cargo test --all-targets` pasan los tres (exit 0); regenerar no produce diff (idempotente).
  - Principio VIII: cero ocurrencias de `f32`/`f64` en los stubs. Además el gate de clippy se
    probó de verdad introduciendo un `f64` temporal → clippy falla con el motivo declarado en
    `clippy.toml`. Antes no verificaba nada: `clippy.toml` solo declara los tipos y la
    severidad debe estar en la raíz del crate, que no existía.
  - `src/main.rs` es un **marcador de posición** (solo lints del crate y `mod pb;`) porque
    `Cargo.toml` declara `[[bin]]` y sin él cargo no llega a ejecutar `build.rs`. El wiring
    real sigue siendo de **T037**.
- [X] T019 [P] Generar y versionar los stubs gRPC de TypeScript desde `contracts/proto/` hacia `services/learning/src/pb/`, `services/notification/src/pb/` y `frontend/src/app/pb/`
  - Dos plantillas: Aprendizaje recibe stubs de servicio (sirve gRPC); Notificación y Frontend
    reciben **solo tipos de mensaje**, porque los stubs de servicio arrastran `@grpc/grpc-js`,
    exclusivo de Node, a un consumidor puro de RabbitMQ y a un SPA de navegador (Principio II).
  - `forceLong=string` verificado en ejecución: los `int64` llegan a TS como `string`.
  - `tsc --noEmit` limpio en `services/learning` y `services/notification` con su propio
    tsconfig. El Frontend aún no tiene `tsconfig.json` (llega con la fase de Angular), pero
    sus stubs **sí** se comprobaron: `tsc --strict` invocado directamente sobre los ficheros
    de `frontend/src/app/pb` pasa (cerrado durante T022).
- [X] T020 [P] Implementar el helper `DecimalString` de Go (parseo/serialización canónica `^-?\d+(\.\d+)?$` con `shopspring/decimal`, rechazo de overflow y de notación científica) en `services/users/internal/decimalstr/decimalstr.go` (D-10, Principio VIII)
- [X] T021 [P] Implementar el helper `DecimalString` de Rust con `rust_decimal::Decimal` en `services/simulator/src/domain/decimal_str.rs` (D-10, Principio VIII)
- [X] T022 [P] Implementar el helper `DecimalString` de TypeScript con `decimal.js` en `services/learning/src/common/decimal-str.ts` y `frontend/src/app/shared/decimal-str.ts` (D-10, Principio VIII)
- [X] T023 [P] Escribir pruebas unitarias del helper decimal en `services/simulator/tests/decimal_str.rs`, `services/learning/test/decimal-str.spec.ts` y `services/users/internal/decimalstr/decimalstr_test.go` cubriendo montos extremos, escala máxima, notación científica rechazada y overflow

**Notas de T020–T023** (misma API en los tres lenguajes: `parse`, `parseNumeric`,
`parseMoney`/`parseRate`/`parseScore`, `format`, `formatFixed`, `roundHalfEven`):

- Los límites no son inventados: salen de data-model.md §Convenciones —
  `NUMERIC(19,2)` montos, `NUMERIC(9,6)` tasas, `NUMERIC(6,2)` calificaciones—, así que
  un valor que la frontera acepta cabe en su columna y no falla recién en el INSERT.
- La escala se mide sobre decimales **significativos**: `"1.500"` cuenta como escala 1.
  Rechazar el relleno de un emisor a ancho fijo sería un falso positivo.
- `formatFixed` **falla** si el valor tiene más decimales de los pedidos, en lugar de
  redondear: una pérdida silenciosa de precisión es justo lo que prohíbe el Principio VIII.
  Redondear exige `roundHalfEven` (half-even, D-14), que es explícito.
- **Verificado en ejecución**, no por inspección: 59 subtests Go, 10 tests Rust y 56 tests
  TypeScript en verde; `golangci-lint` 0 issues, `cargo clippy -D warnings` 0,
  `eslint --max-warnings 0` 0, `gofmt`/`cargo fmt`/`tsc --noEmit` limpios.
- Los tres gates del Principio VIII se probaron **introduciendo una violación a propósito**
  y comprobando que fallan: `float64` en Go (forbidigo), `f64` en Rust
  (`clippy::disallowed_types`) y el tipo `number` en TS (`no-restricted-types`). Antes de
  T018 el gate de Rust no verificaba nada (ver la nota de T018).
- El Frontend usa **`decimal.js`, no `big.js`** como declaraba su `package.json`. `plan.md`
  admite ambas, pero dos implementaciones distintas de una regla NON-NEGOTIABLE —una de
  ellas sin pruebas todavía— es peor riesgo que el tamaño del bundle. El helper del Frontend
  es copia byte a byte del de Aprendizaje salvo la cabecera que documenta la duplicación.
- `frontend/` todavía no tiene `tsconfig.json` (llega con la fase Angular), así que su copia
  se comprobó con `tsc --strict` invocado directamente sobre el fichero. De paso queda
  cerrada la salvedad de T019: `frontend/src/app/pb` **sí** typechequea.

### Esqueletos de capas (Principio IX) y acceso a datos (Principio XI)

- [X] T024 [P] Crear el esqueleto de capas del Servicio de Usuarios: `services/users/internal/handler/{handler.go,middleware.go,types.go,mapping.go}`, `services/users/internal/server/{server.go,mapping.go,profile.go,progress.go,inapp.go,report.go,anonymize.go}` (stubs vacíos por dominio) y `services/users/internal/storer/{storer.go,storer_postgres.go,progress.go,preferences.go,types.go}`, con `Storer` como interfaz explícita y `NewPostgresStorer(db)`
- [X] T025 [P] Crear el esqueleto de capas del Servidor de Autenticación en `services/auth-server/internal/handler/`, `services/auth-server/internal/server/{server.go,mapping.go,oauth.go,credentials.go,client_credentials.go,password.go,anonymize.go}` y `services/auth-server/internal/storer/{storer.go,storer_postgres.go,redis_store.go,types.go}`
- [X] T026 [P] Crear el esqueleto de capas del Orquestador en `services/orchestrator/internal/{handler,server,storer,outbox,events}/`, incluyendo `internal/server/steps/` con un archivo stub por saga
- [X] T027 [P] Crear el esqueleto del Servicio de Auditoría en `services/audit/internal/handler/consumer.go` y `services/audit/internal/storer/storer_postgres.go` (consumidor puro: transporte AMQP, sin capa `server` gRPC — `plan.md` N-01)
- [X] T028 [P] Crear el esqueleto del API Gateway en `services/api-gateway/internal/handler/{handler.go,routes.go,middleware.go,types.go,mapping.go,auth.go,learning.go,simulators.go,me.go,editorial.go}` (stubs por área de ruta), `internal/grpcclient/` y `internal/ratelimit/` — sin capas `server` ni `storer` (`plan.md` N-01)
- [X] T029 [P] Implementar el helper de transacción `execTx(ctx, fn)` centralizado en `services/users/internal/storer/storer_postgres.go`, `services/auth-server/internal/storer/storer_postgres.go`, `services/orchestrator/internal/storer/storer_postgres.go` y `services/audit/internal/storer/storer_postgres.go` (Principio XI regla 4)
- [X] T030 [P] Implementar el equivalente de `execTx` en `services/simulator/src/repo/tx.rs`, `services/learning/src/common/tx.ts` y `services/notification/src/repo/tx.ts`
- [X] T031 [P] Definir la convención de envoltura de errores con causa preservada en `services/users/internal/storer/errors.go`, `services/simulator/src/domain/error.rs` y `services/learning/src/common/errors.ts` (Principio XI regla 6)

**Notas de T024–T031**:

- **Verificado en ejecución**, no por inspección: `go build` + `gofmt` + `golangci-lint run`
  con **0 issues en los 5 módulos Go**; `cargo build` + `cargo fmt --check` +
  `cargo clippy --all-targets -D warnings` limpios; `tsc --noEmit` y
  `eslint --max-warnings 0` limpios en Aprendizaje y Notificación, 56 tests en verde.
- Las interfaces las declara el **consumidor**, no el implementador: `handler.Service`
  enumera lo que el transporte usa de `server`. Declararla junto a `*server.Server` la
  convertiría en una copia de su lista de métodos que hay que mantener a mano.
- `server` **re-exporta** `ErrNotFound`/`ErrConflict` como alias de los de `storer` para
  que `handler` no importe `storer`. Saltarse una capa —aunque sea hacia abajo— acopla el
  transporte a la persistencia.
- Los stubs devuelven un `ErrNotImplemented` explícito, nunca el valor cero: un stub que
  devolviera `Progress{}, nil` es indistinguible de un dato legítimo, y el fallo
  aparecería como «el progreso siempre es 0» en lugar de como un error. En Auth la
  cuestión es de seguridad, no de ergonomía.
- `execTx` es **el único lugar** por servicio donde se abre/confirma/revierte una
  transacción, y el `*sqlx.Tx` NO aparece en la interfaz `Storer`: si `server` pudiera
  abrir transacciones, la capa de aplicación acabaría decidiendo el alcance de un bloqueo
  de base de datos. `AdvanceSaga` del Orquestador recibe los eventos como parámetro por lo
  mismo — hace imposible escribir el avance sin su evento (D-07).
- **`.golangci.yml`**: `status.Error`/`status.Errorf` añadidos a `wrapcheck.ignore-sigs`.
  CREAN el error de la frontera gRPC, no lo propagan; envolverlos sería lo contrario de
  lo correcto, porque el mensaje que sale al cliente tiene que estar saneado.
- Los interceptores gRPC (`middleware.go`) están **duplicados** en los cuatro servicios
  Go que sirven gRPC. Es deliberado: `contracts/` es la única superficie compartida y
  contiene contratos, no código. Un paquete común de utilidades acoplaría el despliegue de
  ocho servicios a un cambio en una función de log.
- **Defecto real corregido en Notificación**: su `tsconfig.json` combinaba
  `"type": "module"` con `moduleResolution: bundler`, que typechequea y falla al ARRANCAR
  con `ERR_MODULE_NOT_FOUND`. Al pasarlo a `NodeNext` quedó a la vista la causa de fondo —
  los stubs de ts-proto emitían imports relativos sin extensión—, resuelta con
  `importSuffix=.js` en `buf.gen.ts-messages.yaml` y regeneración. El Frontend comparte
  esa plantilla y sigue typechequeando (usa bundler, que resuelve `./x.js` → `./x.ts`).
- **Dos discrepancias de artefactos detectadas, no resueltas aquí**:
  1. `plan.md` §Source Code enumera cinco archivos en `internal/server/steps/` y omite la
     saga de **actividad**, que sí existe en el CHECK `saga_state_type_valid` y en N-03. Se
     creó `activity.go` (el esquema y N-03 son la fuente más específica); conviene corregir
     la lista de `plan.md`.
  2. `contracts/openapi/gateway.yaml` declara los endpoints OAuth2
     `authorizationUrl`/`tokenUrl` en el host `auth.fintcart.co`, **fuera de `paths:`**.
     Pero el Principio II reserva REST para el Gateway y Auth solo expone gRPC, así que
     esos dos endpoints tienen que atenderse en el Gateway o la SPA no puede completar
     PKCE. Además T055 habla de «18 rutas» y el esquema tiene 16 rutas / 17 operaciones.
     Añadirlos es un cambio de contrato: queda señalado para T055 en lugar de inventar
     superficie.

### Entrypoints y configuración (Principio X)

- [X] T032 [P] Implementar el entrypoint delgado del Servicio de Usuarios en `services/users/cmd/users/main.go`: leer env (`DB_ADDR`, `AMQP_ADDR`, `GRPC_PORT`, `LEARNING_SVC_ADDR`, `SIMULATOR_SVC_ADDR`), abrir conexiones, ensamblar `storer → server → handler`, servir gRPC y apagado ordenado — sin lógica de negocio
- [X] T033 [P] Implementar el entrypoint del Servidor de Autenticación en `services/auth-server/cmd/auth/main.go` (env: `DB_ADDR`, `REDIS_ADDR`, `AMQP_ADDR`, `JWT_SIGNING_KEY`, `USERS_SVC_ADDR`)
- [X] T034 [P] Implementar el entrypoint del Orquestador en `services/orchestrator/cmd/orchestrator/main.go` (env: `DB_ADDR`, `AMQP_ADDR`, direcciones gRPC de los servicios participantes)
- [X] T035 [P] Implementar el entrypoint del API Gateway en `services/api-gateway/cmd/gateway/main.go` (env: `REDIS_ADDR`, `*_SVC_ADDR` por servicio, `JWT_PUBLIC_KEY`, `HTTP_PORT`)
- [X] T036 [P] Implementar el entrypoint del Servicio de Auditoría en `services/audit/cmd/audit/main.go` (env: `DB_ADDR`, `AMQP_ADDR`)
- [X] T037 [P] Implementar los entrypoints de `services/simulator/src/main.rs`, `services/learning/src/main.ts` y `services/notification/src/main.ts` siguiendo la misma regla de wiring-only
- [X] T038 [P] Crear `Dockerfile` (producción, multi-stage) y `Dockerfile.dev` (desarrollo) para los 8 servicios y el frontend en `services/*/` y `frontend/`

**Notas de T032–T038**:

- **Verificado en ejecución** para todo lo compilable: `go build` + `gofmt -l` +
  `golangci-lint run` con **0 issues en los 5 módulos Go**; `cargo build` + `cargo fmt
  --check` + `cargo clippy --all-targets -D warnings` limpios; `tsc --noEmit` y
  `eslint --max-warnings 0` limpios en Aprendizaje y Notificación.
- **T038 NO se ha verificado construyendo las imágenes**: el demonio de Docker no está
  levantado en esta máquina (`docker version` falla al conectar con
  `dockerDesktopLinuxEngine`). Los 18 ficheros están escritos y son coherentes con las
  rutas y el `context: ..` de `dev/docker-compose.yaml`, pero **`dev/build` sigue sin
  ejecutarse ni una vez**. Es lo primero que hay que hacer cuando haya Docker.
- Todos los entrypoints comparten la misma forma: `run() error` con el apagado ordenado
  en `defer`, y `main()` reducido a reportar y `os.Exit(1)`. `os.Exit` SALTA los `defer`,
  así que meter la lógica en `main` cerraría el proceso con las conexiones abiertas.
- **Las variables ausentes se reportan TODAS juntas**, no la primera. Con ocho
  servicios, fallar de una en una convierte un despliegue mal configurado en una tarde
  de reinicios. La lista se ordena porque el recorrido de un mapa en Go es aleatorio y
  dos arranques iguales darían mensajes distintos.
- **Constantes frente a entorno**: es configurable lo que CAMBIA entre entornos
  (direcciones, credenciales, nivel de log). Plazos de apagado, tamaño de pool o
  intervalo del outbox son decisiones de diseño y quedan como constantes; exponerlas
  multiplicaría la superficie de configuración sin que nadie las tocara.
- Piezas nuevas que el wiring exigía y que **son esqueletos**, con el cuerpo en su tarea:
  `auth-server/internal/util/password.go` (Argon2id, T047),
  `auth-server/internal/token/{jwt_maker.go,claims.go}` (T048),
  `api-gateway/internal/authn/authn.go` (verificador JWT + blacklist Redis, T056) y
  `simulator/src/grpc/{mod.rs,service.rs}` (T130–T133, T163). Se implementó de verdad
  `orchestrator/internal/events/publisher.go`, porque `DeliveryMode: Persistent` es
  justo la línea que sostiene la garantía del outbox (D-07) y no debía quedar en stub.
- **`events.Declare` sigue devolviendo `ErrNotImplemented` (T062)** y el Orquestador lo
  llama al arrancar, así que **hoy no arranca**. Es deliberado: declarar la topología en
  un solo sitio, antes de servir, elimina la carrera de publicar en una cola que aún no
  existe; degradarlo a un aviso escondería que la topología no está. Consecuencia
  conocida: Auditoría y Notificación tampoco encontrarán su cola hasta T062.
- **`JWT_PUBLIC_KEY` frente a `JWT_SIGNING_KEY`**: T035 nombra la primera y
  `dev/docker-compose.yaml` pasa la segunda al Gateway. El Gateway acepta las dos, y el
  ALGORITMO lo decide cuál está presente (`JWT_PUBLIC_KEY` → RS256,
  `JWT_SIGNING_KEY` → HS256), nunca el `alg` del token — aceptarlo del token es el
  ataque clásico de degradar a `none` o de usar la clave pública como secreto HMAC. La
  salvedad de fondo queda anotada en `authn.JWTVerifier`: con HS256, quien verifica
  puede FIRMAR, así que el Gateway —el componente expuesto— podría emitir tokens de
  administrador. Migrar a un par asimétrico es T048/T056 y toca también el compose.
- `services/learning` necesitaba `nest-cli.json` (ausente) para que `npm run build`
  funcionara, y `app.module.ts` para tener un grafo que arrancar. El transporte gRPC de
  NestJS carga los `.proto` en EJECUCIÓN, así que la imagen copia `contracts/proto` y
  fija `PROTO_DIR`; los stubs generados no bastan.
- El Frontend no puede leer variables de entorno una vez compilado. En lugar de hornear
  `API_BASE_URL` en el build —que daría una imagen distinta por entorno, y entonces lo
  desplegado no sería lo probado—, `frontend/Dockerfile` escribe `config.js` al arrancar
  el contenedor. `angular.json` todavía no existe, así que la ruta de salida
  (`dist/*/browser` en Angular 17+) se resuelve en el build en vez de codificarse.

### Migraciones base (Principio XI)

- [X] T039 [P] Crear las migraciones emparejadas de Auth en `services/auth-server/migrations/<ts>_init_auth.{up,down}.sql`: `credentials` (con `login_status`), `oauth_clients`, `authorization_codes` (data-model §Autenticación)
- [X] T040 [P] Crear las migraciones de Usuarios en `services/users/migrations/<ts>_init_users.{up,down}.sql`: `profiles`, `roles_assignment`, `preferences`, `progress`, `quiz_best_score`, `article_views`, `inapp_notifications`
- [X] T041 [P] Crear las migraciones de Aprendizaje en `services/learning/migrations/<ts>_init_learning.{up,down}.sql`: `articles`, `article_versions`, `quizzes`, `questions`, `quiz_attempts`, `article_stats` (`score`/`weight`/`pass_threshold` como `NUMERIC(6,2)`)
- [X] T042 [P] Crear las migraciones del Simulador en `services/simulator/migrations/<ts>_init_simulator.{up,down}.sql`: `simulations` con `inputs`/`result` en `JSONB` de strings decimales canónicas
- [X] T043 [P] Crear las migraciones de Notificación en `services/notification/migrations/<ts>_init_notification.{up,down}.sql`: `notification_events_queue` (con `event_id UNIQUE` y `attempts`) y `notification_states` (`not_sent`|`sent`|`failed`, sobrevive al desencolado) — data-model §Notificación
- [X] T044 [P] Crear las migraciones de Auditoría en `services/audit/migrations/<ts>_init_audit.{up,down}.sql`: `audit_log` append-only con `REVOKE UPDATE, DELETE` sobre la tabla (FR-025/FR-031)
- [X] T045 [P] Crear las migraciones del Orquestador en `services/orchestrator/migrations/<ts>_init_orchestrator.{up,down}.sql`: `saga_state` y la tabla de outbox transaccional (D-07)
- [X] T046 Verificar que TODAS las migraciones de T039–T045 tienen un `.down.sql` que revierte efectivamente, ejecutando `dev/migrate up && dev/migrate down && dev/migrate up` (Principio XI regla 1)
  - Verificado contra PostgreSQL 16 real en las 7 bases: `up → down → up` deja un esquema
    IDÉNTICO (561 objetos: tablas, índices, constraints, funciones y triggers). El `down`
    se ejecutó con datos y claves foráneas presentes y no dejó residuo (0 tablas,
    0 funciones propias). Invariantes de esquema comprobados en ejecución, no solo por
    revisión: `jsonb_has_no_numbers` rechaza números JSON en raíz, en sub-objetos y dentro
    de arrays; los triggers de `audit_log` rechazan UPDATE y DELETE aun conectándose como
    propietario de la tabla; `article_versions` rechaza que el autor apruebe su propia
    versión (FR-008); el índice único parcial de `profiles` admite varias cuentas
    anonimizadas y sigue rechazando correos duplicados con distinta caja vía CITEXT
    (FR-030); `notification_states` conserva el estado tras desencolar. `NUMERIC` devolvió
    `87.65` exacto (Principio VIII).

### Identidad OAuth2 (Principio VII) — requerida por las cuatro historias

- [X] T047 Implementar el hash Argon2id de contraseñas en `services/auth-server/internal/util/password.go` (nunca en claro ni en logs)
- [X] T048 Implementar el emisor/validador JWT y sus claims en `services/auth-server/internal/token/{jwt_maker.go,claims.go}` (D-05)
- [X] T049 Implementar el almacén Redis de Auth en `services/auth-server/internal/storer/redis_store.go`: `blacklist:{jti}` con TTL = vida residual y `refresh:{token_id}` con rotación (Principio IV, FR-004)
- [X] T050 Implementar `AuthService.IssueAuthorizationCode`, `ExchangeCode` (validando `code_verifier` S256) y `RefreshToken` en `services/auth-server/internal/server/oauth.go` (D-05, Authorization Code + PKCE)
- [X] T051 Implementar `AuthService.ValidateCredentials`, `Revoke` e `Introspect` en `services/auth-server/internal/server/credentials.go`
- [X] T052 Implementar el flujo Client Credentials para M2M en `services/auth-server/internal/server/client_credentials.go` contra `oauth_clients`
- [X] T053 [P] Escribir pruebas de la persistencia de Auth contra driver SQL simulado en `services/auth-server/internal/storer/storer_postgres_test.go` (§Calidad: `go-sqlmock`, sin BD viva)
- [X] T054 [P] Escribir pruebas de contrato gRPC de `AuthService` (productor↔consumidor) en `services/auth-server/internal/server/contract_test.go`

**Notas de T047–T054**:

- **Verificado en ejecución**: `go build` + `gofmt -l` + `golangci-lint run` con **0 issues**
  en los 5 módulos Go, y **todas las pruebas de `auth-server` en verde** (`internal/util`,
  `internal/token`, `internal/storer`, `internal/server`).
- **Defecto real encontrado y corregido durante T054**: la detección de reutilización de
  refresh tokens de T049 era *código muerto*. `RefreshToken` consultaba primero y la
  rotación BORRABA el token viejo, así que presentar uno robado daba «no existe» —
  indistinguible de uno caducado— y la familia nunca se cortaba. Lo destapó la prueba de
  contrato, no la unitaria. Corregido cambiando el modelo: la rotación **marca**
  (`used:{userID}`) en lugar de borrar, `LookupRefreshToken` devuelve
  `(userID, ErrTokenReuse)` —usuario **y** error a la vez, que es lo que permite
  reaccionar— y se añadió `TokenStore.InvalidateFamily`. Cortar la familia es decisión de
  `server`, no del almacén.
- **Argon2id en formato PHC** (`$argon2id$v=19$m=...,t=...,p=...$sal$clave`): los
  parámetros de coste viajan DENTRO del hash, así que `Verify` usa los del hash que
  verifica y las constantes solo afectan a los hashes nuevos. Sin eso, recalibrar el coste
  invalidaría todas las contraseñas de la base.
- **Confusión de algoritmo cerrada** en `token.Parse` con
  `jwt.WithValidMethods([]string{"HS256"})` + `WithIssuer` + `WithAudience` +
  `WithExpirationRequired`. Hay prueba explícita con `alg: none`.
- **Ningún oráculo**: correo inexistente ≡ contraseña incorrecta (probado comparando las
  dos respuestas campo a campo); `client_id` inexistente ≡ secreto incorrecto; código
  caducado ≡ ya consumido ≡ inexistente; PKCE fallido ≡ refresh reutilizado en el mensaje
  al cliente, distinguibles solo en el log.
- **Comparaciones en tiempo constante** donde hay secreto: `subtle.ConstantTimeCompare` en
  la verificación PKCE y en el hash de contraseña.
- **El refresh token no se guarda tal cual**: en Redis va su SHA-256. Redis no cifra en
  reposo y su contenido acaba en volcados, así que guardar el valor presentable
  convertiría cualquier lectura del almacén en un juego de sesiones utilizables. Sin sal
  ni KDF caro: el token tiene 256 bits de entropía, no hay diccionario que recorrer.
- **`authCodeTTL = 45s` y no 60**: el CHECK compara `expires_at` con el `created_at` que
  pone PostgreSQL, mientras el valor sale del reloj del proceso. Los 15 s de margen
  absorben la deriva; con 60 exactos el síntoma sería «el login falla a veces».
- **Dependencias nuevas**: `miniredis/v2` (dev) para probar el script Lua de rotación de
  verdad, y `lib/pq` **solo** por `pq.Array` — el driver sigue siendo `pgx`; `database/sql`
  no sabe traducir `TEXT[]` ↔ `[]string`.
- **`//nolint:gosec` documentados**: G101 se dispara por el NOMBRE de las constantes de
  consulta («Credential», «Password»), no por su contenido, que es SQL parametrizado;
  G115 en `password.go` está cubierto por la cota `maxKeyLen` que gosec no propaga.
- **Alcance ampliado respecto al enunciado**: T050/T051 exigían métodos de `PostgresStorer`
  que ninguna tarea asignaba explícitamente (`GetOAuthClient`, `InsertAuthCode`,
  `ConsumeAuthCode`, y los cinco de `credentials`). Se implementaron aquí porque sin ellos
  los flujos no existen; `ConsumeAuthCode` es `UPDATE … RETURNING` en UNA sentencia, y esa
  forma es la que cierra la ventana de doble canje.
- **Sigue pendiente el par asimétrico** (HS256 → RS256/ES256). Con clave simétrica, el
  Gateway —el componente expuesto— podría FIRMAR tokens de administrador. Anotado en
  `token.JWTMaker` y en `authn.JWTVerifier`; toca también `dev/docker-compose.yaml`.

### Borde REST — API Gateway (Principio II)

- [X] T055 Implementar el router `chi` y el registro de las 18 rutas de `contracts/openapi/gateway.yaml` en `services/api-gateway/internal/handler/routes.go` (solo enrutamiento)
- [X] T056 Implementar los middlewares en `services/api-gateway/internal/handler/middleware.go`: validación de firma JWT, consulta de blacklist en Redis, y middlewares de autorización por rol (`usuario_final`, `editor`, `coordinador_editorial`) — Principio VII
- [X] T057 Implementar el rate limiting distribuido sobre Redis en `services/api-gateway/internal/ratelimit/ratelimit.go` (Principio IV, único otro uso permitido de Redis)
- [X] T058 Implementar los clientes gRPC hacia los seis servicios internos en `services/api-gateway/internal/grpcclient/clients.go`, direccionados por hostname vía env (Principio X regla 3)
- [X] T059 Implementar el mapeo REST↔gRPC y los DTO del borde en `services/api-gateway/internal/handler/{mapping.go,types.go}`, serializando TODO monto/tasa como `string` decimal canónica y nunca como número JSON (Principio VIII + Principio IX regla 3)

**Notas de T055–T059** (borde REST completo; `go build` + `gofmt` + `golangci-lint` sin
incidencias en los cinco módulos Go, y las tres suites del Gateway —`authn`, `ratelimit`,
`handler`— en verde):

- **Las «18 rutas» de T055 resueltas, no inventadas.** `paths:` declaraba 16 rutas y 17
  operaciones; las dos que faltaban son `/oauth/authorize` y `/oauth/token`, que el
  esquema ponía en el host `auth.fintcart.co`, FUERA de `paths:`. Ese host no puede
  existir: el Principio II reserva toda la superficie REST al Gateway y Auth solo habla
  gRPC. Sin esos dos endpoints la SPA no obtiene token y la plataforma no tiene login.
  Se incorporan al borde y `contracts/openapi/gateway.yaml` se actualiza en
  consecuencia. Total: **18 rutas, 19 operaciones**.
- **Desviación consciente de RFC 6749 §3.1, y conviene tenerla escrita.** El endpoint de
  autorización es JSON y no una redirección de navegador, porque bajo estas restricciones
  no existe ningún componente capaz de servir la página de login. Consecuencia real: la
  SPA recoge la contraseña, que es justo lo que Authorization Code evita cuando el
  cliente es de terceros. Aquí es de primera parte. PKCE sigue aportando —liga el código
  a la instancia que lo pidió— pero no sustituye a la separación de credenciales.
- **DEFECTO REAL CORREGIDO: el límite por usuario era código inalcanzable.** El
  `RateLimit` del esqueleto (T028) leía los claims del contexto para construir la clave,
  pero se montaba como middleware GLOBAL, es decir, ANTES de `Authenticate`: `ClaimsFrom`
  nunca devolvía nada y la clave era siempre la IP. El comentario afirmaba lo contrario.
  Corregido partiéndolo en `RateLimitByIP` (global, protege lo que ocurre antes de tener
  token) y `RateLimitByUser` (dentro del grupo autenticado). Hacen falta LOS DOS: solo IP
  hace que una oficina entera comparta cuota; solo usuario deja `/oauth/token` sin
  protección. `TestRateLimitAppliesPerUserOnceAuthenticated` fija el orden.
- **El rate limiting es un script Lua y no `INCR` + `EXPIRE`.** Si el proceso muere entre
  los dos comandos, la clave queda sin TTL, el contador no vuelve nunca a cero y el
  cliente afectado queda bloqueado para siempre — un fallo transitorio convertido en
  expulsión permanente. El TTL se pone solo en el primer incremento: renovarlo en cada
  petición haría que quien no dejara de martillear mantuviera vivo su propio contador.
- **Fail CLOSED** tanto en el limitador como en la consulta de blacklist. Tratar un fallo
  de Redis como «adelante» convertiría una caída en la reactivación simultánea de todas
  las sesiones revocadas, incluidas las de cuentas anonimizadas.
- **Defensas contra confusión de algoritmo en el verificador** (`WithValidMethods`,
  `WithIssuer`, `WithAudience`, `WithExpirationRequired`), con prueba para `alg: none` y
  para la degradación RS256→HS256 firmando con la clave pública como secreto HMAC. Se
  rechazan además `sub` y `jti` vacíos: el primero llegaría al dominio como «el usuario
  cuyo id es la cadena vacía»; el segundo haría la sesión IMPOSIBLE de revocar (FR-004).
- **El actor sale SIEMPRE del token**, nunca del cuerpo ni de la URL, en las tres rutas
  editoriales, en el envío de cuestionario, en la bandeja y en la simulación. Es la pieza
  sin la cual el invariante `approved_by ≠ created_by` de Aprendizaje no comprueba nada.
- **Principio VIII probado sobre el JSON en bruto**, no sobre un struct decodificado:
  `"score":"85.55"` con comillas, `"1500000.00"` conservando los ceros a la derecha. Una
  aserción sobre un struct pasaría con el error dentro si el campo fuera numérico.
- **`unsupported_grant_type` para `client_credentials` (hueco de contrato).**
  `server.ClientCredentialsToken` existe desde T052 pero NO está expuesto en
  `contracts/proto/fintcart/auth/v1/auth.proto`, así que el Gateway no tiene por dónde
  invocarlo. No hay tokens M2M por el borde hasta que se añada el RPC.
- **`users.v1.UpdateProfileRequest` no tiene máscara de campos.** El DTO del borde usa
  punteros para distinguir «ausente» de «vacío», pero lo único transmisible por gRPC es
  el vacío. Queda establecida la convención «campo vacío ⇒ no cambiar», que el Servicio
  de Usuarios debe respetar al implementarse (US1).
- **`InAppNotification` extiende el contrato con `payload`**, reemitido como JSON anidado
  y omitido si viene corrupto. Una bandeja que muestra el tipo pero no el contenido no
  cumple FR-023; queda anotado para la revisión del OpenAPI.
- **Alcance adelantado**: los handlers de simulación (T130) y de baja de cuenta (T164)
  quedan implementados aquí porque su superficie gRPC ya existe y dejarlos en 501 habría
  obligado a un segundo paso por los mismos archivos. Su lógica de servicio sigue
  pendiente en las tareas originales.
- **Añadidos al Gateway**: tope de 1 MiB por cuerpo (`http.MaxBytesReader`), rechazo de
  un segundo valor JSON en el mismo cuerpo, `Cache-Control: no-store` en todo lo que
  transporte tokens (RFC 6749 §5.1), plazo de 20 s por llamada gRPC saliente y balanceo
  `round_robin` — sin esto último, `pick_first` mandaría el 100 % del tráfico a una sola
  réplica y el autoescalado de D-12/SC-012 no serviría de nada.
- Dependencia nueva: `miniredis/v2` en el módulo del Gateway (solo pruebas), para
  ejercitar el script Lua de verdad en lugar de afirmar sobre los argumentos de `Eval`.
- **Sigue pendiente el par asimétrico** (HS256 → RS256). El verificador ya acepta los dos
  y `NewJWTVerifier` interpreta el PEM al arrancar; falta generar el par y cambiar
  `dev/docker-compose.yaml`.

### Saga, auditoría, notificaciones y observabilidad

- [X] T060 Implementar el motor de Saga (secuenciación, persistencia de estado en `saga_state`, ejecución de compensaciones, reanudación) en `services/orchestrator/internal/server/saga.go` — sin lógica de dominio (Principio VI)
- [X] T061 Implementar el outbox transaccional de publicación de eventos en `services/orchestrator/internal/outbox/outbox.go` (D-07)
- [X] T062 Declarar la topología RabbitMQ (exchange topic, colas `notification.q` y `audit.q`, y los bindings de los 11 eventos de `contracts/events/events-catalog.md`) en `services/orchestrator/internal/events/topology.go`, con consumidores restringidos a Notificación y Auditoría (Principio V)
- [X] T063 Implementar el consumidor de eventos y el escritor append-only de Auditoría en `services/audit/internal/handler/consumer.go` y `services/audit/internal/storer/storer_postgres.go` (solo `INSERT`, `actor_ref` opaco)
- [X] T064 Implementar la cola persistente con estado de Notificación en `services/notification/src/repo/queue.ts`: encolar en `notification_events_queue`, registrar `not_sent` en `notification_states`, y las tres transiciones (éxito → dequeue + `sent`; fallo con `attempts < MAX_ATTEMPTS` → incrementar contador; fallo con `attempts ≥ MAX_ATTEMPTS` → dequeue + `failed`), con `MAX_ATTEMPTS` configurable por entorno
- [X] T065 Implementar el despachador concurrente de Notificación en `services/notification/src/email/dispatcher.ts`, listando eventos pendientes ordenados por `created_at` y entregando de forma idempotente respecto al `event_id` de origen
- [X] T066 [P] Escribir las pruebas de los tres desenlaces de la cola de notificaciones (éxito, fallo reintentable, fallo terminal) y de la supervivencia del estado tras el desencolado, en `services/notification/test/queue.spec.ts` (§Calidad, obligatorio por constitución)
- [X] T067 [P] Implementar logs estructurados JSON, métricas (latencia, tasa de error, throughput) y endpoints `/healthz` y `/readyz` en los 8 servicios (D-12, §Observabilidad)
- [X] T068 [P] Escribir los manifiestos base de Kubernetes en `deploy/k8s/base/` (Deployment, Service, HPA, probes) con **mínimo 2 réplicas para Gateway, Auth, Usuarios, Aprendizaje y Simulador** (ruta crítica, D-12/SC-012) y los overlays `deploy/k8s/overlays/{dev,prod}/` con configuración y secretos por entorno

**Notas de T060–T068**

- **Defecto real corregido en la interfaz del storer.** `AdvanceSaga` no recibía el
  `payload`, así que lo que los pasos se escriben entre sí (`steps.State.Payload`) nunca
  se habría persistido: una saga reanudada tras un reinicio retomaría el paso correcto
  sin el `user_id` que el paso anterior dejó, y fallaría de una forma que no se parece a
  su causa. La firma pasa a `AdvanceSaga(ctx, id, fromStep, toStep, payload,
  compensations, events)`.
- **Segundo defecto: `json.Unmarshal` del literal `null` deja el mapa en NIL**, no
  vacío. Una saga arrancada sin payload entregaba a los pasos un mapa en el que escribir
  es un pánico. Lo encontró `TestEveryStepIsPersistedBeforeTheNext`.
- `fromStep` es un **bloqueo optimista** y `toStep` puede ser menor: así se registra
  también el avance de las compensaciones, que recorren los pasos hacia atrás. El
  invariante del motor es `len(compensations) == current_step`, y `stateFromRow` lo
  comprueba: una fila que no lo cumple no se ejecuta ni se compensa, porque no se sabría
  qué paso corresponde a qué nombre.
- La compensación corre con contexto **desacoplado** (`context.WithoutCancel`). La causa
  más común de que un paso falle es que el contexto se cancelara, y compensar con ese
  mismo contexto fallaría en la primera llamada — dejando la saga a medias justo en el
  escenario para el que existe.
- Una compensación fallida deja la saga en `compensating`, **no** en `failed`: solo ese
  estado vuelve a intentarse en el barrido de reanudación, y una compensación pendiente
  no se puede dar por perdida.
- `ErrConflict` al avanzar **detiene sin compensar**: otra ejecución se adelantó y
  deshacer arruinaría lo que esa otra está usando.
- La reanudación es **periódica**, no un barrido único al arrancar (`resumeLoop` en
  `main.go`). Con un barrido único, una saga abandonada por una réplica que muere
  esperaría al reinicio de ESA réplica. `ListResumable` reclama con
  `FOR UPDATE SKIP LOCKED` y un margen de antigüedad.
- `steps.Event` gana **`ActorRef`**, obligatorio y validado como UUID antes de escribir
  en el outbox: Auditoría manda a la dead-letter todo sobre cuyo actor no lo sea, y ese
  descarte ocurre a tres saltos del paso que lo construyó mal.
- **Migración nueva** `20260730120000_event_outbox_last_error`: `attempts` contaba los
  fallos de publicación sin decir por qué, y la diferencia decide la respuesta operativa
  (broker caído vs. topología que nunca se declaró).
- `ListPendingEvents` **no** lleva `FOR UPDATE SKIP LOCKED`, al contrario de lo que
  sugería el esqueleto: el bloqueo solo dura su transacción, y publicar y marcar ocurren
  fuera de ella. La entrega ya es at-least-once por diseño (D-07), así que un duplicado
  ocasional es aceptable; marcar antes de publicar lo cambiaría por una pérdida
  silenciosa.
- **Cambio de contrato documentado (T062).** `BindingsNotification` pasa de seis eventos
  a **tres**, los que producen un correo, y coincide uno a uno con las tres plantillas
  del CHECK del esquema. `learning.article_published`, `user.progress_milestone` y
  `user.activity` se enlazan ahora a `audit.q`. El catálogo los asignaba a Notificación
  «para la bandeja in-app», asignación anterior a la aclaración N-03 que pasó la bandeja
  a Usuarios — Notificación es consumidor puro sin gRPC y no puede servir esa lectura.
  `contracts/events/events-catalog.md` se actualiza con la nota correspondiente.
  Propiedad que garantiza la nueva topología y que hay una prueba que la fija:
  **ningún evento del catálogo se queda sin binding** (un evento sin binding se descarta
  en silencio en el exchange).
- El `result` de una entrada de auditoría lo declara el **productor** (`"result":
  "failure"` en el payload) en lugar de una tabla de excepciones en Auditoría: en el
  momento en que este servicio decidiera por su cuenta que cierto evento «es un fallo»,
  tendría una opinión sobre el dominio de otro servicio.
- La cola de Notificación **reclama e incrementa el contador en la misma sentencia**
  (`UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`). Reclamar y contar por separado
  abriría la ventana en la que dos réplicas envían el mismo correo. `finalizeExhausted`
  cierra las filas que agotaron intentos y siguen encoladas, el hueco que deja un proceso
  que muere entre el último envío fallido y su `markFailed`.
- **T067 sin dependencias nuevas salvo `prometheus/client_golang`** en los cinco módulos
  Go. Rust y los dos TypeScript exponen el formato de texto de Prometheus escrito a mano;
  en Rust las latencias se acumulan en **microsegundos enteros** para no pedir una
  excepción al `clippy::disallowed_types` que veta `f64` (Principio VIII).
- Las sondas van en un **puerto aparte** (9090) en los ocho servicios. `/healthz` no
  consulta dependencias: si lo hiciera, una caída de PostgreSQL reiniciaría todas las
  réplicas a la vez.
- **T068**: los cinco de la ruta crítica mantienen dos réplicas **también en el overlay
  de dev**. Relajarlo «solo en desarrollo» haría que el escenario probado a diario fuera
  el que producción no usa. Los dos overlays se validan con `kubectl kustomize`.
- Los manifiestos **no despliegan PostgreSQL, Redis ni RabbitMQ** ni contienen ningún
  Secret (Principio X); `deploy/k8s/README.md` documenta cómo se crean fuera del árbol.

**Checkpoint**: Un usuario puede autenticarse, el Gateway enruta, el Orquestador ejecuta sagas, Auditoría registra y Notificación entrega. Las historias pueden comenzar en paralelo.

---

## Phase 3: User Story 1 - Aprendizaje guiado con artículos y cuestionarios (Priority: P1) 🎯 MVP

**Goal**: Una persona se registra, verifica su correo, inicia sesión, navega el catálogo, lee un artículo, resuelve su cuestionario y ve su progreso actualizado.

**Independent Test**: Registro → verificación de correo → login → catálogo → lectura de artículo → cuestionario → calificación → barra de progreso actualizada, sin usar simuladores ni funciones de perfil.

### Tests for User Story 1 ⚠️

> Escribir estas pruebas PRIMERO y verificar que fallan antes de implementar.

- [ ] T069 [P] [US1] Prueba de contrato gRPC de `LearningService` (`ListPublished`, `GetArticle`, `GetQuiz`, `GradeAndStoreAttempt`, `ListAttempts`) en `services/learning/test/learning.contract.spec.ts`
- [ ] T070 [P] [US1] Prueba de contrato gRPC de `UsersService` (`CreateProfile`, `MarkEmailVerified`, `GetAuthContext`, `ApplyQuizScore`, `GetProgress`, `RecordArticleView`, `AppendInAppNotification`) en `services/users/internal/server/contract_test.go`
- [ ] T071 [P] [US1] Prueba de integración de la Saga de registro con inyección de fallo en cada paso y verificación de compensación en `services/orchestrator/internal/server/saga_registration_test.go` (D-04)
- [ ] T072 [P] [US1] Prueba de integración de la Saga de calificación→progreso→notificar→auditar, verificando idempotencia y monotonía de `ApplyQuizScore` en `services/orchestrator/internal/server/saga_grading_test.go` (D-07, FR-027)
- [ ] T073 [P] [US1] Prueba e2e Playwright del recorrido completo de US1 en `frontend/e2e/us1-aprendizaje.spec.ts` (SC-001)

### Implementación — Servicio de Aprendizaje (NestJS)

- [ ] T074 [P] [US1] Implementar la capa de persistencia de artículos y versiones en `services/learning/src/articles/articles.repository.ts` sobre `articles` y `article_versions`
- [ ] T075 [P] [US1] Implementar la capa de persistencia de cuestionarios e intentos en `services/learning/src/quizzes/quizzes.repository.ts` sobre `quizzes`, `questions` y `quiz_attempts`
- [ ] T076 [US1] Implementar `LearningService.ListPublished` y `GetArticle` (catálogo por categorías temáticas, ≥ 5 categorías) en `services/learning/src/articles/articles.service.ts` (FR-010, SC-009)
- [ ] T077 [US1] Implementar `LearningService.GetQuiz` en `services/learning/src/quizzes/quizzes.service.ts` (FR-011)
- [ ] T078 [US1] Implementar `LearningService.GradeAndStoreAttempt` en `services/learning/src/grading/grading.service.ts`: calificar con `decimal.js`, persistir SIEMPRE el intento con `attempt_no` incremental dentro de una transacción, devolver `score` y `attemptNumber` (FR-012, FR-016)
- [ ] T079 [US1] Implementar `LearningService.ListAttempts` (historial completo y paginado de intentos por usuario y cuestionario) en `services/learning/src/grading/grading.service.ts` — ruta de lectura de FR-016 y fuente del historial de cuestionarios exigido por FR-029
- [ ] T080 [US1] Implementar el incremento de agregados de `article_stats` dentro de `GetArticle` en `services/learning/src/articles/articles.service.ts` (D-06)
- [ ] T081 [US1] Implementar los controladores gRPC y el mapeo proto↔dominio en `services/learning/src/grpc/learning.controller.ts` y `services/learning/src/grpc/mapping.ts` — los tipos proto no llegan al repositorio (Principio IX regla 1)
- [ ] T082 [P] [US1] Escribir pruebas de persistencia de Aprendizaje contra driver SQL simulado en `services/learning/test/repositories.spec.ts`

### Implementación — Servicio de Usuarios (Go)

- [ ] T083 [P] [US1] Implementar la persistencia de `profiles` y `roles_assignment` en `services/users/internal/storer/storer_postgres.go`
- [ ] T084 [P] [US1] Implementar la persistencia de `progress`, `quiz_best_score`, `article_views` e `inapp_notifications` en `services/users/internal/storer/progress.go`
- [ ] T085 [US1] Implementar `UsersService.CreateProfile` y `MarkEmailVerified` en `services/users/internal/server/profile.go` (FR-001, FR-002)
- [ ] T086 [US1] Implementar `UsersService.GetAuthContext` devolviendo rol y estado de verificación para los claims del JWT en `services/users/internal/server/authcontext.go` (D-04)
- [ ] T087 [US1] Implementar `UsersService.ApplyQuizScore` en `services/users/internal/server/progress.go`: actualizar `quiz_best_score` solo si supera el histórico y recalcular `progress.points`, de forma **idempotente y monótona**, dentro de `execTx` (FR-014, D-07)
- [ ] T088 [US1] Implementar `UsersService.GetProgress` y `RecordArticleView` en `services/users/internal/server/progress.go` (FR-014, FR-015)
- [ ] T089 [US1] Implementar `UsersService.AppendInAppNotification` sobre `inapp_notifications` en `services/users/internal/server/inapp.go` (D-09, FR-023, `plan.md` N-03)
- [ ] T090 [P] [US1] Escribir pruebas de persistencia de Usuarios contra `go-sqlmock` en `services/users/internal/storer/storer_postgres_test.go`, incluyendo el caso de reintento con puntaje inferior que NO modifica los puntos

### Implementación — Autenticación (reglas específicas de US1)

- [ ] T091 [US1] Implementar el bloqueo de acceso pleno hasta la verificación de correo en `services/auth-server/internal/server/oauth.go` y `credentials.go`: rechazar la emisión de tokens y la validación de credenciales cuando `credentials.login_status = pending_verification` (FR-002)
- [ ] T092 [US1] Publicar el evento `auth.session_revoked` hacia Auditoría al ejecutar `AuthService.Revoke`, en `services/auth-server/internal/server/credentials.go` y `services/auth-server/internal/events/publisher.go` (FR-004, catálogo de eventos)

### Implementación — Sagas (Orquestador)

- [ ] T093 [US1] Implementar la Saga de registro (`Users.CreateProfile` → `Auth.CreateCredential` → publicar `user.registered`) con compensación que deshabilita perfil y credencial en `services/orchestrator/internal/server/steps/registration.go` (D-04, FR-001)
- [ ] T094 [US1] Implementar la Saga de verificación de correo (`Auth.ActivateCredential` → `Users.MarkEmailVerified` → publicar `user.email_verified`) en `services/orchestrator/internal/server/steps/email_verification.go` (FR-002)
- [ ] T095 [US1] Implementar la Saga de calificación (`Learning.GradeAndStoreAttempt` → `Users.ApplyQuizScore` → publicar `learning.quiz_graded` y `user.progress_milestone` → `Users.AppendInAppNotification`) con reintento en lugar de compensación destructiva en `services/orchestrator/internal/server/steps/grading.go` (D-07, FR-027)
- [ ] T096 [US1] Implementar la Saga de actividad que publica `user.activity` y ejecuta `Users.AppendInAppNotification` para los eventos de actividad del usuario, en `services/orchestrator/internal/server/steps/activity.go` (FR-023, catálogo de eventos)
- [ ] T097 [US1] Implementar `OrchestratorService.StartRegistration`, `StartEmailVerification`, `StartQuizGrading` y `GetSagaStatus` en `services/orchestrator/internal/server/server.go`

### Implementación — Notificación y borde REST

- [ ] T098 [P] [US1] Implementar el consumidor de `user.registered` y la plantilla de email de verificación en `services/notification/src/consumers/identity.consumer.ts` y `services/notification/src/email/templates/verificacion.ts` (FR-002, FR-023)
- [ ] T099 [US1] Implementar los handlers REST `POST /auth/register`, `POST /auth/verify-email` y `POST /auth/logout` en `services/api-gateway/internal/handler/auth.go` (FR-001–FR-004)
- [ ] T100 [US1] Implementar los handlers REST `GET /catalog/articles`, `GET /catalog/articles/{articleId}` y `POST /quizzes/{quizId}/attempts` en `services/api-gateway/internal/handler/learning.go` (FR-010–FR-012)
- [ ] T101 [US1] Implementar el handler REST `GET /me/progress` en `services/api-gateway/internal/handler/me.go` (FR-014)

### Implementación — Frontend Angular

- [ ] T102 [P] [US1] Implementar el flujo OAuth2 Authorization Code + PKCE con `angular-oauth2-oidc`, el interceptor de JWT y los guards de rol en `frontend/src/app/core/auth/` (FR-003, Principio VII)
- [ ] T103 [P] [US1] Implementar las pantallas de registro y verificación de correo en `frontend/src/app/features/auth/`
- [ ] T104 [P] [US1] Implementar el catálogo por categorías y la vista de artículo en `frontend/src/app/features/learning/catalog/` y `frontend/src/app/features/learning/article/` (FR-010, FR-011)
- [ ] T105 [US1] Implementar la ejecución del cuestionario, el envío de respuestas y la presentación de la calificación en `frontend/src/app/features/learning/quiz/` (FR-011, FR-012)
- [ ] T106 [US1] Implementar la barra de progreso en puntos acumulados en `frontend/src/app/features/learning/progress/` consumiendo `GET /me/progress` (FR-014)
- [ ] T107 [US1] Implementar el manejo de cuestionario abandonado (cierre de pestaña / pérdida de conexión): no registrar resultado y permitir reanudar o reiniciar en sesión posterior, en `frontend/src/app/features/learning/quiz/quiz-state.service.ts` (Edge Cases)
- [ ] T108 [US1] Implementar el manejo de enlace de verificación expirado o correo no recibido, con reenvío, en `frontend/src/app/features/auth/verify-email.component.ts` (Edge Cases)

**Checkpoint**: US1 completamente funcional y verificable de forma independiente — MVP entregable.

---

## Phase 4: User Story 2 - Simuladores financieros para análisis personal (Priority: P2)

**Goal**: Un usuario autenticado ejecuta las cinco calculadoras con precisión decimal exacta y consulta su historial de simulaciones.

**Independent Test**: Login → módulo de simuladores → cinco calculadoras visibles → parámetros en COP → resultado con precisión decimal → simulación en el historial, sin haber consumido contenido educativo.

### Tests for User Story 2 ⚠️

- [ ] T109 [P] [US2] Prueba de contrato gRPC de `SimulatorService` (`Compute`, `ListHistory`) en `services/simulator/tests/contract.rs`
- [ ] T110 [P] [US2] Pruebas de borde numérico OBLIGATORIAS en `services/simulator/tests/numeric_edge.rs`: montos extremos, redondeo bancario half-even, división con resto, tasas atípicas y plazos largos, comparadas contra un cálculo decimal de referencia con cero divergencia (SC-004, Principio VIII)
- [ ] T111 [P] [US2] Prueba de integración de la Saga de simulación (`Simulator.Compute` → publicar `simulation.executed` → Auditoría) en `services/orchestrator/internal/server/saga_simulation_test.go` (D-03)
- [ ] T112 [P] [US2] Prueba e2e Playwright del recorrido de US2 en `frontend/e2e/us2-simuladores.spec.ts`

### Implementación — Simulador (Rust)

- [ ] T113 [P] [US2] Implementar la calculadora de ahorro con `rust_decimal::Decimal` en `services/simulator/src/calculators/ahorro.rs` (FR-019, FR-021)
- [ ] T114 [P] [US2] Implementar la calculadora de crédito en `services/simulator/src/calculators/credito.rs`
- [ ] T115 [P] [US2] Implementar la calculadora de presupuesto en `services/simulator/src/calculators/presupuesto.rs`
- [ ] T116 [P] [US2] Implementar la calculadora de inversión en `services/simulator/src/calculators/inversion.rs`
- [ ] T117 [P] [US2] Implementar las calculadoras específicas del contexto financiero colombiano en `services/simulator/src/calculators/colombia.rs` (FR-019)
- [ ] T118 [US2] Implementar el despacho por `calc_type`, la validación de parámetros y el rechazo de overflow/escala inválida en `services/simulator/src/domain/dispatch.rs` (Edge Cases: precisión extrema y rangos irrazonables)
- [ ] T119 [US2] Implementar la conversión auxiliar de moneda con tasa provista como parámetro y redondeo half-even explícito en `services/simulator/src/domain/currency.rs` (FR-020, D-14)
- [ ] T120 [US2] Implementar la persistencia de `simulations` con `inputs`/`result` como strings decimales canónicas en `services/simulator/src/repo/simulations.rs` (FR-022, D-10)
- [ ] T121 [US2] Implementar `SimulatorService.Compute` y `ListHistory` con su mapeo proto↔dominio en `services/simulator/src/grpc/{service.rs,mapping.rs}`

### Implementación — Saga, borde REST y frontend

- [ ] T122 [US2] Implementar la Saga de simulación (paso único con publicación de `simulation.executed` hacia Auditoría) en `services/orchestrator/internal/server/steps/simulation.go` y `OrchestratorService.StartSimulation` (D-03, FR-025, SC-006)
- [ ] T123 [US2] Implementar los handlers REST `POST /simulators/{calcType}/run` y `GET /simulators/history` en `services/api-gateway/internal/handler/simulators.go`, con montos y tasas como `string` decimal en la petición y la respuesta (Principio VIII)
- [ ] T124 [P] [US2] Implementar el selector de las cinco calculadoras en `frontend/src/app/features/simulators/selector/` (FR-019)
- [ ] T125 [P] [US2] Implementar los formularios de parámetros en COP con validación decimal mediante `big.js` en `frontend/src/app/features/simulators/forms/` — sin usar `number` para montos ni tasas (Principio VIII)
- [ ] T126 [US2] Implementar la presentación de resultados con precisión decimal preservada en `frontend/src/app/features/simulators/result/`
- [ ] T127 [US2] Implementar la vista del historial de simulaciones con parámetros, resultados y marca temporal en `frontend/src/app/features/simulators/history/` (FR-022)
- [ ] T128 [US2] Implementar el manejo de pérdida de conexión durante la ejecución de una simulación en `frontend/src/app/features/simulators/simulators.service.ts` (Edge Cases)

**Checkpoint**: US1 y US2 funcionan de forma independiente.

---

## Phase 5: User Story 3 - Gestión de perfil, preferencias e historial (Priority: P3)

**Goal**: El usuario administra su información personal y preferencias, consulta su reporte estadístico, cambia su contraseña y puede ejercer sus derechos de Ley 1581.

**Independent Test**: Login → perfil → editar datos y preferencias → confirmación → reporte estadístico de actividad, sin consumir contenido nuevo ni ejecutar simulaciones nuevas. Los clientes gRPC hacia Aprendizaje y Simulador se sustituyen por dobles para probar la historia aislada.

### Tests for User Story 3 ⚠️

- [ ] T129 [P] [US3] Prueba de contrato gRPC de `UsersService` para perfil, preferencias, bandeja in-app y reportes (`GetProfile`, `UpdateProfile`, `ListInAppNotifications`, `MarkNotificationRead`, `GetActivityReport`) en `services/users/internal/server/profile_contract_test.go`
- [ ] T130 [P] [US3] Prueba de integración de la Saga de anonimización verificando que `audit_log` permanece intacto y que `actor_ref` sigue siendo opaco, en `services/orchestrator/internal/server/saga_anonymization_test.go` (D-08, FR-030)
- [ ] T131 [P] [US3] Prueba e2e Playwright del recorrido de US3 en `frontend/e2e/us3-perfil.spec.ts`

### Implementación — Perfil, preferencias y reportes

- [ ] T132 [P] [US3] Implementar la persistencia de `preferences` en `services/users/internal/storer/preferences.go`
- [ ] T133 [US3] Implementar `UsersService.GetProfile` y `UpdateProfile` en `services/users/internal/server/profile.go` (FR-017, FR-029)
- [ ] T134 [US3] Implementar los clientes gRPC salientes de Usuarios hacia `LearningService` y `SimulatorService` en `services/users/internal/grpcclient/clients.go`, direccionados por env (`LEARNING_SVC_ADDR`, `SIMULATOR_SVC_ADDR`)
- [ ] T135 [US3] Implementar `UsersService.GetActivityReport` en `services/users/internal/server/report.go`: `points` y `articles_viewed` desde la BD propia; `quizzes_attempted` y `simulations_run` por **fan-out gRPC** a `Learning.ListAttempts` y `Simulator.ListHistory` — PROHIBIDA la lectura cruzada de BD (FR-018, Principio III, `plan.md` N-02)
- [ ] T136 [US3] Implementar `UsersService.ListInAppNotifications` y `MarkNotificationRead` con estado de lectura y marca temporal en `services/users/internal/server/inapp.go` (FR-023)
- [ ] T137 [US3] Implementar el flujo de cambio y restablecimiento de contraseña en `services/auth-server/internal/server/password.go`, publicando `auth.password_changed` (FR-005)
- [ ] T138 [P] [US3] Implementar el consumidor de `auth.password_changed` y `auth.security_alert` con sus plantillas de email en `services/notification/src/consumers/security.consumer.ts` (FR-023)
- [ ] T139 [US3] Implementar la protección ante intentos repetidos de inicio de sesión fallidos, emitiendo `auth.security_alert`, en `services/auth-server/internal/server/credentials.go` (Edge Cases)

### Implementación — Derechos Ley 1581 (FR-029–FR-031)

- [ ] T140 [US3] Implementar `AuthService.RevokeAndAnonymizeCredential` (invalidar credenciales y refresh tokens, anonimizar correo) en `services/auth-server/internal/server/anonymize.go` (D-08)
- [ ] T141 [P] [US3] Implementar `UsersService.AnonymizeProfile` reemplazando PII y marcando `account_status = anonymized`, conservando métricas agregadas, en `services/users/internal/server/anonymize.go`
- [ ] T142 [P] [US3] Implementar `LearningService.AnonymizeAttempts` disociando PII de `quiz_attempts` en `services/learning/src/grading/anonymize.service.ts`
- [ ] T143 [P] [US3] Implementar `SimulatorService.AnonymizeHistory` disociando PII de `simulations` en `services/simulator/src/repo/anonymize.rs`
- [ ] T144 [US3] Implementar la Saga de anonimización (pasos idempotentes con reintento hasta completar, publicando `account.anonymized` con identificador opaco) en `services/orchestrator/internal/server/steps/anonymization.go` y `OrchestratorService.StartAccountAnonymization` (D-08, FR-030)
- [ ] T145 [US3] Implementar la vista de consulta completa de datos personales del titular (perfil, historial de cuestionarios vía `Learning.ListAttempts`, simulaciones vía `Simulator.ListHistory`, progreso) en `services/api-gateway/internal/handler/me.go` (FR-029)

### Implementación — Borde REST y frontend

- [ ] T146 [US3] Implementar los handlers REST `GET /me/profile`, `PATCH /me/profile`, `GET /me/notifications`, `POST /me/notifications/{id}/read` y `DELETE /me/account` en `services/api-gateway/internal/handler/me.go`
- [ ] T147 [P] [US3] Implementar la pantalla de perfil y preferencias con confirmación de cambios en `frontend/src/app/features/profile/` (FR-017)
- [ ] T148 [P] [US3] Implementar el reporte estadístico de actividad en `frontend/src/app/features/profile/report/` (FR-018)
- [ ] T149 [P] [US3] Implementar la bandeja in-app con estado de lectura y marca temporal en `frontend/src/app/features/notifications/` (FR-023)
- [ ] T150 [US3] Implementar el flujo de cambio de contraseña en `frontend/src/app/features/profile/password/` (FR-005)
- [ ] T151 [US3] Implementar el flujo de eliminación de cuenta con advertencia de irreversibilidad en `frontend/src/app/features/profile/delete-account/` (FR-030)
- [ ] T152 [US3] Implementar el manejo de pérdida de conexión durante el guardado de perfil en `frontend/src/app/features/profile/profile.service.ts` (Edge Cases)
- [ ] T153 [P] [US3] Escribir pruebas de persistencia de preferencias y bandeja in-app contra `go-sqlmock` en `services/users/internal/storer/preferences_test.go`

**Checkpoint**: US1, US2 y US3 funcionan de forma independiente.

---

## Phase 6: User Story 4 - Curaduría y publicación de contenido educativo (Priority: P4)

**Goal**: Un editor redacta y versiona artículos con sus cuestionarios y los envía a revisión; un coordinador editorial distinto los aprueba y publica.

**Independent Test**: Editor crea artículo + cuestionario → envía a revisión → coordinador editorial distinto aprueba y publica → el artículo aparece en el catálogo público, sin depender de la actividad de usuarios finales.

### Tests for User Story 4 ⚠️

- [ ] T154 [P] [US4] Prueba de contrato gRPC de `LearningService` editorial (`CreateDraft`, `UpdateDraft`, `SubmitForReview`, `ApproveAndPublish`, `Archive`) en `services/learning/test/editorial.contract.spec.ts`
- [ ] T155 [P] [US4] Prueba de la invariante de separación de responsabilidades — `approved_by ≠ created_by` — incluyendo el intento de un editor de publicar su propio artículo, en `services/learning/test/publishing.spec.ts` (FR-008)
- [ ] T156 [P] [US4] Prueba e2e Playwright del recorrido editorial con dos actores distintos en `frontend/e2e/us4-editorial.spec.ts`

### Implementación — Flujo editorial (Aprendizaje)

- [ ] T157 [US4] Implementar `LearningService.CreateDraft` y `UpdateDraft` creando filas de `article_versions` en estado `borrador` visibles solo a su editor, en `services/learning/src/publishing/publishing.service.ts` (FR-007)
- [ ] T158 [US4] Implementar `LearningService.SubmitForReview` con la transición `borrador → en_revision` en `services/learning/src/publishing/publishing.service.ts` (FR-008)
- [ ] T159 [US4] Implementar `LearningService.ApproveAndPublish` con la transición `en_revision → publicado`, rechazando la operación cuando `approved_by == created_by`, y actualizando `articles.current_version_id` dentro de una transacción, en `services/learning/src/publishing/publishing.service.ts` (FR-008)
- [ ] T160 [US4] Implementar `LearningService.Archive` con la transición `publicado → archivado` en `services/learning/src/publishing/publishing.service.ts`
- [ ] T161 [US4] Implementar el versionado incremental (`version_no`) que preserva la trazabilidad histórica al generar una nueva versión de un artículo publicado, en `services/learning/src/publishing/versioning.service.ts` (FR-013)
- [ ] T162 [US4] Implementar la gestión de cuestionarios asociados al artículo (≥ 1 por artículo) en el flujo editorial, en `services/learning/src/quizzes/quizzes.service.ts` (FR-009)
- [ ] T163 [US4] Implementar la publicación del evento `learning.article_published` hacia Notificación y Auditoría en `services/learning/src/events/publisher.ts` (Principio V, FR-008)
- [ ] T164 [P] [US4] Implementar el consumidor de `learning.article_published` y de `user.activity` que generan las notificaciones in-app "nuevo artículo" y de actividad, en `services/notification/src/consumers/activity.consumer.ts` (FR-023)

### Implementación — Autorización, borde REST y frontend

- [ ] T165 [US4] Implementar la aplicación de los roles `editor` y `coordinador_editorial` en los middlewares de autorización de las rutas editoriales, en `services/api-gateway/internal/handler/middleware.go` (FR-006)
- [ ] T166 [US4] Implementar los handlers REST `POST /editorial/articles`, `POST /editorial/versions/{versionId}/submit` y `POST /editorial/versions/{versionId}/publish` en `services/api-gateway/internal/handler/editorial.go`
- [ ] T167 [P] [US4] Implementar el editor de artículos y cuestionarios en `frontend/src/app/features/editorial/editor/` (FR-007, FR-009)
- [ ] T168 [P] [US4] Implementar la bandeja de revisión del coordinador editorial en `frontend/src/app/features/editorial/review/` (FR-008)
- [ ] T169 [US4] Implementar la vista de historial de versiones de un artículo en `frontend/src/app/features/editorial/versions/` (FR-013)
- [ ] T170 [US4] Implementar el guard de rol que oculta las rutas editoriales a usuarios finales en `frontend/src/app/core/auth/editorial.guard.ts` (FR-006)
- [ ] T171 [P] [US4] Escribir pruebas de persistencia editorial contra driver SQL simulado en `services/learning/test/publishing.repository.spec.ts`

**Checkpoint**: Las cuatro historias de usuario funcionan de forma independiente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verificación de criterios de éxito medibles y auditoría de cumplimiento constitucional.

- [ ] T172 [P] Escribir las pruebas de esquema de evento (productor) y de consumo idempotente (Notificación/Auditoría) para los **11** eventos de `contracts/events/events-catalog.md`, en `services/audit/internal/handler/consumer_test.go` y `services/notification/test/consumers.spec.ts` (D-13)
- [ ] T173 [P] Verificar la inmutabilidad de `audit_log` con una prueba que confirme que `UPDATE` y `DELETE` fallan, en `services/audit/internal/storer/immutability_test.go` (FR-025)
- [ ] T174 [P] Implementar y verificar el particionado anual de `audit_log` con retención ≥ 5 años en `services/audit/migrations/<ts>_partition_audit.{up,down}.sql` (FR-031)
- [ ] T175 Ejecutar pruebas de carga con 1.000 usuarios concurrentes verificando respuesta percibida < 2 s y lecturas < 1 s, con el guion en `deploy/loadtest/k6-scenarios.js` (SC-003, SC-005)
- [ ] T176 Verificar la tasa de inconsistencia residual < 0,1% de las operaciones distribuidas mediante inyección sistemática de fallos en cada paso de cada saga (SC-008)
- [ ] T177 Verificar que el 95% de las notificaciones está disponible en < 2 minutos desde el evento de origen, midiendo sobre `notification_states` (SC-007)
- [ ] T178 Verificar que el 100% de las operaciones significativas genera un registro auditable, contrastando los 11 eventos contra `audit_log` (SC-006)
- [ ] T179 [P] Auditar el cumplimiento del Principio VIII en todo el árbol: confirmar cero `float`/`double`/`number` para dinero o tasas en persistencia, dominio, `.proto`, eventos y JSON del borde
- [ ] T180 [P] Auditar el cumplimiento del Principio IX: confirmar que ninguna capa `storer` importa tipos de transporte o de protobuf y que ninguna capa `handler` importa tipos de fila, en los 8 servicios
- [ ] T181 [P] Auditar el cumplimiento del Principio III: confirmar que ningún servicio tiene credenciales de una base ajena y que `GetActivityReport` resuelve los contadores externos por gRPC; y del Principio IV/V: solo Auth y Gateway abren Redis, solo Notificación y Auditoría consumen de RabbitMQ
- [ ] T182 [P] Auditar el cumplimiento del Principio X: confirmar que ningún host, puerto, credencial o URL está hardcodeado y que ningún secreto real está versionado
- [ ] T183 Escribir el `README.md` raíz con el diagrama de arquitectura vigente y comandos copiables verificados
- [ ] T184 Verificar que los comandos documentados en `README.md` y `specs/001-fintcart-platform/quickstart.md` coinciden exactamente con los scripts `dev/`, y añadir esa verificación al CI (Principio XII regla 5)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede comenzar inmediatamente
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias de usuario**
- **User Stories (Phase 3–6)**: todas dependen de Foundational
  - Pueden ejecutarse en paralelo si hay equipo disponible
  - O secuencialmente en orden de prioridad (P1 → P2 → P3 → P4)
- **Polish (Phase 7)**: depende de todas las historias deseadas

### User Story Dependencies

- **US1 (P1)**: solo depende de Foundational. Es el MVP.
- **US2 (P2)**: solo depende de Foundational. No requiere US1 (independent test explícito: "sin requerir consumo previo de contenido educativo").
- **US3 (P3)**: depende de Foundational. **Dependencia declarada en tiempo de ejecución**: T135 (`GetActivityReport`) y T145 (consulta de datos del titular) invocan por gRPC a `Learning.ListAttempts` (US1, T079) y `Simulator.ListHistory` (US2, T121). La historia sigue siendo **probable de forma independiente** sustituyendo esos clientes por dobles (T134 los aísla tras una interfaz).
- **US4 (P4)**: solo depende de Foundational. Produce el contenido que US1 consume, pero se prueba de forma independiente verificando la aparición en el catálogo.

> **Acoplamiento a nivel de archivo**: los stubs de `internal/server/*.go` de Usuarios (T024), del
> Gateway (T028) y de Auth (T025) se crean en **Foundational**, de modo que ninguna historia
> depende de que otra cree un archivo. US1 y US4 comparten `services/learning/`: si se trabajan en
> paralelo, US1 se concentra en `articles/`, `quizzes/`, `grading/` y US4 en `publishing/`.

### Within Each User Story

- Las pruebas se escriben PRIMERO y deben fallar antes de implementar
- Persistencia (`storer`/repository) antes que aplicación (`server`/service)
- Aplicación antes que transporte (`handler`/controller)
- Backend antes que el borde REST del Gateway
- Borde REST antes que el frontend Angular

### Parallel Opportunities

- **Phase 1**: T003, T006–T007, T009–T014, T016 en paralelo
- **Phase 2**: T017–T023 (stubs y decimal), T024–T031 (esqueletos de capas), T032–T038 (entrypoints), T039–T045 (migraciones) — cada bloque en paralelo internamente
- **Phase 3**: T069–T073 (todas las pruebas), T074–T075, T083–T084, T102–T104 en paralelo
- **Phase 4**: T109–T112 (pruebas), T113–T117 (las cinco calculadoras, archivos distintos), T124–T125 en paralelo
- **Phase 5**: T129–T131 (pruebas), T141–T143 (anonimización en tres servicios distintos), T147–T149 en paralelo
- **Phase 6**: T154–T156 (pruebas), T167–T168 en paralelo
- **Phase 7**: T172–T174, T179–T182 en paralelo
- Las cuatro historias pueden asignarse a equipos distintos una vez completada la Phase 2

---

## Parallel Example: User Story 2

```bash
# Lanzar todas las pruebas de US2 juntas:
Task: "Prueba de contrato gRPC de SimulatorService en services/simulator/tests/contract.rs"
Task: "Pruebas de borde numérico en services/simulator/tests/numeric_edge.rs"
Task: "Prueba de integración de la Saga de simulación en services/orchestrator/internal/server/saga_simulation_test.go"
Task: "Prueba e2e Playwright en frontend/e2e/us2-simuladores.spec.ts"

# Lanzar las cinco calculadoras juntas (archivos distintos, sin dependencias):
Task: "Calculadora de ahorro en services/simulator/src/calculators/ahorro.rs"
Task: "Calculadora de crédito en services/simulator/src/calculators/credito.rs"
Task: "Calculadora de presupuesto en services/simulator/src/calculators/presupuesto.rs"
Task: "Calculadora de inversión en services/simulator/src/calculators/inversion.rs"
Task: "Calculadoras del contexto colombiano en services/simulator/src/calculators/colombia.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup (T001–T016)
2. Completar Phase 2: Foundational (T017–T068) — **CRÍTICO, bloquea todo**
3. Completar Phase 3: User Story 1 (T069–T108)
4. **DETENER y VALIDAR**: probar US1 contra su Independent Test y SC-001
5. Desplegar o demostrar

### Incremental Delivery

1. Setup + Foundational → base lista
2. + US1 → probar → desplegar (**MVP**: aprendizaje guiado completo)
3. + US2 → probar → desplegar (simuladores financieros)
4. + US3 → probar → desplegar (perfil, historial y derechos Ley 1581)
5. + US4 → probar → desplegar (curaduría editorial)
6. + Phase 7 → verificación de criterios de éxito y cumplimiento constitucional

### Parallel Team Strategy

Con varios equipos, tras completar Phase 2:

- Equipo A: US1 (Aprendizaje + Usuarios + sagas de registro/calificación/actividad + frontend de aprendizaje)
- Equipo B: US2 (Simulador Rust + saga de simulación + frontend de simuladores)
- Equipo C: US3 (perfil, preferencias, reportes, anonimización Ley 1581)
- Equipo D: US4 (flujo editorial + frontend editorial)

Coordinación requerida: Equipos A y D comparten `services/learning/`; el Equipo C consume por gRPC los servicios de A y B (usa dobles hasta que estén disponibles).

---

## Notes

- Las tareas marcadas [P] tocan archivos distintos y no tienen dependencias pendientes
- La etiqueta [Story] mapea cada tarea a su historia para trazabilidad
- Verificar que las pruebas fallan antes de implementar
- Hacer commit tras cada tarea o grupo lógico
- **Principio VIII es NON-NEGOTIABLE**: cualquier tarea que introduzca `float`/`double`/`number` para dinero o tasas es motivo de rechazo automático en revisión
- Cada tarea de persistencia debe respetar `execTx` y la propagación de contexto (Principio XI)
- Ninguna tarea puede introducir acceso cruzado a bases de datos (Principio III) ni consumidores de RabbitMQ fuera de Notificación y Auditoría (Principio V)
- Los 11 eventos del catálogo tienen productor asignado: `user.registered` (T093), `user.email_verified` (T094), `auth.password_changed` (T137), `auth.security_alert` (T139), `auth.session_revoked` (T092), `learning.article_published` (T163), `learning.quiz_graded` y `user.progress_milestone` (T095), `user.activity` (T096), `simulation.executed` (T122), `account.anonymized` (T144)
