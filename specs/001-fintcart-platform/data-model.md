# Phase 1 — Modelo de Datos

**Feature**: Plataforma Fintcart | **Branch**: `001-fintcart-platform` | **Date**: 2026-06-13

El modelo respeta **database-per-service** (Principio III): cada tabla pertenece a **una** instancia lógica PostgreSQL de **un** servicio. No hay claves foráneas entre servicios; las referencias cruzadas se hacen por **identificador opaco** (UUID) resuelto vía gRPC. Todo valor monetario/tasa usa `NUMERIC` (Principio VIII).

**Convenciones**: PK = `id UUID` (`gen_random_uuid()`). Marcas temporales `TIMESTAMPTZ`. Montos `NUMERIC(19,2)`; tasas/porcentajes `NUMERIC(9,6)`. Prohibido `REAL`/`DOUBLE PRECISION`/`FLOAT`.

---

## Mapa de propiedad (entidad → servicio dueño)

| Entidad (spec) | Servicio dueño | Tablas |
|----------------|----------------|--------|
| Usuario (identidad/credencial) | **Auth** | `credentials`, `oauth_clients`, `authorization_codes` |
| Usuario (perfil) + Progreso | **Usuarios** | `profiles`, `roles_assignment`, `preferences`, `progress`, `quiz_best_score`, `article_views`, `inapp_notifications` |
| Artículo Educativo · Cuestionario · Resultado de Cuestionario | **Aprendizaje** | `articles`, `article_versions`, `quizzes`, `questions`, `quiz_attempts`, `article_stats` |
| Simulación Financiera | **Simulador** | `simulations` |
| Notificación (email) | **Notificación** | `notification_events_queue`, `notification_states` |
| Registro de Auditoría | **Auditoría** | `audit_log` |
| Estado de Saga | **Orquestador** | `saga_state` |

> La **bandeja in-app** (`inapp_notifications`) es propiedad de **Usuarios** (decisión D-09: Notificación es consumidor puro sin gRPC y no puede servir lecturas al usuario). Notificación posee únicamente el canal **email**, implementado como cola persistente con estado (`notification_events_queue` + `notification_states`).

---

## Servicio de Autenticación (PostgreSQL: `auth_db` + Redis)

### `credentials`
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` (=`user_id`) | UUID PK | Igual al `sub` del JWT y al `profiles.id` de Usuarios |
| `email` | CITEXT UNIQUE | Único (FR-001); anonimizable (FR-030) |
| `password_hash` | TEXT | Argon2id; nunca en claro/logs |
| `login_status` | TEXT | `pending_verification` → `active` → `anonymized` |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Transiciones `login_status`**: `pending_verification` --(EmailVerified)--> `active` --(AccountAnonymized)--> `anonymized`. En `anonymized` se imposibilita la emisión de tokens.

### `oauth_clients`
`id UUID PK`, `client_id TEXT UNIQUE`, `client_secret_hash TEXT` (solo M2M), `grant_types TEXT[]` (`authorization_code`+`refresh_token` para SPA; `client_credentials` para M2M), `redirect_uris TEXT[]`, `scopes TEXT[]`, `is_public BOOL` (SPA = público, sin secreto, requiere PKCE).

### `authorization_codes`
`id UUID PK`, `code TEXT UNIQUE`, `client_id TEXT`, `user_id UUID`, `code_challenge TEXT`, `code_challenge_method TEXT` (`S256`), `redirect_uri TEXT`, `scopes TEXT[]`, `expires_at TIMESTAMPTZ`, `consumed BOOL`. TTL corto (≤ 60 s).

### Redis (Principio IV)
- `blacklist:{jti}` → TTL = vida residual del access token (revocación inmediata, FR-004).
- `refresh:{token_id}` → `{user_id, rotated_from, expires_at}` (rotación de refresh tokens).

---

## Servicio de Usuarios (PostgreSQL: `users_db`)

### `profiles`
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` (=`user_id`) | UUID PK | = `credentials.id` |
| `email` | CITEXT | Copia de perfil; anonimizable (FR-030) |
| `display_name` | TEXT | Anonimizable |
| `email_verified` | BOOL | FR-002 |
| `account_status` | TEXT | `active` \| `anonymized` (FR-030) |
| `created_at` | TIMESTAMPTZ | |

### `roles_assignment`
`user_id UUID`, `role TEXT` ∈ {`usuario_final`, `editor`, `coordinador_editorial`} (FR-006). Un usuario puede tener ≥ 1 rol; regla de negocio: un `editor` no puede ejercer de `coordinador_editorial` sobre su propio artículo (FR-008, validado en Aprendizaje vía contexto del actor).

### `preferences`
`user_id UUID PK`, `locale TEXT` (default `es-CO`), `notif_inapp BOOL`, `notif_email BOOL`, `payload JSONB` (preferencias extensibles). Anonimizable.

### `progress`
| Campo | Tipo | Reglas |
|-------|------|--------|
| `user_id` | UUID PK | |
| `points` | INTEGER | ≥ 0; = Σ mejor puntaje por cuestionario distinto (FR-014) |
| `updated_at` | TIMESTAMPTZ | |

### `quiz_best_score`
`user_id UUID`, `quiz_id UUID`, `best_score NUMERIC(6,2)`, `updated_at`. PK (`user_id`,`quiz_id`). Soporta el cálculo monótono de puntos (D-07): solo se actualiza si el nuevo puntaje supera el almacenado.

### `article_views` (FR-015)
`user_id UUID`, `article_id UUID`, `first_viewed_at TIMESTAMPTZ`, `last_viewed_at TIMESTAMPTZ`, `view_count INT`. PK (`user_id`,`article_id`).

### `inapp_notifications` (bandeja in-app, FR-023 / D-09)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `user_id` | UUID | Destinatario |
| `type` | TEXT | `nuevo_articulo` \| `recordatorio` \| `hito_progreso` \| `resultado_cuestionario` |
| `payload` | JSONB | Datos de presentación |
| `read_state` | TEXT | `unread` \| `read` (estado de lectura) |
| `created_at` | TIMESTAMPTZ | Marca temporal |
| `read_at` | TIMESTAMPTZ NULL | |

---

## Servicio de Aprendizaje (PostgreSQL: `learning_db`)

### `articles`
`id UUID PK`, `title TEXT`, `category TEXT` (≥ 5 categorías, SC-009), `current_version_id UUID NULL` (versión publicada vigente), `author_id UUID` (editor creador, ID opaco de Usuarios), `created_at`.

### `article_versions` (FR-013, trazabilidad histórica)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `article_id` | UUID | |
| `version_no` | INT | Incremental por artículo |
| `body` | TEXT | Contenido |
| `state` | TEXT | `borrador` \| `en_revision` \| `publicado` \| `archivado` |
| `created_by` | UUID | Editor |
| `approved_by` | UUID NULL | Coordinador editorial (≠ `created_by`, FR-008) |
| `created_at` / `published_at` | TIMESTAMPTZ | |

**Transiciones de estado** (FR-007/FR-008):
```
borrador --(editor: enviar a revisión)--> en_revision
en_revision --(coordinador ≠ editor: aprobar+publicar)--> publicado
publicado --(nueva versión por editor)--> [nueva fila version: borrador]
publicado --(coordinador: retirar/reemplazar)--> archivado
```
Invariante: la transición `en_revision → publicado` exige `approved_by ≠ created_by` (separación de responsabilidades). Visibilidad: `borrador` solo a su editor; `en_revision` al coordinador; `publicado` a usuarios finales.

### `quizzes`
`id UUID PK`, `article_id UUID` (≥ 1 cuestionario por artículo, FR-009), `title TEXT`, `pass_threshold NUMERIC(6,2)`.

### `questions`
`id UUID PK`, `quiz_id UUID`, `prompt TEXT`, `options JSONB`, `correct_key TEXT`, `weight NUMERIC(6,2)`.

### `quiz_attempts` (Resultado de Cuestionario — historial completo, FR-012/FR-016)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `user_id` | UUID | |
| `quiz_id` | UUID | |
| `attempt_no` | INT | Nº de intento (incremental por usuario/quiz) |
| `score` | NUMERIC(6,2) | Calificación obtenida |
| `answers` | JSONB | Respuestas enviadas |
| `created_at` | TIMESTAMPTZ | Marca temporal |

Se persiste **todo** intento (incluso por debajo del mejor histórico, FR-016). El progreso lo deriva Usuarios (D-06/D-07), no Aprendizaje. Reintentos ilimitados (FR-014).

### `article_stats`
`article_id UUID PK`, `view_count BIGINT`, `attempt_count BIGINT`, `avg_score NUMERIC(6,2)`. Agregados de interacción (FR-018 a nivel contenido).

---

## Servicio de Simulador (PostgreSQL: `simulator_db`)

### `simulations` (Simulación Financiera — historial por usuario, FR-022)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `user_id` | UUID | |
| `calc_type` | TEXT | `ahorro` \| `credito` \| `presupuesto` \| `inversion` \| `colombia_especifica` (FR-019) |
| `currency` | TEXT | Default `COP` (FR-020) |
| `inputs` | JSONB | Parámetros; montos/tasas como **string decimal canónica** (D-10) |
| `result` | JSONB | Resultados; montos/tasas como **string decimal canónica** |
| `created_at` | TIMESTAMPTZ | Marca temporal |

> En cómputo (Rust) los valores se manejan con `rust_decimal::Decimal`; la persistencia JSONB guarda strings decimales canónicas para evitar cualquier representación binaria (Principio VIII). Anonimizable por `user_id` (FR-030).

---

## Servicio de Notificación (PostgreSQL: `notification_db`)

Canal **email** únicamente. La bandeja in-app NO vive aquí: es propiedad del Servicio de Usuarios (`inapp_notifications`, D-09), porque Notificación es consumidor puro sin gRPC y no puede servir lecturas al usuario.

La entrega se implementa como **cola persistente con estado** (Constitución §"Entrega de Notificaciones: Cola Persistente con Estado"), con dos tablas: la cola guarda lo pendiente y el estado **sobrevive al desencolado**, quedando como registro consultable de lo ocurrido. Reemplaza la tabla única `email_outbox` de versiones anteriores de este documento.

### `notification_events_queue` (cola de pendientes, FR-024)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `event_id` | UUID UNIQUE | Identificador del evento de origen; garantiza entrega idempotente |
| `recipient` | TEXT | Destinatario del email |
| `template` | TEXT | `verificacion` \| `cambio_password` \| `alerta_seguridad` |
| `payload` | JSONB | Datos de la plantilla |
| `attempts` | INT | Contador de intentos; se incrementa en cada fallo reintentable |
| `created_at` | TIMESTAMPTZ | Orden de despacho (el despachador lista por este campo) |

Se **desencola** (borra) al alcanzar un desenlace terminal: éxito, o fallo con `attempts ≥ MAX_ATTEMPTS`. `MAX_ATTEMPTS` es configurable por entorno (Principio X) y su valor por defecto se documenta.

### `notification_states` (estado persistente, sobrevive al desencolado)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `event_id` | UUID UNIQUE | Correlaciona con el evento de origen |
| `state` | TEXT | `not_sent` \| `sent` \| `failed` |
| `attempts` | INT | Intentos totales consumidos |
| `last_error` | TEXT NULL | Último error observado |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Transiciones** (los tres desenlaces, cada uno con prueba obligatoria):
```
encolado                      → notification_states.state = not_sent
éxito                         → dequeue + state = sent
fallo, attempts < MAX         → attempts += 1 (permanece en cola, siguiente ronda)
fallo, attempts ≥ MAX         → dequeue + state = failed
```

Consumidor puro de eventos de seguridad/identidad (Principio V): `auth.password_changed`, `auth.security_alert`, `user.registered`.

---

## Servicio de Auditoría (PostgreSQL: `audit_db`)

### `audit_log` (Registro de Auditoría — inmutable, append-only, FR-025/FR-031)
| Campo | Tipo | Reglas |
|-------|------|--------|
| `id` | UUID PK | |
| `actor_ref` | UUID | **ID opaco**; sobrevive a anonimización del titular (FR-030) |
| `operation` | TEXT | p. ej. `user.registered`, `quiz.graded`, `simulation.executed`, `article.published`, `account.anonymized` |
| `context` | JSONB | Detalle no-PII / despersonalizado |
| `result` | TEXT | `success` \| `failure` |
| `occurred_at` | TIMESTAMPTZ | |
| `recorded_at` | TIMESTAMPTZ | |

**Invariantes**: solo `INSERT` (sin `UPDATE`/`DELETE`); retención **≥ 5 años** (FR-031, particionado por año recomendado). Fuente autoritativa de trazabilidad regulatoria; los logs operacionales no la sustituyen.

---

## Orquestador (PostgreSQL: `orchestrator_db`)

### `saga_state`
`id UUID PK`, `saga_type TEXT` (`registro`, `verificacion_email`, `calificacion`, `simulacion`, `anonimizacion`), `status TEXT` (`running`\|`completed`\|`compensating`\|`failed`), `current_step INT`, `payload JSONB`, `compensations JSONB`, `created_at`, `updated_at`. Patrón outbox para publicación confiable de eventos (D-07). Sin lógica de dominio (Principio VI).

---

## Relaciones entre dominios (vía gRPC / eventos, sin FK cruzada)

```
Auth.credentials.id  ─┬─(= user_id)─►  Users.profiles.id
                      └─(claims via gRPC GetAuthContext)
Users.quiz_best_score ◄─(Saga ApplyQuizScore)── Learning.quiz_attempts
Users.article_views   ◄─(RecordArticleView)──── (acción de usuario)
Users.inapp_notifications ◄─(Saga AppendInAppNotification)── Orchestrator
Learning.article_versions ──(evento ArticlePublished)──► Notification(email N/A)/Audit + (in-app vía saga)
Simulator.simulations ──(Orchestrator emite SimulationExecuted)──► Audit
* ──(eventos)──► Audit.audit_log   (actor_ref opaco)
```

**Anonimización (FR-030)**: la saga toca `Auth.credentials`, `Users.{profiles,preferences,inapp_notifications}`, `Learning.quiz_attempts` (disociar PII), `Simulator.simulations` (disociar PII); **nunca** `Audit.audit_log` (inmutable; conserva `actor_ref` opaco).
