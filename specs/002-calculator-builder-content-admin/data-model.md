# Phase 1 — Data Model: Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido

**Feature**: `002-calculator-builder-content-admin` | **Fecha**: 2026-08-26

**Entrada**: [spec.md](./spec.md) §Key Entities · [research.md](./research.md) D-13…D-25

Este documento describe **deltas** sobre el modelo de `001-fintcart-platform`. Cada tabla
pertenece a un único servicio (Principio III); no existe ninguna clave foránea que cruce
bases de datos — las referencias entre servicios son identificadores opacos resueltos por
gRPC.

**Principio VIII (NON-NEGOTIABLE)**: todo importe, tasa, peso, umbral y valor de indicador
es `NUMERIC`. `REAL`, `DOUBLE PRECISION` y `FLOAT` están prohibidos en todas las tablas de
este documento.

---

## 1. `learning_db` — Servicio de Aprendizaje

### 1.1 `categories` *(nueva — FR-032…FR-036)*

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `UUID PK` | `gen_random_uuid()` |
| `name` | `TEXT NOT NULL` | único entre categorías activas |
| `slug` | `TEXT NOT NULL UNIQUE` | identificador legible para rutas y filtros |
| `description` | `TEXT NOT NULL DEFAULT ''` | |
| `position` | `INTEGER NOT NULL` | orden de visualización |
| `active` | `BOOLEAN NOT NULL DEFAULT TRUE` | desactivación lógica |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Restricciones:

- `categories_name_not_blank CHECK (length(btrim(name)) > 0)`
- `categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`
- `UNIQUE INDEX categories_name_active_uniq ON (lower(name)) WHERE active` — permite reusar
  un nombre solo si la categoría homónima está desactivada.
- `UNIQUE INDEX categories_position_active_uniq ON (position) WHERE active`

**Nunca se borran físicamente** (D-19): un artículo archivado cuya categoría desapareciera
dejaría de ser reconstruible, contra FR-013.

### 1.2 `articles` *(modificada)*

| Cambio | Detalle |
|--------|---------|
| ‑ `category TEXT` | se elimina tras la migración |
| + `category_id UUID NOT NULL REFERENCES categories(id)` | FR-034 |
| índice | `articles_category_idx` se redefine sobre `category_id` |

**Migración (FR-036)**, en este orden dentro de una única transacción:

1. Crear `categories`.
2. Poblarla con los valores distintos de `articles.category` normalizados (recorte, colapso
   de espacios, comparación *case/accent-insensitive*), conservando el original como `name`.
3. Completar hasta cinco categorías si el catálogo real trajera menos (SC-009).
4. Añadir `category_id` **anulable**, rellenarla por correspondencia con el valor
   normalizado.
5. Solo entonces imponer `NOT NULL` y la clave foránea; eliminar `category`.

Invertir el orden dejaría artículos sin categoría y haría fallar la migración a medias.

### 1.3 `article_versions` *(modificada — FR-063…FR-069)*

| Cambio | Detalle |
|--------|---------|
| + `body_doc JSONB NOT NULL` | documento de bloques de D-14 |
| ‑ `body TEXT` | se elimina en una **segunda** migración, ya verificada la primera |

Restricción: `article_versions_body_doc_is_doc CHECK (body_doc->>'tipo' = 'doc')`.

La validación completa del vocabulario cerrado (nodos, marcas, esquemas de `href`) es
responsabilidad de la capa de aplicación de Aprendizaje al guardar; el `CHECK` solo
garantiza que la raíz sea un documento. Motivo: expresar el esquema completo en SQL sería
ilegible y quedaría desincronizado del validador real.

**Migración (FR-069)**: cada `body` se envuelve como documento de párrafos, partiendo por
líneas en blanco. Sin pérdida y reversible.

### 1.4 `article_images` *(nueva — FR-064…FR-067, D-13)*

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `TEXT PK` | **SHA-256 hexadecimal del contenido** (direccionamiento por contenido) |
| `article_id` | `UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE` | ámbito de propiedad |
| `mime_type` | `TEXT NOT NULL` | |
| `byte_size` | `INTEGER NOT NULL` | |
| `width`, `height` | `INTEGER NOT NULL` | para reservar el espacio al renderizar |
| `bytes` | `BYTEA NOT NULL` | `SET STORAGE EXTERNAL` |
| `uploaded_by` | `UUID NOT NULL` | editor (ID opaco) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Restricciones:

- `article_images_mime_allowed CHECK (mime_type IN ('image/jpeg','image/png','image/webp'))`
- `article_images_size_cap CHECK (byte_size > 0 AND byte_size <= 2097152)` — 2 MB (D-13)
- `article_images_dims_positive CHECK (width > 0 AND height > 0)`

**Las filas son inmutables.** El `alt` y el pie de foto NO viven aquí: viven en el nodo
`imagen` del documento, porque pertenecen al uso de la imagen en una versión concreta y no
al archivo. Esto es lo que permite que dos versiones compartan la misma imagen con pies
distintos, y lo que hace que FR-067 se cumpla sin duplicar bytes.

### 1.5 `quizzes` *(modificada — FR-037, FR-041)*

| Cambio | Detalle |
|--------|---------|
| + `questions_to_serve INTEGER NOT NULL DEFAULT 5` | FR-037 |
| `pass_threshold` | pasa a interpretarse como **porcentaje** |

Restricciones:

- `quizzes_questions_to_serve_positive CHECK (questions_to_serve > 0)`
- `quizzes_pass_threshold_range CHECK (pass_threshold >= 0 AND pass_threshold <= 100)`
  — reemplaza la restricción anterior, que solo exigía `>= 0`.

**Migración (D-18)**: `pass_threshold := 100 * pass_threshold / Σ weight` del cuestionario.
`Σ weight > 0` está garantizado por `questions_weight_positive`.

### 1.6 `quiz_sessions` *(nueva — FR-038…FR-042, D-17)*

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `UUID PK` | |
| `user_id` | `UUID NOT NULL` | ID opaco de Usuarios |
| `quiz_id` | `UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE` | |
| `served` | `JSONB NOT NULL` | `[{question_id, option_keys[]}]` en el orden servido |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | `created_at + 60 min` (D-17) |
| `consumed_at` | `TIMESTAMPTZ` | nulo hasta calificar; impide reusar la sesión |

Restricciones e índices:

- `quiz_sessions_expiry_after_creation CHECK (expires_at > created_at)`
- `quiz_sessions_served_not_empty CHECK (jsonb_array_length(served) > 0)`
- `INDEX quiz_sessions_user_quiz_idx ON (user_id, quiz_id, created_at DESC)`
- `INDEX quiz_sessions_expiry_idx ON (expires_at) WHERE consumed_at IS NULL` — barrido.

`served` guarda **también el orden de las opciones**, no solo qué preguntas se sirvieron:
FR-038 baraja las alternativas, y sin ese orden la reconstrucción de lo que el usuario vio
sería imposible.

### 1.7 `quiz_attempts` *(modificada — FR-039, FR-041)*

| Cambio | Detalle |
|--------|---------|
| + `session_id UUID REFERENCES quiz_sessions(id) ON DELETE SET NULL` | FR-039 |
| + `served_snapshot JSONB NOT NULL` | copia del `served` de la sesión |
| `score` | pasa a ser **porcentaje sobre 100** |

Restricción: `quiz_attempts_score_range CHECK (score >= 0 AND score <= 100)` — reemplaza
`quiz_attempts_score_non_negative`.

`served_snapshot` duplica deliberadamente el contenido de la sesión: las sesiones se purgan
al vencer, y el historial de intentos debe seguir siendo reconstruible años después
(FR-016, FR-039). La clave foránea a la sesión queda como `SET NULL` por esa misma razón.

**Migración (D-18)**: `score := 100 * score / Σ weight` del cuestionario;
`served_snapshot` se rellena con todas las preguntas del cuestionario, que es exactamente
lo que se servía antes de esta enmienda. **Salvedad documentada**: si el banco cambió tras
el intento, la conversión es aproximada; la migración emite el recuento de cuestionarios
afectados.

---

## 2. `simulator_db` — Servicio de Simulador

### 2.1 `calculators` *(nueva — FR-043…FR-054)*

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `UUID PK` | |
| `owner_id` | `UUID` | autor; **nulo** en las definiciones semilla de la plataforma |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT NOT NULL DEFAULT ''` | |
| `is_builtin` | `BOOLEAN NOT NULL DEFAULT FALSE` | las siete semillas de D-16 |
| `state` | `TEXT NOT NULL DEFAULT 'privada'` | `privada` \| `en_revision` \| `publicada` |
| `approved_by` | `UUID` | coordinador editorial; nulo hasta aprobar |
| `rejection_reason` | `TEXT` | FR-054 |
| `version` | `INTEGER NOT NULL DEFAULT 1` | se incrementa en cada cambio de definición |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Restricciones:

- `calculators_state_valid CHECK (state IN ('privada','en_revision','publicada'))`
- `calculators_approver_differs_from_owner CHECK (approved_by IS NULL OR owner_id IS NULL OR approved_by <> owner_id)`
  — FR-053 impuesto en la base, igual que ya se hace con `article_versions` en 001.
- `calculators_published_requires_approval CHECK (state <> 'publicada' OR is_builtin OR approved_by IS NOT NULL)`
  — las semillas de la plataforma están publicadas sin aprobador porque no tienen autor.
- `calculators_builtin_has_no_owner CHECK (NOT is_builtin OR owner_id IS NULL)` — ser
  semilla implica no tener autor, pero **no** al revés: una calculadora publicada cuyo autor
  se anonimizó también queda con `owner_id` nulo sin volverse semilla (Edge Cases). Una
  equivalencia estricta (`is_builtin = (owner_id IS NULL)`) haría fallar la anonimización.
- `INDEX calculators_owner_idx ON (owner_id) WHERE owner_id IS NOT NULL`
- `INDEX calculators_published_idx ON (name) WHERE state = 'publicada'`

### 2.2 `calculator_definitions` *(nueva — FR-043…FR-047, D-15)*

Una fila por **versión** de definición. Nunca se actualiza: editar produce una fila nueva.
Es lo que permite que `simulations` referencie la versión exacta con la que se calculó
(FR-050).

| Columna | Tipo | Notas |
|---------|------|-------|
| `calculator_id` | `UUID NOT NULL REFERENCES calculators(id) ON DELETE CASCADE` | |
| `version` | `INTEGER NOT NULL` | |
| `inputs` | `JSONB NOT NULL` | `[{clave, etiqueta, tipo, unidad, min, max, default, requerido}]` |
| `validations` | `JSONB NOT NULL DEFAULT '[]'` | `[{ast, mensaje}]` (D-15) |
| `outputs` | `JSONB NOT NULL` | `[{clave, etiqueta, ast, escala, cuando?}]` |
| `indicators_used` | `TEXT[] NOT NULL DEFAULT '{}'` | extraído del AST al guardar |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Clave primaria compuesta `(calculator_id, version)`.

Restricciones:

- `calculator_definitions_inputs_bounded CHECK (jsonb_array_length(inputs) BETWEEN 1 AND 20)`
- `calculator_definitions_outputs_bounded CHECK (jsonb_array_length(outputs) BETWEEN 1 AND 10)`

**Los límites de nodos y profundidad del AST (≤ 64 / ≤ 16) se validan en la capa de
aplicación**, no en SQL: recorrer un árbol para contar nodos en un `CHECK` sería ilegible y
se desincronizaría del analizador real. Todo `ast` persistido ya pasó por el analizador del
Simulador; nada llega aquí sin haber sido validado.

`tipo` de un campo de entrada ∈ `{monto, tasa, entero}`. **No existe el tipo texto**: la
única entrada de texto del sistema actual era el discriminador `operacion` de la
calculadora colombiana, que D-16 elimina al separarla en tres definiciones.

### 2.3 `financial_indicators` *(nueva — FR-055…FR-060, D-22)*

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `UUID PK` | |
| `name` | `TEXT NOT NULL` | `SMMLV`, `UVT`, `UVR`, `IPC`, `TASA_USURA`, … |
| `value` | `NUMERIC(20,6) NOT NULL` | **Principio VIII** |
| `validity` | `DATERANGE NOT NULL` | vigencia; `[inicio, fin)` |
| `registered_by` | `UUID NOT NULL` | administrador (ID opaco) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Restricciones:

- `financial_indicators_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$')` — el mismo
  identificador que las fórmulas referencian como `@NOMBRE`.
- `financial_indicators_value_non_negative CHECK (value >= 0)`
- **`EXCLUDE USING gist (name WITH =, validity WITH &&)`** — FR-059. Requiere
  `CREATE EXTENSION btree_gist`. Se impone en la base y no en la aplicación porque dos
  administradores concurrentes son un caso real (Edge Cases).
- `INDEX financial_indicators_lookup_idx ON (name, validity)`

### 2.4 `simulations` *(modificada — FR-050, FR-058)*

| Cambio | Detalle |
|--------|---------|
| + `calculator_id UUID REFERENCES calculators(id)` | nulo para el historial anterior a la enmienda |
| + `calculator_version INTEGER` | versión exacta de la definición usada |
| + `indicators_snapshot JSONB NOT NULL DEFAULT '{}'` | `{nombre: valor}` (FR-058) |

`calc_type` se conserva para no invalidar el historial existente y para que las siete
semillas sigan siendo identificables por su tipo original.

**Migración**: las filas existentes reciben `calculator_id` de la definición semilla
correspondiente a su `calc_type`, y `indicators_snapshot = '{}'` — honesto: esas
simulaciones se calcularon con constantes cableadas, no con indicadores persistidos.

---

## 3. `users_db` — Servicio de Usuarios

### 3.1 `profiles` *(modificada — FR-073…FR-076, D-20)*

| Cambio | Detalle |
|--------|---------|
| `account_status` | admite un tercer valor: `pending_deletion` |
| + `purge_due_at TIMESTAMPTZ` | vencimiento del período de gracia |
| + `purge_requested_by UUID` | administrador que la marcó (ID opaco) |

Restricciones:

- `profiles_account_status_valid CHECK (account_status IN ('active','pending_deletion','anonymized'))`
- `profiles_purge_due_requires_pending CHECK ((account_status = 'pending_deletion') = (purge_due_at IS NOT NULL))`
- **`UNIQUE INDEX profiles_email_reserved_uniq ON (email) WHERE account_status IN ('active','pending_deletion')`**
  — reemplaza a `profiles_email_active_uniq`. **Es el cambio del que depende FR-074**: sin
  ampliar el índice, un tercero podría registrar el correo durante la gracia y la
  reactivación fracasaría con una violación de índice.
- `INDEX profiles_purge_due_idx ON (purge_due_at) WHERE account_status = 'pending_deletion'`
  — soporta `ListAccountsDueForPurge` (D-20).

**FR-077**: no se añade ninguna columna con el correo original transformado. Un hash de una
dirección de correo sería un oráculo de pertenencia sobre un espacio enumerable.

### 3.2 `roles_assignment` *(modificada — FR-080)*

`roles_assignment_role_valid CHECK (role IN ('usuario_final','editor','coordinador_editorial','administrador'))`.

---

## 4. Transiciones de estado

### 4.1 Cuenta de usuario

```text
active ──(admin marca depuración, FR-073)──> pending_deletion ──(30 días, FR-075)──> anonymized
   ^                                              │
   └──────(titular reactiva, FR-074)──────────────┘
```

`anonymized` es **terminal**: no hay transición de salida. La anonimización es idempotente y
no tiene compensación posible, como ya documenta `services/users/internal/server/anonymize.go:30`.

### 4.2 Calculadora

```text
privada ──(autor propone, FR-052)──> en_revision ──(coordinador ≠ autor aprueba)──> publicada
   ^                                      │
   └────────(rechazo con motivo, FR-054)──┘
```

Editar una calculadora publicada crea una versión nueva en estado `privada`; la publicada
sigue sirviendo hasta que la nueva se apruebe (FR-055 del spec, escenario 5 de la historia 5).

### 4.3 Sesión de cuestionario

```text
emitida ──(envío dentro de vigencia)──> consumida ──> intento calificado
   └────(vencimiento a los 60 min)────> inválida
```

---

## 5. Referencias entre servicios

Ninguna de estas relaciones es una clave foránea: cruzan bases de datos y se resuelven por
gRPC (Principio III).

| Origen | Destino | Cómo |
|--------|---------|------|
| `article_versions.body_doc` → nodo `calculadora` | `simulator_db.calculators` | Aprendizaje valida por gRPC al guardar y degrada el bloque a un aviso si deja de estar publicada (FR-072, D-25) |
| `calculators.approved_by` | `users_db.profiles` | ID opaco; el rol se verifica en el Gateway |
| `profiles.purge_requested_by` | `users_db.profiles` | interna al servicio |
| Orquestador → `Users.ListAccountsDueForPurge` | `users_db.profiles` | gRPC; nunca lectura cruzada (D-20) |
| Orquestador → estado del calendario de indicadores | `simulator_db.financial_indicators` | gRPC; el evento de aviso lo publica el Orquestador porque el Simulador no es productor (D-23) |
