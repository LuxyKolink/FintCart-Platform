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

- [x] T001 **Verificar que `frontend/src/app/shared/ui/` existe y su galería renderiza** — es la biblioteca que entrega el feature 002 (sus T032–T048). Si no está, **este feature no arranca**: improvisar componentes locales sería reconstruir la capa artesanal que venimos a retirar (research D-26)
- [x] T002 Crear los cuatro tokens de punto de corte en `frontend/src/styles/tokens/breakpoints.css`: `--bp-sm: 480px`, `--bp-md: 768px`, `--bp-lg: 1024px`, `--bp-xl: 1280px` (FR-125, SC-039, research D-27) — son **adición al sistema de diseño**, no valores sueltos por pantalla
- [x] T003 Declarar `breakpoints.css` en el manifiesto de importaciones `frontend/src/styles/styles.css`, junto al resto de tokens (FR-125)
- [x] T004 [P] Componente `Skeleton` (estado de carga con la forma del contenido que va a aparecer) en `frontend/src/app/shared/ui/skeleton/` (research D-32, FR-118)
- [x] T005 [P] Componente `EmptyState` (ilustración, mensaje y acción sugerida) en `frontend/src/app/shared/ui/empty-state/` (research D-32, FR-119)
- [x] T006 [P] Componente `ErrorState` (mensaje comprensible y acción de reintento) en `frontend/src/app/shared/ui/error-state/` (research D-32, FR-118)
- [x] T007 [P] Pruebas unitarias y de accesibilidad de los tres componentes de estado en `frontend/src/app/shared/ui/{skeleton,empty-state,error-state}/*.spec.ts`
- [x] T008 Script de medición de deuda de estilo en `frontend/scripts/design-debt.mjs`: cuenta estilos en línea, líneas de `styles.scss` y referencias a clases artesanales. Registrar la **línea base** (94 / 116 / 19 pantallas) para poder medir el avance por lo que desaparece (nota N-12)
**Notas de implementación (T001–T008)**

- **T001**: `shared/ui` está completo (13 componentes + galería) y compila; la galería se
  construye sin cambios. La compuerta del feature se cumple.
- **T002/T003 — límite técnico que el enunciado no decía**: las propiedades personalizadas
  **no** se resuelven dentro de `@media`, así que `@media (max-width: var(--bp-md))` es
  inválido. Los tokens siguen siendo la fuente única de verdad, pero cada `@media` escribe el
  literal (`768px`) y cita el token en un comentario. Resolverlo con `@custom-media` habría
  exigido PostCSS, es decir una dependencia nueva que el Technical Context prohíbe. Queda
  documentado en el encabezado de `breakpoints.css`.
- **T004 — por qué las dimensiones no son `[style]`**: `no-inline-styles` marca tanto el
  atributo `style="…"` como los bindings `[style.x]` (comprobado: el primer intento de
  `Skeleton` con `[style.--fc-skeleton-w]` falló el lint). Se fijan con `Renderer2` y
  `RendererStyleFlags2.DashCase`, el mismo patrón que ya usaba `ProgressBar` para el ancho de
  su relleno: la plantilla queda limpia y la hoja de estilos sigue mandando.
- **T005/T006**: `EmptyState` proyecta la acción sugerida (el vacío del catálogo y el del
  progreso no ofrecen la misma), y `ErrorState` lleva el reintento dentro porque un mensaje sin
  salida deja al usuario atrapado. `role="status"` en el vacío y `role="alert"` en el error:
  la diferencia no es cosmética — un error que no se anuncia deja al usuario esperando una
  carga que ya terminó.
- **T007**: 13 pruebas nuevas (5 + 4 + 4). Suite completa en **47/47**, verde.
- **T008 — la línea base se midió, no se copió**: 94 estilos en línea, 116 líneas y **19**
  pantallas, exactamente los valores declarados. El detector cuenta **clases**, no tags: `fc-input`
  es a la vez clase artesanal y `<fc-input>` del design system, y contar el tag habría dado un
  falso positivo que nunca baja a cero (el `grep` del quickstart §2 tiene ese defecto; el script
  no). **Hallazgo que el ledger debe ver**: `features/admin/categories` (dueño: feature 002)
  todavía referencia clases artesanales y por tanto **bloquea** la eliminación de `styles.scss`;
  el script lo reporta aparte en vez de diluirlo en el total.
- **Estado de `npm run lint`**: sigue en rojo por los 94 estilos en línea preexistentes. No es
  una regresión de este bloque: es exactamente la deuda que el feature retira (T076 exige 0).

- [x] T009 Ejecutar las 4 suites de extremo a extremo **sin modificarlas** y registrar el resultado verde de partida, en `frontend/e2e/` — es la referencia contra la que se comparará tras cada grupo (research D-29)

---

## Phase 2: Foundational — Barreras y armazón

**Purpose**: las barreras automáticas y el marco que se ve en todas las vistas.

**⚠️ CRÍTICO**: ninguna historia arranca hasta terminar esta fase.

> Las barreras van **antes** de la primera migración, no después. Instalarlas al final
> convertiría este feature en un maquillaje: el siguiente cambio urgente reintroduce el primer
> estilo en línea y en seis meses estamos igual (spec, historia 6).

- [x] T010 Regla de lint que rechaza el atributo `style="..."` en toda plantilla de `frontend/src/app/**/*.html`, configurada en el lint del frontend (FR-088, FR-089)
- [x] T011 [P] Verificación automatizada de accesibilidad por pantalla —recorrido por teclado, etiqueta asociada, contraste AA— etiquetada `@a11y` en `frontend/e2e/a11y.spec.ts` (FR-093…FR-096, SC-030…SC-032)
- [x] T012 [P] Verificación de que la interfaz se presenta completa con la conectividad externa bloqueada, en `frontend/e2e/offline-assets.spec.ts` (FR-092, SC-033)
- [x] T013 Migrar el armazón —barra superior, navegación por rol, cierre de sesión— a los componentes compartidos y a `BrandLogo`, en `frontend/src/app/app.component.ts` (FR-086, research D-30). La navegación **sigue derivándose del rol**; no se añade lógica de autorización a la vista (Principio VII)
- [x] T014 Comportamiento responsive del armazón: bajo `--bp-md` la navegación colapsa a menú, en `frontend/src/app/app.component.ts` (FR-124, FR-126, SC-038)
- [x] T015 Retirar el CSS embebido del bloque `styles` de `frontend/src/app/app.component.ts`, sustituido por los componentes compartidos (FR-086, FR-088, research D-30)
- [x] T016 [P] Deduplicar los logotipos: conservar `frontend/src/styles/assets/logo/`, eliminar `frontend/src/assets/logo/` y reapuntar toda referencia, verificando que ninguna queda rota (FR-090, SC-037)
**Notas del armazón (T010, T013–T016)**

- **T010**: la regla ya existía — la añadió 002 en `abc21a7` (`frontend/.eslintrc.json`,
  `@angular-eslint/template/no-inline-styles: error`). Se verificó que rechaza **tanto** el
  atributo `style="…"` como los bindings `[style.x]`: fue justo lo que obligó a rehacer
  `Skeleton`. No se tocó nada.
- **T013–T015**: `app.component` pasa a `templateUrl` + `styleUrl`, así que el bloque `styles`
  embebido desaparece y la estética ya no puede divergir en silencio. El `<img>` suelto del
  logotipo se sustituye por `fc-brand-logo`, y «Cerrar sesión» por
  `fc-button variant="ghost"`. La navegación **sigue derivándose del rol** con
  `auth.hasRole(...)`: no se añadió ni una comprobación de autorización a la vista
  (Principio VII). 10 pruebas nuevas en `app.component.spec.ts` cubren la derivación por rol
  —incluida la frontera de que `administrador` **no** hereda atribuciones editoriales— y el menú.
- **T014 — por qué el botón del menú no es `fc-button`**: un control de divulgación necesita
  `aria-expanded`/`aria-controls` **en el propio `<button>`**. Escritos sobre `<fc-button>`
  aterrizan en el elemento anfitrión, no en el botón interior, y un lector de pantalla los
  ignora. Se usa un `<button>` nativo con clase propia; también por eso el menú se cierra con
  `Escape` y al elegir un destino. La accesibilidad manda sobre la uniformidad estética.
- **T016 — el enunciado tenía las rutas invertidas**: `frontend/src/styles/assets/logo/` **ya
  no existe**; `frontend/src/styles/assets/` solo contiene tipografías. La deduplicación ya la
  había hecho 002: la copia que sobrevive es `frontend/src/assets/logo/` (la que Angular sirve
  y la que `BrandLogo` resuelve), con los 5 SVG. Ejecutar la instrucción al pie de la letra
  —borrar `src/assets/logo/`— habría roto todos los logotipos. Verificado: 0 referencias a
  `styles/assets/logo` y toda referencia viva apunta a `assets/logo/`.
- **T011/T012 ya corren**: la accesibilidad y la independencia de servicios externos están
  verdes contra la pila. Lo que sigue sin afirmarse a 360/480 px es el colapso de la
  navegación: el harness mide teclado, etiquetas y contraste, no anchos.

- [x] T017 Ejecutar las suites de extremo a extremo **sin modificarlas** tras migrar el armazón, en `frontend/e2e/` — el armazón se ve en el 100 % de las vistas, así que un fallo aquí afecta a todas

**Notas de la línea base e2e (T009, T017)**

- **La pila se levantó de verdad** (`dev/build` → `dev/up` → `dev/migrate` → `dev/seed`) y
  destapó un fallo que solo existe con infraestructura en pie: `dev/seed` seguía insertando
  en `articles.category`, la columna que la migración de 002 eliminó. Como el bloque del
  catálogo va ANTES que el del Simulador, tampoco sembraba las 7 calculadoras. Arreglado y
  commiteado en 002 (`1a9f44e`). Es exactamente lo que T163 de 002 existe para cazar, y
  seguía sin marcar.
- **T009, tal como está escrito, era imposible de cumplir**: pedía registrar un verde de
  partida «sin modificarlas», y las 4 suites NO estaban verdes. **Tres** aserciones eran deuda
  de 002, no del rediseño: `us1` contaba los `fieldset` antes de que respondiera
  `StartQuizSession` (flaky: 1 de 2 pasadas); `us4` hacía `.fill()` sobre la categoría, ya
  convertida en `<select>`; y `us2` usaba `getByText('Cuota mensual')`, que también casaba con
  la descripción de la calculadora y pasaba **solo por suerte** —cuando el resultado todavía
  no había renderizado, el único match era el párrafo—. **Se modificaron los tres tests**
  (`d9910b2` y `fix(002): us2…`) con autorización explícita del usuario. Queda dicho porque
  contradice la nota N-13: quien compare contra T009 debe saber que la referencia no salió
  intacta.
- Lo que sí conserva la garantía de 003: ninguno de los dos cambios toca un selector por rol
  o etiqueta accesible, que es lo que 003 usa como red. Resultado: **4/4**. Como el armazón ya
  estaba migrado cuando se corrió, T009 y T017 comparten el mismo registro — no hay una foto
  de «antes del armazón» que recuperar, y los dos fallos ajenos la habrían empañado igual.

**Notas de las barreras (T011, T012)**

- **T011 encontró dos defectos reales el primer día, y eso es lo que la hace valer.**
  1. Texto blanco sobre `--brand-primary` (coral 400, `#DE4D2B`) daba **4.04:1**, por debajo
     del 4.5:1 de AA. Afectaba a *todos* los botones primarios, a la pestaña activa del
     catálogo y a los badges sólidos. Se corrigió en el token —`--brand-primary` pasa a coral
     500, **5.11:1**—, no componente a componente (FR-125). El kit es autoridad visual, pero
     no puede ganarle a un MUST de accesibilidad.
  2. El botón fantasma (`fc-button variant="ghost"`) se enfocaba **sin ninguna señal**:
     `[data-variant='ghost']` declara `box-shadow: var(--shadow-none)` con la MISMA
     especificidad que `.fc-btn:focus-visible` y, por ir después en el archivo, le ganaba
     por orden. La regla del anillo de foco se movió al final. Un MUST de accesibilidad no
     puede depender de en qué línea se escribió una variante.
- **T011 — alcance, y cómo crece**: cubre las pantallas de acceso y el recorrido del aprendiz
  (catálogo, simuladores, progreso, notificaciones, perfil). Cada grupo añade las suyas;
  correr la suite sobre pantallas aún sin migrar llenaría el informe de trabajo pendiente, no
  de regresiones. **No es una auditoría WCAG completa**: no cubre regiones vivas ni orden de
  lectura de lectores de pantalla, y no usa `@axe-core` porque el plan prohíbe dependencias
  nuevas (las tres comprobaciones se miden contra el navegador real).
- **T012 — medido, no afirmado**: bloquea toda petición fuera de `localhost` y comprueba que
  la galería interna sigue mostrando las tres familias tipográficas (forzando su carga, no
  fiándose de la que la pantalla usó de casualidad), los iconos y el logotipo. Si algo viniera
  de un CDN, aquí se vería.
- **Sigue sin verificarse**: el colapso real de la navegación a 360/480 px, que el harness no
  mide (no evalúa anchos). Se cubrirá con las capturas por punto de corte de T027.

**Checkpoint**: barreras activas y armazón migrado. Las historias pueden empezar.

---

## Phase 3: User Story 1 — Entrada a la plataforma con identidad de marca (Priority: P1) 🎯 MVP

**Goal**: acceso, registro y verificación se presentan con el card partido del kit: panel de
marca junto al formulario.

**Independent Test**: abrir las tres pantallas y contrastarlas con `design/ui_kits/auth/`.

**Referencia**: `design/ui_kits/auth/app.js` + su `README.md`.

- [x] T018 [P] [US1] Componente de panel de marca —logotipo, titular, subtítulo y los tres indicadores de contenido— en `frontend/src/app/shared/ui/brand-panel/`, reutilizable por las tres pantallas (FR-087, FR-098)
- [x] T019 [US1] Disposición de card partido para el flujo de acceso en `frontend/src/app/features/auth/`, con el panel de marca a un lado y el formulario al otro
- [x] T020 [US1] Recomponer `frontend/src/app/features/auth/login/login.component.html` con los componentes compartidos, sustituyendo el `fc-module` de 420 px y los 2 estilos en línea (FR-098)
- [x] T021 [US1] Añadir al acceso la opción de mantener la sesión, el enlace de recuperación de contraseña, el divisor y el acceso federado, en `frontend/src/app/features/auth/login/` (FR-099)
- [x] T022 [US1] Recomponer `frontend/src/app/features/auth/register/register.component.html` con los componentes compartidos, eliminando sus 2 estilos en línea
- [x] T023 [US1] Presentar el consentimiento de tratamiento de datos personales de forma explícita antes del envío, en `frontend/src/app/features/auth/register/` (FR-100)
- [x] T024 [US1] Recomponer `frontend/src/app/features/auth/verify-email/verify-email.component.html` con la introducción del código y el estado de éxito que conduce al catálogo (FR-101), eliminando su 1 estilo en línea
- [x] T025 [US1] Estados de carga y error en las tres pantallas de acceso, con los componentes de T004 y T006, en `frontend/src/app/features/auth/` (FR-118)
- [x] T026 [US1] Responsive del card partido: bajo `--bp-md` el panel de marca pasa a **banda superior compacta con logotipo y titular**, conservando la identidad y sacrificando solo los tres indicadores, en `frontend/src/app/features/auth/` — **no se oculta entero** (FR-126, nota N-14)
- [x] T027 [P] [US1] Comparación visual por captura de las tres pantallas contra el kit, a cada punto de corte, en `frontend/e2e/visual/auth.spec.ts`
- [x] T028 [US1] Ejecutar las suites de extremo a extremo y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [x] T029 [US1] Retirar de `frontend/src/styles.scss` las clases artesanales que ya no referencia ninguna plantilla tras este grupo

**Notas del grupo de acceso (T018–T029)**

- **T018 — indicadores cualitativos, no las cifras del kit.** El kit escribe «+120 artículos»
  y «5 simuladores»; la semilla deja 5 artículos y 7 calculadoras. Un número inventado en la
  portada no es texto incompleto: es un dato falso, el mismo criterio que N-15 aplica a la
  cifra truncada. Entran por el input `indicators` si alguna pantalla puede consultar el número
  real (FR-122). El tercer icono es `flame` y no el `award` del kit porque `award` no está entre
  los 25 iconos registrados (D-32).
- **T018 — por qué el fondo lleva `background-color` además del degradado.** El verificador de
  contraste lee el `background-color` computado, y con solo `background-image` es transparente:
  habría comparado el texto blanco contra el blanco de la tarjeta y dado un **falso positivo**.
  El coral 500 sólido fija el peor caso real (5.11:1) y además cubre que el degradado no se
  pinte. Se usa coral 500 y no el coral 400 del kit por el mismo motivo que en el botón
  primario: el blanco sobre coral 400 da 4.04:1.
- **T019**: la disposición vive en `features/auth/`, no en `shared/ui/`: `fc-brand-panel` sí es de
  la biblioteca (es identidad de marca), pero el card partido solo tiene sentido en el flujo de
  acceso.
- **T020–T022**: las tres pantallas se componen con `fc-auth-layout`, `fc-input`, `fc-checkbox`,
  `fc-button`, `fc-icon` y el nuevo `fc-banner`; sus **5 estilos en línea desaparecen**. El botón
  de envío conserva el nombre «Iniciar sesión» (no el «Entrar» del kit) porque las cuatro suites
  e2e lo buscan por ese nombre y N-13 manda no tocarlas.
- **Nuevo `fc-banner` compartido**: `.fc-banner` era artesanal y el mensaje sigue existiendo, así
  que la clase sobrevivía por carencia, no por diseño (FR-087). El tono decide el `role`
  (`alert` para error/aviso, `status` para el resto).
- **T021 «Recordarme» es real, y por eso `TokenStorageService` cambia.** Elige `sessionStorage`
  (defecto) o `localStorage` (marcado). Se deja **desmarcada por defecto**: FR-121 prohíbe
  alterar el comportamiento funcional, así que sin tocar la casilla la sesión vive donde vivía;
  el kit la dibuja marcada y aquí manda FR-004, no el adorno.
- **T021 «recuperación de contraseña» es una carencia, no una función.** No existe endpoint de
  restablecimiento en ningún contrato: el enlace apunta al reenvío de verificación, que es la
  única recuperación que la plataforma expone. **Hallazgo para T089** (FR-122).
- **T021 «acceso federado»: no hay proveedor de identidad externo.** El Authorization Server de
  la plataforma ES el Gateway, así que el botón ejecuta el mismo flujo Authorization Code + PKCE
  que el principal. Se deja operativo en vez de muerto; **la falta de un IdP externo queda como
  hallazgo** (FR-122).
- **T023 consentimiento (FR-100)**: la casilla se presenta explícita antes del envío (Ley 1581)
  pero **no bloquea**. El contrato de registro solo acepta `email`, `password` y `display_name`, y
  exigirla rompería los cuatro recorridos e2e, que se registran sin tocarla (N-13). **Hallazgo**:
  exigirla es una decisión de contrato de 002, no de presentación.
- **T024 verificación (FR-101)**: la plataforma **no** verifica con un código de 6 dígitos —el
  correo trae un enlace con `user_id` + `token`— así que se conserva el mecanismo real y se
  dibuja el estado de éxito. Seis casillas que no envían nada serían el falso verde que FR-122
  prohíbe; **la carencia del código queda como hallazgo**. El éxito conduce a iniciar sesión y no
  directo al catálogo porque el guard del catálogo exige sesión.
- **T025 carga y error (FR-118)**: `checking` es `fc-skeleton`; `expired` y `no-link` son
  `fc-error-state`, cuyo reintento abre el formulario de reenvío. Login y registro **no dependen
  de datos**, así que su carga es el botón deshabilitado y su error, `fc-banner`.
- **T026 responsive (FR-126, N-14)**: bajo `--bp-md` el card se apila y el panel pasa a banda
  compacta (logotipo, titular y subtítulo; sin indicadores) y **nunca se oculta**. Verificado a
  1280/768/767/480/375/360 px: panel visible a todos los anchos y **cero scroll horizontal**
  (FR-127).
- **T027 capturas**: 15 (3 pantallas × 5 anchos —los 4 tokens más el mínimo de 360 px—) en
  `test-results/visual/auth/`, con aserciones de panel visible y sin desplazamiento horizontal.
  Sin `toHaveScreenshot`: la referencia es el kit HTML, no una imagen versionada.
- **Dos defectos reales que la barrera destapó en componentes compartidos**:
  1. `--text-faint` (warm-500) daba **3.37:1** sobre blanco y lo usaban la ayuda de campo, la
     etiqueta del divisor y las pestañas inactivas. Pasa a un warm-550 (4.87:1): el tono más
     claro que aún cumple AA, para conservar la jerarquía frente a `--text-muted` en vez de
     igualarlos.
  2. El checkbox usaba `transition: all`, así que el anillo de foco **se desvanecía** en vez de
     aparecer: en el instante del foco no se veía. Se acota a `background` y `border-color`.
  3. El verificador solo miraba el elemento enfocado, pero el anillo de `fc-input` vive en el
     contenedor (`:focus-within`) y lo reportaba como ausente. Ahora sube hasta 4 ancestros y
     **exige sombra opaca** (alfa ≥ 0.4), con lo que una sombra estática `--shadow-xs` ya no hace
     pasar a un botón sin anillo: la comprobación quedó **más estricta**, no más laxa.
- **T028**: las 4 suites + 15 capturas + 3 de accesibilidad + 1 de independencia externa =
  **23/23 verde**. Las suites e2e **no** se tocaron; solo se afinó `e2e/support/a11y.ts`, que es
  infraestructura de la barrera, no una aserción.
- **T029**: se retiran `.fc-select` y `.fc-error-text` (0 referencias). Las demás clases las
  siguen usando grupos sin migrar, así que se retiran cuando llegue su turno. `styles.scss` baja
  de 116 a 113 líneas.

**Checkpoint**: US1 entregable (SC-029). Se despliega el kit completo, nunca pantalla suelta.

---

## Phase 4: User Story 2 — El portal de aprendizaje (Priority: P1)

**Goal**: catálogo, lector, cuestionario, progreso y notificaciones se presentan como el portal
denso que define la marca.

**Independent Test**: recorrer catálogo → artículo → cuestionario → progreso → notificaciones
y contrastar con el kit.

**Referencia**: `design/ui_kits/learner/app.js`, `data.js` y la variante `portal.js` de tres
columnas.

- [x] T030 [US2] Disposición de portal de tres zonas —riel de categorías y progreso, columna central, riel de continuación/ranking/notificaciones— en `frontend/src/app/features/learning/catalog/` (FR-102)
- [x] T031 [US2] Recomponer el catálogo con artículo destacado y catálogo con pestañas en `frontend/src/app/features/learning/catalog/catalog.component.html`, eliminando sus 6 estilos en línea
- [x] T032 [US2] Responsive del portal: bajo `--bp-lg` colapsa **primero el riel derecho**; bajo `--bp-md` el izquierdo pasa a desplegable; la columna central **nunca** se sacrifica (FR-126, research D-27)
- [x] T033 [US2] Recomponer el lector en `frontend/src/app/features/learning/article/article.component.html`: ancho cómodo de lectura, cita destacada y panel lateral de progreso y relacionados (FR-103), eliminando sus 2 estilos en línea. **Conservar el elemento `<article>`** como contenedor del cuerpo: `us1-aprendizaje.spec.ts` lo selecciona y es además el marcado semánticamente correcto (research D-29)
- [x] T034 [US2] Recomponer el cuestionario en `frontend/src/app/features/learning/quiz/quiz.component.html` con la presentación de calificación y reintento del sistema (FR-104), eliminando sus 6 estilos en línea. **Conservar `<fieldset>` por pregunta y `<input type="radio">` como control de opción**: `us1-aprendizaje.spec.ts` los selecciona, y son el marcado que un lector de pantalla necesita para un grupo de opciones excluyentes (research D-29, FR-095). Sustituirlos por fichas seleccionables rompería la suite **y** la accesibilidad
- [x] T035 [US2] Recomponer la pantalla de progreso en `frontend/src/app/features/learning/progress/progress.component.html` con puntos, estadísticas e historial usando `ProgressBar` y `Badge` (FR-105), eliminando sus 5 estilos en línea
- [x] T036 [US2] Recomponer la bandeja en `frontend/src/app/features/notifications/notifications.component.html`, distinguiendo visualmente lo leído de lo no leído (FR-106), eliminando sus 5 estilos en línea
- [x] T037 [P] [US2] Estados vacíos con sentido: catálogo sin artículos publicados, progreso sin cuestionarios resueltos, bandeja sin notificaciones, en `frontend/src/app/features/{learning,notifications}/` (FR-119) — los kits se dibujaron con datos siempre presentes y no cubren este caso
- [x] T038 [P] [US2] Estados de carga y error en las cinco pantallas, con los componentes de T004 y T006, en `frontend/src/app/features/{learning,notifications}/` (FR-118)
- [x] T039 [US2] Tolerancia a desbordamiento: títulos de artículo y de categoría más largos que los del kit truncan con indicación visible, sin romper la maquetación, en `frontend/src/app/features/learning/` (FR-120)
- [x] T040 [US2] Verificar que la puntuación mostrada en progreso conserva su precisión decimal, reutilizando los ayudantes existentes en `frontend/src/app/features/learning/progress/` (FR-109, Principio VIII)
- [x] T041 [P] [US2] Comparación visual por captura de las cinco pantallas contra el kit, a cada punto de corte, en `frontend/e2e/visual/learner.spec.ts`
- [x] T042 [US2] Ejecutar `us1-aprendizaje.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [x] T043 [US2] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Notas del grupo del portal (T030–T043)**

- **T030–T032 — tres zonas y degradación declarada.** Riel de categorías y acceso a
  calculadoras, columna central con destacado y catálogo con pestañas, riel de progreso y
  notificaciones. El orden del DOM es el de lectura y las tres zonas se reparten con
  `grid-template-areas`, que es lo único que permite reordenarlas sin tocar el marcado: bajo
  `--bp-lg` la **zona de actividad** baja a lo ancho (primera en sacrificarse) y bajo `--bp-md`
  la **navegación** se pliega; la columna central no cambia de sitio en ningún ancho. Las
  columnas usan `minmax(0, 1fr)` porque un título sin espacios ensancha la columna si el mínimo
  no está acotado, y eso mueve la página entera (FR-127).
- **El desplegable de categorías es un `<details>` nativo**, no un componente: el design system
  no trae «disclosure» y un `<details>` no lo es — solo se ajustan el resumen y el chevron,
  que son `--space-*` y `--fs-*` como cualquier otra regla de disposición.
- **Dos defectos de disposición que solo aparecieron al mirar las capturas**:
  1. En columna, `flex-basis: 260px` mide el ALTO, así que el riel de actividad abría 260 px
     de hueco entre un módulo y el siguiente bajo `--bp-md`. Se devuelve a `flex: 0 0 auto`.
  2. Las pestañas se recortaban en el borde del contenedor. Es correcto —se desplazan dentro
     de él y la página no se mueve (FR-127)— pero se deja anotado que la solución
     *preferible* sería un indicador de desplazamiento; hoy no existe y el recorte es visible.

#### Lo que el kit dibuja y los contratos NO tienen (se reporta, no se inventa)

El kit del portal está dibujado con datos que la plataforma no produce. Se han comprobado uno a
uno contra `routes.go` y los DTO del Gateway, y **ninguno se ha sustituido por un valor
inventado** (N-15, FR-122):

| Pieza del kit | Por qué no está |
|---|---|
| Ranking de la semana | No existe endpoint de ranking en ningún contrato |
| «Continuar aprendiendo» | No existe endpoint de «último artículo» ni de continuar |
| % de avance por categoría | `/me/progress` da los puntos globales, no por categoría |
| Dificultad y minutos de lectura en la tarjeta | `Article` no lleva ninguno de los dos campos |
| Autor y fecha del artículo | `Article` tampoco los lleva |
| Cita destacada dentro del texto | Necesita `body_doc` (bloque `quote`), que es de 002 y aún no existe (T016/T131) |
| «Racha de N días» | No hay racha en los contratos; el «hito» es de puntos |

El riel derecho se queda por tanto con lo que **sí** existe: mi progreso (puntos reales) y las
notificaciones reales. Es más delgado que el del kit y esa diferencia es un dato, no un olvido.

- **T033 — el `<article>` tiene que ser ÚNICO.** `us1-aprendizaje.spec.ts` hace
  `expect(page.locator('article')).toBeVisible()` y Playwright resuelve esa aserción contra **un
  solo** elemento (comprobado: con dos, falla por modo estricto). Por eso los relacionados van en
  una lista y no en artículos anidados. Medida de lectura de 68 caracteres, párrafos separados
  por línea en blanco y `white-space: pre-line` para respetar los saltos simples de dentro de un
  párrafo. Los relacionados son otros artículos de la **misma categoría**, pedidos al mismo
  listado del catálogo: sin endpoint de recomendaciones, «relacionado» solo puede significar algo
  comprobable.
- **T034 — dos correcciones reales.** (1) «Reintentar» abría un intento nuevo **por debajo** de
  la calificación anterior, porque `restart()` no limpiaba `result()`: sin eso, FR-104 no se
  cumplía y el usuario veía el resultado viejo como si nada hubiera pasado. (2) El reintento abre
  una sesión NUEVA a propósito: la ya calificada no se puede reutilizar (FR-042). El `<fieldset>`
  y el `<input type="radio">` siguen siendo nativos (D-29) — cambia el dibujo, no el control, y
  el estado elegido se marca con fondo, borde y peso además del color.
- **T035 + T040 — la pantalla tiene EXACTAMENTE un `.fc-num`.** `us1` cierra con
  `expect(page.locator('.fc-num')).toHaveText(/\d+ puntos/)`; se comprobó que con dos coincidencias
  Playwright **falla** por ambigüedad, así que la figura con tipografía de datos es la de los
  puntos (con la unidad dentro del mismo elemento) y los contadores de la actividad van con la
  tipografía normal. Trampa asociada: `fc-progress-bar` pinta su propio `.fc-num` cuando se le
  pide `showValue`, así que en esta pantalla no se le pide. La primera prueba de
  `progress.component.spec.ts` fija las dos cosas para que un rediseño futuro no las rompa en
  silencio.
- **T035 — tres fuentes, tres estados.** Los puntos, las estadísticas y el historial vienen de
  `/me/progress`, `/me/report` y `/me/data`; cada zona declara su carga y su error por separado
  (FR-118). **Hallazgo**: el historial no puede mostrar el artículo ni la categoría porque
  `QuizAttempt` solo lleva `attempt_id`, `attempt_no`, `score` y `created_at`.
- **T040 — la calificación no se trunca.** `shared/format-decimal.ts` es el único lugar donde la
  cadena decimal se interpreta y se vuelve a serializar, con `decimal.js` y a través del ayudante
  de frontera del proyecto. `66.67` se muestra `66.67`; nunca `66`. La escala se mide con
  `decimal.js` y no con `Number`/`parseFloat` porque el Principio VIII prohíbe la coma flotante
  para estos valores, aunque el directorio no esté entre los que la regla de lint cubre. Nota:
  este ayudante vive en `shared/` y no en `features/learning/progress/` como decía la tarea,
  porque lo usan pantallas de DOS features (cuestionario y progreso, y la bandeja).
- **T036 — lo leído y lo no leído, con tres señales.** Fondo, peso y la etiqueta «sin leer». El
  color solo no basta. El texto de cada entrada sale del `payload` que el Orquestador escribe al
  calificar: `resultado_cuestionario` (puntaje + aprobado) y `hito_progreso` (puntos).
  **Hallazgo**: `nuevo_articulo` y `recordatorio` están declarados en el `CHECK` de la tabla y en
  Usuarios, pero **ningún productor los emite** (verificado en los servicios) — hoy la bandeja no
  puede mostrar esas dos clases de entrada.
- **T037/T038 — estados vacíos, de carga y de error.** El kit no dibuja ninguno de los tres casos
  vacíos porque siempre tiene datos, así que se han añadido a mano: catálogo sin artículos
  publicados (con salida a «ver todas las categorías» si hay filtro), historial sin intentos (con
  salida al catálogo) y bandeja vacía. Cada riel declara su error por separado, y la primera prueba
  de `catalog.component.spec.ts` fija que una bandeja rota **no** deja el catálogo en blanco.
- **T039 — desbordamiento.** Los títulos se acotan a dos líneas con puntos suspensivos, pero el
  texto completo sigue en el DOM y además viaja en `title`: no se oculta información (FR-120), solo
  se acota la caja. La tabla del historial se desplaza dentro de su contenedor (FR-127).

#### `fc-link-button`: un componente nuevo que nace de un defecto real

`fc-button` no podía navegar, y los enlaces de este grupo lo necesitaban. La primera versión lo
resolvió con un modo `link` que elegía el elemento con `@if`/`@else` dentro de la propia
plantilla... y **Angular no proyecta `<ng-content>` dentro de un bloque de control de flujo**: el
`<a>` se renderizaba **vacío**, sin texto y sin nombre accesible. Lo destapó el recorrido de
`us1`, que no encontraba «Iniciar cuestionario», y se confirmó con una prueba mínima de unidad.

La corrección no es un parche: son **dos componentes** —`fc-button` (acción) y `fc-link-button`
(navegación)— que comparten la MISMA hoja de estilos. El elemento decide el rol, y un enlace con
rol de botón (o al revés) le miente al lector de pantalla (FR-095). La prueba que faltaba —afirmar
el **texto proyectado**, no solo la etiqueta— está ahora en las dos suites.

#### Dos colisiones con la suite que no se puede tocar (N-13)

1. **«Ir a simuladores» dejó de ser un nombre válido.** `us2-simuladores.spec.ts` selecciona
   `getByRole('link', { name: 'Simuladores' })`, que coincide por **subcadena**: con el botón del
   riel, el localizador resolvía a DOS elementos y el recorrido fallaba por ambigüedad. Se renombra
   a «Ver las calculadoras» —no se toca la prueba— y además describe mejor el destino.
2. **Los títulos del catálogo tienen que ser encabezados de nivel 3, y el destacado no.**
   `us4-editorial.spec.ts` afirma que el artículo publicado aparece con
   `getByRole('heading', { level: 3 })`. El destacado también está en la lista, así que si ambos
   fueran `<h3>` la aserción encontraría dos encabezados con el mismo texto y fallaría; el
   destacado va en `<h2>` y las filas en `<h3>`. De paso, los títulos dejan de ser `<span>` con
   aspecto de título: un titular que no es encabezado tampoco existe para un lector de pantalla.

**T041/T042/T043**: 25 capturas (5 pantallas × 5 anchos) en `test-results/visual/learner/`, y
**28/28 verde** —4 recorridos + 3 de accesibilidad + 1 de independencia externa + 15 del acceso +
5 del portal— con las suites sin tocar. En `styles.scss` **no queda nada que retirar**: las seis
clases que quedan (`fc-btn`, `fc-banner`, `fc-help`, `fc-input`, `fc-field`, `fc-label`) las siguen
usando los cuatro grupos sin migrar, y se retiran cuando llegue su turno. La deuda baja a **65
espacios en línea** (desde 94), **11 pantallas artesanales** (desde 19) y **65 errores de lint**
(desde 89, todos preexistentes en las pantallas sin migrar). Las pruebas unitarias pasan de 77 a
**100**.

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
