# Catálogo de Eventos RabbitMQ

**Feature**: Plataforma Fintcart | **Branch**: `001-fintcart-platform`

Broker: **RabbitMQ 4.0** (AMQP). Restricción constitucional (Principio V): los eventos
solo pueden ser **consumidos por Notificación y/o Auditoría**. Productores autorizados:
**Usuarios, Aprendizaje, Orquestador, Autenticación**. El **Simulador NO es productor**
(research D-03): sus operaciones se auditan vía eventos emitidos por el Orquestador.

**Convención de precisión**: cualquier monto/tasa en el payload viaja como `string`
decimal canónica (Principio VIII / D-10). PROHIBIDO número JSON para dinero.

**Topología**: exchange `tipo topic`. Routing key = nombre del evento. Colas dedicadas
por consumidor (`notification.q`, `audit.q`) con dead-letter para reintentos (FR-024).
Consumo **idempotente** (clave de idempotencia = `event_id`).

**Envelope común** (todos los eventos):
```json
{
  "event_id": "uuid",
  "event_type": "string",
  "occurred_at": "RFC-3339 UTC",
  "actor_ref": "uuid-opaco",
  "payload": { }
}
```
> `actor_ref` es un **identificador opaco**: permite trazabilidad en Auditoría incluso
> tras la anonimización del titular (FR-030/FR-031). Nunca incluir PII en `payload`
> destinado a Auditoría.

---

## Eventos por productor

| Evento (`event_type`) | Productor | Consumidores | Propósito |
|-----------------------|-----------|--------------|-----------|
| `user.registered` | Orquestador | Notificación, Auditoría | Disparar email de verificación; auditar alta |
| `user.email_verified` | Orquestador | Auditoría | Auditar verificación de correo |
| `auth.password_changed` | Autenticación | Notificación, Auditoría | Email de cambio/restablecimiento (FR-005); auditar |
| `auth.security_alert` | Autenticación | Notificación, Auditoría | Alertas de seguridad (p. ej. logins fallidos repetidos) |
| `auth.session_revoked` | Autenticación | Auditoría | Auditar logout/revocación (FR-004) |
| `learning.article_published` | Aprendizaje | Auditoría | Auditar publicación (FR-008); in-app: ver nota N-03 abajo |
| `learning.quiz_graded` | Orquestador | Auditoría | Auditar calificación (FR-012/FR-025) |
| `user.progress_milestone` | Orquestador | Auditoría | Hito de progreso (bandeja in-app: ver nota N-03 abajo) |
| `user.activity` | Orquestador | Auditoría | Actividad del usuario (bandeja in-app: ver nota N-03 abajo) |
| `simulation.executed` | Orquestador | Auditoría | Auditar simulación (FR-025/SC-006); Simulador NO produce (D-03) |
| `account.anonymized` | Orquestador | Auditoría | Auditar supresión/anonimización (FR-030) |

### Eventos añadidos por la enmienda 002

| Evento | Productor | Consumidores | Propósito |
|--------|-----------|--------------|-----------|
| `indicator.calendar_alert` | Orquestador | Notificación, Auditoría | Faltan indicadores del período o están por vencer (FR-061) |
| `calculator.published` | Orquestador | Auditoría | Auditar la aprobación de una calculadora al catálogo público (FR-053) |
| `category.deactivated` | Aprendizaje | Auditoría | Auditar la desactivación de una categoría (FR-035) |

**El Simulador sigue sin ser productor** (Principio V). Los dos eventos que nacen en su
territorio —el aviso del calendario de indicadores y la aprobación de una calculadora— los
publica el Orquestador, que es quien pregunta por gRPC y encola en su `event_outbox`. Es el
mismo patrón que ya resolvió D-03 para `simulation.executed`: el dueño del dato no es el dueño
del hecho notificable.

### Lo que el delta de 002 prometía y NO está en este catálogo

Un catálogo que documente eventos que nadie publica es peor que uno corto: quien lo lea
supondrá recibos que no existen. Tres de los seis eventos del delta no están aquí, y cada uno
por su razón:

- `account.purge_scheduled` y `account.purge_cancelled`: pertenecen a la **Fase 9 (depuración
de cuentas), descartada explícitamente** tras T165. El flujo que los emitía no existe, así que
no se documentan. Su nota de enrutamiento —dos routing keys, una con correo hacia
Notificación y otra sin correo hacia Auditoría, para que la PII del titular no acabe en el
registro inmutable de cinco años— es un diseño correcto y queda escrito en
`specs/002-calculator-builder-content-admin/contracts/events/events-catalog-delta.md`, para el
día en que esa fase se retome.
- `indicator.updated`: el delta lo asignaba al Orquestador para auditar la carga de un
indicador, y **nunca tuvo productor**: los indicadores los guarda el Gateway contra el
Simulador sin pasar por ninguna saga, así que no hay `event_outbox` del que salga. Se deja
fuera en vez de dejarlo prometiendo una auditoría que no ocurre. Que una edición de
indicador no quede auditada es una carencia REAL y se declara aquí: se ve en el historial de
simulaciones —cada una guarda el valor con el que calculó (FR-058)—, pero no en `audit_log`,
y esa es la diferencia entre reconstruir un resultado y acreditar quién lo cambió.

**Leyenda del hallazgo 20**: `category.deactivated` **sí** se publicaba desde Aprendizaje
(T056) y **no** estaba enlazado en el Orquestador, así que el exchange lo descartaba en
silencio y FR-035 no se cumplía. Se descubrió comparando este catálogo con los bindings
reales del broker (`rabbitmqctl list_bindings`) al aplicar este delta, y ahora está declarado,
enlazado y comprobado por `frontend/scripts/events-barrier.mjs`.

> **Nota N-03 — la bandeja in-app NO llega por evento.** Tres eventos
> (`learning.article_published`, `user.progress_milestone`, `user.activity`) tenían
> asignada Notificación como consumidor «para materializar la bandeja in-app». Esa
> asignación es anterior a la aclaración N-03 de `plan.md`, que pasó la bandeja al
> **Servicio de Usuarios**: Notificación es consumidor puro **sin gRPC** y no puede
> servir la lectura de una bandeja de la que fuera dueño. Hoy la bandeja se alimenta
> con `Users.AppendInAppNotification`, llamado desde el paso de la saga.
>
> Los tres eventos siguen produciéndose y se enlazan a `audit.q`, no a
> `notification.q`. Notificación solo recibe los eventos que producen un correo:
> `user.registered`, `auth.password_changed`, `auth.security_alert` —las tres plantillas del
esquema de 001— y `indicator.calendar_alert`, que se sumó con su propia migración
(`20260902130000_indicator_calendar_alert_template`) precisamente porque un binding sin
plantilla entregaría mensajes que el consumidor solo puede descartar, y una cola que recibe y
tira en silencio es indistinguible de una que funciona. Ver
`services/orchestrator/internal/events/topology.go`.

---

## Esquemas de payload (resumen)

### `user.registered`
```json
{ "user_id": "uuid", "email": "string", "display_name": "string",
  "verification_token": "string", "verification_expires_at": "RFC-3339" }
```
Es el ÚNICO evento del catálogo que transporta datos personales, y es una excepción
deliberada: Notificación es un consumidor puro **sin gRPC**, así que lo que no venga
en el payload no lo puede consultar en ningún sitio — y este es el único correo del
sistema dirigido a alguien que todavía no tiene sesión. El `actor_ref` del sobre sigue
siendo el UUID opaco, de modo que Auditoría conserva la traza aunque después se
anonimice la cuenta (FR-031).

El `user_id` se repite **dentro** del payload además de ir en `actor_ref` porque
`POST /auth/verify-email` lo exige junto al token, y la plantilla solo lee el payload.

El `verification_token` viaja **en claro** por el bus y queda en claro en la fila del
outbox hasta que se publica y se poda. Es transitorio y acotado; en `auth_db` solo
existe su hash. Ninguna de las dos copias es evitable si el correo tiene que llevar un
enlace utilizable.

Consumo Notificación → encola el email de verificación en `notification_events_queue` y registra su estado en `notification_states`.
Consumo Auditoría → `operation = user.registered`.

### `auth.password_changed`
```json
{ "user_id": "uuid", "email": "string", "changed_at": "RFC-3339" }
```

### `learning.article_published`
```json
{ "article_id": "uuid", "version_no": 3, "title": "string", "category": "string",
  "approved_by": "uuid", "created_by": "uuid" }
```
Invariante auditable: `approved_by != created_by` (separación de responsabilidades, FR-008).

### `learning.quiz_graded`
```json
{ "user_id": "uuid", "quiz_id": "uuid", "attempt_no": 2, "score": "85.00", "passed": true }
```
`score` como **string decimal** (Principio VIII).

### `user.progress_milestone` / `user.activity`
```json
{ "user_id": "uuid", "type": "hito_progreso", "payload": { "points": 320 } }
```
La bandeja in-app la materializa el **Orquestador** llamando a
`Users.AppendInAppNotification` desde el paso de la saga, no Notificación por evento
(ver la nota N-03 de arriba; sustituye a lo que decía research D-09). Estos dos eventos
se consumen en Auditoría.

### `simulation.executed`
```json
{ "user_id": "uuid", "simulation_id": "uuid", "calc_type": "credito", "currency": "COP" }
```
Sin montos/PII sensibles en el payload de auditoría (solo metadatos de la operación).

### `account.anonymized`
```json
{ "actor_ref": "uuid-opaco", "anonymized_at": "RFC-3339" }
```
Auditoría conserva el registro inmutable ≥ 5 años con `actor_ref` opaco (FR-031).

### `indicator.calendar_alert`
```jsonc
{
  "missing":  ["UVT", "SMMLV"],
  "expiring": [{ "name": "TASA_USURA", "valid_to": "2027-01-01", "days_remaining": 21 }],
  "admin_refs": ["uuid-opaco"]
}
```
Sin `email`: el aviso llega al administrador a través de los `admin_refs`, que ya están en la
plataforma. El valor del indicador no viaja aquí —quien lo necesite lo pide a
`Indicators.Resolve`—, así que el evento no es una copia del catálogo de indicadores sino la
constancia de que el procedimiento anual se supervisó.

### `calculator.published`
```json
{ "calculator_ref": "uuid", "version": 3, "owner_ref": "uuid-opaco", "approver_ref": "uuid-opaco" }
```
Invariante auditable: `approver_ref != owner_ref` (FR-053). Es el mismo hecho que la
aprobación de un artículo: la curaduría se acredita con dos identificadores distintos.

### `category.deactivated`
```json
{ "category_ref": "uuid", "slug": "ahorro", "actor_ref": "uuid-opaco" }
```
Va SOLO a Auditoría: desactivar una categoría no genera correo (FR-035). El `slug` viaja
además del identificador porque es lo que el lector vio en el catálogo, y un `audit_log` que
solo guarde un UUID obliga a consultar una tabla que puede haber cambiado para saber qué se
desactivó.
