<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at
`specs/003-design-system-frontend/plan.md` (with `research.md` y `quickstart.md`
en el mismo directorio; ese feature **no tiene** `data-model.md` ni `contracts/`
porque es exclusivamente de presentación).
La arquitectura base vive en `specs/001-fintcart-platform/plan.md` y el trabajo
de dominio en curso en `specs/002-calculator-builder-content-admin/plan.md`.
Los tres se acumulan: 002 enmienda a 001, y 003 solo toca `frontend/`.

## Active Feature: Rediseño del Frontend (`003-design-system-frontend`)

Feature **exclusivamente de presentación**: no toca backend, contratos, eventos ni base de
datos. Requisitos FR-086…FR-123, criterios SC-027…SC-037, decisiones D-26…D-32.

- **Retira una capa, no añade otra** (nota N-12): `frontend/src/styles.scss` era un duplicado
  parcial de `shared/ui` y **ya no existe** — se eliminó en `1aeffc5`, y `node
  scripts/design-debt.mjs --check` marca 0 pantallas con clase artesanal desde entonces. Ese
  criterio de terminación está cumplido; lo que falta del feature es juicio visual, no
  fontanería. De las primitivas de portal de `tokens/base.css` sobreviven `fc-module`, `fc-num`
  y `fc-linklist`; `fc-eyebrow` se retiró con el rediseño (§11 del brief).
- **Las pruebas e2e NO se modifican** (nota N-13): seleccionan por rol y etiqueta accesible en
  110 de 112 casos, así que sobreviven al rediseño y fallan si este rompe la accesibilidad. Si
  una falla, el fallo es del rediseño; ajustar la aserción destruye la única garantía dura.
- **Responsive con una sola escala** (D-27): sí existían `@media` —31 en `frontend/src`, cuatro
  de ellos ya en `tokens/breakpoints.css` en `104b41d`—; lo que faltaba era coherencia. Ahora
  hay cuatro puntos de corte como **tokens** (480/768/1024/1280, con 1280 declarado como no-op
  deliberado), mínimo 360 px, y `--page-gutter` gobierna cabecera y contenido. En el
  acceso, el panel de marca degrada a banda compacta pero **nunca se oculta** (N-14).
- **Una cifra monetaria nunca trunca** (N-15): truncar `$1.234.567` a `$1.234…` no es texto
  incompleto, es un dato falso. Es la expresión visual del Principio VIII.
- **Frontera con 002** (FR-123): 002 reescribe la superficie de redacción del editor; 003 solo
  el marco que la rodea. El grupo editorial se migra **el último**.
- Migración **pantalla por pantalla agrupada por UI kit** (D-28), desplegando kit completo:
  acceso → aprendizaje → simuladores → perfil → editorial.
- **Estado (2026-11-01, rama `development`, `staging` intacta en `104b41d`)**: tokens v2,
  las 19 primitivas y las pantallas de acceso, aprendizaje, simuladores, perfil y
  administración ya migradas; editorial (solo el marco, FR-123) es lo último que queda. Las
  cifras que sostienen esto: 59/59 e2e sin omisiones, 311/311 unitarias, build limpio,
  design-debt 0. Lección que el informe debe recoger: `npm run build` no demuestra que una
  página se renderice —la máscara del logotipo pasaba el build y rompía el servidor de
desarrollo—, así que el juicio visual es una prueba, no un adorno.

## Feature en curso: Constructor de Calculadoras y Administración (`002-calculator-builder-content-admin`)

Enmienda al feature 001 (implementado y desplegado). Sin servicios ni infraestructura
nuevos. Requisitos FR-032…FR-082, criterios SC-013…SC-025, decisiones D-13…D-25.

- **Motor de fórmulas (Simulador)**: las calculadoras pasan a ser definiciones
  parametrizadas — analizador → AST persistido en `JSONB` → evaluador acotado, todo en
  `rust_decimal`. Las cinco de FR-019 se resiembran como **siete** definiciones semilla.
  `pot` (exponente entero, exacta) y `potd` (decimal, aproximada) son funciones
  **separadas**: fundirlas perdería en silencio la exactitud del Principio VIII.
  `tests/seed_regression.rs` sostiene FR-049 — el código nativo de `src/calculators/` no
  se borra hasta que esa suite pase.
- **Cuestionarios**: `GetQuiz` deja de ser el camino de ejecución; `StartQuizSession` sirve
  N preguntas al azar con opciones barajadas. `score` pasa a **porcentaje sobre 100**.
  La sesión vive en `learning_db`, **nunca en Redis** (Principio IV).
- **Contenido**: `articles.category` (texto libre) → catálogo `categories`;
  `article_versions.body` (texto plano) → `body_doc` en documento de bloques `JSONB` con
  vocabulario **cerrado**, validado en el servidor. El frontend renderiza por componente:
  **prohibido `innerHTML` y `bypassSecurityTrust*`**. Imágenes en `BYTEA` con tope de 2 MB
  e identificador = SHA-256 del contenido.
- **Administración**: cuarto rol `administrador` (categorías, indicadores anuales, purga);
  no hereda atribuciones de `coordinador_editorial`. Estado `pending_deletion` con gracia de
  30 días; el índice único de correo se amplía para reservarlo durante la gracia. **No se
  guarda hash del correo original**: sería un oráculo de pertenencia (FR-077).
- **Indicadores**: `financial_indicators` en `simulator_db` con vigencia `daterange` y
  `EXCLUDE USING gist`; las fórmulas los referencian como `@NOMBRE`; cada simulación guarda
  el snapshot usado. El Simulador **sigue sin ser productor** de RabbitMQ: el aviso de
  vencimiento lo publica el Orquestador (igual que D-03).

## Feature Base: Plataforma Fintcart (`001-fintcart-platform`)

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
