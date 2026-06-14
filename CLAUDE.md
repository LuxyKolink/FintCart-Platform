<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at
`specs/001-fintcart-platform/plan.md` (with `research.md`, `data-model.md`,
`contracts/` and `quickstart.md` in the same directory).

## Active Feature: Plataforma Fintcart (`001-fintcart-platform`)

Microservicios poliglota + SPA Angular. Restricciones NO negociables (Constitución v1.0.0):
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
<!-- SPECKIT END -->
