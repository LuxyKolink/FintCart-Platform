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

> **Regla de la constitución (§Definición de Contratos)**: los stubs generados se commitean
> y se regeneran **en un commit separado** del cambio de lógica. T006 es ese commit.

- [ ] T001 [P] Aplicar el delta de Aprendizaje a `contracts/proto/fintcart/learning/v1/learning.proto` (RPC de categorías, `StartQuizSession`, imágenes; campos `category_id`, `body_doc`, `questions_to_serve`, `session_id`, `served_question_ids`) según `specs/002-calculator-builder-content-admin/contracts/proto/learning-delta.proto`
- [ ] T002 [P] Aplicar el delta del Simulador a `contracts/proto/fintcart/simulator/v1/simulator.proto` (constructor, curaduría, indicadores; campos nuevos de `ComputeRequest`/`ComputeResponse`/`ListHistoryResponse.Entry`) según `contracts/proto/simulator-delta.proto`
- [ ] T003 [P] Aplicar el delta de Usuarios a `contracts/proto/fintcart/users/v1/users.proto` (`MarkForPurge`, `ReactivateAccount`, `ListAccountsDueForPurge`, `AssignRole`, `RevokeRole`, `SearchAccounts`, `account_status` en `AuthContext`/`Profile`) según `contracts/proto/users-delta.proto`
- [ ] T004 Aplicar el delta REST a `contracts/openapi/gateway.yaml` (~20 rutas nuevas y los cambios de comportamiento en `/quizzes/{quizId}/attempts`, `/editorial/**`, `/catalog/articles`, `/simulators/history`, `/me/profile`) según `contracts/openapi/gateway-delta.yaml`
- [ ] T005 [P] Aplicar el delta de eventos a `contracts/events/events-catalog.md` (6 eventos nuevos y la nota de enrutamiento de `account.purge_scheduled` con dos routing keys) según `contracts/events/events-catalog-delta.md`
- [ ] T006 Regenerar y versionar los stubs de los cinco stacks con `contracts/generate.sh`, **en un commit propio sin cambios de lógica** (Constitución §Definición de Contratos)
- [ ] T007 [P] Declarar `BOOTSTRAP_ADMIN_EMAIL`, `PURGE_SWEEP_INTERVAL` e `INDICATOR_SWEEP_INTERVAL` en `dev/docker-compose.yaml` (Principio X: configuración solo por entorno)
- [ ] T008 [P] Declarar las mismas tres variables en `deploy/vps/compose.app.yaml` y documentarlas en `deploy/vps/README.md`
- [ ] T009 [P] Añadir `sharp` a `services/learning/package.json` para validar que los bytes recibidos son realmente la imagen que declara su `mime_type` (FR-066)
- [ ] T010 [P] Añadir a `frontend/package.json`: `@tiptap/core`, `@tiptap/starter-kit` y `@tiptap/pm` (editor enriquecido, research D-24), `lucide-angular` (iconos) y `@fontsource/ibm-plex-mono` (fuente de cifras en COP) — las dos últimas sustituyen dependencias de CDN por dependencias del bundle

---

## Phase 2: Foundational — Migraciones, rol, autorización y capa de componentes

**Purpose**: esquema, autorización y capa de componentes de UI sin los cuales ninguna
historia puede empezar.

**⚠️ CRÍTICO**: ninguna historia arranca hasta terminar esta fase.

> Las tres migraciones con **conversión de datos** (T013, T015, T017) son el mayor riesgo
> silencioso del feature. Cada una es transaccional y respeta el orden poblar → restringir;
> el orden inverso deja filas inválidas a medio camino.

### Migraciones de `learning_db`

- [ ] T011 [P] Migración emparejada `categories` (nombre, slug, descripción, `position`, `active`, índices únicos parciales sobre activas) en `services/learning/migrations/`
- [ ] T012 Migración emparejada que añade `articles.category_id` **anulable**, la puebla normalizando los valores de `articles.category`, completa hasta 5 categorías si hicieran falta (SC-009), y **solo entonces** impone `NOT NULL` + FK y elimina `category`, en `services/learning/migrations/`
- [ ] T013 Migración emparejada `quizzes.questions_to_serve` (default 5) y reescala `pass_threshold := 100 * pass_threshold / Σ weight`, reemplazando el CHECK por el rango 0–100, en `services/learning/migrations/`
- [ ] T014 [P] Migración emparejada `quiz_sessions` (`served` JSONB, `expires_at`, `consumed_at`, índices de barrido) en `services/learning/migrations/`
- [ ] T015 Migración emparejada que añade `quiz_attempts.session_id` y `served_snapshot`, reescala `score := 100 * score / Σ weight`, reemplaza el CHECK por el rango 0–100, y **emite el recuento de cuestionarios cuyo banco cambió tras su primer intento** (research D-18), en `services/learning/migrations/`
- [ ] T016 [P] Migración emparejada que añade `article_versions.body_doc JSONB` y lo puebla envolviendo cada `body` en párrafos; **`body` NO se elimina aquí** (research D-14), en `services/learning/migrations/`
- [ ] T017 [P] Migración emparejada `article_images` (PK = SHA-256 hex, `BYTEA` con `STORAGE EXTERNAL`, CHECK de mime y de tope de 2 MB) en `services/learning/migrations/`

### Migraciones de `simulator_db`

- [ ] T018 [P] Migración emparejada `calculators` + `calculator_definitions` con los CHECK de `data-model.md` §2.1–2.2, incluido `calculators_builtin_has_no_owner` como **implicación** y no equivalencia, en `services/simulator/migrations/`
- [ ] T019 [P] Migración emparejada `financial_indicators` con `CREATE EXTENSION btree_gist` y `EXCLUDE USING gist (name WITH =, validity WITH &&)` para FR-059, en `services/simulator/migrations/`
- [ ] T020 Migración emparejada que añade `simulations.calculator_id`, `calculator_version` e `indicators_snapshot`, rellenando las filas históricas con la semilla correspondiente a su `calc_type` y snapshot vacío, en `services/simulator/migrations/`

### Migraciones de `users_db`

- [ ] T021 [P] Migración emparejada que amplía `profiles_account_status_valid` con `pending_deletion`, añade `purge_due_at` y `purge_requested_by`, y **sustituye `profiles_email_active_uniq` por `profiles_email_reserved_uniq` sobre `('active','pending_deletion')`** — es el cambio del que depende FR-074, en `services/users/migrations/`
- [ ] T022 [P] Migración emparejada que amplía `roles_assignment_role_valid` con `administrador` en `services/users/migrations/`

### Pruebas de migración

- [ ] T023 [P] Prueba de la reescala de calificaciones sobre un cuestionario cuyo banco cambió tras el primer intento, verificando que la conversión se aplica y que el aviso de aproximación se emite, en `services/learning/test/migrations/rescale.spec.ts`
- [ ] T024 [P] Prueba de la migración de categorías: ningún artículo queda con `category_id` nulo y los duplicados por tildes o mayúsculas colapsan en una sola categoría, en `services/learning/test/migrations/categories.spec.ts`
- [ ] T025 [P] Prueba de que la reserva de correo rechaza un registro con el correo de una cuenta en `pending_deletion` y lo acepta tras la anonimización, en `services/users/internal/storer/storer_postgres_test.go`

### Rol `administrador` y autorización

- [ ] T026 Promoción idempotente a `administrador` de la cuenta indicada por `BOOTSTRAP_ADMIN_EMAIL` al arrancar, en `services/users/cmd/users/main.go` — **no se siembra en migración** (research D-21)
- [ ] T027 Implementar `AssignRole` y `RevokeRole` en `services/users/internal/server/roles.go` y su persistencia en `services/users/internal/storer/storer_postgres.go`
- [ ] T028 [P] Exponer `AssignRole`/`RevokeRole` en `services/users/internal/handler/handler.go` y declararlos en `services/users/internal/handler/types.go`
- [ ] T029 Incluir `administrador` en el conjunto de roles emitido en los claims del JWT, en `services/auth-server/internal/server/`
- [ ] T030 Middleware `requireRole("administrador")` en `services/api-gateway/internal/handler/middleware.go` y su aplicación a `/admin/**` en `routes.go` (FR-081: verificación en el borde, no ocultando la interfaz)
- [ ] T031 [P] Pruebas del middleware: rol ausente → 403; `coordinador_editorial` NO accede a `/admin/**` (FR-082); administrador NO accede a `/editorial/calculators/**`, en `services/api-gateway/internal/handler/middleware_test.go`

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

- [ ] T049 [P] [US1] Prueba de contrato gRPC de `CreateCategory`, `UpdateCategory`, `DeactivateCategory` y `ListCategories` en `services/learning/test/contract/categories.contract.spec.ts`
- [ ] T050 [P] [US1] Prueba de persistencia contra driver SQL simulado del repositorio de categorías (sentencia emitida y mapeo de filas) en `services/learning/test/categories/categories.repository.spec.ts`

### Implementación

- [ ] T051 [P] [US1] Tipos de fila y mapeo de categoría en `services/learning/src/categories/category.types.ts` y `category.mapping.ts` (DTO ≠ dominio ≠ fila, Principio IX)
- [ ] T052 [US1] Repositorio de categorías en `services/learning/src/categories/categories.repository.ts`, incluida la consulta de recuento de artículos publicados que exige FR-035
- [ ] T053 [US1] Servicio de categorías en `services/learning/src/categories/categories.service.ts`: alta, edición, reordenamiento y desactivación con rechazo si hay artículos publicados, devolviendo el recuento en el error
- [ ] T054 [US1] Controlador gRPC de categorías en `services/learning/src/categories/categories.controller.ts`
- [ ] T055 [US1] Validar `category_id` contra el catálogo en la creación y edición de borradores, en `services/learning/src/articles/` (FR-034)
- [ ] T056 [US1] Publicar `category.deactivated` al desactivar, en `services/learning/src/events/` (consumidor: solo Auditoría)
- [ ] T057 [US1] Rutas `/catalog/categories` y `/admin/categories[/{categoryId}]` en `services/api-gateway/internal/handler/routes.go`, con traducción del rechazo por artículos publicados a 409 con `published_count`
- [ ] T058 [P] [US1] Pantalla de administración de categorías (alta, edición, reordenamiento, desactivación) en `frontend/src/app/features/admin/categories/`
- [ ] T059 [US1] Sustituir el `<input>` de texto libre por un `<select>` alimentado por el catálogo en `frontend/src/app/features/editorial/editor/editor.component.html` (hoy es texto libre en la línea 31)
- [ ] T060 [P] [US1] Filtro por categoría del catálogo público en `frontend/src/app/features/learning/catalog/`

**Checkpoint**: US1 entregable y verificable de forma independiente (SC-025).

---

## Phase 4: User Story 2 — Cuestionarios con preguntas aleatorias (P1)

**Goal**: cada intento sirve N preguntas al azar con opciones barajadas, se califica sobre
100 y solo acepta respuestas de la sesión emitida.

**Independent Test**: cargar un cuestionario con más preguntas que su N, ejecutarlo dos
veces y comparar conjuntos servidos y calificaciones.

### Pruebas

- [ ] T061 [P] [US2] Prueba de contrato gRPC de `StartQuizSession` verificando que devuelve exactamente `questions_to_serve` preguntas y **sin** la clave correcta, en `services/learning/test/contract/quiz-session.contract.spec.ts`
- [ ] T062 [P] [US2] Prueba de que dos sesiones consecutivas del mismo cuestionario difieren en conjunto de preguntas y en orden de opciones (SC-013), en `services/learning/test/quizzes/sampling.spec.ts`
- [ ] T063 [P] [US2] Prueba de que calificar con una pregunta no servida, con sesión vencida o con sesión ya consumida falla en vez de calificar (FR-040, FR-042), en `services/learning/test/quizzes/grading.spec.ts`
- [ ] T064 [P] [US2] Prueba de que un banco con menos preguntas que N sirve todas sin error (FR-038), en `services/learning/test/quizzes/sampling.spec.ts`

### Implementación

- [ ] T065 [P] [US2] Repositorio de sesiones en `services/learning/src/quizzes/sessions.repository.ts` (alta, lectura por id, marcado de consumo, barrido de vencidas)
- [ ] T066 [US2] Muestreo aleatorio de N preguntas y barajado de opciones en `services/learning/src/quizzes/session.service.ts`, persistiendo **ambos órdenes** en `served` (research D-17)
- [ ] T067 [US2] `StartQuizSession` en `services/learning/src/quizzes/quizzes.controller.ts`, devolviendo las preguntas sin `correct_key`
- [ ] T068 [US2] Calificación normalizada `100 × peso_acertado / peso_servido` y rechazo de respuestas fuera de la sesión, en `services/learning/src/grading/grading.service.ts` (FR-040, FR-041)
- [ ] T069 [US2] Copiar `served` a `quiz_attempts.served_snapshot` al calificar — el historial no puede depender de una sesión que se purga (nota N-07), en `services/learning/src/grading/`
- [ ] T070 [US2] Añadir `questions_to_serve` a `UpsertQuiz` y validarlo (> 0) en `services/learning/src/quizzes/quizzes.service.ts` (FR-037)
- [ ] T071 [US2] Barrido de sesiones vencidas en el proceso periódico existente de `services/learning/src/`
- [ ] T072 [US2] Ruta `POST /quizzes/{quizId}/session` y exigencia de `session_id` en `POST /quizzes/{quizId}/attempts` (409 si es inválida) en `services/api-gateway/internal/handler/routes.go`
- [ ] T073 [US2] Adaptar el flujo del cuestionario a la sesión en `frontend/src/app/features/learning/quiz/`, propagando `session_id` al enviar
- [ ] T074 [P] [US2] Campo "preguntas a mostrar" en el editor de cuestionarios en `frontend/src/app/features/editorial/editor/`

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

- [ ] T075 [P] [US3] Pruebas del analizador: campo inexistente, expresión mal formada, función desconocida, indicador desconocido, exponente no entero en `pot`, límite de nodos y de profundidad — cada una con su `code` de `DefinitionError`, en `services/simulator/tests/formula_parser.rs`
- [ ] T076 [P] [US3] Pruebas del evaluador: división por cero, desbordamiento y valor no representable producen error de dominio explícito y no pánico, en `services/simulator/tests/formula_eval.rs`
- [ ] T077 [P] [US3] Pruebas de las primitivas financieras contra los valores de `annuity.rs`, incluido el caso `i = 0` de `vf_serie`, en `services/simulator/tests/formula_functions.rs`
- [ ] T078 [P] [US3] Prueba de que **ningún camino del motor usa `f32`/`f64`** (Principio VIII), reforzada con la regla de clippy ya existente, en `services/simulator/tests/no_float.rs`

### Motor de fórmulas

- [ ] T079 [P] [US3] Nodos del AST, cerrados y serializables a JSONB, en `services/simulator/src/domain/formula/ast.rs`
- [ ] T080 [P] [US3] Analizador léxico en `services/simulator/src/domain/formula/lexer.rs`
- [ ] T081 [US3] Analizador sintáctico texto → AST con precedencia de operadores, `si(...)` y llamadas de función, en `services/simulator/src/domain/formula/parser.rs`
- [ ] T082 [US3] Límites de complejidad (≤ 64 nodos, profundidad ≤ 16, ≤ 20 entradas, ≤ 10 salidas) en `services/simulator/src/domain/formula/limits.rs`
- [ ] T083 [US3] Tabla de funciones en `services/simulator/src/domain/formula/functions.rs`: `pot` (entero, `checked_powu`, **rechaza exponente no entero**), `potd` (decimal, `checked_powd`), `redondear`, `redondear_dinero`, `min`, `max`, `abs`, `cuota`, `vf_serie`, `tasa_periodica`, `presente` — ver nota N-09
- [ ] T084 [US3] Evaluador del AST sobre `Decimal` con errores de dominio explícitos, en `services/simulator/src/domain/formula/eval.rs`
- [ ] T085 [US3] Resolución de variables: campos de entrada e indicadores `@NOMBRE` en espacios de nombres separados, en `services/simulator/src/domain/formula/eval.rs`
- [ ] T086 [US3] Extracción de `indicators_used` recorriendo el AST al guardar, en `services/simulator/src/domain/formula/ast.rs`

### Definiciones y persistencia

- [ ] T087 [P] [US3] Tipos de fila y mapeo de calculadora y definición en `services/simulator/src/repo/calculators.rs` y `services/simulator/src/grpc/mapping.rs` (conversión `string` decimal ↔ `Decimal` solo aquí, Principio IX)
- [ ] T088 [US3] Repositorio de calculadoras y definiciones versionadas (una fila nueva por edición, nunca `UPDATE`) en `services/simulator/src/repo/calculators.rs`
- [ ] T089 [US3] Validación completa de definición y evaluación de `validations` antes que `outputs`, con soporte de salidas condicionales (`when`), en `services/simulator/src/domain/`
- [ ] T090 [US3] `UpsertCalculator`, `GetCalculator`, `ListCalculators`, `DeleteCalculator` y `ValidateDefinition` en `services/simulator/src/grpc/service.rs`
- [ ] T091 [US3] Ejecutar por `calculator_id` en `Compute`, conservando `calc_type` como camino de compatibilidad y validando rangos de entrada (FR-044), en `services/simulator/src/grpc/service.rs`

### Semillas y regresión

- [ ] T092 [US3] **Suite de regresión de las semillas** en `services/simulator/tests/seed_regression.rs`: compara, para cada una de las siete definiciones y sobre sus rangos de uso y casos de borde numérico, el resultado del motor contra los valores del código nativo actual. **Sostiene SC-015 y FR-049; si falla, el alcance se renegocia antes de seguir**
- [ ] T093 [P] [US3] Definiciones semilla `ahorro`, `credito`, `presupuesto`, `inversion` en `services/simulator/src/domain/seeds/`, usando `pot` donde hoy se usa `checked_powu`
- [ ] T094 [P] [US3] Definiciones semilla `ea_a_mv`, `mv_a_ea` y `gmf` en `services/simulator/src/domain/seeds/` — `ea_a_mv` usa `potd`; `gmf` usa `si(...)` con el tramo exento sobre `@UVT` en lugar de la constante cableada de `colombia.rs:53` (research D-16)
- [ ] T095 [US3] Sembrar en `dev/seed`, de forma idempotente, las siete definiciones semilla **y los indicadores del año en curso** (SMMLV, UVT, UVR, IPC, TASA_USURA) — los indicadores van aquí y no en una tarea de US4 porque `dev/seed` es un solo archivo y dos tareas paralelas sobre él se pisarían; sin ellos `@UVT` no resuelve y la prueba independiente de US4 no corre

### Borde y frontend

- [ ] T096 [US3] Rutas `/calculators`, `/calculators/validate`, `/calculators/{id}`, `/calculators/{id}/run` y `/me/calculators` en `services/api-gateway/internal/handler/routes.go`, con 422 que devuelve `errors[]` con `location`/`code`/`message` (FR-046)
- [ ] T097 [P] [US3] Constructor visual de calculadoras con validación en vivo contra `/calculators/validate`, y ejecutor de resultados, en `frontend/src/app/features/calculators/{builder,runner}/` — montos, tasas y resultados con `decimal.js` reutilizando `frontend/src/app/shared/decimal-str.ts` y `features/simulators/decimal-validators.ts`; **prohibido `number` nativo** (Principio VIII / FR-048)
- [ ] T098 [US3] Eliminar `services/simulator/src/calculators/` y redirigir el despacho a las definiciones semilla — **solo después de que T092 pase en verde**

**Checkpoint**: US3 entregable (SC-015, SC-016, SC-017).

---

## Phase 6: User Story 4 — Indicadores financieros anuales (P2)

**Goal**: los indicadores viven en la plataforma con vigencia, las fórmulas los referencian
y el procedimiento anual avisa antes de que venzan.

**Independent Test**: cargar los indicadores de un año, ejecutar una calculadora que los
referencie y verificar la alerta al acercarse el vencimiento.

### Pruebas

- [ ] T099 [P] [US4] Prueba de que una vigencia solapada se rechaza **en la base** por la restricción de exclusión, no solo en la aplicación (FR-059), en `services/simulator/tests/indicators.rs`
- [ ] T100 [P] [US4] Prueba de que una simulación conserva el snapshot de indicadores y sigue explicándose tras cambiarlos (SC-019), en `services/simulator/tests/indicators.rs`

### Implementación

- [ ] T101 [P] [US4] Repositorio de indicadores con resolución del valor vigente por fecha en `services/simulator/src/repo/indicators.rs`
- [ ] T102 [US4] Resolución de indicadores durante la evaluación y construcción del snapshot en `services/simulator/src/domain/indicators.rs` (FR-057)
- [ ] T103 [US4] Persistir `indicators_snapshot`, `calculator_id` y `calculator_version` en cada simulación, en `services/simulator/src/repo/simulations.rs` (FR-050, FR-058)
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
