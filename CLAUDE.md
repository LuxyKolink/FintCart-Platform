<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at
`specs/001-fintcart-platform/plan.md` (with `research.md`, `data-model.md`,
`contracts/` and `quickstart.md` in the same directory).

## Active Feature: Plataforma Fintcart (`001-fintcart-platform`)

Microservicios poliglota + SPA Angular. Restricciones NO negociables (Constitución v1.1.1):
- **gRPC** interno (Protocol Buffers); **REST solo en el API Gateway** (borde).
- **PostgreSQL 16** database-per-service; sin acceso cruzado a BD.
- **Redis 7.4** solo: blacklist JWT + refresh (Auth) y rate limiting (Gateway).
- **RabbitMQ 4.0** solo productores (Usuarios, Aprendizaje, Orquestador, Auth) → consumidores (Notificación, Auditoría).
- Consistencia multi-servicio solo vía **Saga** (Orquestador, con compensaciones); sin 2PC/locks.
- **OAuth2** Authorization Code + PKCE (SPA) y Client Credentials (M2M); JWT firmados.
- **Precisión decimal arbitraria (NON-NEGOTIABLE)**: `NUMERIC` (PG), `shopspring/decimal` (Go),
  `rust_decimal` (Rust), `decimal.js`/`big.js` (TS), `string` decimal en proto/JSON. PROHIBIDO float/double/number para dinero.

Lenguajes por servicio: Go (Gateway, Auth, Orquestador, Usuarios, Auditoría) · Rust (Simulador) ·
TypeScript+NestJS (Aprendizaje) · TypeScript/Node (Notificación) · TypeScript+Angular (Frontend).

Convenciones de estructura y desarrollo (Principios IX–XII, estilo de `github.com/dhij/ecomm`
generalizado a todos los stacks):
- **Capas por servicio**: transporte (`handler`) → aplicación (`server`) → persistencia (`storer`,
  interfaz explícita + `NewPostgresStorer`). Sin dependencias ascendentes; inyección por constructor.
- **Mapeo explícito** en `mapping`/`types` en cada frontera; ahí y solo ahí se convierte
  `string` decimal ↔ tipo decimal. DTO ≠ tipo de dominio ≠ tipo de fila.
- **Entrypoint delgado**: `cmd/<svc>/main.go` · `src/main.rs` · `src/main.ts` — solo config, wiring
  y shutdown. Configuración 100% por variables de entorno; descubrimiento por hostname.
- **Migraciones**: `migrations/<YYYYMMDDHHMMSS>_<nombre>.{up,down}.sql` emparejadas, aplicadas con
  `golang-migrate` en todos los servicios. Prohibido `synchronize: true`. Escrituras multi-tabla
  vía helper `execTx(ctx, fn)`. Contexto propagado y errores envueltos con causa.
- **Dev local**: `dev/build`, `dev/up`, `dev/migrate`, `dev/down` + `dev/docker-compose.yaml`.
  Cero pasos manuales.
- **Contratos** en `contracts/` (única superficie compartida); stubs generados versionados en `gen/`.

Aclaraciones vigentes (ver `plan.md` §Notas de Diseño):
- La **bandeja in-app la posee Usuarios**, no Notificación (consumidor puro sin gRPC). Notificación
  solo maneja **email**, con cola persistente de dos tablas (`notification_events_queue` + `notification_states`).
- `Users.GetActivityReport` obtiene `quizzes_attempted` y `simulations_run` por **gRPC** a Aprendizaje
  y Simulador — nunca por lectura cruzada de BD (Principio III).
- Gateway (sin dominio ni BD) y Auditoría/Notificación (consumidores puros) son **capas degeneradas
  legítimas** del Principio IX.
<!-- SPECKIT END -->
