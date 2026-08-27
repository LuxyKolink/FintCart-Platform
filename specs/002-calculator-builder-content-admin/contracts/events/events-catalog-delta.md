# Catálogo de Eventos RabbitMQ — DELTA Feature 002

**Feature**: `002-calculator-builder-content-admin`

Delta sobre `contracts/events/events-catalog.md`. Se conservan íntegras la topología
(exchange `topic`, `notification.q` / `audit.q` con dead-letter), el envelope común y la
convención de precisión decimal del catálogo de 001.

**Restricción vigente (Principio V)**: productores autorizados son **Usuarios,
Aprendizaje, Orquestador y Autenticación**. El **Simulador sigue sin ser productor** — por
eso los dos eventos originados en su dominio (aviso de indicadores y publicación de
calculadora) los emite el **Orquestador**, exactamente el mismo patrón que ya resolvió D-03
para `simulation.executed`.

---

## Eventos nuevos

| Evento (`event_type`) | Productor | Consumidores | Propósito |
|-----------------------|-----------|--------------|-----------|
| `account.purge_scheduled` | Usuarios | Notificación, Auditoría | Un administrador marcó la cuenta; avisar al titular y auditar quién lo hizo (FR-073, FR-078) |
| `account.purge_cancelled` | Usuarios | Auditoría | El titular reactivó dentro del plazo (FR-074) |
| `indicator.calendar_alert` | Orquestador | Notificación, Auditoría | Faltan indicadores del período o están por vencer (FR-061) |
| `indicator.updated` | Orquestador | Auditoría | Auditar carga o corrección de un indicador (FR-060) |
| `calculator.published` | Orquestador | Auditoría | Auditar la aprobación de una calculadora al catálogo público (FR-053) |
| `category.deactivated` | Aprendizaje | Auditoría | Auditar la desactivación de una categoría (FR-035) |

`account.anonymized` **no es nuevo**: se reutiliza tal cual al consumarse la purga vencida.
Lo emite el Orquestador al terminar la saga, igual que hoy.

---

## Payloads

Ningún `payload` destinado a Auditoría lleva PII, conforme a la nota del catálogo de 001.
El correo aparece únicamente en `account.purge_scheduled`, que **sí** llega a Notificación
porque necesita la dirección para enviar el aviso — y por eso ese payload NO se enlaza a
`audit.q`: ver la nota de enrutamiento más abajo.

```jsonc
// account.purge_scheduled  → notification.q, audit.q (con proyecciones distintas)
{
  "user_ref":   "uuid-opaco",
  "admin_ref":  "uuid-opaco",
  "reason":     "string, puede ir vacío",
  "purge_due_at": "RFC-3339",     // vencimiento del período de gracia (FR-074)
  "email":      "string"          // SOLO para Notificación; ver nota de enrutamiento
}

// account.purge_cancelled → audit.q
{ "user_ref": "uuid-opaco", "reactivated_at": "RFC-3339" }

// indicator.calendar_alert → notification.q, audit.q
{
  "missing":  ["UVT", "SMMLV"],
  "expiring": [{ "name": "TASA_USURA", "valid_to": "2027-01-01", "days_remaining": 21 }],
  "admin_refs": ["uuid-opaco"]    // destinatarios con rol administrador
}

// indicator.updated → audit.q
{
  "indicator_name": "UVT",
  "value":      "49799",          // [decimal] string, nunca número JSON
  "valid_from": "2027-01-01",
  "valid_to":   "2028-01-01",
  "actor_ref":  "uuid-opaco"
}

// calculator.published → audit.q
{
  "calculator_ref": "uuid",
  "version":        3,
  "owner_ref":      "uuid-opaco",
  "approver_ref":   "uuid-opaco"  // ≠ owner_ref por FR-053
}

// category.deactivated → audit.q
{ "category_ref": "uuid", "slug": "ahorro", "actor_ref": "uuid-opaco" }
```

---

## Nota de enrutamiento — `account.purge_scheduled` y la PII

Es el único evento nuevo que necesita llegar a los dos consumidores con contenido
distinto: Notificación necesita el correo para escribir al titular; Auditoría **no debe
recibirlo nunca**, porque su registro se conserva cinco años y sobrevive a la
anonimización (FR-031), de modo que un correo almacenado ahí sería precisamente el rastro
que FR-077 prohíbe conservar.

**Resolución**: el productor publica con dos routing keys —
`account.purge_scheduled.notify` (con `email`) enlazada a `notification.q`, y
`account.purge_scheduled.audit` (sin `email`) enlazada a `audit.q`. Un único evento con el
correo dentro, enlazado a las dos colas, dejaría PII en el registro inmutable de forma
permanente e irreversible.

---

## Plantillas nuevas en el Servicio de Notificación

El esquema de Notificación admite hoy tres plantillas de correo. Se añaden dos:

| Plantilla | Disparada por | Destinatario |
|-----------|---------------|--------------|
| `account_purge_scheduled` | `account.purge_scheduled.notify` | titular de la cuenta |
| `indicator_calendar_alert` | `indicator.calendar_alert` | administradores |

Ambas mantienen la garantía de idempotencia por `event_id` de la cola persistente con
estado (Constitución §Entrega de Notificaciones): reprocesar el mismo evento no puede
producir un segundo correo.
