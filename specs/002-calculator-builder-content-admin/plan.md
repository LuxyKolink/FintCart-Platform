# Implementation Plan: Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido

**Branch**: `002-calculator-builder-content-admin` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-calculator-builder-content-admin/spec.md`

**Constraints applied from**: `.specify/memory/constitution.md` (**v1.1.1**),
`specs/001-fintcart-platform/plan.md` (arquitectura vigente)

## Summary

Enmienda al feature `001-fintcart-platform`, ya implementado y desplegado. No introduce
servicios nuevos ni componentes de infraestructura nuevos: los ocho microservicios y la SPA
siguen siendo los mismos, con la misma topología gRPC/REST, la misma asignación de
lenguajes y las mismas siete bases PostgreSQL.

El cambio de mayor calado es que el **Simulador deja de ser un conjunto cerrado de cinco
calculadoras cableadas y pasa a ser un motor de definiciones parametrizadas**: un analizador
que valida una expresión al guardarla, un AST persistido y un evaluador acotado, todo en
precisión decimal arbitraria. Las cinco calculadoras de FR-019 se resiembran como siete
definiciones sobre ese mismo motor. La investigación (research D-16) confirma que **son
reproducibles**: las salidas ya son escalares, no hay entradas de longitud variable, y el
código vigente ya distingue potencia entera exacta de potencia decimal aproximada, que es
justo la distinción de la que depende la exactitud.

El resto del alcance se reparte así: **Aprendizaje** gana el catálogo de categorías, las
sesiones de cuestionario con muestreo aleatorio, el cuerpo de artículo como documento de
bloques y las imágenes en `BYTEA`; **Usuarios** gana el rol `administrador`, el estado
`pending_deletion` con período de gracia de 30 días y la ampliación del índice de reserva de
correo; el **Orquestador** gana dos barridos periódicos —purgas vencidas y calendario de
indicadores— y la publicación de sus eventos; el **Gateway** gana la superficie REST
correspondiente y el middleware de rol administrador.

Ninguna decisión de este plan requiere enmienda constitucional. La única que la habría
exigido —almacenar imágenes en un almacén de objetos— se resolvió por la vía que no la
necesita, con la razón documentada en research D-13.

## Technical Context

**Language/Version**: sin cambios respecto de 001. Go 1.24 (Gateway, Auth, Orquestador,
Usuarios, Auditoría) · Rust 1.85 (Simulador) · TypeScript 5.6 + NestJS 11 (Aprendizaje) ·
TypeScript 5.6 Node puro (Notificación) · TypeScript 5.6 + Angular 19 (Frontend).

**Primary Dependencies** — solo se añaden estas; el resto se hereda de 001:

| Servicio | Dependencia nueva | Para qué |
|----------|-------------------|----------|
| Simulador (Rust) | ninguna | El analizador y el evaluador se escriben a mano sobre `rust_decimal`, que **ya trae la característica `maths`** (`Cargo.toml:31`). Meter un motor de expresiones de terceros introduciría aritmética que no controlamos en la ruta donde el Principio VIII es NON-NEGOTIABLE |
| Aprendizaje (NestJS) | `sharp` | Leer dimensiones y validar que los bytes recibidos son realmente la imagen que el `mime_type` declara (FR-066) |
| Frontend (Angular) | `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` | Editor enriquecido sobre un modelo de documento que **ya es** el árbol de bloques que se persiste (research D-24) |
| Frontend (Angular) | `lucide-angular`, `@fontsource/ibm-plex-mono` | Sustituyen **dos dependencias de CDN en tiempo de ejecución** por dependencias del bundle: los iconos que `design/guidelines/brand-iconography.html` sirve desde lucide.dev, y la fuente de las cifras en COP que `tokens/fonts.css:9` importa desde `fonts.googleapis.com`. En el VPS del CTIC, un fallo de red externo no debe degradar la interfaz |

**Storage**: PostgreSQL 16, sin instancias nuevas. Tres bases tocadas — `learning_db`
(categorías, sesiones, documento de bloques, imágenes), `simulator_db` (calculadoras,
definiciones, indicadores), `users_db` (estado de cuenta, rol). Redis **sin cambios**: el
Principio IV lo acota a blacklist JWT y rate limiting, y la sesión de cuestionario vive en
PostgreSQL por eso mismo (research D-17). RabbitMQ gana seis eventos, todos a
Notificación/Auditoría.

**Migraciones**: trece migraciones emparejadas `up`/`down`, con `golang-migrate` uniforme
(Principio XI). Tres llevan **conversión de datos** y son las de mayor riesgo:

| Migración | Riesgo |
|-----------|--------|
| `articles.category` → `category_id` | Debe poblar antes de imponer `NOT NULL`; el orden inverso deja artículos huérfanos |
| `score`/`pass_threshold` → escala 0–100 | Exacta solo si el banco de preguntas no cambió tras el intento; emite el recuento de casos aproximados (research D-18) |
| `body` → `body_doc` | Se aplica en dos pasos: primero añadir y poblar, y solo en una migración posterior eliminar `body` |

**Testing**: se hereda el marco de 001. Obligatorio añadir:

- **Suite de regresión de las semillas** (`cargo test --test seed_regression`): compara,
  calculadora por calculadora y sobre casos de borde numérico, el resultado del motor contra
  los valores que producía el código nativo. **Es la prueba que sostiene SC-015 y FR-049**;
  si falla, el alcance se renegocia antes de seguir.
- Pruebas del analizador: rechazo de campo inexistente, expresión mal formada, exponente no
  entero en `pot`, indicador desconocido, límite de nodos y de profundidad.
- Pruebas del evaluador: división por cero, desbordamiento, valor no representable.
- Pruebas del validador de documento: nodo desconocido, marca desconocida, `href` con
  esquema `javascript:` y `data:`.
- Pruebas de la migración de calificaciones sobre un cuestionario cuyo banco cambió.
- Pruebas de saga para la purga vencida, con compensación en cada paso.

**Target Platform**: sin cambios. Dos VPS del CTIC (Ubuntu 24.04, **4 GB RAM / 2 vCPU /
80 GB**) para el despliegue actual, Kubernetes como destino de producción. **Esta
restricción es la que decide research D-13**: la caja ya necesita 2 GB de swap para
construir, y un almacén de objetos más sería un contenedor, un volumen y una segunda ruta
de respaldo sobre un presupuesto ya agotado.

**Project Type**: Web — microservicios poliglota + SPA. Sin cambios.

**Performance Goals**: se conservan los de 001 (SC-003, SC-005, SC-007). Se añade: la
evaluación de una calculadora tiene **coste acotado por construcción**, porque el AST
persistido ya pasó los límites de ≤ 64 nodos y profundidad ≤ 16 al guardarse. No hace falta
ningún vigilante de tiempo de ejecución.

**Constraints**: los doce principios de 001, más los específicos de este feature —
Redis no admite estado de sesión de negocio (IV); el Simulador no puede producir eventos
(V); Aprendizaje no puede leer `simulator_db` para validar una calculadora incrustada (III);
la validación del documento enriquecido es del servidor y el esquema del editor en el
cliente no cuenta (FR-068).

**Scale/Scope**: 8 historias de usuario (3×P1, 4×P2, 1×P3); 54 requisitos funcionales
(FR-032…FR-085); 14 criterios de éxito (SC-013…SC-026); 8 entidades nuevas o modificadas;
9 de los 9 componentes tocados; 13 migraciones; 6 eventos nuevos; 11 componentes de UI
portados a Angular y 8 pantallas nuevas construidas sobre ellos.

## Constitution Check

*GATE: debe pasar antes de Phase 0. Re-evaluado tras Phase 1.*

| # | Principio | Estado | Cómo lo cumple el diseño |
|---|-----------|--------|--------------------------|
| I | Bounded Contexts y Microservicios | ✅ PASS | Sin servicios nuevos. Aprendizaje referencia calculadoras por **identificador opaco** y valida por gRPC (D-25); nunca comparte tipos de dominio con el Simulador. Los deltas de contrato viven en `contracts/`, la única superficie compartida |
| II | gRPC interno, REST en el borde | ✅ PASS | Los ~20 endpoints nuevos son **todos** del Gateway, incluida la subida multiparte de imágenes. Ningún servicio interno gana superficie HTTP |
| III | Database-per-service | ✅ PASS | Imágenes en `learning_db`, calculadoras e indicadores en `simulator_db`, estado de cuenta en `users_db`. El barrido de purgas pregunta por **`Users.ListAccountsDueForPurge`** (gRPC), no leyendo `users_db` (D-20); la validación de una calculadora incrustada es una llamada gRPC al Simulador, no una consulta a su base (D-25) |
| IV | Uso acotado de Redis | ✅ PASS | **Cero uso nuevo.** La sesión de cuestionario —que es el candidato obvio a Redis— vive en `quiz_sessions` de `learning_db` precisamente porque un almacén de sesiones de negocio está PROHIBIDO (D-17) |
| V | RabbitMQ solo a Notificación/Auditoría | ✅ PASS | Los 6 eventos nuevos van solo a esas dos colas. **El Simulador sigue sin ser productor**: el aviso de indicadores y la publicación de calculadora los emite el Orquestador, mismo patrón que D-03 (D-23) |
| VI | Saga vía Orquestador | ✅ PASS | La purga vencida **reutiliza la saga de anonimización existente** con sus compensaciones. El barrido periódico es **secuenciación, no dominio**: decide *cuándo* correr, mientras que *qué cuentas están vencidas* lo responde Usuarios por gRPC. Ver §Notas de Diseño N-06 |
| VII | Autenticación/autorización estandarizada | ✅ PASS | `administrador` se añade a los claims de rol existentes; la verificación es **middleware explícito de la capa de transporte** del Gateway (FR-081), no lógica dispersa ni ocultación de botones. Ningún mecanismo de identidad nuevo |
| VIII | Precisión monetaria (NON-NEGOTIABLE) | ✅ PASS | `NUMERIC(20,6)` en indicadores; `string` decimal en todo el contrato nuevo; el evaluador opera solo en `Decimal`. **El motor de fórmulas se escribe a mano y no se delega en una librería de expresiones**, porque un motor de terceros metería aritmética fuera de nuestro control justo donde este principio no admite excepción. `pot`/`potd` separadas para no perder exactitud donde hoy no se pierde (D-16) |
| IX | Arquitectura en capas y mapeo explícito | ✅ PASS | El analizador, el AST y el evaluador viven en `src/domain/formula/` del Simulador — capa de aplicación, sin importar tipos de transporte ni de fila. La conversión `string` decimal ↔ `Decimal` sigue confinada a `src/grpc/mapping.rs`. El validador de documento vive en la capa de aplicación de Aprendizaje, no en el controlador |
| X | Entrypoints delgados y configuración por entorno | ✅ PASS | `BOOTSTRAP_ADMIN_EMAIL` y los intervalos de barrido son variables de entorno. **El administrador inicial NO se siembra en una migración**: quedaría un usuario privilegiado escrito en el repositorio (D-21) |
| XI | Migraciones versionadas y disciplina de datos | ✅ PASS | 13 migraciones emparejadas con `golang-migrate`; las tres con conversión de datos son transaccionales y ordenadas para no dejar estados intermedios inválidos; `execTx` para las escrituras multi-tabla; errores envueltos con causa |
| XII | Flujo de desarrollo local uniforme | ✅ PASS | Los cuatro verbos de `dev/` **no cambian**. `dev/seed` se extiende con las siete definiciones semilla y los indicadores del año. Cero pasos manuales nuevos: el único requisito de entorno es una variable en el compose |

**Resultado del gate**: ✅ **PASS** — sin violaciones. No se requiere Complexity Tracking.

**Re-evaluación tras Phase 1**: ✅ **PASS**. El diseño de `data-model.md` y de los deltas de
contrato no introdujo ninguna desviación. Dos puntos merecieron atención expresa y se
resolvieron dentro de los principios: el enrutamiento de `account.purge_scheduled` con dos
routing keys para que el correo del titular llegue a Notificación pero **nunca** al registro
inmutable de Auditoría (FR-077 vs FR-031), y la restricción
`calculators_builtin_has_no_owner`, que se relajó a una implicación porque una equivalencia
estricta habría hecho fallar la anonimización del autor de una calculadora publicada.

## Project Structure

### Documentation (this feature)

```text
specs/002-calculator-builder-content-admin/
├── plan.md              # Este archivo (/speckit-plan)
├── spec.md              # Especificación (enmienda a 001)
├── research.md          # Phase 0 — decisiones D-13…D-25
├── data-model.md        # Phase 1 — deltas de esquema por servicio
├── quickstart.md        # Phase 1 — verificación de este feature
├── contracts/           # Phase 1 — DELTAS sobre contracts/ de la raíz
│   ├── README.md
│   ├── proto/learning-delta.proto
│   ├── proto/simulator-delta.proto
│   ├── proto/users-delta.proto
│   ├── openapi/gateway-delta.yaml
│   └── events/events-catalog-delta.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) ✅ 171 tareas
```

### Source Code (repository root)

Sin directorios de servicio nuevos. Se listan solo las rutas que este feature añade o
modifica; los nombres siguen la tabla normativa de la constitución §"Convenciones de
Estructura y Nomenclatura por Tecnología".

```text
contracts/                                  # deltas aplicados aquí; stubs en commit aparte
├── proto/fintcart/learning/v1/learning.proto      (M)
├── proto/fintcart/simulator/v1/simulator.proto    (M)
├── proto/fintcart/users/v1/users.proto            (M)
├── openapi/gateway.yaml                           (M)
└── events/events-catalog.md                       (M)

services/simulator/                          # Rust — el grueso del feature
├── src/domain/formula/
│   ├── ast.rs                               (N) nodos del AST, cerrado
│   ├── lexer.rs                             (N)
│   ├── parser.rs                            (N) texto → AST; valida al GUARDAR
│   ├── eval.rs                              (N) AST → Decimal; coste acotado
│   ├── functions.rs                         (N) pot/potd/cuota/vf_serie/…
│   └── limits.rs                            (N) ≤64 nodos, profundidad ≤16
├── src/domain/indicators.rs                 (N) resolución por vigencia
├── src/domain/seeds/                        (N) las 7 definiciones semilla
├── src/repo/calculators.rs                  (N)
├── src/repo/indicators.rs                   (N)
├── src/grpc/{service,mapping}.rs            (M)
├── src/calculators/                         (D) tras validar la suite de regresión
├── migrations/                              (N) calculators, definitions, indicators
└── tests/seed_regression.rs                 (N) SOSTIENE SC-015 y FR-049

services/learning/                           # NestJS
├── src/categories/                          (N) controller · service · repository
├── src/quizzes/session.service.ts           (N) muestreo y vigencia
├── src/articles/body-doc.validator.ts       (N) vocabulario CERRADO (D-14)
├── src/images/                              (N) subida, validación, servicio de bytes
├── src/pb/                                  (M) stubs regenerados
└── migrations/                              (N) categorías, sesiones, body_doc, imágenes

services/users/                              # Go
├── internal/server/{purge,roles}.go         (N)
├── internal/storer/storer_postgres.go       (M) ListAccountsDueForPurge, estado
├── internal/handler/handler.go              (M)
├── cmd/users/main.go                        (M) BOOTSTRAP_ADMIN_EMAIL idempotente
└── migrations/                              (N) estado, índice de correo, rol

services/orchestrator/                       # Go
├── internal/server/sweeper.go               (N) purgas vencidas + calendario
└── internal/server/saga_purge.go            (N) reutiliza la saga de anonimización

services/api-gateway/                        # Go
├── internal/handler/routes.go               (M) rutas nuevas
├── internal/handler/middleware.go           (M) rol administrador (FR-081)
└── internal/handler/media.go                (N) multiparte + caché inmutable

services/notification/src/email/templates/   (M) 2 plantillas nuevas
services/audit/internal/handler/             (M) consumo de los eventos nuevos

frontend/src/app/shared/ui/                  # capa de componentes del design system
├── {button,input,checkbox,select}/          (N) portados de design/components/forms/
├── {card,module-box,tabs}/                  (N) portados de design/components/layout/
├── {avatar,badge,progress-bar,tag}/         (N) portados de design/components/display/
├── {icon,brand-logo}/                       (N) 25 iconos vía lucide-angular; 5 SVG de marca
├── gallery/                                 (N) verificación visual contra los *.card.html
└── index.ts                                 (N) barril

frontend/src/app/features/
├── admin/{categories,indicators,accounts}/  (N)
├── calculators/{builder,catalog,runner}/    (N)
├── editorial/editor/                        (M) TipTap + desplegable de categorías
├── learning/article/blocks/                 (N) render por componente, SIN innerHTML
└── learning/quiz/                           (M) sesión en vez de cuestionario completo

dev/seed                                     (M) 7 semillas + indicadores del año
dev/docker-compose.yaml                      (M) BOOTSTRAP_ADMIN_EMAIL
deploy/vps/compose.app.yaml                  (M) BOOTSTRAP_ADMIN_EMAIL
```

`(N)` nuevo · `(M)` modificado · `(D)` eliminado

**Structure Decision**: se conserva íntegra la estructura de 001. Este feature no crea
servicios ni capas nuevas: cada pieza entra en la capa que le corresponde por el Principio
IX. El único subsistema con estructura interna propia es el motor de fórmulas, que se aloja
bajo `src/domain/formula/` del Simulador por ser lógica de dominio pura —sin transporte y
sin SQL— y por tanto comprobable sin base de datos ni servidor gRPC.

## Notas de Diseño

Continúan la numeración de `001-fintcart-platform` §Notas de Diseño (N-01…N-05).

**N-06 — El barrido periódico del Orquestador no es lógica de dominio.** El Principio VI
prohíbe al Orquestador tener dominio propio. Un temporizador que cada N minutos pregunta
"¿hay cuentas vencidas?" y "¿hay indicadores por vencer?" y dispara la saga correspondiente
es **secuenciación**, que es exactamente su responsabilidad. La regla de negocio —qué cuenta
está vencida, qué indicador falta— la responden Usuarios y Simulador por gRPC. Poner el
temporizador en Usuarios habría sido peor: obligaría a Usuarios a orquestar una saga
multi-servicio, que es justo lo que el principio le prohíbe.

**N-07 — La sesión de cuestionario es estado de dominio, no caché.** Podría parecer
candidata natural a Redis por ser efímera y con vencimiento. No lo es: el Principio IV
prohíbe explícitamente el almacén de sesiones de negocio, y además el registro de qué
preguntas se sirvieron debe sobrevivir en el intento durante años (FR-039). Por eso
`quiz_attempts.served_snapshot` **duplica** deliberadamente el `served` de la sesión: las
sesiones se purgan al vencer y el historial no puede depender de ellas.

**N-08 — El esquema del editor en el cliente no es la validación.** TipTap declara un
esquema y rechaza nodos fuera de él, pero eso solo protege contra un error del editor, no
contra un cliente manipulado. Aprendizaje valida el documento recibido contra el vocabulario
cerrado de D-14 —nodos, atributos, marcas y esquema de `href`— antes de guardarlo. Es
validación **positiva**: se acepta una lista explícita y se rechaza todo lo demás, que es
sustancialmente más fuerte que limpiar HTML arbitrario.

**N-09 — `pot` y `potd` están separadas porque la exactitud lo exige.** El código vigente ya
distingue `checked_powu` (entero, multiplicación repetida, exacta) de `checked_powd`
(decimal, funciones trascendentes, aproximada), y documenta que en un crédito a 240 meses la
diferencia "llega a los pesos" (`annuity.rs:14`). El lenguaje de fórmulas hereda esa
distinción como dos funciones con nombres distintos, y `pot` **rechaza** un exponente no
entero en lugar de degradar en silencio a la variante aproximada. Fundir las dos en una sola
función `^` sería el modo más fácil de perder, sin que nadie lo note, la exactitud que el
Principio VIII exige.

**N-10 — El correo del titular no puede entrar en Auditoría.** `account.purge_scheduled`
necesita el correo para que Notificación escriba al titular, pero el registro de auditoría se
conserva cinco años y sobrevive a la anonimización (FR-031). Un correo almacenado ahí sería
exactamente el rastro que FR-077 prohíbe. Se resuelve con dos routing keys y dos
proyecciones del mismo evento, no con un evento único enlazado a las dos colas.

**N-11 — La capa de componentes entra aquí por secuencia, no por estética.** Los tokens de
`design/` ya están copiados **idénticos** en `frontend/src/styles/tokens/`, pero los 11
componentes del design system solo existen como referencia React en `design/components/`, y
las 19 pantallas actuales se construyeron sobre las 99 líneas de primitivas de
`tokens/base.css` más 94 atributos `style="..."` en línea. Este feature añade **8 pantallas
nuevas**: si la capa de componentes Angular no existe cuando se escriban, nacen en ese mismo
estilo y hay que rehacerlas después. Por eso T032–T048 están en la fase **bloqueante** y no
en el feature de rediseño. La migración de las 19 pantallas existentes contra los 5 UI kits
de `design/ui_kits/` es el feature **003**, separado a propósito: mezclarlo aquí convertiría
una enmienda de dominio en un rediseño de producto.

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Una semilla no reproduce el resultado nativo | FR-049 y SC-015 fallan; hay que renegociar el alcance | `tests/seed_regression.rs` se escribe **antes** de eliminar `src/calculators/`, y el código nativo no se borra hasta que la suite pasa |
| La reescala de calificaciones es aproximada en cuestionarios cuyo banco cambió | Puntajes históricos ligeramente desplazados | Imposible de evitar: el peso servido histórico no existe. La migración emite el recuento de casos afectados y queda documentado en D-18 |
| `learning_db` crece con las imágenes | Presión de disco y de respaldo en un VPS de 80 GB | Tope de 2 MB, tipos restringidos, direccionamiento por contenido (una imagen repetida no se duplica). Si el catálogo crece, la interfaz `storer` permite sustituir la implementación sin tocar dominio ni contrato (D-13) |
| El editor enriquecido reintroduce `innerHTML` en algún punto | FR-068 y SC-022 comprometidos | El render es por componente y nunca por HTML. `grep` de `innerHTML`/`bypassSecurityTrust` en la verificación del quickstart, promovible a regla de lint |
| `pending_deletion` no se contempla en algún camino de autorización | Una cuenta suspendida podría seguir operando | El estado viaja en `AuthContext`; se trata en el mismo punto donde hoy se trata la falta de verificación de correo, no en un camino nuevo |

## Phase 2 (no ejecutada aquí)

`/speckit-tasks` generará `tasks.md` a partir de estos artefactos. Orden sugerido por
dependencias: contratos y stubs → migraciones → motor de fórmulas y suite de regresión →
categorías → sesiones de cuestionario → rol y purga → documento de bloques e imágenes →
indicadores y barridos → editor y pantallas de administración → calculadora incrustada.
