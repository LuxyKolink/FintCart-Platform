# Quickstart — Plataforma Fintcart

**Feature**: Plataforma Fintcart | **Branch**: `001-fintcart-platform` | **Date**: 2026-07-27

Guía para levantar el entorno local poliglota y verificar el flujo principal (User Story 1).
Refleja las restricciones de la **Constitución v1.1.1** y del marco tecnológico.

> **Principio XII (flujo de desarrollo local uniforme)**: los comandos de esta guía DEBEN
> coincidir exactamente con los scripts de `dev/`. Si un paso aquí requiere una acción manual
> que los scripts no cubren, eso es un **defecto de los scripts** y se corrige en `dev/`, no
> añadiendo instrucciones a este documento.

## Prerrequisitos

| Herramienta | Versión | Necesaria para |
|-------------|---------|----------------|
| Docker + Docker Compose | reciente | **Único requisito** para levantar el sistema completo |
| Go | 1.24+ | desarrollo fuera de contenedor |
| Rust | 1.85+ (stable) | desarrollo fuera de contenedor |
| Node.js | 22 LTS | desarrollo fuera de contenedor |
| Angular CLI | 19 | desarrollo del frontend |
| `buf` | reciente | regenerar stubs al cambiar un `.proto` (Go y TypeScript) |
| `protoc` | 25+ | regenerar los stubs de Rust (`tonic-build` no lo empaqueta) |

Los stubs gRPC están **versionados en el repositorio** (§Definición de Contratos), de modo que
compilar cualquier servicio NO exige tener `buf` ni `protoc` instalados. Solo se necesitan al
modificar un contrato.

## 1. Levantar el sistema completo

```bash
dev/build      # construye las imágenes de desarrollo (Dockerfile.dev) de los 8 servicios + frontend
dev/up         # levanta la topología y espera los health checks de PostgreSQL, Redis y RabbitMQ
dev/migrate    # aplica las migraciones de los 7 servicios con estado (golang-migrate uniforme)
dev/seed       # datos sin los que la plataforma no se puede USAR (ver abajo)
```

Eso es todo: **cero pasos manuales adicionales** (Principio XII, regla 4). Para detener y limpiar:

```bash
dev/down
```

La topología declarada en `dev/docker-compose.yaml` sobre la red bridge `fintcart`:

- **PostgreSQL 16 ×7** — `auth_db`, `users_db`, `learning_db`, `simulator_db`, `notification_db`,
  `audit_db`, `orchestrator_db` (instancias lógicas aisladas — Principio III).
- **Redis 7.4** — blacklist JWT + refresh (Auth), rate limiting (Gateway) — Principio IV.
- **RabbitMQ 4.0** — exchange topic; colas `notification.q`, `audit.q` — Principio V.
- **8 servicios backend + SPA**, configurados 100% por variables de entorno y localizados por
  hostname (nombre de servicio en compose) — Principio X.

Health checks: `GET /healthz` y `/readyz` por servicio (consumidos por Kubernetes en producción).
Frontend en `http://localhost:4200`; borde REST en `http://localhost:8080`.

### `dev/seed` no es opcional

Migrar deja el esquema listo pero el sistema **inutilizable**, y de una forma que no se
nota hasta que se intenta entrar:

- `oauth_clients` está vacía, así que `POST /oauth/authorize` rechaza toda petición. Es
  el único dato que ninguna saga crea y que ningún endpoint permite dar de alta —
  registrarse funciona, iniciar sesión no.
- El catálogo se llena solo por el flujo editorial, que exige un usuario con rol, y los
  roles tampoco se pueden pedir por la API (concederlos desde fuera es lo que sostiene
  la separación de responsabilidades de FR-008).

```bash
dev/seed                                   # cliente OAuth `fintcart-spa` + 5 artículos + 1 cuestionario
dev/seed role ana@fintcart.co editor       # rol editorial sobre una cuenta ya registrada
```

Es idempotente. No es una migración a propósito: `golang-migrate` versiona el esquema, y
una migración con `INSERT` llevaría este cliente OAuth de desarrollo a producción
(Principio XI).

## 2. Regenerar stubs tras cambiar un contrato

Solo necesario al modificar `contracts/proto/`:

```bash
contracts/generate.sh          # lint + stubs de Go, TypeScript y (vía build.rs) Rust
```

El script hace `buf lint` y luego genera hacia los diez destinos. Los stubs regenerados se
commitean en un **commit separado** del cambio de lógica de negocio.

### Prerrequisitos de generación (solo para regenerar, no para compilar)

Los plugins de protoc se ejecutan **en local**, no en el servicio alojado de buf.build: la
imagen del esquema —servicios, RPC, campos y comentarios— no sale de la máquina. A cambio hay
que tener los binarios instalados:

```bash
go install github.com/bufbuild/buf/cmd/buf@v1.47.2
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
npm install --prefix contracts        # protoc-gen-ts_proto, fijado en contracts/package.json
# `protoc` del sistema y la cadena de Rust: los necesita tonic-build (ver más abajo).
# protoc: https://github.com/protocolbuffers/protobuf/releases → añadir su bin/ al PATH
```

`generate.sh` los verifica antes de empezar y, si falta alguno, indica el comando exacto.
Compilar un servicio **no** requiere ninguno de ellos: los stubs están versionados.

### El Simulador (Rust) genera con `tonic-build`, y es opt-in

El Simulador no usa `buf`: sus stubs los produce `services/simulator/build.rs` con
`tonic-build`, hacia `services/simulator/src/pb/` (versionado, igual que `gen/` en Go).
La generación **no ocurre en cada `cargo build`**, sino solo con la variable puesta:

```bash
FINTCART_REGEN_PROTO=1 cargo build   # regenera src/pb/
cargo build                          # usa los stubs versionados
```

El motivo es que `tonic-build` no trae su propio `protoc` —`prost-build` dejó de
empaquetarlo— y lo exige en el PATH. Si generase en cada compilación, compilar el
Simulador requeriría `protoc` pese a tener los stubs versionados, y el job de Rust en
CI fallaría, porque el workflow no instala `protoc`. `contracts/generate.sh` activa la
variable por su cuenta, así que el flujo normal no cambia.

`src/pb/mod.rs` se escribe a mano y **no** es generado: declara la jerarquía
`fintcart::<servicio>::v1` que `prost` da por supuesta en sus referencias entre
paquetes, y trae los ficheros con `include!` (lo que además mantiene el código
generado fuera del alcance de `cargo fmt`).

### Disposición de los `.proto`

Ruta canónica de buf, `<paquete>` ≡ `<directorio>`, exigida por las reglas `STANDARD` de lint:

```text
contracts/proto/fintcart/<servicio>/v1/<servicio>.proto
```

Los imports entre contratos usan esa misma ruta desde la raíz del módulo, p. ej.
`import "fintcart/common/v1/common.proto";`.

### Dos plantillas de TypeScript

Solo **Aprendizaje** (NestJS) sirve gRPC y recibe stubs de servicio (`buf.gen.ts.yaml`).
**Notificación** (consumidor puro de RabbitMQ) y **Frontend** (habla REST contra el Gateway,
Principio II) reciben solo tipos de mensaje (`buf.gen.ts-messages.yaml`), porque los stubs de
servicio arrastran `@grpc/grpc-js`, que es exclusivo de Node y no funciona en un navegador.

## 3. Migraciones

Todas las migraciones usan **`golang-migrate`**, independientemente del lenguaje del servicio
(Principio XI). `dev/migrate` las aplica a las siete bases. Convención de archivos:

```text
services/<svc>/migrations/<YYYYMMDDHHMMSS>_<nombre_snake_case>.up.sql
services/<svc>/migrations/<YYYYMMDDHHMMSS>_<nombre_snake_case>.down.sql
```

Toda migración `up` DEBE tener un `down` que revierta efectivamente. Para verificarlo:

```bash
dev/migrate up && dev/migrate down && dev/migrate up
```

Está PROHIBIDO el auto-sincronizado de esquema por ORM (`synchronize: true` de TypeORM y
equivalentes) en cualquier entorno.

## 4. Verificación del flujo principal (User Story 1 — P1)

```bash
# (a) Registro → inicia Saga de registro (Users.CreateProfile + Auth.CreateCredential + email)
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{ "email": "ana@example.co", "password": "S3gura!2026", "display_name": "Ana" }'
# 202 Accepted; revisar el email de verificación en la UI de Mailhog

# (b) Verificar correo → Saga de verificación (Auth.ActivateCredential + Users.MarkEmailVerified)
curl -X POST http://localhost:8080/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{ "user_id": "...", "verification_token": "..." }'

# (c) Login OAuth2 Authorization Code + PKCE → la SPA obtiene access + refresh JWT
#     (flujo de navegador; el Gateway valida el token en cada request contra la blacklist Redis)

# (d) Catálogo y lectura (FR-010/FR-011)
curl http://localhost:8080/catalog/articles -H "Authorization: Bearer <jwt>"

# (e) Enviar cuestionario → Saga calificación→progreso→notificar→auditar (FR-027)
curl -X POST http://localhost:8080/quizzes/<quizId>/attempts \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{ "answers": { "q1": "b", "q2": "a" } }'
# 201; la respuesta incluye score (string decimal), attempt_no y points_after

# (f) Progreso actualizado (FR-014)
curl http://localhost:8080/me/progress -H "Authorization: Bearer <jwt>"

# (g) Bandeja in-app — servida por el Servicio de Usuarios, no por Notificación (D-09)
curl http://localhost:8080/me/notifications -H "Authorization: Bearer <jwt>"
```

**Criterio de aceptación**: tras (a)–(g), `points` refleja el mejor puntaje del cuestionario,
el intento queda en el historial (FR-016), Auditoría registró `learning.quiz_graded`, y la
bandeja in-app muestra `resultado_cuestionario` (FR-023).

## 5. Verificaciones de cumplimiento (gates)

- **Precisión (VIII)**: ejecutar la suite de borde numérico del Simulador
  (`cargo test -p simulator -- numeric_edge`) → cero divergencias por redondeo binario (SC-004).
  Confirmar que ningún payload monetario viaja como número JSON (lint de contrato).
- **Database-per-service (III)**: verificar que cada servicio solo posee credenciales de SU base
  (sin cadenas de conexión cruzadas en config/secretos). `GetActivityReport` obtiene los
  contadores ajenos por gRPC, nunca por lectura cruzada (plan.md N-02).
- **Redis acotado (IV)**: solo Auth y Gateway tienen `REDIS_ADDR`.
- **RabbitMQ (V)**: solo `notification.q` y `audit.q` tienen consumidores enlazados.
- **Saga (VI)**: pruebas de integración con inyección de fallo por paso → compensación/reintento
  correctos.
- **Capas (IX)**: ninguna capa `storer` importa tipos de transporte ni de protobuf; ninguna capa
  `handler` importa tipos de fila.
- **Configuración (X)**: ningún host, puerto, credencial o URL hardcodeado; ningún secreto real
  versionado.
- **Cola de notificaciones**: los tres desenlaces (éxito, fallo reintentable, fallo terminal)
  tienen prueba, y el estado sobrevive al desencolado.

## 6. Pruebas

```bash
go test ./...                       # Go — incluye persistencia contra go-sqlmock
cargo test                          # Simulador — incluye casos de borde numérico
npm test --workspace services/learning
npm test --workspace services/notification
cd frontend && npm test && npm run e2e   # Jest/Karma + Playwright (una spec por historia)
buf breaking contracts/proto --against '.git#branch=main'   # sin cambios incompatibles
```
