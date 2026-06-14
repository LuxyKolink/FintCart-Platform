# Phase 0 — Research & Decisiones Técnicas

**Feature**: Plataforma Fintcart | **Branch**: `001-fintcart-platform` | **Date**: 2026-06-13

Este documento consolida las decisiones técnicas que resuelven el Technical Context del plan. La asignación de lenguajes, almacenamiento y topología de comunicación está **fijada por la Constitución de Fintcart (v1.0.0)** y el marco tecnológico (`technology.md`); por tanto no existen incógnitas (`NEEDS CLARIFICATION`) sobre el stack. El research concreta versiones, librerías y patrones de implementación que la constitución deja abiertos.

---

## D-01 — Versiones concretas del stack

**Decisión**: Go 1.24, Rust 1.85 (edición 2021), Node.js 22 LTS + TypeScript 5.6, NestJS 11, Angular 19, PostgreSQL 16, Redis 7.4, RabbitMQ 4.0, Kubernetes 1.31+, Docker, Protocol Buffers proto3 + gRPC.

**Rationale**: Versiones LTS/estables vigentes a 2026-06 con soporte de seguridad activo. Go 1.24 y Node 22 LTS dan estabilidad de runtime a largo plazo; Angular 19 y NestJS 11 son las líneas mayores actuales; PostgreSQL 16 ofrece particionado y mejoras de paralelismo útiles para el log de auditoría append-only.

**Alternativas consideradas**: versiones bleeding-edge (Node 23, Angular 20-rc) descartadas por falta de soporte LTS; versiones antiguas (Go 1.21, Postgres 14) descartadas por ventana de soporte más corta.

---

## D-02 — Precisión decimal arbitraria por capa (Principio VIII, NON-NEGOTIABLE)

**Decisión**: una librería de precisión arbitraria por lenguaje, con `string` decimal canónica como representación de transporte:

| Capa | Tipo permitido | Prohibido |
|------|----------------|-----------|
| PostgreSQL | `NUMERIC(p,s)` — montos COP `NUMERIC(19,2)`, tasas `NUMERIC(9,6)` | `REAL`, `DOUBLE PRECISION`, `FLOAT` |
| Go | `github.com/shopspring/decimal` | `float32`, `float64` |
| Rust | `rust_decimal::Decimal` (128-bit) | `f32`, `f64` |
| TypeScript (NestJS/Node/Angular) | `decimal.js` / `big.js` | `number` para montos/tasas |
| Protocol Buffers | `string` (decimal canónica) | `float`, `double` |
| JSON en borde REST | `string` (decimal canónica) | número JSON |

**Rationale**: evita errores IEEE 754 que comprometen exactitud contable y violan requerimientos regulatorios colombianos. `rust_decimal` (128-bit, escala fija hasta 28 dígitos) cubre cómodamente los rangos de simulación; para cálculos compuestos de muy alta escala (interés compuesto a largo plazo) se valida overflow y se escala explícitamente. La frontera de servicio convierte string↔decimal validando precisión y rechazando overflow silencioso.

**Validación estática**: reglas de lint que prohíben `float64`/`f64`/`number` en módulos financieros (Disciplina §Calidad). Pruebas con montos extremos, redondeo bancario (half-even) y división con resto (SC-004).

**Alternativas consideradas**: `big.Rat` (Go) descartado por ergonomía y costo; enteros en centavos descartados porque las tasas requieren > 2 decimales y el dominio mezcla montos y tasas; `bigdecimal` (Rust) viable pero `rust_decimal` es suficiente y más rápido para escala fija.

---

## D-03 — Auditoría de simulaciones sin convertir al Simulador en productor de eventos

**Decisión**: el **Simulador no publica en RabbitMQ** (no figura como productor en el Principio V ni en `technology.md` §1.9). La ejecución de una simulación que debe auditarse se **coordina a través del Orquestador**: Gateway → Orquestador → `Simulator.Compute` (gRPC, calcula y persiste su historial) → el Orquestador publica el evento `SimulationExecuted` consumido por Auditoría (y opcionalmente Notificación).

**Rationale**: Principio V restringe los productores a Usuarios, Aprendizaje, Orquestador y Autenticación. Para satisfacer FR-025/SC-006 (100% de simulaciones auditadas) sin violar la topología de eventos, el único productor natural para el flujo de simulación es el Orquestador. Emitir un evento de trazabilidad es coordinación, no lógica de dominio, por lo que respeta "Orquestador sin lógica de dominio" (Principio VI).

**Alternativas consideradas**: (a) convertir al Simulador en productor → viola Principio V; (b) que el Gateway publique → el Gateway no es productor y debe permanecer sin estado de dominio; (c) no auditar simulaciones → viola FR-025/SC-006.

**Trade-off aceptado**: la ruta de simulación añade un salto (Orquestador) frente a un Gateway→Simulador directo. Es una saga degenerada de un paso con compensación trivial (la simulación no muta estado de otros dominios). Se documenta como decisión deliberada, no como violación.

---

## D-04 — Frontera de identidad: Autenticación vs. Usuarios; registro como Saga

**Decisión**:
- **Servidor de Autenticación** es la autoridad de identidad y **dueño de las credenciales**: `oauth_clients`, `authorization_codes`, `credentials` (correo + hash Argon2id + estado de elegibilidad de login), claves de firma JWT; refresh tokens y blacklist en **Redis**.
- **Servicio de Usuarios** es dueño del **perfil**: identificador de usuario (= `sub` del JWT), correo como atributo de perfil + estado de verificación, **rol** (usuario final / editor / coordinador editorial), preferencias, progreso, historiales, estadísticas. Conduce la UX de registro y el ciclo de vida del token de verificación de correo.
- **El registro es una Saga** (cruza Usuarios + Autenticación ⇒ obligatorio por Principio VI): `Users.CreateProfile(pending)` → `Auth.CreateCredential(pending)` → publicar `UserRegistered` → Notificación envía correo de verificación. Compensación: deshabilitar/eliminar perfil y credencial creados.
- En la emisión de token, Auth obtiene rol y estado vía gRPC `Users.GetAuthContext(userId)` para poblar los claims del JWT (Auth no consume eventos: Principio V).

**Rationale**: centraliza la identidad en Auth (Principio VII) manteniendo a Usuarios como dueño del perfil/roles según `scope.md`. El registro tocando dos servicios es precisamente el caso que el Principio VI obliga a resolver con Saga; no es complejidad gratuita.

**Alternativas consideradas**: (a) Usuarios almacena credenciales y Auth solo emite tokens → diluye la autoridad de identidad de Auth (Principio VII); (b) Auth dueño de todo el registro de identidad incluyendo perfil → contradice `scope.md` que asigna registro y perfiles a Usuarios y aun así requeriría Saga para crear el perfil.

---

## D-05 — Flujo OAuth2 Authorization Code + PKCE (SPA) y Client Credentials (M2M)

**Decisión**:
- **SPA Angular** (cliente público): Authorization Code + PKCE (`code_challenge` S256). Redirección a `/authorize` del Auth Server; autenticación del usuario (correo+contraseña validados contra el almacén de credenciales de Auth, verificando estado de correo verificado); emisión de `authorization_code`; intercambio en `/token` con `code_verifier` ⇒ JWT de acceso (corta duración) + refresh token (rotado, almacenado en Redis).
- **M2M** (servicio↔servicio cuando un servicio actúa en nombre propio, p. ej. trabajos del Orquestador): Client Credentials con `client_id`/`client_secret` gestionados en `oauth_clients`.
- **Validación de tokens**: el API Gateway valida la firma JWT y consulta la **blacklist en Redis** en cada solicitud entrante; el logout añade el `jti`/refresh a la blacklist con TTL = vida residual del token (efecto inmediato, FR-004).

**Rationale**: cumple el Principio VII y `technology.md` §1.6/§scope §Servidor de Autenticación al pie de la letra. PKCE protege al cliente público sin secreto; la rotación de refresh tokens mitiga robo de token.

**Alternativas consideradas**: Implicit Flow (obsoleto/inseguro) y Resource Owner Password Credentials (desaconsejado por OAuth 2.1) descartados; sesiones con cookie de servidor descartadas por ser SPA + API stateless.

---

## D-06 — Propiedad de datos de aprendizaje y progreso

**Decisión**:
- **Aprendizaje** posee el registro autoritativo de contenido y evaluación: `articles`, `article_versions`, `quizzes`, `questions`, `quiz_attempts` (**historial completo de intentos**, FR-016) y estadísticas de interacción por artículo.
- **Usuarios** posee la **agregación de progreso**: `progress` (puntos acumulados), `quiz_best_score` (mejor puntaje por (usuario, cuestionario) para el cálculo de puntos, FR-014), `article_views` (historial de artículos vistos, FR-015) y reportes estadísticos (FR-018).
- El "mejor puntaje" existe en dos vistas con propósitos distintos: Aprendizaje guarda **todos** los intentos (fuente de verdad de evaluación); Usuarios deriva el **mejor** por cuestionario para puntos (fuente de verdad de progreso). No hay acceso cruzado a BD: Usuarios recibe el puntaje vía la saga de calificación (D-07).
- **Registro de vista de artículo** (FR-015): operación explícita del usuario enrutada por el Gateway a `Users.RecordArticleView`; en paralelo, `Learning.GetArticle` incrementa el contador agregado del artículo. Son escrituras independientes en servicios distintos (sin acceso cruzado).

**Rationale**: respeta database-per-service (Principio III). La duplicación aparente del concepto "mejor puntaje" es en realidad una partición de responsabilidades: evaluación (Aprendizaje) vs. gamificación/progreso (Usuarios).

**Alternativas consideradas**: que Usuarios consuma un evento `QuizGraded` para actualizar progreso → viola Principio V (Usuarios no es consumidor de eventos). Por eso la actualización de progreso se hace por Saga vía gRPC (D-07).

---

## D-07 — Saga de calificación → progreso → notificación → auditoría (FR-027)

**Decisión**: saga canónica coordinada por el Orquestador al enviar un cuestionario:
1. `Learning.GradeAndStoreAttempt(userId, quizId, answers)` → califica y persiste el intento (siempre se registra, FR-016); devuelve `score` y `attemptNumber`.
2. `Users.ApplyQuizScore(userId, quizId, score)` → si `score` supera el mejor histórico, actualiza `quiz_best_score` y recalcula `progress.points`; operación **idempotente y monótona** (aplicar el mismo o menor puntaje no cambia nada).
3. El Orquestador publica `QuizGraded` (→ Auditoría) y `ActivityOccurred`/`ProgressMilestone` (→ Notificación: resultado in-app + hito de progreso).

**Compensación**: como el paso 1 siempre debe persistir el intento y el paso 2 es idempotente y monótono, no hay compensación destructiva: si el paso 2 falla, el Orquestador reintenta; el intento ya registrado es correcto por sí mismo. Si la publicación de eventos falla, se reintenta (outbox transaccional en el Orquestador).

**Rationale**: satisface FR-027 (consistencia eventual con compensación) y SC-008 (< 0,1% inconsistencia residual). La monotonía del best-score elimina la necesidad de rollback complejo, simplificando la saga.

**Alternativas consideradas**: actualizar progreso síncronamente dentro de Aprendizaje → viola Principio I/III (Aprendizaje no posee progreso); 2PC → prohibido por Principio VI.

---

## D-08 — Anonimización Ley 1581 como Saga, preservando auditoría (FR-030/FR-031)

**Decisión**: la eliminación de cuenta es una **Saga de anonimización** coordinada por el Orquestador:
1. `Auth.RevokeAndAnonymizeCredential(userId)` → invalida credenciales/refresh tokens (blacklist), anonimiza correo.
2. `Users.AnonymizeProfile(userId)` → reemplaza PII (correo, nombre, preferencias) por valores anonimizados, marca `estado de cuenta = anonimizada`, conserva métricas agregadas no identificables.
3. `Learning.AnonymizeAttempts(userId)` y `Simulator.AnonymizeHistory(userId)` → disocian PII de los registros operacionales (conservan datos estadísticos despersonalizados).
4. El Orquestador publica `AccountAnonymized` (→ Auditoría) con **identificador opaco** del actor.

**Invariante**: el **registro de auditoría es inmutable y append-only** (Principio §Cumplimiento + FR-025) y **se conserva ≥ 5 años** (FR-031); referencia al actor mediante **ID opaco** que no permite re-identificar al titular tras la anonimización. La exportación portable de datos queda **fuera del MVP** (FR-031).

**Compensación**: la anonimización es un punto sin retorno por diseño; cada paso es idempotente. Si un paso falla, el Orquestador reintenta hasta completar (no se "des-anonimiza"). El estado de la saga persiste en `saga_state` para reanudación.

**Rationale**: concilia el derecho de supresión (Ley 1581) con la obligación de trazabilidad regulatoria (auditoría inmutable) mediante anonimización de PII + IDs opacos, exactamente como fija la clarificación Q3 de la spec.

**Plazos**: consulta ≤ 10 días hábiles; reclamos/supresión ≤ 15 días hábiles (SC-011). La operación técnica es inmediata; los plazos son SLA de proceso.

---

## D-09 — Canales de notificación: email (seguridad/identidad) + bandeja in-app (actividad)

**Decisión**: el Servicio de Notificación consume eventos de RabbitMQ y entrega por dos canales:
- **Email** (`nodemailer`): eventos críticos de seguridad/identidad — verificación de correo, cambio/restablecimiento de contraseña, alertas de seguridad. Con reintentos ante fallos transitorios del proveedor (backoff + dead-letter queue).
- **Bandeja in-app** (tabla PostgreSQL propia): eventos de actividad — artículos nuevos, recordatorios, hitos de progreso, resultados de cuestionario. Persiste `estado de lectura` y `marca temporal`; el usuario consulta la bandeja vía Gateway → (¿cómo, si Notificación no expone gRPC?).

**Aclaración de lectura de la bandeja**: Notificación es **consumidor puro** y **no expone gRPC** (Principio V / `scope.md`). Por tanto la **bandeja in-app se lee** mediante una de dos opciones, resuelta a favor de la primera: **(a)** el Servicio de **Usuarios** expone la consulta de bandeja, materializando una vista de notificaciones in-app del usuario a partir de los mismos eventos de actividad que también consume Notificación — **descartada** porque Usuarios no es consumidor de eventos (Principio V). **(b) Adoptada**: la bandeja in-app la **posee Notificación** y se **expone como un endpoint REST de solo lectura servido por el API Gateway que consulta directamente** — también inválida porque el Gateway no accede a BD de dominio. **Decisión final (c)**: Notificación, al ser consumidor puro sin gRPC, expone su bandeja **únicamente a través de un canal de lectura dedicado**; para no violar la topología, **el MVP materializa la bandeja in-app dentro del Servicio de Usuarios** vía la **Saga de actividad**: cuando el Orquestador publica un evento de actividad, también invoca `Users.AppendInAppNotification` por gRPC. Así Usuarios posee y sirve la bandeja (lectura con estado/typestamp, FR-023) y Notificación gestiona el canal **email**. Ver nota de implementación abajo.

> **Nota de implementación (resolución de la bandeja in-app)**: para respetar estrictamente el Principio V (Notificación/Auditoría como únicos consumidores; Notificación sin gRPC) y a la vez permitir lectura de la bandeja por el usuario, la **bandeja in-app es propiedad del Servicio de Usuarios** (que sí expone gRPC y es alcanzable por el Gateway). El **Servicio de Notificación** queda responsable del canal **email** (consumidor de eventos de seguridad/identidad). Los eventos de actividad que alimentan la bandeja se escriben en Usuarios mediante un paso gRPC de la saga de actividad coordinada por el Orquestador (`Users.AppendInAppNotification`). Esto mantiene: REST solo en el borde, gRPC interno, sin consumidores de eventos fuera de Notificación/Auditoría, y un único dueño de la bandeja consultable.

**Rationale**: alinea la clarificación Q4 (email + in-app, sin SMS/push) con la restricción de que Notificación es consumidor puro sin gRPC. El email permanece en Notificación (canal saliente puro dirigido por eventos); la bandeja consultable vive donde puede ser leída por el usuario sin romper la topología.

**Alternativas consideradas**: exponer gRPC en Notificación → viola Principio V/scope; cache de bandeja en Redis → viola Principio IV.

---

## D-10 — Representación canónica de Decimal en contratos

**Decisión**: tipo lógico `DecimalString` = `string` con formato decimal canónico (`^-?\d+(\.\d+)?$`, sin notación científica, sin separadores de miles, punto como separador decimal). Usado en todos los `.proto` y payloads JSON para montos, tasas y resultados. Validación en frontera: parsear a la librería decimal nativa, rechazar overflow/escala inválida.

**Rationale**: Principio VIII prohíbe `float`/`double` en proto y número JSON. Una representación canónica única evita ambigüedad de escala entre lenguajes.

**Alternativas consideradas**: mensaje proto `{units int64, nanos int32}` (estilo `google.type.Money`) → insuficiente para tasas con > 9 decimales y escalas variables de simulación; descartado.

---

## D-11 — Migraciones y aislamiento de datos

**Decisión**: cada servicio gestiona sus propias migraciones versionadas (`golang-migrate` para Go; TypeORM migrations para NestJS; `sqlx::migrate!` para Rust) contra su instancia lógica PostgreSQL exclusiva, con usuario/credencial propios. Pooling por servicio (pgx pool / TypeORM pool / sqlx pool). Réplicas de lectura habilitables para Usuarios y Aprendizaje (catálogo/progreso de alta lectura, SC-003/SC-005).

**Rationale**: Principio III (soberanía de datos). Migraciones por servicio evitan esquema compartido y acoplamiento de despliegue.

**Alternativas consideradas**: una instancia PostgreSQL con esquemas separados → viola "ni esquemas compartidos ni credenciales reutilizadas".

---

## D-12 — Observabilidad, health checks y SLO 99,9%

**Decisión**: cada servicio expone logs estructurados (JSON), métricas básicas (latencia, tasa de error, throughput) y health/readiness checks consumibles por Kubernetes. HPA por servicio; mínimo 2 réplicas para servicios de la ruta crítica de usuario (Gateway, Auth, Usuarios, Aprendizaje, Simulador) para sostener 99,9% mensual (SC-012) excluyendo mantenimiento planificado. Auditoría es la fuente autoritativa de trazabilidad regulatoria; los logs operacionales NO la sustituyen.

**Rationale**: cumple §Observabilidad de la constitución y el objetivo de disponibilidad. La redundancia básica (réplicas + balanceo) es el supuesto explícito del SLO en la spec (Assumptions).

**Alternativas consideradas**: instancia única por servicio → incompatible con 99,9% y con recuperación ante fallos.

---

## D-13 — Estrategia de pruebas

**Decisión**:
- **Contrato gRPC**: `buf lint` + `buf breaking` en CI; pruebas productor↔consumidor por par de servicios.
- **Saga**: pruebas de integración para registro, verificación, calificación→progreso→notificar→auditar y anonimización, incluyendo inyección de fallo en cada paso y verificación de compensación/reintento.
- **Numérico (Simulador)**: casos de borde obligatorios — montos extremos, redondeo bancario half-even, división con resto, tasas atípicas, plazos largos (SC-004, Disciplina §Calidad).
- **Eventos RabbitMQ**: pruebas de esquema de evento (productor) y de consumo idempotente (Notificación/Auditoría).
- **E2E**: Playwright sobre la SPA para las 4 historias priorizadas.

**Rationale**: cubre los puntos exigidos por la constitución (§Calidad y Pruebas) y los criterios de éxito medibles.

---

## D-14 — Moneda principal COP y conversión auxiliar

**Decisión**: COP es la moneda base de los simuladores (`NUMERIC(19,2)`); el soporte multimoneda se limita a conversión/cálculo auxiliar con tasa provista como parámetro de simulación (no se integra un proveedor externo de tasas de cambio en el MVP). Toda conversión usa decimal arbitrario y redondeo half-even explícito.

**Rationale**: alinea FR-020 y Assumptions de la spec; evita dependencia externa de FX en el MVP manteniendo la puerta abierta a integrarla después.

**Alternativas consideradas**: integrar API de tasas en tiempo real → fuera de alcance MVP; añade dependencia externa y superficie de fallo.

---

## Resumen de incógnitas resueltas

| Incógnita potencial | Estado | Decisión |
|---------------------|--------|----------|
| Versiones del stack | Resuelta | D-01 |
| Librerías de precisión decimal | Resuelta | D-02 |
| Auditoría de simulaciones (Simulador no productor) | Resuelta | D-03 |
| Frontera Auth/Usuarios y registro | Resuelta | D-04 |
| Flujos OAuth2 concretos | Resuelta | D-05 |
| Propiedad de progreso e historiales | Resuelta | D-06 |
| Saga de calificación | Resuelta | D-07 |
| Anonimización Ley 1581 + auditoría inmutable | Resuelta | D-08 |
| Canales de notificación y lectura de bandeja in-app | Resuelta | D-09 |
| Representación de Decimal en contratos | Resuelta | D-10 |
| Migraciones / aislamiento de datos | Resuelta | D-11 |
| Observabilidad / SLO | Resuelta | D-12 |
| Estrategia de pruebas | Resuelta | D-13 |
| Moneda COP / multimoneda | Resuelta | D-14 |

**Sin `NEEDS CLARIFICATION` pendientes.** Listo para Phase 1.
