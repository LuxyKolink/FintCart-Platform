---

description: "Task list for Rediseño del Frontend contra el Design System"
---

# Tasks: Rediseño del Frontend contra el Design System

**Input**: Design documents from `/specs/003-design-system-frontend/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, quickstart.md ✅

> Sin `data-model.md` ni `contracts/`: el feature no introduce entidades ni cambia interfaces
> (FR-121). No es una omisión.

**Constitución aplicada**: `.specify/memory/constitution.md` **v1.1.1**. Siete principios son
N/A —no hay servicios, datos, eventos ni infraestructura—; aplican VII, VIII, IX, X y XII.

**Tests**: INCLUIDOS. La diferencia con 001 y 002 es que aquí **la mayor parte de la
verificación ya está escrita**: las 4 suites de `frontend/e2e/` seleccionan por rol y etiqueta
accesible en 100 de 109 casos, así que sobreviven al rediseño y fallan si este rompe la
accesibilidad (research D-29). **No se modifican.** Si una falla, el fallo es del rediseño.

**Organization**: tareas agrupadas por historia, en el orden de migración de research D-28 —
acceso → aprendizaje → simuladores → perfil → editorial— que no coincide con el orden de
prioridad del spec, y no por capricho: el grupo editorial va el último porque es la única zona
que colisiona con el feature 002.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1…US6)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Todo ocurre dentro de `frontend/`, salvo la deduplicación de logotipos. Convención normativa
del Angular según la Constitución §"Convenciones de Estructura y Nomenclatura por Tecnología"
(Principio IX): `core/` transporte · `features/*/services/` aplicación · `shared/` compartido.

Rutas reales de la aplicación (verificadas en `frontend/src/app/app.routes.ts`):
`iniciar-sesion`, `crear-cuenta`, `auth/verify-email`, `catalogo`, `articulos/:articleId`,
`cuestionarios/:quizId`, `progreso`, `notificaciones`, `simuladores[/historial|/:calcType]`,
`perfil[/reporte|/contrasena|/eliminar-cuenta]`, `editorial[/revision|/borradores|…]`.

---

## Phase 1: Setup — Tokens, componentes de estado y medición de partida

**Purpose**: lo que hace falta antes de tocar la primera pantalla.

- [ ] T001 **Verificar que `frontend/src/app/shared/ui/` existe y su galería renderiza** — es la biblioteca que entrega el feature 002 (sus T032–T048). Si no está, **este feature no arranca**: improvisar componentes locales sería reconstruir la capa artesanal que venimos a retirar (research D-26)
- [ ] T002 Crear los cuatro tokens de punto de corte en `frontend/src/styles/tokens/breakpoints.css`: `--bp-sm: 480px`, `--bp-md: 768px`, `--bp-lg: 1024px`, `--bp-xl: 1280px` (FR-125, SC-039, research D-27) — son **adición al sistema de diseño**, no valores sueltos por pantalla
- [ ] T003 Declarar `breakpoints.css` en el manifiesto de importaciones `frontend/src/styles/styles.css`, junto al resto de tokens (FR-125)
- [ ] T004 [P] Componente `Skeleton` (estado de carga con la forma del contenido que va a aparecer) en `frontend/src/app/shared/ui/skeleton/` (research D-32, FR-118)
- [ ] T005 [P] Componente `EmptyState` (ilustración, mensaje y acción sugerida) en `frontend/src/app/shared/ui/empty-state/` (research D-32, FR-119)
- [ ] T006 [P] Componente `ErrorState` (mensaje comprensible y acción de reintento) en `frontend/src/app/shared/ui/error-state/` (research D-32, FR-118)
- [ ] T007 [P] Pruebas unitarias y de accesibilidad de los tres componentes de estado en `frontend/src/app/shared/ui/{skeleton,empty-state,error-state}/*.spec.ts`
- [ ] T008 Script de medición de deuda de estilo en `frontend/scripts/design-debt.mjs`: cuenta estilos en línea, líneas de `styles.scss` y referencias a clases artesanales. Registrar la **línea base** (94 / 116 / 19 pantallas) para poder medir el avance por lo que desaparece (nota N-12)
- [ ] T009 Ejecutar las 4 suites de extremo a extremo **sin modificarlas** y registrar el resultado verde de partida, en `frontend/e2e/` — es la referencia contra la que se comparará tras cada grupo (research D-29)

---

## Phase 2: Foundational — Barreras y armazón

**Purpose**: las barreras automáticas y el marco que se ve en todas las vistas.

**⚠️ CRÍTICO**: ninguna historia arranca hasta terminar esta fase.

> Las barreras van **antes** de la primera migración, no después. Instalarlas al final
> convertiría este feature en un maquillaje: el siguiente cambio urgente reintroduce el primer
> estilo en línea y en seis meses estamos igual (spec, historia 6).

- [ ] T010 Regla de lint que rechaza el atributo `style="..."` en toda plantilla de `frontend/src/app/**/*.html`, configurada en el lint del frontend (FR-088, FR-089)
- [ ] T011 [P] Verificación automatizada de accesibilidad por pantalla —recorrido por teclado, etiqueta asociada, contraste AA— etiquetada `@a11y` en `frontend/e2e/a11y.spec.ts` (FR-093…FR-096, SC-030…SC-032)
- [ ] T012 [P] Verificación de que la interfaz se presenta completa con la conectividad externa bloqueada, en `frontend/e2e/offline-assets.spec.ts` (FR-092, SC-033)
- [ ] T013 Migrar el armazón —barra superior, navegación por rol, cierre de sesión— a los componentes compartidos y a `BrandLogo`, en `frontend/src/app/app.component.ts` (FR-086, research D-30). La navegación **sigue derivándose del rol**; no se añade lógica de autorización a la vista (Principio VII)
- [ ] T014 Comportamiento responsive del armazón: bajo `--bp-md` la navegación colapsa a menú, en `frontend/src/app/app.component.ts` (FR-124, FR-126, SC-038)
- [ ] T015 Retirar el CSS embebido del bloque `styles` de `frontend/src/app/app.component.ts`, sustituido por los componentes compartidos (FR-086, FR-088, research D-30)
- [ ] T016 [P] Deduplicar los logotipos: conservar `frontend/src/styles/assets/logo/`, eliminar `frontend/src/assets/logo/` y reapuntar toda referencia, verificando que ninguna queda rota (FR-090, SC-037)
- [ ] T017 Ejecutar las suites de extremo a extremo **sin modificarlas** tras migrar el armazón, en `frontend/e2e/` — el armazón se ve en el 100 % de las vistas, así que un fallo aquí afecta a todas

**Checkpoint**: barreras activas y armazón migrado. Las historias pueden empezar.

---

## Phase 3: User Story 1 — Entrada a la plataforma con identidad de marca (Priority: P1) 🎯 MVP

**Goal**: acceso, registro y verificación se presentan con el card partido del kit: panel de
marca junto al formulario.

**Independent Test**: abrir las tres pantallas y contrastarlas con `design/ui_kits/auth/`.

**Referencia**: `design/ui_kits/auth/app.js` + su `README.md`.

- [ ] T018 [P] [US1] Componente de panel de marca —logotipo, titular, subtítulo y los tres indicadores de contenido— en `frontend/src/app/shared/ui/brand-panel/`, reutilizable por las tres pantallas (FR-087, FR-098)
- [ ] T019 [US1] Disposición de card partido para el flujo de acceso en `frontend/src/app/features/auth/`, con el panel de marca a un lado y el formulario al otro
- [ ] T020 [US1] Recomponer `frontend/src/app/features/auth/login/login.component.html` con los componentes compartidos, sustituyendo el `fc-module` de 420 px y los 2 estilos en línea (FR-098)
- [ ] T021 [US1] Añadir al acceso la opción de mantener la sesión, el enlace de recuperación de contraseña, el divisor y el acceso federado, en `frontend/src/app/features/auth/login/` (FR-099)
- [ ] T022 [US1] Recomponer `frontend/src/app/features/auth/register/register.component.html` con los componentes compartidos, eliminando sus 2 estilos en línea
- [ ] T023 [US1] Presentar el consentimiento de tratamiento de datos personales de forma explícita antes del envío, en `frontend/src/app/features/auth/register/` (FR-100)
- [ ] T024 [US1] Recomponer `frontend/src/app/features/auth/verify-email/verify-email.component.html` con la introducción del código y el estado de éxito que conduce al catálogo (FR-101), eliminando su 1 estilo en línea
- [ ] T025 [US1] Estados de carga y error en las tres pantallas de acceso, con los componentes de T004 y T006, en `frontend/src/app/features/auth/` (FR-118)
- [ ] T026 [US1] Responsive del card partido: bajo `--bp-md` el panel de marca pasa a **banda superior compacta con logotipo y titular**, conservando la identidad y sacrificando solo los tres indicadores, en `frontend/src/app/features/auth/` — **no se oculta entero** (FR-126, nota N-14)
- [ ] T027 [P] [US1] Comparación visual por captura de las tres pantallas contra el kit, a cada punto de corte, en `frontend/e2e/visual/auth.spec.ts`
- [ ] T028 [US1] Ejecutar las suites de extremo a extremo y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [ ] T029 [US1] Retirar de `frontend/src/styles.scss` las clases artesanales que ya no referencia ninguna plantilla tras este grupo

**Checkpoint**: US1 entregable (SC-029). Se despliega el kit completo, nunca pantalla suelta.

---

## Phase 4: User Story 2 — El portal de aprendizaje (Priority: P1)

**Goal**: catálogo, lector, cuestionario, progreso y notificaciones se presentan como el portal
denso que define la marca.

**Independent Test**: recorrer catálogo → artículo → cuestionario → progreso → notificaciones
y contrastar con el kit.

**Referencia**: `design/ui_kits/learner/app.js`, `data.js` y la variante `portal.js` de tres
columnas.

- [ ] T030 [US2] Disposición de portal de tres zonas —riel de categorías y progreso, columna central, riel de continuación/ranking/notificaciones— en `frontend/src/app/features/learning/catalog/` (FR-102)
- [ ] T031 [US2] Recomponer el catálogo con artículo destacado y catálogo con pestañas en `frontend/src/app/features/learning/catalog/catalog.component.html`, eliminando sus 6 estilos en línea
- [ ] T032 [US2] Responsive del portal: bajo `--bp-lg` colapsa **primero el riel derecho**; bajo `--bp-md` el izquierdo pasa a desplegable; la columna central **nunca** se sacrifica (FR-126, research D-27)
- [ ] T033 [US2] Recomponer el lector en `frontend/src/app/features/learning/article/article.component.html`: ancho cómodo de lectura, cita destacada y panel lateral de progreso y relacionados (FR-103), eliminando sus 2 estilos en línea. **Conservar el elemento `<article>`** como contenedor del cuerpo: `us1-aprendizaje.spec.ts` lo selecciona y es además el marcado semánticamente correcto (research D-29)
- [ ] T034 [US2] Recomponer el cuestionario en `frontend/src/app/features/learning/quiz/quiz.component.html` con la presentación de calificación y reintento del sistema (FR-104), eliminando sus 6 estilos en línea. **Conservar `<fieldset>` por pregunta y `<input type="radio">` como control de opción**: `us1-aprendizaje.spec.ts` los selecciona, y son el marcado que un lector de pantalla necesita para un grupo de opciones excluyentes (research D-29, FR-095). Sustituirlos por fichas seleccionables rompería la suite **y** la accesibilidad
- [ ] T035 [US2] Recomponer la pantalla de progreso en `frontend/src/app/features/learning/progress/progress.component.html` con puntos, estadísticas e historial usando `ProgressBar` y `Badge` (FR-105), eliminando sus 5 estilos en línea
- [ ] T036 [US2] Recomponer la bandeja en `frontend/src/app/features/notifications/notifications.component.html`, distinguiendo visualmente lo leído de lo no leído (FR-106), eliminando sus 5 estilos en línea
- [ ] T037 [P] [US2] Estados vacíos con sentido: catálogo sin artículos publicados, progreso sin cuestionarios resueltos, bandeja sin notificaciones, en `frontend/src/app/features/{learning,notifications}/` (FR-119) — los kits se dibujaron con datos siempre presentes y no cubren este caso
- [ ] T038 [P] [US2] Estados de carga y error en las cinco pantallas, con los componentes de T004 y T006, en `frontend/src/app/features/{learning,notifications}/` (FR-118)
- [ ] T039 [US2] Tolerancia a desbordamiento: títulos de artículo y de categoría más largos que los del kit truncan con indicación visible, sin romper la maquetación, en `frontend/src/app/features/learning/` (FR-120)
- [ ] T040 [US2] Verificar que la puntuación mostrada en progreso conserva su precisión decimal, reutilizando los ayudantes existentes en `frontend/src/app/features/learning/progress/` (FR-109, Principio VIII)
- [ ] T041 [P] [US2] Comparación visual por captura de las cinco pantallas contra el kit, a cada punto de corte, en `frontend/e2e/visual/learner.spec.ts`
- [ ] T042 [US2] Ejecutar `us1-aprendizaje.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [ ] T043 [US2] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Checkpoint**: US2 entregable. Es el grupo de mayor superficie visible del feature.

---

## Phase 5: User Story 3 — Los simuladores financieros (Priority: P2)

**Goal**: las cinco calculadoras se presentan con las cifras en pesos destacadas y legibles.

**Independent Test**: ejecutar una simulación de cada tipo y revisar selector, formulario,
resultado e historial.

**Referencia**: `design/ui_kits/simulators/app.js`. **Solo como referencia visual**: su propio
README advierte que sus cálculos son de demostración y que en la plataforma real la precisión
decimal es responsabilidad del backend.

- [ ] T044 [US3] Riel de calculadoras junto al formulario de la seleccionada en `frontend/src/app/features/simulators/selector/selector.component.html` (FR-107), eliminando sus 4 estilos en línea
- [ ] T045 [US3] Recomponer el formulario de parámetros en `frontend/src/app/features/simulators/forms/simulator-form.component.html` con `Input` y `Button` compartidos, eliminando sus 6 estilos en línea
- [ ] T046 [US3] Presentar las cifras monetarias con la tipografía de datos del sistema, distinguibles del texto corrido, en `frontend/src/app/features/simulators/result/result.component.html` (FR-108), eliminando sus 3 estilos en línea
- [ ] T047 [US3] Recomponer el historial en `frontend/src/app/features/simulators/history/history.component.html` de modo que permita comparar ejecuciones sin abrir cada una (FR-110) — es la plantilla con **más estilos en línea de todas: 13**
- [ ] T048 [US3] **Verificar que ninguna cifra pasa por una conversión que altere su precisión**: se conservan `frontend/src/app/shared/decimal-str.ts`, `features/simulators/decimal-validators.ts` y `result-format.ts`; prohibido `number` nativo (FR-109, Principio VIII NON-NEGOTIABLE)
- [ ] T049 [US3] Una cifra monetaria **nunca trunca**: si no cabe, se reduce el contenedor o cambia la disposición, en `frontend/src/app/features/simulators/` — un importe cortado no es texto incompleto, es un dato falso (nota N-15)
- [ ] T050 [US3] Responsive: el riel de calculadoras pasa a selector horizontal desplazable sobre el formulario bajo `--bp-md`; el historial desplaza **dentro de su contenedor** y la página nunca en horizontal (FR-127, research D-27)
- [ ] T051 [P] [US3] Estados de carga, error y vacío —historial sin simulaciones— en las cuatro pantallas de `frontend/src/app/features/simulators/` (FR-118, FR-119)
- [ ] T052 [P] [US3] Comparación visual por captura contra el kit, a cada punto de corte, en `frontend/e2e/visual/simulators.spec.ts`
- [ ] T053 [US3] Ejecutar `us2-simuladores.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [ ] T054 [US3] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Checkpoint**: US3 entregable (SC-035).

---

## Phase 6: User Story 4 — Perfil, privacidad y reportes (Priority: P2)

**Goal**: las cuatro pantallas de perfil y datos personales se ven parte de la misma
plataforma.

**Independent Test**: recorrer las cuatro y verificar el tratamiento de las cifras del reporte.

**Sin kit propio**: se resuelven con los componentes compartidos y las guías del design system.

- [ ] T055 [US4] Recomponer `frontend/src/app/features/profile/profile.component.html` con los controles compartidos (FR-111), eliminando sus 7 estilos en línea
- [ ] T056 [US4] Recomponer `frontend/src/app/features/profile/password/password.component.html`, eliminando sus 2 estilos en línea
- [ ] T057 [US4] Recomponer el reporte de actividad en `frontend/src/app/features/profile/report/report.component.html` con la tipografía de datos (FR-113) — es la segunda plantilla con más estilos en línea: **10**
- [ ] T058 [US4] Verificar que las cifras del reporte conservan su precisión decimal, en `frontend/src/app/features/profile/report/` (FR-113, Principio VIII)
- [ ] T059 [US4] Recomponer `frontend/src/app/features/profile/delete-account/delete-account.component.html` de modo que la consecuencia de la operación y su período de reversión se comuniquen **de forma destacada**, con los componentes de aviso del sistema y no en texto corrido (FR-112), eliminando sus 3 estilos en línea
- [ ] T060 [P] [US4] Estados de carga, error y vacío —reporte sin actividad— en las cuatro pantallas de `frontend/src/app/features/profile/` (FR-118, FR-119)
- [ ] T061 [US4] Responsive de las cuatro pantallas hasta el mínimo de 360 px, en `frontend/src/app/features/profile/` (FR-124, SC-038, research D-27)
- [ ] T062 [P] [US4] Comparación visual por captura contra las guías, a cada punto de corte, en `frontend/e2e/visual/profile.spec.ts`
- [ ] T063 [US4] Ejecutar `us3-perfil.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [ ] T064 [US4] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Checkpoint**: US4 entregable.

---

## Phase 7: User Story 5 — El marco del flujo editorial (Priority: P2)

**Goal**: el entorno de trabajo editorial se ve como una herramienta coherente.

**Independent Test**: recorrer el listado por estado, la bandeja de revisión y el historial de
versiones, **sin tocar la superficie de redacción**.

**Va el último a propósito** (research D-28): es la única zona que colisiona con el feature
002, que reescribe la superficie de redacción del editor. Se migra cuando esa reescritura ya
está asentada.

**Referencia**: `design/ui_kits/editorial/app.js`. Usa el púrpura portal como color de la
herramienta editorial.

- [ ] T065 [US5] Recomponer el listado de artículos agrupados por estado —borrador, en revisión, publicado— con distintivos visuales que los diferencien, en `frontend/src/app/features/editorial/versions/versions.component.html` (FR-114), eliminando sus 5 estilos en línea
- [ ] T066 [US5] Recomponer la bandeja de revisión presentando **de forma destacada** la decisión de aprobar o rechazar, en `frontend/src/app/features/editorial/review/review.component.html` (FR-115), eliminando sus 4 estilos en línea
- [ ] T067 [US5] Presentar el aviso de que un editor no puede aprobar su propio contenido de forma comprensible y no como error genérico, en `frontend/src/app/features/editorial/review/` (FR-116) — preserva la regla FR-008 sin duplicar su lógica en la vista
- [ ] T068 [US5] Historial de versiones con estado, autor y fecha presentados de forma consistente con el resto de la plataforma, en `frontend/src/app/features/editorial/versions/` (FR-117)
- [ ] T069 [US5] Migrar **únicamente el marco** del editor de artículos —cabecera, paneles laterales, ajustes de publicación— en `frontend/src/app/features/editorial/editor/`, **sin tocar la superficie de redacción**, que pertenece al feature 002 (FR-123). De sus 8 estilos en línea, solo se retiran los del marco
- [ ] T070 [US5] Verificar la frontera con `git diff` sobre `frontend/src/app/features/editorial/editor/`: los cambios deben limitarse al marco (FR-123, quickstart §4 grupo 5)
- [ ] T071 [P] [US5] Estados de carga, error y vacío —sin borradores, sin artículos en revisión— en las tres pantallas de `frontend/src/app/features/editorial/` (FR-118, FR-119)
- [ ] T072 [US5] Responsive de las tres pantallas en `frontend/src/app/features/editorial/`; las tablas desplazan dentro de su contenedor (FR-124, FR-127, research D-27)
- [ ] T073 [P] [US5] Comparación visual por captura contra el kit, a cada punto de corte, en `frontend/e2e/visual/editorial.spec.ts`
- [ ] T074 [US5] Ejecutar `us4-editorial.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`

**Checkpoint**: US5 entregable. Con este grupo, las 19 pantallas y el armazón están migrados.

---

## Phase 8: User Story 6 — Consistencia y accesibilidad verificables (Priority: P1)

**Goal**: la coherencia visual y la accesibilidad quedan garantizadas por verificación
automática, para que la deuda no vuelva a acumularse.

**Independent Test**: introducir deliberadamente un estilo en línea y un control sin etiqueta,
y comprobar que la verificación los rechaza.

**Es P1 pero cierra al final**, y no es contradicción: **sus barreras se instalaron en la fase
2** —antes de la primera migración, que es donde sirven—. Lo que queda aquí es la comprobación
de que el objetivo se alcanzó de verdad, y eso solo puede medirse con todo migrado.

- [ ] T075 [US6] **Eliminar `frontend/src/styles.scss`** y retirar su declaración de `frontend/angular.json` — la capa artesanal debe quedar vacía tras los cinco grupos. **Es el criterio de terminación del feature** (research D-26)
- [ ] T076 [US6] Verificar con `frontend/scripts/design-debt.mjs` que los estilos en línea pasaron de 94 a **0** y que ninguna plantilla referencia ya clases artesanales (FR-086, FR-088, SC-027)
- [ ] T077 [US6] Recorrer las 19 pantallas y el armazón confirmando que ninguna desentona del sistema visual común, contrastando `frontend/src/app/features/` contra los cinco kits de `design/ui_kits/` (FR-086, SC-028)
- [ ] T078 [US6] Verificar los 6 selectores no accesibles de `frontend/e2e/` (research D-29): que `fc-module`, `fc-num`, `fc-eyebrow` y `fc-linklist` **siguen definidas** en `frontend/src/styles/tokens/base.css`, y que el lector conserva `<article>` y el cuestionario conserva `<fieldset>` e `<input type="radio">`
- [ ] T079 [US6] Comprobar que la barrera de T010 rechaza un estilo en línea introducido a propósito, en `frontend/` (FR-089, SC-027)
- [ ] T080 [US6] Recorrido manual por teclado de las 19 pantallas y el armazón: todos los controles alcanzables, foco siempre visible, recorriendo `frontend/src/app/features/` y `frontend/src/app/app.component.ts` (FR-093, FR-094, SC-030)
- [ ] T081 [US6] Auditoría de que el 100 % de los controles de formulario tiene etiqueta asociada anunciable por lector de pantalla, sobre `frontend/src/app/**/*.html` (FR-095, SC-031)
- [ ] T082 [US6] Auditoría de contraste AA de todo el texto frente a su fondo, sobre los tokens de `frontend/src/styles/tokens/colors.css` tal como se aplican en `frontend/src/app/` (FR-096, SC-032)
- [ ] T083 [US6] Verificar que la interfaz sigue siendo utilizable con el tamaño de fuente del navegador al 200 %, sin pérdida de contenido ni funcionalidad, sobre `frontend/src/app/` (FR-097)
- [ ] T084 [US6] Ejecutar `frontend/e2e/offline-assets.spec.ts` con la conectividad externa bloqueada: tipografía e iconos presentes (FR-092, SC-033)
- [ ] T085 [US6] Ejecutar las **4 suites completas sin modificar** y confirmar que pasan con las mismas aserciones que en T009, en `frontend/e2e/` — es la garantía de SC-036, de que ningún comportamiento cambió

**Checkpoint**: US6 entregable. `styles.scss` no existe.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T086 [P] Revisar que ningún texto de la interfaz se salió de la voz de marca —español de Colombia, tuteo directo— contrastando con `design/guidelines/brand-voice.html` (FR-091)
- [ ] T087 [P] Verificar que el presupuesto de tamaño declarado en `frontend/angular.json` no se excedió y que la biblioteca compartida se importa por componente y no entera
- [ ] T088 [P] Documentar los cuatro puntos de corte y la regla de degradación por disposición en `design/guidelines/`, para que los hereden los features siguientes en vez de redescubrirlos
- [ ] T089 [P] Recopilar los hallazgos de datos que la API no expone, si aparecieron, como entrada de un feature posterior, registrados en `specs/003-design-system-frontend/findings.md` — **sin resolverlos aquí** (FR-122)
- [ ] T090 Verificar los 13 criterios SC-027…SC-039 siguiendo `quickstart.md` §2–§7, prestando atención a **SC-034**: ninguna pantalla que dependa de datos queda en blanco ante un fallo ni ante la ausencia de contenido
- [ ] T091 Re-evaluar el gate constitucional sobre el código escrito y anotar el resultado en `plan.md` §Constitution Check, con atención al Principio VIII en las pantallas de dinero
- [ ] T092 [P] Actualizar `README.md` y `frontend/README.md` con la tabla de criterio de terminación de `quickstart.md` §7
- [ ] T093 [P] Comprobar que `dev/build && dev/up` sigue dejando el frontend funcionando sin ningún paso manual (Principio XII regla 4)

---

## Dependencies

### Entre fases

```text
Feature 002 (shared/ui) ──> Phase 1 (Setup) ──> Phase 2 (Foundational) ──┐
                                                                         │
   ┌─────────────────────────────────────────────────────────────────────┘
   │
   └─> Phase 3 US1 (auth) ─> Phase 4 US2 (learner) ─> Phase 5 US3 (simuladores)
        ─> Phase 6 US4 (perfil) ─> Phase 7 US5 (editorial) ─> Phase 8 US6 (cierre)
        ─> Phase 9 (Polish)
```

**Los cinco grupos son secuenciales por decisión, no por acoplamiento técnico** (research
D-28): cada uno retira clases de `styles.scss` que los siguientes podrían seguir usando, y el
despliegue por kit completo es lo que evita que el usuario perciba pantallas sueltas
desalineadas. Técnicamente, US1 y US3 no se tocan entre sí.

### Entre historias

| Historia | Depende de | Por qué |
|----------|-----------|---------|
| Todas | Feature 002, `shared/ui` | Dependencia dura. Sin la biblioteca no hay con qué componer (T001) |
| US2 | Fase 2 (armazón) | El portal se ve dentro del marco; migrar uno sin el otro los enfrenta visualmente |
| US5 | Feature 002, superficie de redacción | Coordinación, no código: evitar el conflicto en el editor (FR-123) |
| US6 | US1…US5 completas | "Cero estilos en línea" solo es comprobable con todo migrado |

### Dependencias críticas

- **T002/T003 antes de cualquier tarea responsive**: los puntos de corte son tokens; sin ellos
  cada pantalla inventaría sus propios anchos, que es cómo se erosiona un sistema de diseño.
- **T010 antes de T018**: la barrera de estilo en línea se instala **antes** de la primera
  migración, no después.
- **T075 después de T029, T043, T054, T064 y del grupo editorial**: `styles.scss` solo se
  elimina cuando ninguna plantilla lo referencia. Borrarlo antes deja pantallas sin estilo.
- **T085 comparado contra T009**: la comparación exige haber registrado el verde de partida.

---

## Parallel Execution Examples

**Fase 1** — T004, T005 y T006 (los tres componentes de estado) en paralelo; T007 tras ellos.
T008 y T009 son independientes de todo lo demás y pueden ir desde el minuto uno.

**Fase 2** — T011 y T012 (verificaciones) en paralelo con T013…T015 (armazón), que son
secuenciales sobre el mismo archivo. T016 es independiente.

**Dentro de cada grupo de pantallas** — las tareas de recomposición tocan plantillas distintas
y podrían paralelizarse, pero **el estado vacío/carga/error y la comparación visual sí van
marcados `[P]`** porque son archivos aparte. La recomposición se deja en serie a propósito:
son las tareas donde se descubre qué componente falta, y descubrirlo cinco veces en paralelo
produce cinco soluciones distintas al mismo problema.

**Entre grupos** — no se paralelizan (ver Dependencies).

---

## Implementation Strategy

### MVP sugerido

**US1 (acceso)**. Tres pantallas, el kit más pequeño, y la primera que ve cualquier usuario.
Es la validación más barata de que la biblioteca de 002 sirve para componer pantallas reales,
y es exactamente la pantalla que motivó este feature.

### Entrega incremental

1. **Incremento 1** — Fases 1 y 2. Barreras activas y armazón migrado. Poco visible en
   pantalla pero se nota en todas: la barra superior es lo primero que cambia.
2. **Incremento 2** — US1. El kit de acceso completo.
3. **Incremento 3** — US2. El grupo de mayor superficie visible.
4. **Incremento 4** — US3 + US4. Simuladores y perfil.
5. **Incremento 5** — US5. Editorial, cuando 002 haya asentado la superficie de redacción.
6. **Incremento 6** — US6 + Fase 9. Se elimina `styles.scss` y se cierra.

### Regla de despliegue

**Kit completo, nunca pantalla suelta.** Durante la migración conviven dos estéticas; es
inevitable y es aceptable. Lo que no es aceptable es que convivan *dentro del mismo módulo*:
desplegando por kit, el usuario percibe "el módulo de aprendizaje cambió", no "esta pantalla
está rara".

### La regla que no se negocia

Si una suite de extremo a extremo falla tras migrar un grupo, **el fallo es del rediseño**.
Seleccionan por rol y etiqueta accesible en 100 de 109 casos: un fallo significa que se rompió
un rol, una etiqueta o un texto visible, es decir, la accesibilidad. Ajustar la aserción para
que pase destruye la única garantía dura del feature (nota N-13).
