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
| `learning.article_published` | Aprendizaje | Notificación, Auditoría | In-app "nuevo artículo"; auditar publicación (FR-008) |
| `learning.quiz_graded` | Orquestador | Auditoría | Auditar calificación (FR-012/FR-025) |
| `user.progress_milestone` | Orquestador | Notificación | Hito de progreso → bandeja in-app (FR-023) |
| `user.activity` | Orquestador | Notificación | Eventos de actividad → bandeja in-app |
| `simulation.executed` | Orquestador | Auditoría | Auditar simulación (FR-025/SC-006); Simulador NO produce (D-03) |
| `account.anonymized` | Orquestador | Auditoría | Auditar supresión/anonimización (FR-030) |

---

## Esquemas de payload (resumen)

### `user.registered`
```json
{ "user_id": "uuid", "email": "string", "verification_token": "string" }
```
Consumo Notificación → envía email de verificación (`email_outbox`).
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
Notificación materializa la bandeja in-app vía `Users.AppendInAppNotification` cuando
corresponde (research D-09).

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
