---

description: "Task list for Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido"
---

# Tasks: Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido

**Input**: Design documents from `/specs/002-calculator-builder-content-admin/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Constitución aplicada**: `.specify/memory/constitution.md` **v1.1.1** (Principios I–XII)

**Tests**: INCLUIDOS, por el mismo motivo que en 001 — la Constitución v1.1.1 §"Calidad y
Pruebas" los declara obligatorios y prevalece sobre otras prácticas (§Governance). Las
tareas de prueba NO son opcionales. Este feature añade además una categoría de prueba
crítica: la **suite de regresión de las semillas** (T092), de la que depende que FR-049 no
haya que renegociar.

**Organization**: tareas agrupadas por historia de usuario, en el orden de prioridad de
`spec.md` (3×P1, 4×P2, 1×P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1…US8)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Se conservan íntegras las de 001. Rutas normativas de la Constitución §"Convenciones de
Estructura y Nomenclatura por Tecnología" (Principio IX), capas `handler` → `server` →
`storer`. Rutas nuevas de este feature, según `plan.md` §Project Structure:

- **Simulador (Rust)**: `services/simulator/src/domain/formula/`, `src/domain/seeds/`,
  `src/repo/`, `tests/`
- **Aprendizaje (NestJS)**: `services/learning/src/{categories,quizzes,articles,images}/`
- **Frontend (Angular)**: `frontend/src/app/features/{admin,calculators,editorial,learning}/`

---

## Phase 1: Setup — Contratos y dependencias

**Purpose**: aplicar los deltas de contrato y dejar las dependencias listas. Nada de lógica.

**Estado (2026-09-16)**: cerradas T002 y T007–T012. Quedan **T001, T003, T004, T005 y T006**,
que son cinco tareas y no cinco problemas: T001 y T003 son dos deltas de proto que **crecen
por historia** —imágenes y `body_doc` en US6, purga en US7—, T004 es el delta REST que depende
de los tres anteriores, T005 es el catálogo de eventos y T006 es la regeneración de stubs, que
por la regla de la constitución va **en un commit propio sin cambios de lógica** y se repite
cada vez que un proto crece. Es decir: la fase no está bloqueando a nadie, está esperando a
las historias que la hacen crecer. Por eso US3 puede seguir sin cerrarla.

> **Regla de la constitución (§Definición de Contratos)**: los stubs generados se commitean
> y se regeneran **en un commit separado** del cambio de lógica. T006 es ese commit.

- [ ] T001 [P] Aplicar el delta de Aprendizaje a `contracts/proto/fintcart/learning/v1/learning.proto` (RPC de categorías, `StartQuizSession`, imágenes; campos `category_id`, `body_doc`, `questions_to_serve`, `session_id`, `served_question_ids`) según `specs/002-calculator-builder-content-admin/contracts/proto/learning-delta.proto`
- [X] T002 [P] Aplicar el delta del Simulador a `contracts/proto/fintcart/simulator/v1/simulator.proto` (constructor, curaduría, indicadores; campos nuevos de `ComputeRequest`/`ComputeResponse`/`ListHistoryResponse.Entry`) según `contracts/proto/simulator-delta.proto` — deja el Simulador **sin compilar** hasta que US3/US4 implementen los RPC nuevos (T087–T091, T101–T104); los cinco servicios Go y los tres destinos TS sí compilan. **Estado transitorio CERRADO en T075–T086**: los once RPC nuevos tienen cuerpo `Status::unimplemented` en `grpc/service.rs` que nombra la tarea que los implementa, de modo que el crate vuelve a compilar y las pruebas del motor pueden correr. Ese cierre es necesario, no cosmético: un trait con métodos sin implementar no compila, así que sin él las pruebas de T075–T078 no podrían ni ejecutarse. En `grpc/mapping.rs`, `calculator_version`/`indicators_used`/`calculator_id` se devuelven en su valor neutro porque el camino vigente es el de compatibilidad por `calc_type` (FR-043), que no pasa por ninguna definición versionada; T091 y T103 los rellenan cuando exista la procedencia
- [ ] T003 [P] Aplicar el delta de Usuarios a `contracts/proto/fintcart/users/v1/users.proto` (`MarkForPurge`, `ReactivateAccount`, `ListAccountsDueForPurge`, `AssignRole`, `RevokeRole`, `SearchAccounts`, `account_status` en `AuthContext`/`Profile`) según `contracts/proto/users-delta.proto`
- [ ] T004 Aplicar el delta REST a `contracts/openapi/gateway.yaml` (~20 rutas nuevas y los cambios de comportamiento en `/quizzes/{quizId}/attempts`, `/editorial/**`, `/catalog/articles`, `/simulators/history`, `/me/profile`) según `contracts/openapi/gateway-delta.yaml`
- [ ] T005 [P] Aplicar el delta de eventos a `contracts/events/events-catalog.md` (6 eventos nuevos y la nota de enrutamiento de `account.purge_scheduled` con dos routing keys) según `contracts/events/events-catalog-delta.md`
- [ ] T006 Regenerar y versionar los stubs de los cinco stacks con `contracts/generate.sh`, **en un commit propio sin cambios de lógica** (Constitución §Definición de Contratos) — **parcial**: regenerados para los deltas ya aplicados (T001/T002/T003), pero la tarea sigue abierta porque T001 y T003 aún deben crecer (imágenes y `body_doc` en US6, purga en US7) y cada ampliación exige volver a ejecutarlo
- [X] T007 [P] Declarar `BOOTSTRAP_ADMIN_EMAIL`, `PURGE_SWEEP_INTERVAL` e `INDICATOR_SWEEP_INTERVAL` en `dev/docker-compose.yaml` (Principio X: configuración solo por entorno) — **`BOOTSTRAP_ADMIN_EMAIL` NO estaba declarada y el código SÍ la lee** (`services/users/cmd/users/main.go:260`, D-21): sin declararla, `os.Getenv` devolvía la cadena vacía, la promoción se saltaba en silencio y en desarrollo no había forma de obtener el rol salvo el helper de siembra. Las otras dos las leerán los barridos de T105 y T144, que aún no existen: se declaran ahora porque el valor por defecto es una DECISIÓN y no un detalle — en desarrollo van a 5m, porque US7 no se puede recorrer si la purga solo se revisa cada 24 h. El formato (el de `time.ParseDuration` de Go) queda fijado aquí y no en el código futuro, que es lo que evita que cada barrido invente el suyo. Verificado con `docker compose config --quiet` y leyendo el valor renderizado, no solo el archivo
- [X] T008 [P] Declarar las mismas tres variables en `deploy/vps/compose.app.yaml` y documentarlas en `deploy/vps/README.md` — en producción los intervalos son HOLGADOS (1h y 12h) porque ninguno de los dos barridos tiene prisa: la purga tiene 30 días de gracia y el aviso de vencimiento se publica con semanas de antelación. Se documenta además el procedimiento del administrador inicial —registrar la cuenta por el flujo normal, poner el correo y reiniciar `users`—, incluido el aviso `no corresponde a ninguna cuenta registrada`, que parece un error y no lo es. `deploy/vps/.env.app.example` gana las tres con su comentario, porque una variable que solo vive en el README se queda sin poner. La verificación se hizo con `--env-file .env.app.example` más las ocho obligatorias por entorno: `compose.app.yaml` no renderiza solo con el ejemplo, porque `PG_PASSWORD` y las demás usan `${VAR:?}`
- [X] T009 [P] Añadir `sharp` a `services/learning/package.json` para validar que los bytes recibidos son realmente la imagen que declara su `mime_type` (FR-066) — `^0.35.4`, con el `package-lock.json` actualizado por `npm install` (editarlo a mano habría roto `npm ci` en la imagen Docker). **No basta con que aparezca en el manifiesto**: `sharp` es un binding nativo y su modo de fallo típico es instalarse sin el binario de la plataforma. Comprobado cargándolo: `require('sharp').versions.vips` → `8.18.6`, que es una libvips real y no un stub
- [X] T010 [P] Añadir a `frontend/package.json`: `@tiptap/core`, `@tiptap/starter-kit` y `@tiptap/pm` (editor enriquecido, research D-24), `lucide-angular` (iconos) y `@fontsource/ibm-plex-mono` (fuente de cifras en COP) — las dos últimas sustituyen dependencias de CDN por dependencias del bundle — **la tarea describía dos de las cinco como pendientes y ya estaban**: `@fontsource/ibm-plex-mono` y los iconos, que en el paquete actual se llaman **`@lucide/angular`** y no `lucide-angular` (el nombre viejo es de otra línea de versiones). Solo faltaba TipTap, instalado en `^3.31.3`. Comprobado que la instalación no arrastró nada más: el diff de `package.json` añade tres líneas y no quita ninguna

---

## Phase 2: Foundational — Migraciones, rol, autorización y capa de componentes

**Purpose**: esquema, autorización y capa de componentes de UI sin los cuales ninguna
historia puede empezar.

**⚠️ CRÍTICO**: ninguna historia arranca hasta terminar esta fase.

**✅ Las once migraciones de este feature están aplicadas y verificadas contra PostgreSQL 16**
(2026-09-16): cuatro en `simulator_db`, seis en `learning_db` y una en `users_db`.

**Y aquí me equivoqué una vez, de una forma que conviene no repetir.** Al aplicar las del
Simulador decidí NO aplicar las de Aprendizaje y Usuarios, razonando que
`20260902101500_link_articles_to_categories` termina con `ALTER TABLE articles DROP COLUMN
category` y que eso «rompería el Aprendizaje, porque US1 no está implementado». **US1 sí está
implementado**: `services/learning/src/` tiene `categories/`, `quizzes/` y `publishing/`, y
`articles.repository.ts` hace `JOIN categories c ON c.id = a.category_id`. El código llevaba
tareas esperando su esquema, no al revés.

El error fue deducir el estado del código a partir de lo que yo había tocado en la sesión, en
lugar de mirarlo. La lección es concreta: **antes de decidir que una migración es insegura de
aplicar, hay que comprobar si su código ya existe** —y `grep` cuesta menos que razonar sobre
una suposición—. Aplicadas después, las once pasan limpio, y la conversión de datos de
`link_articles_to_categories` conservó las categorías de los artículos sembrados y de tres
artículos de prueba E2E que ya estaban en la base.

> Las tres migraciones con **conversión de datos** (T013, T015, T017) son el mayor riesgo
> silencioso del feature. Cada una es transaccional y respeta el orden poblar → restringir;
> el orden inverso deja filas inválidas a medio camino.

### Migraciones de `learning_db`

- [X] T011 [P] Migración emparejada `categories` (nombre, slug, descripción, `position`, `active`, índices únicos parciales sobre activas) en `services/learning/migrations/` — **estaba HECHA y sin marcar.** Las dos migraciones se implementaron en `74105f4` («feat(002): T011/T012 migraciones de categorías y articles.category_id en learning_db») y el ledger nunca se actualizó. Se descubrió al comprobar el estado real de la fase antes de seguir, no al recordarlo: `ls services/learning/migrations/` muestra los dos pares y `git log` sobre ellos devuelve el commit. **Es la misma clase de error que el de las migraciones no aplicadas** —dar por bueno lo que uno recuerda haber tocado en vez de ir a mirarlo—, solo que en el sentido contrario: entonces di por hecho que faltaba trabajo que estaba hecho, y ahora di por hecho que faltaba marcar trabajo que ya estaba hecho. El `ls` cuesta menos que las dos suposiciones
- [X] T012 Migración emparejada que añade `articles.category_id` **anulable**, la puebla normalizando los valores de `articles.category`, completa hasta 5 categorías si hicieran falta (SC-009), y **solo entonces** impone `NOT NULL` + FK y elimina `category`, en `services/learning/migrations/` — misma deriva que T011: implementada en `74105f4`, sin marcar. El orden poblar → restringir es lo que garantiza que ningún artículo quede huérfano, y la normalización es por clave sin tildes ni mayúsculas con `slug` como identidad, de modo que `seguridad_financiera`, `seguridad-financiera` y `Seguridad Financiera` colapsan en una sola categoría. **Su prueba es T024, que sigue pendiente** — la migración está aplicada y verificada contra la base, pero la propiedad que T024 afirma (ningún `category_id` nulo, duplicados por tildes colapsados) no está cubierta por ninguna prueba automática
- [X] T013 Migración emparejada `quizzes.questions_to_serve` (default 5) y reescala `pass_threshold := 100 * pass_threshold / Σ weight`, reemplazando el CHECK por el rango 0–100, en `services/learning/migrations/` — **sin reescala** (001 ya guarda porcentajes; ver D-18 corregida)
- [X] T014 [P] Migración emparejada `quiz_sessions` (`served` JSONB, `expires_at`, `consumed_at`, índices de barrido) en `services/learning/migrations/`
- [X] T015 Migración emparejada que añade `quiz_attempts.session_id` y `served_snapshot`, reescala `score := 100 * score / Σ weight`, reemplaza el CHECK por el rango 0–100, y **emite el recuento de cuestionarios cuyo banco cambió tras su primer intento** (research D-18), en `services/learning/migrations/` — **sin reescala de `score`** (001 ya guarda porcentajes); la salvedad persiste solo para `served_snapshot`
- [ ] T016 [P] Migración emparejada que añade `article_versions.body_doc JSONB` y lo puebla envolviendo cada `body` en párrafos; **`body` NO se elimina aquí** (research D-14), en `services/learning/migrations/`
- [ ] T017 [P] Migración emparejada `article_images` (PK = SHA-256 hex, `BYTEA` con `STORAGE EXTERNAL`, CHECK de mime y de tope de 2 MB) en `services/learning/migrations/`

### Migraciones de `simulator_db`

- [X] T018 [P] Migración emparejada `calculators` + `calculator_definitions` con los CHECK de `data-model.md` §2.1–2.2, incluido `calculators_builtin_has_no_owner` como **implicación** y no equivalencia, en `services/simulator/migrations/` — **no** se le aplica la guardia `jsonb_has_no_numbers` de `simulations`: `outputs` lleva `escala`, que es un recuento y no una cifra monetaria, así que la guardia rechazaría definiciones válidas (documentado en la migración) — **APLICADA contra PostgreSQL 16 y verificada**: `simulations` y las dos tablas nuevas existen, `btree_gist` y `pgcrypto` están, y los CHECK son los que dice `data-model.md`
- [X] T019 [P] Migración emparejada `financial_indicators` con `CREATE EXTENSION btree_gist` y `EXCLUDE USING gist (name WITH =, validity WITH &&)` para FR-059, en `services/simulator/migrations/` — se añade además `financial_indicators_validity_half_open`, que impone el `[inicio, fin)` de `data-model.md` §2.3 para que «qué indicador rige el día D» tenga una sola respuesta — **APLICADA y verificada contra PostgreSQL 16**: `EXCLUDE USING gist (name WITH =, validity WITH &&)` está en pie, y las cinco filas sembradas por `dev/seed` quedan en `[2026-01-01,2027-01-01)` con `lower_inc` verdadero y `upper_inc` falso, que es exactamente la convención
- [X] T020 Migración emparejada que añade `simulations.calculator_id`, `calculator_version` e `indicators_snapshot`, rellenando las filas históricas con la semilla correspondiente a su `calc_type` y snapshot vacío, en `services/simulator/migrations/` — el relleno empareja por **nombre** de semilla, porque las migraciones corren antes que `dev/seed`; `colombia_especifica` se desambigua por `inputs->>'operacion'`, ya que era una sola calculadora que D-16 separa en tres. **`dev/seed` (T095) debe repetir el mismo UPDATE** tras sembrar, para que el resultado no dependa del orden — **APLICADA y verificada contra PostgreSQL 16 sobre 13.493 simulaciones REALES**: la migración las dejó en NULL —corrió antes que el sembrado, como estaba previsto— y el UPDATE de `repo::seeds::backfill_history` las ligó todas a la semilla `credito`. Las 13.493 son de tipo `credito`, así que la rama `colombia_especifica` NO quedó cubierta por los datos existentes y se comprobó aparte con filas sintéticas: `operacion='gmf'` → semilla `gmf`, `operacion='ea_a_mv'` → semilla `ea_a_mv`, y `operacion='inventada'` se queda en NULL, que es lo honesto

### Migraciones de `users_db`

- [ ] T021 [P] Migración emparejada que amplía `profiles_account_status_valid` con `pending_deletion`, añade `purge_due_at` y `purge_requested_by`, y **sustituye `profiles_email_active_uniq` por `profiles_email_reserved_uniq` sobre `('active','pending_deletion')`** — es el cambio del que depende FR-074, en `services/users/migrations/`
- [X] T022 [P] Migración emparejada que amplía `roles_assignment_role_valid` con `administrador` en `services/users/migrations/`

### Pruebas de migración

- [ ] T023 [P] Prueba de la reescala de calificaciones sobre un cuestionario cuyo banco cambió tras el primer intento, verificando que la conversión se aplica y que el aviso de aproximación se emite, en `services/learning/test/migrations/rescale.spec.ts`
- [ ] T024 [P] Prueba de la migración de categorías: ningún artículo queda con `category_id` nulo y los duplicados por tildes o mayúsculas colapsan en una sola categoría, en `services/learning/test/migrations/categories.spec.ts`
- [ ] T025 [P] Prueba de que la reserva de correo rechaza un registro con el correo de una cuenta en `pending_deletion` y lo acepta tras la anonimización, en `services/users/internal/storer/storer_postgres_test.go`

### Rol `administrador` y autorización

- [X] T026 Promoción idempotente a `administrador` de la cuenta indicada por `BOOTSTRAP_ADMIN_EMAIL` al arrancar, en `services/users/cmd/users/main.go` — **no se siembra en migración** (research D-21)
- [X] T027 Implementar `AssignRole` y `RevokeRole` en `services/users/internal/server/roles.go` y su persistencia en `services/users/internal/storer/storer_postgres.go`
- [X] T028 [P] Exponer `AssignRole`/`RevokeRole` en `services/users/internal/handler/handler.go` y declararlos en `services/users/internal/handler/types.go`
- [X] T029 Incluir `administrador` en el conjunto de roles emitido en los claims del JWT, en `services/auth-server/internal/server/`
- [X] T030 Middleware `requireRole("administrador")` en `services/api-gateway/internal/handler/middleware.go` y su aplicación a `/admin/**` en `routes.go` (FR-081: verificación en el borde, no ocultando la interfaz)
- [X] T031 [P] Pruebas del middleware: rol ausente → 403; `coordinador_editorial` NO accede a `/admin/**` (FR-082); administrador NO accede a `/editorial/calculators/**`, en `services/api-gateway/internal/handler/middleware_test.go`

### Capa de componentes del design system (bloqueante para toda UI)

> **Por qué está aquí y no en el feature 003**: los tokens de `design/` ya están copiados
> **idénticos** en `frontend/src/styles/tokens/`, pero los 11 componentes solo existen como
> referencia React en `design/components/`. Las 19 pantallas actuales se construyeron sobre
> las 99 líneas de primitivas de `tokens/base.css` más 94 atributos `style="..."` en línea —
> por eso se ven pobres. Este feature añade **8 pantallas nuevas**; si la capa de componentes
> no existe cuando se escriban, nacerán en el mismo estilo ad-hoc y habrá que rehacerlas.
> La migración de las 19 pantallas existentes es el feature **003**, aparte.

- [x] T032 Scaffolding de `frontend/src/app/shared/ui/` (componentes standalone + barril `index.ts`) y adopción de `design/_adherence.oxlintrc.json` como regla de lint del frontend (FR-083)
- [x] T033 Componente `Icon` sobre `lucide-angular` en `frontend/src/app/shared/ui/icon/`, registrando solo los 25 iconos que usan los kits — sustituye el CDN que propone `design/guidelines/brand-iconography.html` (FR-085), que en el VPS del CTIC sería una dependencia externa en tiempo de ejecución. Lucide es una **sustitución** elegida por el design system (`design/README.md:98`), no una marca de FintCart: si aparece un set propio, se cambia aquí y en los kits
- [x] T034 Auto-hospedar **IBM Plex Mono**: sustituir el `@import` a `fonts.googleapis.com` de `frontend/src/styles/tokens/fonts.css:9` por los pesos **400, 500 y 600** de `@fontsource/ibm-plex-mono` — son exactamente los que el token pide hoy, así que el resultado visual es idéntico y solo desaparece la petición externa por visitante (FR-085)
- [x] T035 [P] `Button` (variantes `primary`/`secondary`, `block`, `iconLeft`) en `frontend/src/app/shared/ui/button/`, portado de `design/components/forms/Button.jsx`
- [x] T036 [P] `Input` con `ControlValueAccessor` para formularios reactivos en `frontend/src/app/shared/ui/input/`, portado de `design/components/forms/Input.jsx`
- [x] T037 [P] `Checkbox` con `ControlValueAccessor` en `frontend/src/app/shared/ui/checkbox/`, portado de `design/components/forms/Checkbox.jsx`
- [x] T038 [P] `Select` con `ControlValueAccessor` en `frontend/src/app/shared/ui/select/`, portado de `design/components/forms/Select.jsx` — lo consume directamente el desplegable de categorías de US1
- [x] T039 [P] `Card` en `frontend/src/app/shared/ui/card/`, portado de `design/components/layout/Card.jsx`
- [x] T040 [P] `ModuleBox` (caja con borde + barra de cabecera, el patrón central de la estética "portal denso") en `frontend/src/app/shared/ui/module-box/`, portado de `design/components/layout/ModuleBox.jsx`
- [x] T041 [P] `Tabs` en `frontend/src/app/shared/ui/tabs/`, portado de `design/components/layout/Tabs.jsx`
- [x] T042 [P] `Avatar` en `frontend/src/app/shared/ui/avatar/`, portado de `design/components/display/Avatar.jsx`
- [x] T043 [P] `Badge` en `frontend/src/app/shared/ui/badge/`, portado de `design/components/display/Badge.jsx`
- [x] T044 [P] `ProgressBar` en `frontend/src/app/shared/ui/progress-bar/`, portado de `design/components/display/ProgressBar.jsx`
- [x] T045 [P] `Tag` en `frontend/src/app/shared/ui/tag/`, portado de `design/components/display/Tag.jsx`
- [x] T046 [P] Componente `BrandLogo` sobre los 5 SVG de marca en `frontend/src/app/shared/ui/brand-logo/`, y **deduplicar** los assets: hoy están repetidos en `frontend/src/assets/logo/` y `frontend/src/styles/assets/logo/`
- [x] T047 Pruebas unitarias y de accesibilidad de los 11 componentes (foco visible con `--focus-ring`, etiqueta asociada a cada control, roles ARIA) en `frontend/src/app/shared/ui/**/*.spec.ts` (FR-084)
- [x] T048 Galería interna de verificación visual que reproduzca `design/components/{display,forms,layout}/*.card.html` con los componentes Angular, en `frontend/src/app/shared/ui/gallery/`

**Checkpoint**: esquema aplicado, autorización lista y capa de componentes disponible. Las
historias pueden empezar, y toda pantalla nueva se construye sobre `shared/ui`, nunca sobre
primitivas sueltas ni `style="..."` en línea.

---

## Phase 3: User Story 1 — Catálogo administrable de categorías (P1) 🎯 MVP

**Goal**: el administrador mantiene un catálogo de categorías; el editor escoge de una lista
desplegable y el catálogo público filtra por ella.

**Independent Test**: crear categorías, clasificar un artículo desde el desplegable y
verificar el filtrado público. No depende de ninguna otra historia.

### Pruebas

- [X] T049 [P] [US1] Prueba de contrato gRPC de `CreateCategory`, `UpdateCategory`, `DeactivateCategory` y `ListCategories` en `services/learning/test/contract/categories.contract.spec.ts`
- [X] T050 [P] [US1] Prueba de persistencia contra driver SQL simulado del repositorio de categorías (sentencia emitida y mapeo de filas) en `services/learning/test/categories/categories.repository.spec.ts`

### Implementación

- [X] T051 [P] [US1] Tipos de fila y mapeo de categoría en `services/learning/src/categories/category.types.ts` y `category.mapping.ts` (DTO ≠ dominio ≠ fila, Principio IX)
- [X] T052 [US1] Repositorio de categorías en `services/learning/src/categories/categories.repository.ts`, incluida la consulta de recuento de artículos publicados que exige FR-035
- [X] T053 [US1] Servicio de categorías en `services/learning/src/categories/categories.service.ts`: alta, edición, reordenamiento y desactivación con rechazo si hay artículos publicados, devolviendo el recuento en el error
- [X] T054 [US1] Controlador gRPC de categorías en `services/learning/src/categories/categories.controller.ts`
- [X] T055 [US1] Validar `category_id` contra el catálogo en la creación y edición de borradores, en `services/learning/src/articles/` (FR-034)
- [X] T056 [US1] Publicar `category.deactivated` al desactivar, en `services/learning/src/events/` (consumidor: solo Auditoría)
- [X] T057 [US1] Rutas `/catalog/categories` y `/admin/categories[/{categoryId}]` en `services/api-gateway/internal/handler/routes.go`, con traducción del rechazo por artículos publicados a 409 con `published_count`
- [X] T058 [P] [US1] Pantalla de administración de categorías (alta, edición, reordenamiento, desactivación) en `frontend/src/app/features/admin/categories/`
- [X] T059 [US1] Sustituir el `<input>` de texto libre por un `<select>` alimentado por el catálogo en `frontend/src/app/features/editorial/editor/editor.component.html` (hoy es texto libre en la línea 31)
- [X] T060 [P] [US1] Filtro por categoría del catálogo público en `frontend/src/app/features/learning/catalog/`

**Checkpoint**: US1 entregable y verificable de forma independiente (SC-025).

---

## Phase 4: User Story 2 — Cuestionarios con preguntas aleatorias (P1)

**Goal**: cada intento sirve N preguntas al azar con opciones barajadas, se califica sobre
100 y solo acepta respuestas de la sesión emitida.

**Independent Test**: cargar un cuestionario con más preguntas que su N, ejecutarlo dos
veces y comparar conjuntos servidos y calificaciones.

> **Hallazgo (2026-09-16): `dev/demo` quedó desactualizado por el cambio de contrato de esta
> historia, y nadie lo actualizó.** El guion de humo del proyecto envía `POST
> /quizzes/{quizId}/attempts` directamente, sin pasar antes por `POST /quizzes/{quizId}/session`
> —que existe en `routes.go` desde T071—, así que el servicio responde 500 con
> `session_id no es un UUID: ""`. Lo encontré verificando T091 contra el stack levantado: el
> demo se detiene en el paso 6 y no llega a los pasos del simulador.
>
> No lo arreglé, y conviene decir por qué en vez de dejarlo implícito: el arreglo toca la
> semántica de US2 —crear la sesión, recoger su identificador y enviarlo con las respuestas— y
> merece su propia lectura del contrato, no un parche al final de una unidad de US3. Lo que sí
> es un hecho es que **la suite de humo del proyecto lleva sin pasar desde que US2 cambió el
> contrato de los intentos**, y eso no lo detecta ningún `cargo test` ni ninguna prueba de
> servicio: solo lo detecta ejecutar el demo. `dev/demo` no aparece en `tasks.md` ni en
> `quickstart.md`, que es probablemente la razón de que se quedara atrás.
>
> Coste de dejarlo así: el demo sigue sirviendo para US1 y para el arranque de sesión, y deja
> de servir como verificación de punta a punta. Debería ser una tarea propia.

### Pruebas

- [X] T061 [P] [US2] Prueba de contrato gRPC de `StartQuizSession` verificando que devuelve exactamente `questions_to_serve` preguntas y **sin** la clave correcta, en `services/learning/test/contract/quiz-session.contract.spec.ts`
- [X] T062 [P] [US2] Prueba de que dos sesiones consecutivas del mismo cuestionario difieren en conjunto de preguntas y en orden de opciones (SC-013), en `services/learning/test/quizzes/sampling.spec.ts` — probado de forma determinista sobre `shuffle`/`sampleServed` con fuente de aleatoriedad fija
- [X] T063 [P] [US2] Prueba de que calificar con una pregunta no servida, con sesión vencida o con sesión ya consumida falla en vez de calificar (FR-040, FR-042), en `services/learning/test/quizzes/grading.spec.ts`
- [X] T064 [P] [US2] Prueba de que un banco con menos preguntas que N sirve todas sin error (FR-038), en `services/learning/test/quizzes/sampling.spec.ts`

### Implementación

- [X] T065 [P] [US2] Repositorio de sesiones en `services/learning/src/quizzes/sessions.repository.ts` (alta, lectura por id, marcado de consumo, barrido de vencidas)
- [X] T066 [US2] Muestreo aleatorio de N preguntas y barajado de opciones en `services/learning/src/quizzes/session.service.ts`, persistiendo **ambos órdenes** en `served` (research D-17)
- [X] T067 [US2] `StartQuizSession` en `services/learning/src/quizzes/quizzes.controller.ts`, devolviendo las preguntas sin `correct_key` — implementado en `src/grpc/learning.controller.ts` (el controlador gRPC de este servicio)
- [X] T068 [US2] Calificación normalizada `100 × peso_acertado / peso_servido` y rechazo de respuestas fuera de la sesión, en `services/learning/src/grading/grading.service.ts` (FR-040, FR-041)
- [X] T069 [US2] Copiar `served` a `quiz_attempts.served_snapshot` al calificar — el historial no puede depender de una sesión que se purga (nota N-07), en `services/learning/src/grading/`
- [X] T070 [US2] Añadir `questions_to_serve` a `UpsertQuiz` y validarlo (> 0) en `services/learning/src/quizzes/quizzes.service.ts` (FR-037)
- [X] T071 [US2] Barrido de sesiones vencidas en el proceso periódico existente de `services/learning/src/` — no había proceso periódico; se creó `SessionSweeper` (intervalo `SESSION_SWEEP_INTERVAL_MS`, defecto 60 s)
- [X] T072 [US2] Ruta `POST /quizzes/{quizId}/session` y exigencia de `session_id` en `POST /quizzes/{quizId}/attempts` (409 si es inválida) en `services/api-gateway/internal/handler/routes.go` — también se threadó `session_id` por la saga del Orquestador y se preservó `FAILED_PRECONDITION` (antes caía a `Internal`)
- [X] T073 [US2] Adaptar el flujo del cuestionario a la sesión en `frontend/src/app/features/learning/quiz/`, propagando `session_id` al enviar — el borrador local de 001 se **acota a las preguntas servidas** al reanudarlo (con sorteo, uno viejo puede referirse a preguntas que esta sesión no sirvió, y enviarlas haría fallar el intento entero); el 409 de sesión vencida o consumida se distingue del fallo de red y ofrece un intento nuevo en vez de reintentar en bucle
- [X] T074 [P] [US2] Campo "preguntas a mostrar" en el editor de cuestionarios en `frontend/src/app/features/editorial/editor/` — el proto ya devolvía `questions_to_serve` en `Quiz`, pero el DTO de lectura del Gateway no lo exponía: se añadió allí para que el valor sobreviva a reabrir el cuestionario (si no, guardar lo reiniciaría al defecto de FR-037)

**Checkpoint**: US2 entregable (SC-013, SC-014).

---

## Phase 5: User Story 3 — Constructor de calculadoras propias (P1)

**Goal**: cualquier usuario define y ejecuta calculadoras propias; las cinco por defecto se
resiembran como siete definiciones sobre el mismo motor.

**Independent Test**: crear una calculadora de dos entradas y una fórmula, ejecutarla y
verificar el resultado y su registro en el historial.

> **Esta es la fase de mayor riesgo del feature.** T092 es la tarea que sostiene FR-049.
> `src/calculators/` **no se elimina** (T098) hasta que esa suite pase.

### Pruebas del motor

- [X] T075 [P] [US3] Pruebas del analizador: campo inexistente, expresión mal formada, función desconocida, indicador desconocido, exponente no entero en `pot`, límite de nodos y de profundidad — cada una con su `code` de `DefinitionError`, en `services/simulator/tests/formula_parser.rs` — 37 pruebas. Se añade el código `tipo_incompatible` (séptimo), declarado también en el comentario de `DefinitionError` del contrato: sin él, «usaste una comparación donde va un número» y «la expresión está mal escrita» llegarían al constructor visual con el mismo código y la misma corrección sugerida, que no es la misma
- [X] T076 [P] [US3] Pruebas del evaluador: división por cero, desbordamiento y valor no representable producen error de dominio explícito y no pánico, en `services/simulator/tests/formula_eval.rs` — 19 pruebas; incluyen la pereza de `si(…)` y del cortocircuito de `y`/`o`, que es **semántica y no optimización**: `si(meses > 0, monto / meses, 0)` es la única forma que tiene un autor de protegerse de una operación inválida en un lenguaje sin sentencias
- [X] T077 [P] [US3] Pruebas de las primitivas financieras contra los valores de `annuity.rs`, incluido el caso `i = 0` de `vf_serie`, en `services/simulator/tests/formula_functions.rs` — 24 pruebas. Dos hallazgos que corrigen supuestos: `potd` con exponente ENTERO da el mismo resultado que `pot` (delega en la vía exacta), así que lo que hace necesaria la separación no es que difieran sino que `pot` **rechaza** el exponente decimal; y la ida y vuelta EA → MV → EA **no** vuelve exactamente al origen — se desvía hasta una cienmilésima, el mismo margen que ya documenta `tests/numeric_edge.rs`, porque es el límite del dato publicado a seis decimales y no del cálculo
- [X] T078 [P] [US3] Prueba de que **ningún camino del motor usa `f32`/`f64`** (Principio VIII), reforzada con la regla de clippy ya existente, en `services/simulator/tests/no_float.rs` — cubre las vías que `clippy::disallowed_types` NO puede ver porque no nombran el tipo vetado: `valor.to_f64()`, `Decimal::from_f64(x)`, el trait `Float` y el literal `let x = 1.5` que Rust infiere como `f64`. Exige quitar comentarios y cadenas —el propio módulo explica qué tipos están prohibidos— y lleva guardia contra el falso verde además de comprobar que la regla de clippy sigue declarada en `clippy.toml` **y** en las dos raíces de crate, que es donde se fija la severidad

### Motor de fórmulas

- [X] T079 [P] [US3] Nodos del AST, cerrados y serializables a JSONB, en `services/simulator/src/domain/formula/ast.rs` — los literales se serializan como **cadena canónica**, no como número JSON: un número obligaría a leerlo con un tipo de coma flotante (Principio VIII) y `serde_json` redondea a 15-17 dígitos significativos, así que el AST se degradaría en cada ciclo guardar → leer. Se escribe a mano en vez de confiar en la característica `serde-with-str`, que es un valor por defecto global que un ajuste de dependencias podría retirar sin que nada fallara. `children()` centraliza la estructura del árbol para que los tres recorridos no puedan desincronizarse
- [X] T080 [P] [US3] Analizador léxico en `services/simulator/src/domain/formula/lexer.rs` — cada token lleva su **columna**, porque «expresión mal formada» a secas sobre una fórmula larga no dice dónde mirar. El signo NO se reconoce aquí: el `-` es un operador unario del analizador, de modo que `-5` y `- 5` producen el MISMO árbol
- [X] T081 [US3] Analizador sintáctico texto → AST con precedencia de operadores, `si(...)` y llamadas de función, en `services/simulator/src/domain/formula/parser.rs` — `parse` valida entero (aridad, palabras reservadas, campos e indicadores declarados, forma de los argumentos, tipos, límites) y **el orden importa**: `limits::check` acota el árbol ANTES de los recorridos recursivos de argumentos y tipos, porque si no sería absurdo proteger la recursión del analizador para dejársela abierta al verificador. Dos guardias distintas: el presupuesto de **nodos** (que también evita que un `Box<Expr>` de diez mil niveles desborde la pila al DESTRUIRSE, fuera de toda validación) y el contador de **anidamiento**, que no es el de FR-046 porque los paréntesis son transparentes en el árbol
- [X] T082 [US3] Límites de complejidad (≤ 64 nodos, profundidad ≤ 16, ≤ 20 entradas, ≤ 10 salidas) en `services/simulator/src/domain/formula/limits.rs` — el recorrido es iterativo con pila explícita: es la función que decide si un árbol es aceptable, y una versión recursiva desbordaría la pila justo antes de poder informar de que el árbol es demasiado profundo
- [X] T083 [US3] Tabla de funciones en `services/simulator/src/domain/formula/functions.rs`: `pot` (entero, `checked_powu`, **rechaza exponente no entero**), `potd` (decimal, `checked_powd`), `redondear`, `redondear_dinero`, `min`, `max`, `abs`, `cuota`, `vf_serie`, `tasa_periodica`, `presente` — ver nota N-09. `presente` NO es una `Func`: su argumento es el NOMBRE de un campo, así que tiene variante propia y `presente(1 + 2)` no es representable. `cuota`/`vf_serie`/`tasa_periodica` **delegan en `crate::calculators::annuity`** en vez de reimplementarse: una segunda copia de la cuota haría que T092 comparara el motor contra sí mismo. Se añade `MAX_EXPONENT` (el mismo tope de `MAX_PERIODS`), sin el cual `pot(1, 1000000000)` no desborda —uno elevado a lo que sea es uno— y daría mil millones de multiplicaciones, falsificando la promesa de coste acotado de D-15
- [X] T084 [US3] Evaluador del AST sobre `Decimal` con errores de dominio explícitos, en `services/simulator/src/domain/formula/eval.rs` — todas las operaciones usan `checked_*`: aquí el desbordamiento no es un fallo del programa sino un resultado que el usuario produjo con sus datos, y un operador que entre en pánico lo convertiría en «error del servidor». La división entre cero se comprueba ANTES de `checked_div`, que devuelve `None` tanto para el cero como para el desbordamiento
- [X] T085 [US3] Resolución de variables: campos de entrada e indicadores `@NOMBRE` en espacios de nombres separados, en `services/simulator/src/domain/formula/eval.rs` — `Scope` exige los tres mapas sin atajo de conveniencia: uno que dejara `supplied` vacío haría que `presente(…)` fuera falso para campos que SÍ están, y uno que dejara `indicators` vacío convertiría cualquier `@INDICADOR` en error de ejecución. Una prueba fija que un campo y un indicador homónimos evalúan a valores distintos, que es la propiedad que D-15 promete
- [X] T086 [US3] Extracción de `indicators_used` recorriendo el AST al guardar, en `services/simulator/src/domain/formula/ast.rs` — ordenado y sin repetir, para que dos versiones que solo difieran en el orden de escritura produzcan la misma columna `TEXT[]`

### Definiciones y persistencia

- [X] T087 [P] [US3] Tipos de fila y mapeo de calculadora y definición en `services/simulator/src/repo/calculators.rs` y `services/simulator/src/grpc/mapping.rs` (conversión `string` decimal ↔ `Decimal` solo aquí, Principio IX) — 23 pruebas en `tests/calculators.rs`. El adaptador `Decimal` ↔ cadena JSON se mueve a `domain::decimal_str::serde_decimal` (antes era privado de `ast.rs`): las entradas y las salidas de una definición guardada necesitan la misma regla, y una copia por tipo es una copia que puede quedarse atrás. La prueba que más importa comprueba el JSON **crudo**: recorre las tres columnas y exige que el ÚNICO número JSON sea `escala`, que es un recuento de decimales y no una cifra (el `jsonb_has_no_numbers` de `simulations` no aplica aquí por eso mismo). Añade `texto`/`cuando_texto` a la forma almacenada — ver T088
- [X] T088 [US3] Repositorio de calculadoras y definiciones versionadas (una fila nueva por edición, nunca `UPDATE`) en `services/simulator/src/repo/calculators.rs` — dos tablas: `calculators` (identidad) y `calculator_definitions` (historia). Editar sube `version` e inserta definición, en una sola transacción por `exec_tx`; la autoría va en el `WHERE` del `UPDATE` y no en una comprobación previa, para que comprobar y escribir sean la misma operación. `delete` comprueba antes si hay simulaciones que la citan: la clave foránea `RESTRICT` ya lo impediría, pero el usuario merece saber cuántas lo bloquean en vez de leer una violación de integridad. **Hallazgo que cambia la forma almacenada**: el contrato devuelve las fórmulas como TEXTO (`CalculatorOutput.expression`) y el árbol no se puede imprimir sin decidir paréntesis y espaciado, así que se guarda también el **original del autor** junto al AST (`texto`, `cuando_texto`). Un impresor con un fallo haría que el autor reabriera su calculadora y leyera una fórmula distinta de la que escribió, sin que nada fallara. Es la única desviación de la forma que describía data-model.md §2.2, queda documentada allí y en el comentario de la migración de T018, y no cambia ningún `CHECK`
- [X] T089 [US3] Validación completa de definición y evaluación de `validations` antes que `outputs`, con soporte de salidas condicionales (`when`), en `services/simulator/src/domain/` — 28 pruebas en `tests/definition.rs`. `Draft::parse` acumula **todos** los problemas en vez de abortar en el primero: seis salidas con una errata en cada una no deberían descubrirse guardando seis veces. El `Schema` de campos se construye dentro de `parse` a partir de las propias entradas y no se recibe de fuera: un llamador que se olvidara de una entrada haría que toda fórmula que la use reportara `campo_inexistente`. La clave de un campo se valida con el analizador léxico REAL (`tokenize` da exactamente un `Ident`), no con una regla propia que se desincronizaría. El orden al ejecutar —rangos → reglas del autor → salidas— es semántica y no preferencia: el rango es la promesa del campo y va primero, y las reglas antes que las salidas son lo que hace que el usuario lea el mensaje del autor en vez de una división por cero. El rango se comprueba sobre el valor EFECTIVO, así que un opcional ausente sin defecto que valga 0 con mínimo 1 también se rechaza
- [X] T090 [US3] `UpsertCalculator`, `GetCalculator`, `ListCalculators`, `DeleteCalculator` y `ValidateDefinition` en `services/simulator/src/grpc/service.rs` — los cinco sobre la pila real de transporte, con dobles que fallan en vez de devolver vacío (`tests/calculators.rs`). La validación se analiza ANTES de tocar la base: una calculadora a medio escribir no deja rastro. `ValidateDefinition` y `UpsertCalculator` comparten `analyze`, porque el contrato promete que informan de lo mismo y dos copias divergirían justo en la comprobación que se añadiera después. FR-051 se impone aquí y no en el repositorio: es una regla de la PETICIÓN —qué se pregunta— y no de la tabla. `GetCalculator` responde `NotFound` y no `PermissionDenied` ante una privada ajena, para no convertirse en un oráculo que confirma su existencia
- [X] T091 [US3] Ejecutar por `calculator_id` en `Compute`, conservando `calc_type` como camino de compatibilidad y validando rangos de entrada (FR-044), en `services/simulator/src/grpc/service.rs` — **cerrada, y con ella el bloqueo que arrastraba desde T020.** `compute_inner` despacha por los dos caminos: con `calculator_id` resuelve la definición, resuelve sus indicadores a la fecha de ejecución, la ejecuta y persiste con `calc_type = 'usuario'`; sin él sigue calculando con el código nativo y atribuye la fila a la semilla que lo reproduce. Lo que costó trabajo no fue ejecutar la definición sino **el tipo con el que se registra una semilla pedida por identificador**, que ninguna decisión cubría: D-26 justificó el sexto valor como «definida por el usuario», y el catálogo público ofrece las siete semillas y el ejecutor las pide así, de modo que `'usuario'` habría sido el caso más frecuente y el más falso. Se resolvió en **D-29** (`domain::dispatch::SEEDS` relaciona cada semilla con su tipo nativo) y la decisión deja la columna consistente con el historial que T020 ya rellenó. Se añade además la comprobación que el contrato pide y que nadie hacía —«exactamente uno de los dos debe venir relleno»—, en las dos direcciones: con los dos campos viene un `InvalidArgument` que dice que son excluyentes, y con ninguno otro que dice cuál falta. Antes, mandar los dos habría ejecutado uno de ellos en silencio, que es la misma clase de fallo silencioso que esta tarea vino a corregir. **Verificada contra la base real** por `tests/provenance_db.rs` (5 pruebas, `--ignored`) además de por las pruebas de contrato, que ahora incluyen la visibilidad de FR-051 sobre este camino —una privada ajena da `NotFound` y no deja rastro en el historial—. La dependencia de T101 quedó satisfecha en la misma unidad: `gmf` ya se puede ejecutar por identificador, que era el caso que la bloqueaba

### Semillas y regresión

- [X] T092 [US3] **Suite de regresión de las semillas** en `services/simulator/tests/seed_regression.rs`: 16 pruebas que ejecutan el MOTOR y el CÓDIGO NATIVO con las mismas entradas y exigen el mismo mapa de `Decimal`. Las tablas se GENERAN por producto cartesiano en vez de escribirse a mano: los bordes que importan son las COMBINACIONES —el plazo máximo con la tasa mínima— y una tabla escrita acaba cubriendo cada campo por separado, que es justo donde no hay nada que descubrir. Se compara contra las funciones y no contra `domain::dispatch`, que devuelve texto ya formateado: medir ahí mezclaría el cálculo con el formato y un fallo de formato se leería como un fallo de fórmula. Dos guardas contra el falso verde: cada prueba exige un mínimo de casos CALCULADOS —una suite en la que todo se rechaza pasa vacía— y una cota de casos incomparables, para que el conjunto donde no se puede comparar no crezca en silencio. **Sostiene SC-015 y FR-049, y el riesgo queda cerrado: las siete semillas reproducen las cinco calculadoras.** **Hallazgo: el código nativo ENTRA EN PÁNICO al desbordar.** `ahorro.rs:60` multiplica con `*` y no con `checked_mul`, así que con el plazo en su tope de 1200 y una tasa que `NUMERIC(9,6)` admite el producto no cabe en la mantisa de 96 bits y la tarea aborta, donde el usuario debería leer el parámetro que envió mal. El motor no lo hereda por esa vía —`eval.rs:176` sí usa `checked_mul`— pero **sí lo hereda por `cuota`/`vf_serie`**: T083 hizo que delegaran en `calculators::annuity` —decisión correcta, para que la suite no comparara el motor contra sí mismo— y `annuity.rs:74/80/104` multiplican con `*`, incumpliendo la documentación del propio módulo. Cifras: `ahorro` 3 casos en que solo aborta el nativo y 2 en que abortan los dos; `credito`, 2 compartidos; los otros cinco, ninguno. **No se corrige aquí a propósito**: cambiar la aritmética de referencia mientras se establece la suite debilitaría justo la evidencia que la suite existe para dar —ya no se sabría si las semillas reproducen el nativo de hoy o uno modificado—; va como cambio propio y esta suite dirá si algo se movió
- [X] T093 [P] [US3] Definiciones semilla `ahorro`, `credito`, `presupuesto`, `inversion` en `services/simulator/src/domain/seeds/generales.rs`, usando `pot` donde hoy se usa `checked_powu` — se escriben como `Draft` y las analiza el MISMO `Draft::parse` que la definición de un usuario: escritas como `Definition` directas, con los AST a mano, no pasarían por las comprobaciones de FR-046 y una semilla con dos campos homónimos se colaría por la puerta de atrás. Las sub-expresiones compartidas —el saldo y el total aportado de `ahorro`, la cuota de `credito`, el valor futuro de `inversion`— se escriben UNA vez como `macro_rules!` que `concat!` expande, y **ya entre paréntesis**: componer con `concat!` produce texto que se vuelve a analizar, así que sin ellos una sub-expresión como `a * b + c` insertada a la derecha de un `/` cambiaría de significado sin que nada fallara. Los montos negativos se aceptan igual que en el nativo —acotarlos sería corregir un comportamiento, y eso es una decisión de alcance y no una traducción—, y hay una prueba que lo fija para que no se pierda por descuido
- [X] T094 [P] [US3] Definiciones semilla `ea_a_mv`, `mv_a_ea` y `gmf` en `services/simulator/src/domain/seeds/colombia.rs` — `ea_a_mv` usa `potd` porque `colombia.rs:102` usa `checked_powd`, y la separación de D-16 no es estilística: `pot` **rechaza** el exponente decimal, así que sin `potd` esta calculadora no se puede escribir. `gmf` toma la UVT de `@UVT` en lugar de recibirla como parámetro, y la exención pasa del texto `"si"`/`"no"` a un entero `1`/`0` con rango `[0, 1]`, que es lo que un lenguaje sin texto puede expresar. **La guarda «el valor de la UVT debe ser mayor que cero» estuvo a punto de desaparecer**: el razonamiento cómodo era que un indicador no puede registrarse con valor no positivo y que el caso era inalcanzable, pero `financial_indicators_value_non_negative` admite el CERO, así que se conserva como regla `@UVT > 0` —sin ella, una UVT de cero daría ninguna exención a quien la pidió: una cifra equivocada presentada como buena—. Esa regla obliga además a que `compile()` analice contra un catálogo estático (`seeds::INDICATORS`) y no contra los indicadores que la propia semilla declara usar, que aceptaría una errata por construcción
- [X] T095 [US3] Sembrar en `dev/seed`, de forma idempotente, las siete definiciones semilla **y los indicadores del año en curso** (SMMLV, UVT, UVR, IPC, TASA_USURA) — los indicadores van aquí y no en una tarea de US4 porque `dev/seed` es un solo archivo y dos tareas paralelas sobre él se pisarían; sin ellos `@UVT` no resuelve y la prueba independiente de US4 no corre — **además debe repetir el relleno de T020** (`simulations.calculator_id`/`calculator_version` emparejando por nombre de semilla y, para `colombia_especifica`, por `inputs->>'operacion'`), porque la migración corre antes que el sembrado y sobre una base virgen no encuentra semilla que citar. **El sembrado NO es SQL en `dev/seed`**: una definición son tres columnas JSONB producidas por el analizador, así que escribirlas a mano sería mantener una segunda copia del AST —justo lo que el motor existe para impedir—. Lo hace un binario del Simulador (`src/bin/seed.rs`, sobre `repo::seeds.rs`) que `dev/seed` invoca con el entorno del contenedor, de modo que `DB_ADDR` sale del compose y el sembrado no puede apuntar a otra base que la que se migra. **La siembra CONVERGE y no solo inserta**: compara la definición almacenada con la compilada y, si difieren, añade una VERSIÓN NUEVA por el mismo camino que una edición de usuario. «No hagas nada si ya está» habría sido insuficiente y silencioso: con la definición cambiada en el código y la fila quieta, `Compute` por `calculator_id` ejecutaría el AST viejo mientras el binario tiene el nuevo, y nada fallaría. Los identificadores de las semillas son un bloque fijo (`…e001`…`…e007`) y no aleatorios, porque el relleno de T020 empareja por NOMBRE y una segunda siembra con identificadores nuevos dejaría el historial apuntando a la copia que ya nadie actualiza. **Aviso sobre los indicadores**: sus valores son de EJEMPLO y redondos a propósito —la fuente de verdad es `UpsertIndicator` (FR-060), y hay que cargar los oficiales antes de cualquier uso real—; sin `@UVT` `gmf` no puede calcular, que es por lo que se siembran. **EJECUTADO Y VERIFICADO contra PostgreSQL 16**, que es lo que faltaba: `dev/migrate up simulator` aplicó las cuatro migraciones —las tres de T018-T020 y la de D-26— y `dev/seed` sembró `7 creadas`, `5 indicadores`, `13493 simulaciones` ligadas. **Ejecutarlo encontró un fallo que leerlo no habría encontrado nunca**: el `docker exec` del sembrado pasaba por la traducción de rutas de MSYS, que convertía `/src/target/debug/seed` en `C:/Program Files/Git/src/...`, y el contenedor respondía «no such file or directory» sobre un binario que existía. Se corrigió usando `docker exec` sobre el id del contenedor con `MSYS_NO_PATHCONV=1` —el mismo patrón que ya usaba `psql_exec` y la misma trampa que `dev/migrate` documenta— y **no** poniendo la variable en `common.sh`, que rompería el `-f` de `compose` (comprobado: lo rompe). Idempotencia comprobada: la segunda ejecución da `0 creadas, 0 actualizadas, 7 sin cambios` y `0 indicadores`. Convergencia comprobada: cambiando el espaciado de una fórmula en el código, la resiembra da `1 actualizadas` y `presupuesto` pasa a versión 2 conservando `{1,2}`. **Y esa prueba corrigió una afirmación falsa mía**: yo había escrito que un cambio de solo espaciado NO crearía versión «porque se compara el AST y no el texto», y sí la crea — `OutputField::source` es parte de `Definition`. La comparación es sobre la definición ENTERA y es la elección conservadora: comparar de menos arriesga dejar un AST viejo en la base, comparar de más cuesta una fila de versión. Corregido en el comentario de `repo::seeds`

### Borde y frontend

- [X] T096 [US3] Rutas `/calculators`, `/calculators/validate`, `/calculators/{id}`, `/calculators/{id}/run` y `/me/calculators` en `services/api-gateway/internal/handler/routes.go`, con 422 que devuelve `errors[]` con `location`/`code`/`message` (FR-046) — **cerrada, las siete rutas.** `GET /calculators` (pública, solo publicadas: el filtro va en la consulta y no en un parámetro que el borde pudiera olvidar), `POST /calculators` (201), `PUT /calculators/{id}` (200, cita el identificador para que el Simulador versione en vez de crear otra), `GET /calculators/{id}`, `DELETE /calculators/{id}`, `POST /calculators/validate` y `GET /me/calculators`. **El 422 sale de validar antes de guardar**: `UpsertCalculator` responde a una definición que no analiza con un `InvalidArgument` cuyo mensaje ya ha aplanado la lista a un párrafo, y solo `ValidateDefinition` devuelve los problemas estructurados. Cuesta un análisis de más sobre un AST acotado a 64 nodos, y a cambio el autor recibe sus seis erratas de una vez. Se resuelve además el vocabulario de tipos de entrada en el borde (`monto`/`tasa`/`entero`), por la misma razón que el de `calc_type`. **`POST /calculators/{id}/run` necesitó un cambio de contrato que NINGUNA tarea contemplaba**: el contrato dice que recorre «la misma saga» que `/simulators/{calcType}/run` —y eso es lo que la audita, FR-025/D-03—, pero `orchestrator.SimulationRequest` no tenía `calculator_id` y este feature no trae delta del proto del Orquestador. Se añadió (`02b0832`, contrato y stubs en commit propio) y se propagó por los tres saltos (`83f27cf`), incluido que **los dos campos son excluyentes** en el paso de la saga: con `calculator_id` el `calc_type` viaja en su valor cero, de modo que un llamador que rellene los dos falla de forma visible. Verificación: 62 pruebas en el Gateway (13 nuevas), 8 de la saga (3 nuevas), `golangci-lint` con la configuración del CI en 0 incidencias en los dos servicios
- [ ] T097 [P] [US3] Constructor visual de calculadoras con validación en vivo contra `/calculators/validate`, y ejecutor de resultados, en `frontend/src/app/features/calculators/{builder,runner}/` — montos, tasas y resultados con `decimal.js` reutilizando `frontend/src/app/shared/decimal-str.ts` y `features/simulators/decimal-validators.ts`; **prohibido `number` nativo** (Principio VIII / FR-048)
- [ ] T098 [US3] Eliminar `services/simulator/src/calculators/` y redirigir el despacho a las definiciones semilla — **PARCIAL: la mitad que no depende del sembrado está hecha (`2798f01`), y la otra mitad está ORDENADA DESPUÉS de D-28 por una razón que la tarea no decía.** Hecho: `annuity` mudado a `src/domain/annuity.rs` y sus tres multiplicaciones pasadas a `checked_mul` (D-27). La mudanza no era cosmética —`domain/formula/functions.rs` importaba `crate::calculators::annuity` para implementar `cuota`, `vf_serie` y `tasa_periodica`, que son funciones del LENGUAJE, así que la capa de dominio dependía del código nativo que esta tarea viene a retirar: tal como estaba, borrar `src/calculators/` habría dejado al motor sin su aritmética—. La corrección de D-27 se supo que había surtido efecto porque la suite de regresión ACOTABA esos casos en vez de ignorarlos: en cuanto el código nativo dejó de abortar, la prueba falló sola. **Lo que falta**: redirigir el camino de compatibilidad a las definiciones semilla y borrar `ahorro.rs`, `credito.rs`, `presupuesto.rs` e `inversion.rs`. Sus entradas coinciden EXACTAMENTE con las de sus semillas —comprobado—, así que esa redirección no cambia lo que acepta ningún cliente; lo único que cambia son los textos de error, que los de la semilla son deliberadamente mejores, y los casos de desbordamiento, que dejan de ser un 500 por pánico. **`colombia.rs` NO se borra con ellos** (D-30). **Y el bloqueo, que es de orden y no de trabajo**: el despacho redirigido resuelve la definición DESDE LA BASE, así que sobre una base migrada y sin sembrar el Simulador se queda sin ninguna calculadora — la tarea quita el camino nativo y con él la única forma de calcular. En desarrollo `dev/seed` corre siempre; en producción el sembrado es un paso de despliegue que **D-28 dejó anotado como pendiente y no se ha escrito**. Por eso T098 va DESPUÉS de ese paso y no antes: al revés, la primera migración de producción sin sembrar dejaría el simulador entero caído

**Checkpoint**: US3 entregable (SC-015, SC-016, SC-017).

---

## Phase 6: User Story 4 — Indicadores financieros anuales (P2)

**Goal**: los indicadores viven en la plataforma con vigencia, las fórmulas los referencian
y el procedimiento anual avisa antes de que venzan.

**Independent Test**: cargar los indicadores de un año, ejecutar una calculadora que los
referencie y verificar la alerta al acercarse el vencimiento.

### Pruebas

- [ ] T099 [P] [US4] Prueba de que una vigencia solapada se rechaza **en la base** por la restricción de exclusión, no solo en la aplicación (FR-059), en `services/simulator/tests/indicators.rs` — **abierta.** La restricción existe y está verificada contra la base (ver T019), pero la prueba que la EJERCE desde el código no está escrita: hoy lo único que impide un solapamiento es el `EXCLUDE`, y nadie lo comprueba en cada ejecución de la suite. Es la mitad de FR-059 que no depende de la aplicación, y por eso merece su propia prueba
- [X] T100 [P] [US4] Prueba de que una simulación conserva el snapshot de indicadores y sigue explicándose tras cambiarlos (SC-019), en `services/simulator/tests/indicators.rs` — **el archivo es `tests/provenance_db.rs`**, no `tests/indicators.rs` como decía la tarea: las pruebas de T101/T103 viven juntas porque comparten andamiaje (conexión, siembra, limpieza) y separarlas lo duplicaría. La prueba es `cambiar_un_indicador_no_altera_las_simulaciones_que_ya_lo_usaron`, y comprueba la propiedad en los DOS sentidos a la vez, que es lo que la hace concluyente: el valor VIGENTE cambia —se siembra el del año siguiente con otro número y se verifica que la resolución de hoy devuelve el nuevo— y el valor GUARDADO no. Si el snapshot fuera una referencia en vez de una copia, la segunda aserción fallaría

### Implementación

- [X] T101 [P] [US4] Repositorio de indicadores con resolución del valor vigente por fecha en `services/simulator/src/repo/indicators.rs` — una consulta (`name = ANY($1) AND validity @> $2::date`) y un puerto. **Lo que costó decidir no fue la consulta sino el hueco**: la resolución devuelve lo que encuentra y calla sobre lo que no, porque las fórmulas evalúan de forma PEREZOSA —`si(meses > 0, @TASA_USURA * monto, 0)` no lee el indicador cuando `meses` es cero— y rechazar aquí castigaría ejecuciones que el evaluador habría completado sin tocarlo. El hueco se descubre donde se usa: `eval` nombra el indicador que faltó, y solo si de verdad llegó a leerlo. El valor se lee con `value::text` y no habilitando la integración `rust_decimal` de `sqlx`: `NUMERIC(20,6)` da `50000.000000` y `decimal_str::parse_numeric` lo convierte sin pasar por ningún tipo binario (Principio VIII)
- [X] T102 [US4] Resolución de indicadores durante la evaluación y construcción del snapshot en `services/simulator/src/domain/indicators.rs` (FR-057) — el módulo es pequeño a propósito: un [`Snapshot`] que envuelve los valores resueltos, los devuelve para el `Scope` y los serializa a `{nombre: cadena decimal}`. **La decisión que documenta es grabar los indicadores REFERENCIADOS y no los evaluados**: el evaluador es perezoso, así que averiguar cuáles se leyeron de verdad exigiría instrumentarlo, y el error de las dos opciones no cuesta lo mismo —grabar de más deja un valor que no influyó pero el resultado sigue siendo reproducible; grabar de menos rompe FR-058—. Se elige el error barato. La resolución NO se hace en el dominio: `snapshot_for` la pide al repositorio y el dominio sigue siendo probable sin base de datos
- [X] T103 [US4] Persistir `indicators_snapshot`, `calculator_id` y `calculator_version` en cada simulación, en `services/simulator/src/repo/simulations.rs` (FR-050, FR-058) — las tres columnas viajan en un tipo propio, [`Provenance`], y no en tres argumentos sueltos: describen UNA cosa y se escriben en el mismo `INSERT`, así que rellenar dos y olvidar el tercero no fallaría —`indicators_snapshot` tiene valor por defecto y `calculator_id` es anulable— y la fila quedaría sin procedencia en silencio. **Los dos caminos pueblan las tres columnas**, y con valores distintos que son igual de ciertos: el camino por definición graba el snapshot resuelto y `calculator_id`/`version` de ESA definición; el de compatibilidad graba `{}` —las cinco calculadoras nativas llevan sus constantes en el código y `gmf` recibe la UVT como ENTRADA, así que no leen ninguna fila de `financial_indicators`— y cita la semilla que reproduce el cálculo, como ya hizo la migración de T020
- [ ] T104 [US4] `UpsertIndicator`, `ListIndicators` y `GetIndicatorCalendarStatus` en `services/simulator/src/grpc/service.rs`
- [ ] T105 [US4] Barrido periódico del calendario de indicadores y publicación de `indicator.calendar_alert` e `indicator.updated` desde `services/orchestrator/internal/server/sweeper.go` — **el Simulador no es productor** (Principio V, research D-23)
- [ ] T106 [P] [US4] Plantilla de correo `indicator_calendar_alert` en `services/notification/src/email/templates/` con idempotencia por `event_id`
- [ ] T107 [US4] Rutas `/admin/indicators[/{id}]`, `/admin/indicators/status` e `/indicators/current` en `services/api-gateway/internal/handler/routes.go`, con 409 para solapamiento
- [ ] T108 [P] [US4] Pantalla de carga anual de indicadores con vigencias y estado del procedimiento en `frontend/src/app/features/admin/indicators/` — el valor del indicador se captura y transmite como `string` decimal con `decimal.js`; **prohibido `number` nativo** (Principio VIII / FR-056)
- [ ] T109 [US4] Advertencia visible antes de ejecutar una calculadora que dependa de indicadores sin vigencia, en `frontend/src/app/features/calculators/runner/` (FR-062)
- [ ] T110 [P] [US4] Mostrar `indicators_used` y `calculator_version` en el historial de simulaciones, en `frontend/src/app/features/simulators/history/` — los valores se formatean con `result-format.ts` sin convertirlos nunca a `number` (Principio VIII)

**Checkpoint**: US4 entregable (SC-019, SC-020).

---

## Phase 7: User Story 5 — Curaduría y publicación de calculadoras (P2)

**Goal**: ninguna calculadora llega al catálogo público sin aprobación de un coordinador
editorial distinto de su autor.

**Independent Test**: proponer una calculadora, aprobarla con un revisor distinto y
verificar que aparece en el catálogo público.

**Depende de**: US3.

### Pruebas

- [ ] T111 [P] [US5] Prueba de que el propio autor no puede aprobar su calculadora, verificada **tanto en la capa de aplicación como por la restricción de la base** (FR-053), en `services/simulator/tests/curation.rs`
- [ ] T112 [P] [US5] Prueba de que editar una calculadora publicada no altera la versión publicada hasta pasar de nuevo por revisión, en `services/simulator/tests/curation.rs`

### Implementación

- [ ] T113 [US5] Transiciones `privada → en_revision → publicada` y el retorno por rechazo con motivo, en `services/simulator/src/domain/`
- [ ] T114 [US5] `SubmitCalculatorForReview`, `ApproveCalculator` y `RejectCalculator` en `services/simulator/src/grpc/service.rs`
- [ ] T115 [US5] Publicar `calculator.published` desde `services/orchestrator/internal/server/` al aprobarse (Auditoría)
- [ ] T116 [US5] Rutas `/calculators/{id}/submit` y `/editorial/calculators[/{id}/{approve,reject}]` en `services/api-gateway/internal/handler/routes.go`, exigiendo `coordinador_editorial` y **no** `administrador` (FR-082)
- [ ] T117 [P] [US5] Bandeja de revisión de calculadoras para el coordinador en `frontend/src/app/features/editorial/review/`
- [ ] T118 [P] [US5] Acción "proponer para publicación" y visualización del motivo de rechazo en `frontend/src/app/features/calculators/builder/`
- [ ] T119 [P] [US5] Catálogo público de calculadoras en `frontend/src/app/features/calculators/catalog/`

**Checkpoint**: US5 entregable (SC-018).

---

## Phase 8: User Story 6 — Editor de contenido enriquecido con imágenes (P2)

**Goal**: el editor redacta con formato visual e inserta imágenes, y nada de lo que escriba
puede ejecutarse en el navegador del lector.

**Independent Test**: redactar un artículo con títulos, listas, énfasis y una imagen con
texto alternativo, publicarlo y verificar su presentación.

**Depende de**: US1 (desplegable de categorías).

### Pruebas

- [ ] T120 [P] [US6] Pruebas del validador de documento: nodo desconocido, marca desconocida, atributo no admitido, imagen sin `alt`, y `href` con esquema `javascript:` y `data:` — todas rechazadas al guardar, en `services/learning/test/articles/body-doc.validator.spec.ts`
- [ ] T121 [P] [US6] Prueba de que se rechaza un archivo que no es imagen aunque declare un `mime_type` admitido, y uno que excede 2 MB (FR-066), en `services/learning/test/images/images.service.spec.ts`
- [ ] T122 [P] [US6] Prueba de que la migración de `body` a `body_doc` no pierde texto y es reversible (FR-069), en `services/learning/test/migrations/body-doc.spec.ts`

### Implementación

- [ ] T123 [US6] Validador del vocabulario **cerrado** de research D-14 (nodos, marcas, atributos, esquemas de `href`), con validación positiva y rechazo por defecto, en `services/learning/src/articles/body-doc.validator.ts` — ver nota N-08
- [ ] T124 [US6] Persistir y devolver `body_doc` en creación, edición y lectura de versiones, en `services/learning/src/articles/`
- [ ] T125 [P] [US6] Repositorio de imágenes con direccionamiento por contenido (SHA-256) y deduplicación en `services/learning/src/images/images.repository.ts`
- [ ] T126 [US6] Servicio de imágenes: validación de bytes reales con `sharp`, lectura de dimensiones, cálculo del hash y tope de 2 MB, en `services/learning/src/images/images.service.ts`
- [ ] T127 [US6] `UploadArticleImage` y `GetArticleImage` en `services/learning/src/images/images.controller.ts`
- [ ] T128 [US6] Extracción y validación de las referencias a imágenes del documento al guardar, en `services/learning/src/articles/`
- [ ] T129 [US6] Ruta multiparte `POST /editorial/articles/{articleId}/images` con 413 y 415, en `services/api-gateway/internal/handler/media.go`
- [ ] T130 [US6] Ruta `GET /media/images/{imageId}` con `ETag` y `Cache-Control: public, max-age=31536000, immutable`, en `services/api-gateway/internal/handler/media.go` (correcto porque el id **es** el hash del contenido)
- [ ] T131 [US6] Editor TipTap con barra de herramientas y esquema restringido al vocabulario de D-14, en `frontend/src/app/features/editorial/editor/`, sustituyendo el `<textarea rows="8">` de `editor.component.html:35`
- [ ] T132 [US6] Nodo `imagen` con `alt` **obligatorio** y pie de foto opcional, e inserción con subida, en `frontend/src/app/features/editorial/editor/`
- [ ] T133 [US6] Render del documento **por componente Angular, sin `innerHTML` ni `bypassSecurityTrust*`**, en `frontend/src/app/features/learning/article/blocks/` (FR-068, nota N-08)
- [ ] T134 [P] [US6] Prueba e2e de que un documento con nodo o enlace no admitido se rechaza al guardar y nunca llega al lector, en `frontend/e2e/`
- [ ] T135 [US6] Migración emparejada que **elimina `article_versions.body`**, una vez verificado `body_doc` en un entorno real, en `services/learning/migrations/`

**Checkpoint**: US6 entregable (SC-021, SC-022).

---

## Phase 9: User Story 7 — Depuración de cuentas por el administrador (P2)

**Goal**: el administrador depura cuentas con registro y con 30 días para deshacer, sin
romper la auditoría ni los agregados.

**Independent Test**: marcar una cuenta, verificar que queda inaccesible pero reversible, y
comprobar el resultado al vencer el plazo.

### Pruebas

- [ ] T136 [P] [US7] Prueba de saga de la purga vencida con compensación en cada paso, en `services/orchestrator/internal/server/saga_purge_test.go`
- [ ] T137 [P] [US7] Prueba de que la reactivación dentro del plazo devuelve perfil, progreso e historial intactos, y que fuera del plazo falla, en `services/users/internal/server/purge_test.go`
- [ ] T138 [P] [US7] Prueba de que tras la anonimización los agregados de `article_stats` no varían (FR-079, SC-024), en `services/learning/test/`
- [ ] T139 [P] [US7] Prueba de que **ninguna columna conserva el correo original** tras anonimizar (FR-077), en `services/users/internal/server/anonymize_test.go`

### Implementación

- [ ] T140 [US7] `MarkForPurge` (fija `purge_due_at = now() + 30 días`, **no anonimiza**) y `ReactivateAccount` en `services/users/internal/server/purge.go`
- [ ] T141 [US7] `ListAccountsDueForPurge` y `SearchAccounts` en `services/users/internal/server/purge.go` y su persistencia en `services/users/internal/storer/storer_postgres.go`
- [ ] T142 [US7] Bloquear el acceso pleno en estado `pending_deletion` y exponer `account_status` en `AuthContext` y `Profile`, en `services/users/internal/server/`
- [ ] T143 [US7] Publicar `account.purge_scheduled` con **dos routing keys** —`.notify` con correo hacia Notificación y `.audit` sin correo hacia Auditoría— y `account.purge_cancelled`, en `services/users/internal/server/` (nota N-10)
- [ ] T144 [US7] Barrido de purgas vencidas que invoca `Users.ListAccountsDueForPurge` por gRPC y lanza la saga de anonimización existente, en `services/orchestrator/internal/server/sweeper.go` y `saga_purge.go` (research D-20)
- [ ] T145 [US7] Anonimización de la autoría en el Simulador: `owner_id` a NULL en las calculadoras **publicadas** del titular y borrado de las privadas, en `services/simulator/src/grpc/service.rs` (Edge Cases)
- [ ] T146 [P] [US7] Plantilla de correo `account_purge_scheduled` en `services/notification/src/email/templates/`
- [ ] T147 [US7] Rutas `/admin/accounts`, `/admin/accounts/{userId}/purge` y `/me/account/reactivate` en `services/api-gateway/internal/handler/routes.go`, con 410 si el plazo venció
- [ ] T148 [P] [US7] Pantalla de administración de cuentas y aviso de reactivación para el titular, en `frontend/src/app/features/admin/accounts/` y `frontend/src/app/features/profile/`

**Checkpoint**: US7 entregable (SC-023, SC-024).

---

## Phase 10: User Story 8 — Calculadoras ejecutables dentro de un artículo (P3)

**Goal**: el lector usa la calculadora sin salir del artículo y la ejecución cuenta en su
historial.

**Independent Test**: incrustar una calculadora publicada, ejecutarla como lector y
verificar que aparece en el historial de simulaciones.

**Depende de**: US3 y US6.

### Pruebas

- [ ] T149 [P] [US8] Prueba de que se rechaza incrustar una calculadora **no publicada** (FR-070), en `services/learning/test/articles/body-doc.validator.spec.ts`
- [ ] T150 [P] [US8] Prueba de que un artículo cuya calculadora dejó de estar publicada sigue siendo legible con un aviso (FR-072), en `frontend/e2e/`

### Implementación

- [ ] T151 [US8] Validar por **gRPC al Simulador** que el `calculator_id` referenciado está publicado, sin leer `simulator_db` (Principio III, research D-25), en `services/learning/src/articles/`
- [ ] T152 [US8] Nodo `calculadora` en el esquema del editor con selector de calculadoras publicadas y vista previa, en `frontend/src/app/features/editorial/editor/`
- [ ] T153 [US8] Componente de bloque de calculadora ejecutable en el lector, en `frontend/src/app/features/learning/article/blocks/` — reutiliza los validadores y el formateo decimal del ejecutor de T097; **prohibido `number` nativo** (Principio VIII)
- [ ] T154 [US8] Ejecutar por la **misma ruta** Gateway → Orquestador → Simulador, de modo que la ejecución quede en el historial y en la auditoría (FR-071), en `frontend/src/app/features/learning/article/blocks/`
- [ ] T155 [US8] Degradación a aviso cuando la calculadora deja de estar publicada, sin romper la lectura, en `frontend/src/app/features/learning/article/blocks/`
- [ ] T156 [P] [US8] Prueba e2e del recorrido completo: incrustar, publicar, ejecutar como lector y comprobar el historial, en `frontend/e2e/`

**Checkpoint**: US8 entregable.

---

## Phase 11: Polish & Cross-Cutting

> **Hallazgo (2026-09-16): el borde aplana sus PROPIOS errores, y no los registra.**
> Encontrado al implementar T096. `writeGRPCError` traduce todo error a un texto fijo por
> código, y el comentario que lo justifica habla de los mensajes de los **servicios internos**
> —«puede contener nombres de host, de tabla o el detalle del driver»—, que es una razón
> buena. Pero la rama de `errBadRequest` aplica la misma regla a los errores que el Gateway
> redacta a partir de la entrada del cliente, y ahí no protege de nada: no hay infraestructura
> que filtrar, solo la posición de un campo mal escrito. El efecto observable es que
> `POST /calculators` con `"type":"porcentaje"` responde «petición inválida» a secas, cuando el
> borde sabía que el problema estaba en `inputs[1].type`; lo mismo le pasa hoy a
> `calcTypeFromPath`, cuyo mensaje «tipo de cálculo desconocido: …» no llega a nadie. Y esa
> rama retorna **antes** del bloque de log, así que el detalle tampoco queda en el registro.
>
> No se resuelve aquí a propósito: cambiar qué mensajes cruzan el borde afecta a TODAS las
> rutas y tiene implicaciones de filtración que merecen su propia decisión —la misma clase de
> decisión que D-26 o D-29 y no un arreglo de paso—. Queda anotado como candidato a tarea
> propia, con el detalle en la nota de `TestAnUnknownInputTypeIsRejectedAtTheEdge`.

- [ ] T157 [P] Regla de lint que prohíba `innerHTML` y `bypassSecurityTrust*` en `frontend/src/app/features/learning/` — la verificación por `grep` del quickstart §6 promovida a barrera automática
- [ ] T158 [P] Extender la regla de análisis estático anti-punto-flotante a `services/simulator/src/domain/formula/` (Constitución §Calidad y Pruebas)
- [ ] T159 [P] Documentar la gramática del lenguaje de fórmulas, con ejemplos y la diferencia entre `pot` y `potd`, en `docs/`
- [ ] T160 [P] Ayuda contextual en el constructor que explique cuándo usar `pot` y cuándo `potd`, en `frontend/src/app/features/calculators/builder/`
- [ ] T161 Verificar los 14 criterios de éxito SC-013…SC-026 siguiendo `quickstart.md` §2–§8 sobre un entorno levantado con `dev/up`. Para **SC-026**, además: recorrer cada pantalla nueva solo con teclado, y cargarla con el bloqueo de dominios externos activado en el navegador para confirmar que tipografía e iconos siguen presentes (FR-085)
- [ ] T162 [P] Prueba de carga del endpoint de ejecución de calculadoras confirmando que el coste acotado del AST se sostiene, en `deploy/loadtest/`
- [ ] T163 [P] Verificar que `dev/build && dev/up && dev/migrate && dev/seed` deja el sistema funcionando **sin ningún paso manual** (Principio XII regla 4)
- [ ] T164 [P] Actualizar `README.md` con el rol `administrador` y el requisito de `BOOTSTRAP_ADMIN_EMAIL`
- [ ] T165 Re-evaluar el gate constitucional I–XII sobre el código ya escrito y anotar el resultado en `plan.md` §Constitution Check
- [ ] T166 [P] Revisar que las **13 migraciones** tienen `down` que revierte efectivamente (Principio XI regla 1), incluidas las tres con conversión de datos
- [ ] T167 [P] Comprobar en `dev/docker-compose.yaml` y en los `main` de cada servicio que ninguno abrió conexión nueva a Redis, y en `services/simulator/src/` que sigue sin publicar en RabbitMQ (Principios IV y V)
- [ ] T168 Ensayo de la migración completa sobre una copia de los datos del VPS del CTIC usando `deploy/vps/migrate`, midiendo duración y revisando el aviso de reescala aproximada de T015
- [ ] T169 [P] Actualizar `deploy/vps/README.md` con el procedimiento de despliegue de esta enmienda, incluido el orden de migraciones
- [ ] T170 [P] Regla de lint que prohíba el atributo `style="..."` en las plantillas de `frontend/src/app/features/{admin,calculators}/` y en los bloques de artículo — las 8 pantallas nuevas nacen sin deuda de estilo, que es la premisa de haber puesto la capa de componentes en la fase bloqueante (FR-083)
- [ ] T171 [P] Regla de análisis estático que prohíba `number`, `parseFloat` y `Number()` sobre montos, tasas y valores de indicador en `frontend/src/app/features/{calculators,admin/indicators,learning/article/blocks}/` — el Principio VIII se vigilaba en el backend (T078, T158) pero no en el frontend, y este feature añade ahí la superficie nueva de captura de dinero

---

## Dependencies

### Entre fases

```text
Phase 1 (Setup) ──> Phase 2 (Foundational) ──┬──> Phase 3  US1  (P1)
                                             ├──> Phase 4  US2  (P1)
                                             ├──> Phase 5  US3  (P1)
                                             ├──> Phase 6  US4  (P2)
                                             ├──> Phase 9  US7  (P2)
                                             │
                                    US3 ─────┴──> Phase 7  US5  (P2)
                                    US1 ─────────> Phase 8  US6  (P2)
                              US3 + US6 ─────────> Phase 10 US8  (P3)

                                       todas ────> Phase 11 (Polish)
```

### Entre historias

| Historia | Depende de | Por qué |
|----------|-----------|---------|
| US1, US2, US3, US4, US7 | solo la fase Foundational | Independientes entre sí en funcionalidad |
| US4 | T095 (de US3) **solo para datos de prueba** | La siembra de indicadores vive en `dev/seed`, que es un único archivo. Es dependencia de *fixture*, no funcional: US4 se implementa y se despliega sin US3 |
| US5 | US3 | No hay nada que curar sin constructor |
| US6 | US1 | El editor necesita el desplegable de categorías |
| US8 | US3, US6 | Necesita calculadoras publicadas y bloques en el cuerpo |

### Dependencias críticas dentro de una fase

- **T012 después de T011**: no se puede referenciar `categories` antes de crearla.
- **T015 después de T013**: la reescala de `score` usa la misma `Σ weight` que la de `pass_threshold`.
- **T035…T046 después de T032**: el barril y la regla de adherencia primero; si no, cada
  componente se escribe con una convención distinta.
- **Toda tarea de UI de las historias después de T048**: las 8 pantallas nuevas se construyen
  sobre `shared/ui`. Es la dependencia que evita rehacerlas en el feature 003.
- **T098 después de T092**: el código nativo no se borra hasta que la regresión pase. Es la
  única dependencia del plan que protege un requisito de alcance y no solo un orden técnico.
- **T135 después de T124**: `body` no se elimina hasta que `body_doc` esté en uso real.
- **T145 después de T088**: la anonimización de autoría necesita el repositorio de calculadoras.

---

## Parallel Execution Examples

**Fase 1** — T001, T002, T003 y T005 en paralelo (contratos distintos); T004 en serie porque
el OpenAPI toca rutas de los tres. T006 después de todos.

**Fase 2** — tres frentes en paralelo: las migraciones de `simulator_db` (T018, T019), las de
`users_db` (T021, T022) y **toda la capa de componentes (T032–T048)**, que no toca backend en
absoluto y puede ir en paralelo desde el primer día. Dentro de `learning_db`, T011 · T014 ·
T016 · T017 son paralelas; T012, T013, T015 son secuenciales. Dentro de la capa de
componentes, T035…T046 son doce tareas paralelas una vez cerrado T032.

**Fase 5** — T075…T078 (pruebas) en paralelo entre sí; T079 y T080 en paralelo; T081…T086 en
serie sobre los mismos archivos. T093 y T094 en paralelo una vez el motor compila.

**Entre historias** — con la fase Foundational cerrada, cuatro personas pueden tomar US1,
US2, US3 y US7 a la vez sin pisarse: tocan servicios distintos.

---

## Implementation Strategy

### MVP sugerido

**US1 + US2** (ambas P1, ambas independientes, ambas de riesgo bajo). Juntas entregan el
catálogo administrable y la randomización de cuestionarios, que son los dos cambios que el
usuario final nota de inmediato, y no dependen del motor de fórmulas.

**US3 en paralelo desde el principio**, porque es la de mayor riesgo y la que más trabajo
concentra: conviene que T092 se ejecute pronto, ya que un fallo ahí es el único escenario
que obliga a renegociar alcance.

### Entrega incremental

1. **Incremento 1** — Fases 1 y 2. Casi nada visible en producto, pero desbloquea todo.
   Incluye el ensayo de migración (T168 puede adelantarse aquí) y **la capa de componentes,
   que sí es visible**: la galería de T048 es la primera prueba real de que el design system
   se ve como los kits. Conviene enseñarla antes de seguir.
2. **Incremento 2** — US1 + US2. Verificable con `quickstart.md` §2 y §3.
3. **Incremento 3** — US3 + US5. El constructor con su curaduría. **Puerta de calidad: T092**.
4. **Incremento 4** — US4 + US7. Indicadores y depuración de cuentas; ambas cierran
   cumplimiento (procedimiento anual y Ley 1581).
5. **Incremento 5** — US6 + US8. Editor enriquecido y calculadora incrustada.
6. **Incremento 6** — Fase 11.

### Relación con el feature 003 (rediseño de las 19 pantallas existentes)

Este feature aporta **solo la capa de componentes** (T032–T048), porque sus 8 pantallas
nuevas la necesitan para no nacer con deuda. La migración de las 19 pantallas ya existentes
—auth, catálogo, artículo, cuestionario, progreso, simuladores, editorial, perfil y
notificaciones— siguiendo los 5 UI kits de `design/ui_kits/` es el feature **003**, que se
especifica aparte y se implementa después. El login que motivó esta decisión (panel de marca
en degradado, "recordarme", divisor "o continúa con", botón OAuth2 · PKCE) pertenece a 003;
lo que 002 entrega es el `Button`, el `Input` y el `Checkbox` sobre los que 003 lo construirá.

### Nota sobre el orden de despliegue

Los cambios de comportamiento en `POST /quizzes/{quizId}/attempts` (exige `session_id`) y en
el cuerpo de los artículos (`body_doc`) **no son compatibles hacia atrás con el frontend
actual**. El despliegue de cada incremento lleva backend y frontend juntos; no se despliega
el backend de US2 con el frontend anterior.
