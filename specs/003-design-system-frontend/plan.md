# Implementation Plan: Rediseño del Frontend contra el Design System

**Branch**: `003-design-system-frontend` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-design-system-frontend/spec.md`

**Constraints applied from**: `.specify/memory/constitution.md` (**v1.1.1**),
`specs/002-calculator-builder-content-admin/plan.md` (biblioteca de componentes)

## Summary

Feature **exclusivamente de presentación**. No toca backend, contratos, eventos ni base de
datos: los ocho microservicios quedan intactos y ningún archivo fuera de `frontend/` cambia
salvo la deduplicación de logotipos.

El trabajo no es "aplicar estilos a pantallas sin estilar" —esa lectura habría llevado a
apilar una capa más de CSS sobre la existente, que es exactamente cómo se llegó hasta aquí—.
La aplicación **ya consume los tokens** y tiene una capa de primitivas hecha a mano en
`frontend/src/styles.scss`: 116 líneas, 15 clases, comentadas como "inspiradas en" los
componentes del design system. Es un **duplicado parcial** de la biblioteca compartida que
entrega el feature 002 —le faltan `Card`, `Tabs`, `Avatar`, `Badge`, `ProgressBar`, `Tag`,
`Icon` y `BrandLogo`— y todo lo que no alcanza a cubrir se resolvió con 94 atributos de estilo
escritos a mano dentro de las plantillas.

Por tanto el plan **retira una capa en lugar de añadirla**: `styles.scss` se vacía clase a
clase a medida que cada grupo de pantallas migra a la biblioteca compartida, y **su
eliminación es el criterio de terminación medible** del feature.

Tres hallazgos de la investigación gobiernan el resto del plan. Primero, **no existe ni un
`@media` en todo el frontend** ni ningún token de punto de corte: el responsive no se
"conserva", se define aquí por primera vez (D-27). Segundo, las pruebas de extremo a extremo
existentes seleccionan por rol y etiqueta accesible en 100 de 109 casos, así que **sirven sin
reescribirse** como red de regresión y, de paso, verifican la accesibilidad de forma continua
(D-29). Tercero, el armazón de la aplicación es una vigésima superficie que el spec no contaba
y que se ve en el 100 % de las vistas (D-30).

## Technical Context

**Language/Version**: TypeScript 5.6 + Angular 19. Sin cambios respecto de 001.

**Primary Dependencies**: **ninguna nueva**. Este feature consume lo que instala el feature 002
(`lucide-angular`, `@fontsource/ibm-plex-mono`) y la biblioteca `frontend/src/app/shared/ui/`
que ese feature entrega. No introduce librerías de UI, de maquetación ni de utilidades CSS.

**Storage**: N/A. Sin persistencia, sin estado nuevo, sin llamadas nuevas a la API.

**Testing**:

- **Regresión funcional**: las 4 suites de `frontend/e2e/` **sin modificar** (D-29). Se
  ejecutan tras migrar cada grupo, no al final, para que un fallo apunte a un grupo concreto.
- **Accesibilidad**: verificación automatizada por pantalla (recorrido por teclado, etiqueta
  asociada, contraste) más los `getByRole`/`getByLabel` que ya ejercitan las suites existentes.
- **Visual**: comparación por captura contra el kit de referencia, por pantalla y por punto de
  corte.
- **Barrera de estilo**: regla que rechaza el atributo de estilo en línea (FR-089).

**Target Platform**: navegadores modernos de escritorio y móvil. **Ancho mínimo soportado
360 px** (D-27) — hoy no hay ninguno definido, porque no hay responsive.

**Project Type**: Web — solo el frontend de la SPA.

**Performance Goals**: no degradar lo existente. La biblioteca compartida sustituye clases
globales por componentes con estilo encapsulado; el presupuesto de tamaño declarado en
`angular.json` es la barrera y no debe crecer por encima de él.

**Constraints**:

- **Principio VIII (NON-NEGOTIABLE)**: las pantallas de simuladores, historial, progreso y
  reporte muestran dinero. Ninguna conversión que pueda alterar la precisión decimal
  (FR-109, FR-113).
- **Sin cambio funcional** (FR-121) y **sin resolver carencias de datos** (FR-122).
- **Frontera con el feature 002** en la pantalla del editor (FR-123).
- Los kits son autoridad **visual**, nunca de comportamiento.

**Scale/Scope**: 6 historias (3×P1, 3×P2); 38 requisitos (FR-086…FR-123); 11 criterios
(SC-027…SC-037); **19 pantallas + el armazón**; 94 estilos en línea a eliminar; 116 líneas de
capa artesanal a retirar; 4 tokens de punto de corte a añadir; 3 componentes compartidos
nuevos.

## Constitution Check

*GATE: debe pasar antes de Phase 0. Re-evaluado tras Phase 1.*

| # | Principio | Estado | Cómo lo cumple el diseño |
|---|-----------|--------|--------------------------|
| I | Bounded Contexts y Microservicios | ✅ N/A | Ningún servicio se toca. El feature vive por completo en `frontend/` |
| II | gRPC interno, REST en el borde | ✅ N/A | No se añade ni se modifica ninguna llamada. La SPA sigue hablando solo con el Gateway |
| III | Database-per-service | ✅ N/A | Sin acceso a datos |
| IV | Uso acotado de Redis | ✅ N/A | Sin infraestructura |
| V | RabbitMQ solo a Notificación/Auditoría | ✅ N/A | Sin eventos |
| VI | Saga vía Orquestador | ✅ N/A | Sin operaciones multi-servicio |
| VII | Autenticación/autorización estandarizada | ✅ PASS | El armazón sigue derivando la navegación del rol del usuario (D-30); no se añade lógica de autorización en la vista, y la verificación efectiva sigue siendo del Gateway |
| VIII | Precisión monetaria (NON-NEGOTIABLE) | ✅ PASS | FR-109 y FR-113 lo imponen; se reutilizan los ayudantes decimales ya existentes y se hereda la barrera de análisis estático que el feature 002 instala para el frontend. **Regla adicional de este feature**: una cifra monetaria nunca trunca visualmente — se reduce el contenedor, porque una cifra cortada es un dato falso (D-32) |
| IX | Arquitectura en capas y mapeo explícito | ✅ PASS | Se respeta la asignación normativa del Angular: `core/` para interceptores y guardas, `features/*/services/` para la aplicación, `shared/` para lo compartido. Los componentes de presentación **no** ganan lógica de negocio: este feature no mueve ninguna regla desde `features/*/services/` a una plantilla |
| X | Entrypoints delgados y configuración por entorno | ✅ PASS | Sin configuración nueva. Los puntos de corte son tokens del sistema de diseño, no variables de entorno |
| XI | Migraciones versionadas y disciplina de datos | ✅ N/A | Sin esquema |
| XII | Flujo de desarrollo local uniforme | ✅ PASS | Los verbos de `dev/` no cambian. No se añade ningún paso manual |

**Resultado del gate**: ✅ **PASS** — sin violaciones, sin Complexity Tracking.

**Re-evaluación tras Phase 1**: ✅ **PASS**. Un punto mereció atención: los **puntos de corte**
son una adición al sistema de diseño versionado, no una desviación de un principio. Se declaran
junto al resto de tokens para que features posteriores los hereden, en lugar de repetirse como
números sueltos en cada pantalla — que es la forma en que un sistema de diseño se erosiona.

## Project Structure

### Documentation (this feature)

```text
specs/003-design-system-frontend/
├── plan.md              # Este archivo (/speckit-plan)
├── spec.md              # Especificación
├── research.md          # Phase 0 — decisiones D-26…D-32
├── quickstart.md        # Phase 1 — verificación por grupo de pantallas
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

**Sin `data-model.md`**: el feature no introduce ni modifica ninguna entidad (FR-121, spec
§Key Entities). Crear el archivo vacío solo sugeriría que hay un modelo que revisar.

**Sin `contracts/`**: no cambia ninguna interfaz. La SPA consume los mismos endpoints del
Gateway con la misma forma. Si durante la implementación una pantalla necesitara un dato que la
API no expone, FR-122 obliga a **reportarlo como hallazgo**, no a resolverlo aquí — y ese
hallazgo abriría un feature propio con su contrato.

### Source Code (repository root)

Solo se listan las rutas que este feature toca. **Nada fuera de `frontend/`** salvo la
deduplicación de logotipos.

```text
frontend/src/
├── styles.scss                              (D) ← se VACÍA clase a clase y se elimina
├── styles/tokens/breakpoints.css            (N) 4 puntos de corte (D-27)
├── styles/tokens/base.css                   (M) primitivas de portal que SÍ sobreviven
├── assets/logo/                             (D) duplicado; se conserva styles/assets/logo/
└── app/
    ├── app.component.ts                     (M) armazón + CSS embebido retirado (D-30)
    ├── shared/ui/
    │   ├── skeleton/                        (N) estado de carga (D-32)
    │   ├── empty-state/                     (N) estado vacío (D-32)
    │   └── error-state/                     (N) estado de error (D-32)
    └── features/
        ├── auth/{login,register,verify-email}/          (M) kit auth — 3
        ├── learning/{catalog,article,quiz,progress}/    (M) kit learner — 4
        ├── notifications/                               (M) kit learner — 1
        ├── simulators/{selector,forms,result,history}/  (M) kit simulators — 4
        ├── profile/{,password,report,delete-account}/   (M) sin kit — 4
        └── editorial/{editor,review,versions}/          (M) kit editorial — 3
                                                             (solo el marco, FR-123)

frontend/e2e/                                (=) SIN MODIFICAR — red de regresión (D-29)
```

`(N)` nuevo · `(M)` modificado · `(D)` eliminado · `(=)` intacto por decisión

**Structure Decision**: no se crea ninguna estructura nueva. Las 19 pantallas se quedan donde
están —este feature cambia cómo se ven, no dónde viven— y los tres componentes de estado se
añaden a la biblioteca compartida del feature 002, nunca a la carpeta de una pantalla (FR-087).

## Notas de Diseño

Continúan la numeración de 002 §Notas de Diseño (N-01…N-11).

**N-12 — Retirar una capa, no añadir otra.** El instinto ante "la interfaz se ve pobre" es
escribir estilos. Aquí sería el error exacto que produjo el problema: ya hay dos capas —los
tokens y la capa artesanal de `styles.scss`— y las plantillas parchean lo que ninguna resuelve
con 94 estilos en línea. Una tercera capa dejaría tres compitiendo. El plan **sustituye** la
artesanal por la biblioteca compartida y mide el avance por lo que desaparece, no por lo que se
escribe.

**N-13 — Las pruebas existentes son la red, y por eso no se tocan.** Un rediseño total suele
arrastrar la reescritura de la batería de pruebas, y entonces esta deja de demostrar nada: se
adapta la aserción al cambio. Aquí las suites seleccionan por rol y etiqueta accesible en **100 de
109** casos, así que sobreviven al rediseño **y fallan si este rompe la accesibilidad**. De los
9 restantes, **4 seleccionan por estructura del DOM y sí son frágiles** — ver D-29.
Son simultáneamente red de regresión funcional y verificación continua de FR-093…FR-095.
Modificarlas para "que pasen" sería destruir la única garantía dura del feature.

**N-14 — El panel de marca no se oculta en móvil.** Es la tentación evidente al estrechar el
card partido de acceso, y sería revertir el feature en el dispositivo donde más gente entra:
volveríamos al formulario anónimo. Se degrada a banda superior compacta con logotipo y titular,
conservando lo que identifica a la plataforma y sacrificando solo los tres indicadores.

**N-15 — Una cifra monetaria nunca trunca.** El desbordamiento se resuelve truncando títulos
con indicación visible, pero jamás cifras: `$1.234.567` recortado a `$1.234…` no es un texto
incompleto, es un **dato falso**. Si no cabe, se reduce el contenedor o se cambia la
disposición. Es la expresión visual del Principio VIII.

**N-16 — El armazón entra aunque el spec dijera "19 pantallas".** La barra superior se ve en
el 100 % de las vistas. Migrar las 19 y dejarla con la estética anterior produciría un marco
viejo alrededor de contenido nuevo — el peor resultado posible y el más visible. La ampliación
es pequeña y queda registrada en D-30 en lugar de colarse como tarea silenciosa.

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| El feature 002 y este colisionan en la pantalla del editor | Conflictos repetidos y trabajo perdido | FR-123 acota este feature al marco; el grupo editorial se migra **el último** (D-28), cuando 002 ya asentó la superficie de redacción |
| La biblioteca compartida de 002 no está lista a tiempo | Bloqueo total: todas las historias dependen de ella | Es dependencia dura y declarada. Si 002 se retrasa, este feature no arranca; no se improvisan componentes locales, que sería reconstruir la capa artesanal |
| Durante la migración conviven dos estéticas | Percepción de producto inconsistente | Se despliega por **kit completo**, nunca pantalla suelta: el usuario percibe "el módulo cambió", no "esta pantalla está rara" |
| El responsive se define por primera vez y los kits no lo especifican | Decisiones improvisadas pantalla a pantalla | Cuatro puntos de corte como tokens + regla de degradación por disposición fijadas en D-27, antes de tocar la primera pantalla |
| Adaptar una prueba de extremo a extremo "para que pase" | Se pierde la única garantía de que nada funcional cambió | Las suites no se modifican (D-29). Si una falla, el fallo es del rediseño, no de la prueba |
| Un requisito visual exige un dato que la API no expone | El feature se convierte en refactorización de producto | FR-122: se reporta como hallazgo y se difiere; no se resuelve aquí |

## Phase 2 (no ejecutada aquí)

`/speckit-tasks` generará `tasks.md`. Orden por dependencias: tokens de punto de corte y
componentes de estado → armazón → kit auth → kit learner → kit simulators → perfil → kit
editorial → eliminación de `styles.scss` y barrera de estilo. Cada grupo cierra ejecutando las
suites de extremo a extremo sin modificarlas y retirando del archivo artesanal las clases que
ya no referencia nadie.
