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

- [x] T044 [US3] Riel de calculadoras junto al formulario de la seleccionada en `frontend/src/app/features/simulators/selector/selector.component.html` (FR-107), eliminando sus 4 estilos en línea
- [x] T045 [US3] Recomponer el formulario de parámetros en `frontend/src/app/features/simulators/forms/simulator-form.component.html` con `Input` y `Button` compartidos, eliminando sus 6 estilos en línea
- [x] T046 [US3] Presentar las cifras monetarias con la tipografía de datos del sistema, distinguibles del texto corrido, en `frontend/src/app/features/simulators/result/result.component.html` (FR-108), eliminando sus 3 estilos en línea
- [x] T047 [US3] Recomponer el historial en `frontend/src/app/features/simulators/history/history.component.html` de modo que permita comparar ejecuciones sin abrir cada una (FR-110) — es la plantilla con **más estilos en línea de todas: 13**
- [x] T048 [US3] **Verificar que ninguna cifra pasa por una conversión que altere su precisión**: se conservan `frontend/src/app/shared/decimal-str.ts`, `features/simulators/decimal-validators.ts` y `result-format.ts`; prohibido `number` nativo (FR-109, Principio VIII NON-NEGOTIABLE)
- [x] T049 [US3] Una cifra monetaria **nunca trunca**: si no cabe, se reduce el contenedor o cambia la disposición, en `frontend/src/app/features/simulators/` — un importe cortado no es texto incompleto, es un dato falso (nota N-15)
- [x] T050 [US3] Responsive: el riel de calculadoras pasa a selector horizontal desplazable sobre el formulario bajo `--bp-md`; el historial desplaza **dentro de su contenedor** y la página nunca en horizontal (FR-127, research D-27)
- [x] T051 [P] [US3] Estados de carga, error y vacío —historial sin simulaciones— en las cuatro pantallas de `frontend/src/app/features/simulators/` (FR-118, FR-119)
- [x] T052 [P] [US3] Comparación visual por captura contra el kit, a cada punto de corte, en `frontend/e2e/visual/simulators.spec.ts`
- [x] T053 [US3] Ejecutar `us2-simuladores.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [x] T054 [US3] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Notas del grupo de simuladores (T044–T054)**

- **T044/T050 — un solo riel, usado por DOS pantallas.** `fc-calculator-rail` vive en
  `features/simulators/rail/` y lo comparten el selector y el formulario, porque FR-107 pide
  que las calculadoras acompañen al formulario de la elegida. Duplicar la lista habría dejado
  dos sitios donde olvidarse de una calculadora nueva. Bajo `--bp-md` el riel deja de ser una
  columna y pasa a ser un selector horizontal que se desplaza dentro de su contenedor
  (FR-126/FR-127).
- **EL SELECTOR NO REPITE LOS NOMBRES.** `us2-simuladores.spec.ts` selecciona
  `getByRole('link', { name: 'Crédito' })`, que coincide por **subcadena**: si la portada
  mostrara el riel **y** tarjetas con los mismos nombres, el localizador resolvería a dos
  elementos y el recorrido fallaría por ambigüedad (N-13). La lista aparece una sola vez, en el
  riel, y el centro explica cómo funciona el módulo.
- **El riel NO lleva iconos.** El kit dibuja uno por calculadora (`wallet`, `trending-up`,
  `landmark`) y **ninguno de los tres está entre los 25 iconos registrados** (research D-32).
  Poner una alcancía en «Inversión» sería otro dato inventado (N-15), no una licencia creativa.
- **T045 — `fc-input` gana `inputMode`.** Un monto o una tasa se capturan con teclado decimal
  y un número de cuotas con el numérico; sin declararlo, un campo que no puede tener letras
  abría el teclado alfabético en el móvil. Es el mismo criterio que el `autocomplete` que se
  añadió en el grupo de acceso: lo que el campo ES tiene que llegar al `<input>` interno.
- **T046/T049 — la cifra principal primero, y nunca recortada.** El resultado conserva
  `<dl>`/`<dt>`/`<dd class="fc-num">` porque `us2` afirma un `dt` con «Cuota mensual» y que el
  **primer** `dd.fc-num` de la pantalla lleve el símbolo del peso: el ORDEN de `resultFields`
  es lo que decide cuál es la cifra protagonista, y su inversión no rompería la maquetación
  sino la afirmación. La fila principal se pinta más grande y las demás como secundarias.
- **N-15 verificado en el navegador.** No hay `text-overflow` ni `line-clamp` en ninguna regla
  de dinero; las filas usan `flex-wrap`, así que una cifra que no cabe **baja entera a la línea
  siguiente** en vez de encogerse o abreviarse. La comprobación vive en
  `e2e/visual/simulators.spec.ts` porque es geometría —`scrollWidth` contra `clientWidth`, más
  los estilos computados— y eso solo existe dentro de un navegador: se ejecuta en las **cinco
  anchuras** sobre el resultado y sobre el historial.
- **T047 — el historial es una TABLA, no una lista de tarjetas.** FR-110 pide poder comparar
  sin abrir cada ejecución, y comparar es leer la misma columna: cada fila lleva su calculadora,
  su fecha, sus parámetros y su resultado ya formateados. Se desplaza dentro de su contenedor
  (FR-127). El mapeo entrada→filas se extrajo a `history-rows.ts` porque lo usan **dos** sitios
  —el historial y el resumen del formulario—, y dos copias acabarían llamando «Monto» a lo que
  la otra llama «Monto del crédito».
- **El formulario gana la tercera zona del kit**: un resumen de las tres últimas simulaciones,
  con datos reales del mismo endpoint del historial. Se relee después de cada cálculo porque,
  si no, diría «todavía no has guardado ninguna» justo después de guardar una. Va con
  `<span class="fc-num">` y no con `<dd>`: el `dd.fc-num` que `us2` busca tiene que seguir siendo
  el del resultado.
- **T048 — la precisión, comprobada por el resultado y no por la regla.** `result-format.spec.ts`
  fija que `$9,007,199,254,740,993.01` (2⁵³ + 1, el primer entero que un `double` no puede
  representar) sale **exacto**, que un monto con tres decimales se **rechaza** en vez de
  redondearse, y que `formatRate('0.123456')` es `12.3456 %`. La regla de lint
  (`no-restricted-types` + `no-restricted-globals` sobre `Number`/`parseFloat`) ya prohíbe el
  atajo en `features/simulators/**`; estas pruebas comprueban lo que la regla protege.
- **T051 — el selector no tiene estados de carga ni de error, y es correcto.** Las cinco
  calculadoras salen de `calculators.config.ts`, que es un espejo de los contratos: no hay
  lectura de red que pueda fallar. FR-118 obliga a las pantallas que DEPENDEN de datos. Las
  otras sí los tienen, cada una por su cuenta: que el riel de últimas simulaciones falle no
  puede impedir calcular (hay una prueba que lo fija).

#### Un hallazgo de presentación que sí se corrigió: «Tasa anual» no dice qué tasa es

Las fórmulas de la semilla para **ahorro** y **crédito** usan `tasa_periodica(tasa_anual, 12)`,
que en el motor es una **división nominal** —`ast.rs` lo documenta literalmente como «división
NOMINAL anual / m»—, mientras que **inversión** compone la tasa anual directamente. Con 0.24, el
reparto nominal da 2 % mensual (26.82 % E.A. equivalente) y no 1.8087 %, y la cuota del ejemplo
(945 595.97 sobre 10 000 000 a 12 meses) corresponde exactamente a ese 2 %.

No es un defecto del cálculo: es una decisión documentada en el motor. Pero «Tasa anual» a secas
se lee como **Efectiva Anual**, así que el campo ahora lo aclara
(`TASA_NOMINAL_HELP`), y **`inversion` no lleva esa ayuda** porque no reparte nada. Cambiar el
cálculo no era una opción: 003 es de presentación (FR-121).

**T052/T053/T054**: 25 capturas (5 pantallas × 5 anchos) en `test-results/visual/simulators/` y
**33/33 verde** —4 recorridos + 3 de accesibilidad + 1 de independencia externa + 45 capturas—
con las suites sin tocar. En `styles.scss` **no queda nada que retirar**: las seis clases que
quedan las siguen usando los grupos de perfil y editorial, que son los dos últimos. La deuda baja
a **39 espacios en línea** (desde 94), **7 pantallas artesanales** (desde 19) y **39 errores de
lint** (desde 89). Las pruebas unitarias pasan de 100 a **123**.

**Checkpoint**: US3 entregable (SC-035).

---

## Phase 6: User Story 4 — Perfil, privacidad y reportes (Priority: P2)

**Goal**: las cuatro pantallas de perfil y datos personales se ven parte de la misma
plataforma.

**Independent Test**: recorrer las cuatro y verificar el tratamiento de las cifras del reporte.

**Sin kit propio**: se resuelven con los componentes compartidos y las guías del design system.

- [x] T055 [US4] Recomponer `frontend/src/app/features/profile/profile.component.html` con los controles compartidos (FR-111), eliminando sus 7 estilos en línea
- [x] T056 [US4] Recomponer `frontend/src/app/features/profile/password/password.component.html`, eliminando sus 2 estilos en línea
- [x] T057 [US4] Recomponer el reporte de actividad en `frontend/src/app/features/profile/report/report.component.html` con la tipografía de datos (FR-113) — es la segunda plantilla con más estilos en línea: **10**
- [x] T058 [US4] Verificar que las cifras del reporte conservan su precisión decimal, en `frontend/src/app/features/profile/report/` (FR-113, Principio VIII)
- [x] T059 [US4] Recomponer `frontend/src/app/features/profile/delete-account/delete-account.component.html` de modo que la consecuencia de la operación y su período de reversión se comuniquen **de forma destacada**, con los componentes de aviso del sistema y no en texto corrido (FR-112), eliminando sus 3 estilos en línea
- [x] T060 [P] [US4] Estados de carga, error y vacío —reporte sin actividad— en las cuatro pantallas de `frontend/src/app/features/profile/` (FR-118, FR-119)
- [x] T061 [US4] Responsive de las cuatro pantallas hasta el mínimo de 360 px, en `frontend/src/app/features/profile/` (FR-124, SC-038, research D-27)
- [x] T062 [P] [US4] Comparación visual por captura contra las guías, a cada punto de corte, en `frontend/e2e/visual/profile.spec.ts`
- [x] T063 [US4] Ejecutar `us3-perfil.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`
- [x] T064 [US4] Retirar de `frontend/src/styles.scss` las clases que ya no referencia ninguna plantilla tras este grupo

**Notas del grupo de perfil (T055–T064)**

- **T055–T057 — cuatro pantallas de una columna con la biblioteca.** Perfil (datos de cuenta +
  formulario de preferencias + accesos), contraseña, reporte y eliminación. Los siete, dos y
  diez estilos en línea desaparecen; ya no queda ninguno en todo `features/`, salvo el grupo
  editorial que se migra el último (FR-123).
- **El perfil muestra el estado REAL de la cuenta.** `account_status` se traduce para los dos
  valores que el `CHECK` admite hoy (`active`, `anonymized`) y **cualquier otro se enseña tal
  cual**: 002 añadirá `pending_deletion`, e inventarle una traducción sería describir un
  estado que la plataforma no tiene. La misma regla que en los indicadores de contenido y en
  las tasas: lo que no se sabe, no se rellena.
- **El correo del titular sigue siendo el único texto con ese valor exacto** en la pantalla,
  porque `us3-perfil.spec.ts` lo busca con `getByText(email, { exact: true })`.
- **T058 — las cifras del reporte son CONTEOS, no dinero.** `points`, `articles_viewed`,
  `quizzes_attempted` y `simulations_run` son enteros del contrato (`int32`/`int64`), así que
  no cruzan ninguna frontera decimal y el Principio VIII no tiene nada que preservar más allá
  de no manipularlas. Lo que sí se comprueba es que el componente **no suma, no promedia, no
  redondea y no formatea**: solo pinta el número que recibió, incluso cuando es
  `9 007 199 254 740 991`. Lo que sí importa —y por eso van con `.fc-num`— es que se lean como
  datos y no como prosa (FR-113).
- **T059 — lo que FR-112 pide y lo que hoy se puede decir.** FR-112 pide comunicar «la
  consecuencia de la operación y **su período de reversión**», y el período de reversión es de
  002: el estado `pending_deletion` con 30 días de gracia y la reactivación posterior
  (FR-078/FR-079). **Hoy no existe**: no hay migración de estado (T021), ni endpoint de
  reactivación, ni purga (T136–T148). Anunciar «tienes 30 días para recuperarla» sería la peor
  clase de mentira posible en esta pantalla —una promesa de reversibilidad sobre una
  operación que anonimiza sin vuelta atrás—, así que la advertencia dice lo que la plataforma
  hace hoy y **el plazo queda reportado como pendiente de 002** (FR-122, FR-123). Hay una
  prueba que fija que la pantalla NO menciona «30 días». La mitad que sí se cumple se cumple
  entera: el veredicto va en un aviso con `role="alert"` y las consecuencias, punto por
  punto, en una ficha — antes del formulario, porque la fricción de escribir la frase solo
  tiene sentido si primero se leyó la consecuencia.
- **El botón destructivo usa la variante del sistema.** Antes llevaba
  `background: var(--color-danger-strong, #c0392b)`: un token **inexistente** con un color
  literal de reserva. Ahora es `variant="danger"`, que sale de `--danger`.
- **Las dos salidas conservan su elemento.** En la pantalla de contraseña, «Ir a iniciar
  sesión» es un ENLACE; en la de eliminación es un BOTÓN que navega por código. `us3` los
  selecciona con roles distintos (`link` y `button`) y esa distinción no es un capricho del
  test: son dos acciones de naturaleza distinta.
- **T062 — la barrera de accesibilidad se extiende sin tocar la suite.** `a11y.spec.ts` recorre
  `/perfil` pero no sus tres pantallas hijas, y su propio comentario pide ampliarla «por
  grupo». Se hace desde `e2e/visual/profile.spec.ts`, con los MISMOS ayudantes de
  `support/a11y.ts`: la nota N-13 prohíbe modificar `e2e/*.spec.ts`, y una barrera copiada es
  una barrera que se puede relajar sin que nadie lo note. Las cinco anchuras comprueban,
  además, etiquetas asociadas y contraste AA de todo el texto visible **antes** de capturar,
  para que una pantalla que no cumple no deje una imagen que parezca aprobada.

**T063/T064**: 20 capturas (4 pantallas × 5 anchos) en `test-results/visual/profile/` y
**38/38 verde** —4 recorridos + 3 de accesibilidad + 1 de independencia externa + 50 capturas—
con las suites sin tocar. En `styles.scss` **no queda nada que retirar**, y esa es la noticia
importante: las seis clases que quedan las usan **solo las tres pantallas editoriales**, así que
el archivo ya no se puede vaciar hasta que ese grupo se migre — que es exactamente lo que FR-123
manda (el editorial, el último) y lo que 002 bloquea (T131/T075). La deuda baja a **17 espacios
en línea** (desde 94), **3 pantallas artesanales** (desde 19) y **17 errores de lint** (desde 89,
todos en esas tres plantillas). Las pruebas unitarias pasan de 123 a **143**.

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

- [x] T065 [US5] Recomponer el listado de artículos agrupados por estado —borrador, en revisión, publicado— con distintivos visuales que los diferencien, en `frontend/src/app/features/editorial/versions/versions.component.html` (FR-114), eliminando sus 5 estilos en línea
- [x] T066 [US5] Recomponer la bandeja de revisión presentando **de forma destacada** la decisión de aprobar o rechazar, en `frontend/src/app/features/editorial/review/review.component.html` (FR-115), eliminando sus 4 estilos en línea
- [x] T067 [US5] Presentar el aviso de que un editor no puede aprobar su propio contenido de forma comprensible y no como error genérico, en `frontend/src/app/features/editorial/review/` (FR-116) — preserva la regla FR-008 sin duplicar su lógica en la vista
- [x] T068 [US5] Historial de versiones con estado, autor y fecha presentados de forma consistente con el resto de la plataforma, en `frontend/src/app/features/editorial/versions/` (FR-117)
- [ ] T069 [US5] Migrar **únicamente el marco** del editor de artículos —cabecera, paneles laterales, ajustes de publicación— en `frontend/src/app/features/editorial/editor/`, **sin tocar la superficie de redacción**, que pertenece al feature 002 (FR-123). De sus 8 estilos en línea, solo se retiran los del marco — **BLOQUEADA por 002 (T131)**: ver la nota
- [x] T070 [US5] Verificar la frontera con `git diff` sobre `frontend/src/app/features/editorial/editor/`: los cambios deben limitarse al marco (FR-123, quickstart §4 grupo 5)
- [x] T071 [P] [US5] Estados de carga, error y vacío —sin borradores, sin artículos en revisión— en las tres pantallas de `frontend/src/app/features/editorial/` (FR-118, FR-119)
- [x] T072 [US5] Responsive de las tres pantallas en `frontend/src/app/features/editorial/`; las tablas desplazan dentro de su contenedor (FR-124, FR-127, research D-27)
- [x] T073 [P] [US5] Comparación visual por captura contra el kit, a cada punto de corte, en `frontend/e2e/visual/editorial.spec.ts`
- [x] T074 [US5] Ejecutar `us4-editorial.spec.ts` y la verificación `@a11y` **sin modificarlas**, en `frontend/e2e/`

**Notas del grupo editorial (T065–T074)**

- **T065/T068 — el estado se distingue, y el autor no se inventa.** Los cuatro estados de
  `ArticleVersion` tienen etiqueta y tono propios, en un módulo compartido
  (`version-state.ts`) porque las dos pantallas los muestran: dos tablas de traducción
  acabarían llamando «Pendiente» a lo que la otra llama «En revisión», y esa divergencia es
  información falsa para quien revisa. Un estado que no se conoce se muestra **tal cual**.
- **El autor es «Tú» u «Otro editor», y el identificador se conserva.** El contrato lleva
  `created_by` como **UUID**, no el nombre del editor: lo único afirmable sin inventar es si
  la versión es tuya. **Hallazgo**: no hay endpoint que traduzca un `user_id` a un nombre
  visible, así que un coordinador no puede saber *quién* escribió lo que revisa —solo que no
  fue él—; el `created_by` se muestra en mono para poder trazar (FR-122).
- **T066 — la decisión sigue teniendo una sola mitad, y ahora se sabe por qué.** FR-115 pide
  presentar la decisión de aprobar **o rechazar**. Se añadió un «Archivar versión» que reusaba
  `POST …/archive` —la única ruta que parecía sobrar en el contrato—, la prueba unitaria pasó
  (simulaba la API) y **contra el servicio real da `FailedPrecondition`**: ese endpoint es
  `publicado → archivado`. Aprendizaje **no tiene ninguna transición que saque una versión de
  `en_revision` salvo publicarla**. El botón se ha **retirado**: una acción que siempre falla
  es peor que su ausencia, e inventar la transición sería cambiar una regla de negocio
  (FR-121). La mitad «rechazar» de FR-115 queda **bloqueada por 002** y registrada en
  `findings.md` con su evidencia. Lo que sí queda de T066: la decisión se presenta destacada
  al pie de cada versión, con el diseño del sistema en lugar de cuatro estilos en línea.
- **T067 — FR-116 se explica, no se reimplementa.** Que un coordinador no pueda aprobar su
  propio contenido lo decide Aprendizaje; la vista no lo comprueba por su cuenta. Cuando el
  borde lo rechaza (`EditorialError.kind === 'forbidden'`), aparece un aviso **propio** —tono
  de advertencia, no de error— que nombra la regla y dice qué hacer (pedírselo a otro
  coordinador). La frase que describe la regla en la cabecera no decide nada. Y hay una
  prueba que fija que, tras el rechazo, la versión SIGUE en la cola: no se publicó nada.
- **T069 — NO SE HIZO, y es deliberado.** El marco del editor no se ha tocado. El grupo 5
  «va el último a propósito» (research D-28) porque la superficie de redacción la reescribe
  002 (T131, TipTap) y migrar un marco sobre una plantilla que va a desaparecer es trabajo
  para tirar. **Consecuencia: `frontend/src/styles.scss` no se puede vaciar todavía** —las
  seis clases que quedan las usa solo `editor/editor.component.html`—, así que **T075 (el
  criterio de terminación del feature) queda bloqueado por 002**, no por 003.
- **T070 — la frontera, verificada.** `git diff` sobre
  `frontend/src/app/features/editorial/editor/` sale **vacío**: el editor no tiene ni una
  línea modificada en todo el feature 003. Es la comprobación literal que pide la tarea, y
  significa que la reescritura de 002 puede empezar ahí sin resolver ningún conflicto.
- **T072 — responsive sin tablas nuevas.** El listado y la bandeja se resolvieron como
  listas, no como tablas: cada versión lleva pocos datos y el cuerpo puede ser largo, así
  que una tarjeta se lee mejor que una fila de celdas estrechas. Las capturas a 360 px
  confirman que la página no desplaza en horizontal.
- **T073 — la captura del editor es la prueba de la frontera.** Se incluye `/editorial`
  entre las capturas aunque 003 no lo migre: deja constancia de dónde queda el límite.
  Además, la cuenta de prueba recibe **los dos roles** y pulsa «Aprobar y publicar» sobre su
  propio contenido, así que el aviso de FR-116 se captura **de verdad**, con el borde
  rechazándolo — no con un estado simulado.
- **La barrera de accesibilidad también cubre estas dos pantallas.** Ninguna está en
  `a11y.spec.ts`, así que `e2e/visual/editorial.spec.ts` comprueba etiquetas y contraste AA
  con los mismos ayudantes de `support/a11y.ts` antes de capturar. No se toca la suite
  (N-13).

**T074**: 30 capturas (3 pantallas × 5 anchos + el aviso de FR-116 × 5) en
`test-results/visual/editorial/` y **43/43 verde** —4 recorridos + 3 de accesibilidad + 1 de
independencia externa + 85 capturas— con las suites sin tocar. La deuda baja a **8 espacios en
línea** (desde 94) y **1 pantalla artesanal** (desde 19): los ocho que quedan y esa única
pantalla son el editor. Lint: **8 errores** (desde 89). Unitarias: **160** (desde 123).

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

- [ ] T075 [US6] **Eliminar `frontend/src/styles.scss`** y retirar su declaración de `frontend/angular.json` — la capa artesanal debe quedar vacía tras los cinco grupos. **Es el criterio de terminación del feature** (research D-26) — **BLOQUEADA por 002 (T131)**: las seis clases que quedan las usa solo el editor
- [ ] T076 [US6] Verificar con `frontend/scripts/design-debt.mjs` que los estilos en línea pasaron de 94 a **0** y que ninguna plantilla referencia ya clases artesanales (FR-086, FR-088, SC-027) — **BLOQUEADA por T069**: hoy son 8, y los 8 están en el editor
- [x] T077 [US6] Recorrer las 19 pantallas y el armazón confirmando que ninguna desentona del sistema visual común, contrastando `frontend/src/app/features/` contra los cinco kits de `design/ui_kits/` (FR-086, SC-028)
- [x] T078 [US6] Verificar los 6 selectores no accesibles de `frontend/e2e/` (research D-29): que `fc-module`, `fc-num`, `fc-eyebrow` y `fc-linklist` **siguen definidas** en `frontend/src/styles/tokens/base.css`, y que el lector conserva `<article>` y el cuestionario conserva `<fieldset>` e `<input type="radio">`
- [x] T079 [US6] Comprobar que la barrera de T010 rechaza un estilo en línea introducido a propósito, en `frontend/` (FR-089, SC-027)
- [x] T080 [US6] Recorrido por teclado de las 19 pantallas (automatizado, no a mano) y el armazón: todos los controles alcanzables, foco siempre visible, recorriendo `frontend/src/app/features/` y `frontend/src/app/app.component.ts` (FR-093, FR-094, SC-030)
- [x] T081 [US6] Auditoría de que el 100 % de los controles de formulario tiene etiqueta asociada anunciable por lector de pantalla, sobre `frontend/src/app/**/*.html` (FR-095, SC-031)
- [x] T082 [US6] Auditoría de contraste AA de todo el texto frente a su fondo, sobre los tokens de `frontend/src/styles/tokens/colors.css` tal como se aplican en `frontend/src/app/` (FR-096, SC-032)
- [x] T083 [US6] Verificar que la interfaz sigue siendo utilizable con el tamaño de fuente del navegador al 200 %, sin pérdida de contenido ni funcionalidad, sobre `frontend/src/app/` (FR-097)
- [x] T084 [US6] Ejecutar `frontend/e2e/offline-assets.spec.ts` con la conectividad externa bloqueada: tipografía e iconos presentes (FR-092, SC-033)
- [x] T085 [US6] Ejecutar las **4 suites completas sin modificar** y confirmar que pasan con las mismas aserciones que en T009, en `frontend/e2e/` — es la garantía de SC-036, de que ningún comportamiento cambió

**Notas de la verificación final (T078–T085, T089)**

- **T080/T081/T082 — la barrera cubre las 19 pantallas, y se hizo con código.** Las tres
  tareas pedían un recorrido y dos auditorías «a mano» sobre 19 pantallas; se hicieron
  automatizadas en `e2e/a11y.spec.ts` porque una auditoría manual no deja rastro y no se
  puede repetir tras el siguiente cambio. La suite pasó de 7 pantallas a **19**: las de
  acceso (con la de verificación, que antes nadie miraba), las del portal, las cuatro de
  perfil, las tres de simuladores —incluido el **resultado** con sus cifras— y las tres del
  editorial. Las que dependen de datos se descubren navegando, porque su ruta lleva un
  identificador real. Un cuarto recorrido recorre el editorial con una cuenta que tiene los
  dos roles.
- **Un defecto de la propia medición, encontrado al ampliarla.** El recorrido por teclado
  empezaba donde hubiera quedado el foco: tras una navegación interna de la SPA, Chromium
  sigue tabulando **desde el enlace que se acaba de pulsar**, así que el recorrido arrancaba
  a mitad de la página y la cabecera quedaba para el final. Se vio en el lector —el primer
  tabulador entraba en el cuerpo del artículo y la barra superior no aparecía hasta dar la
  vuelta—. Ahora `expectKeyboardReaches` reinicia el foco y la identidad de parada antes de
  recorrer; sin eso, una pantalla con la navegación inalcanzable habría pasado.
- **T078 — las primitivas de portal y los selectores prestados siguen en pie.** `fc-module`,
  `fc-num`, `fc-eyebrow` y `fc-linklist` siguen definidas en `tokens/base.css`; el lector
  tiene **un solo** `<article>` (la suite lo busca por etiqueta y dos la harían ambigua) y el
  cuestionario conserva `<fieldset>` + `<input type="radio">`.
- **T079 — la barrera rechaza de verdad, y se comprobó.** Se introdujo a propósito un
  `style="color: red"` en una plantilla: el lint lo rechaza (`no-inline-styles`) **y**
  `design-debt.mjs` lo cuenta (8 → 9). Se probó también la variante de enlace
  `[style.color]`, que el mismo criterio rechaza. La plantilla se revirtió y la medida
  volvió a 8. Vale la pena el detalle: la comprobación se hizo sobre una sonda real en vez de
  confiar en que la regla estuviera bien escrita.
- **T083 — la comprobación del 200 % existe y pasa.** Con `html { font-size: 200% }` sobre
  seis pantallas: la página no desplaza en horizontal y **ninguna cifra queda recortada**
  (se compara el ancho del contenido con el de su caja, no basta con que siga habiendo un
  `$`). Es la comprobación que enlaza FR-097 con N-15: una cifra recortada por el zoom no es
  texto incompleto, es un dato falso.
- **T086 — el rediseño tenía las cifras en el formato del inglés.** El manual de voz y tono
  (`design/guidelines/brand-voice.html`) escribe «1.250.000» y los cinco kits formatean con
  `toLocaleString('es-CO')`; la aplicación agrupaba los miles con **coma** y separaba los
  decimales con **punto** (`$1,234,567.89`). No es una preferencia: en español de Colombia
  `1,234` se lee mil doscientos treinta y cuatro. Se corrigió en un único sitio
  (`shared/format-number.ts`), del que ahora salen dinero, porcentajes, calificaciones y
  conteos. **No se usó `toLocaleString`**: obliga a pasar por `number`, y el agrupado se hace
  sobre la cadena decimal canónica para no perder precisión por el camino (Principio VIII).
  El porcentaje también lleva su espacio antes del signo, como la norma y el kit.
- **T087 — el presupuesto se respeta y el tamaño real está a la mitad.** Inicial
  **540,33 kB** en crudo y **125,36 kB** transferidos, contra un aviso de 1 MB; ningún
  componente pasa del presupuesto de hoja de estilos. Los trozos diferidos (`catalog`,
  `simulator-form`, `editor`, `categories`) confirman que la biblioteca viaja por pantalla y
  no entera.
- **T089 — diez hallazgos, en `findings.md`.** El más caro: **Aprendizaje no tiene ninguna
  transición que saque una versión de `en_revision` salvo publicarla**, así que la mitad
  «rechazar» de FR-115 no se puede ofrecer (evidencia: las RPC del proto, las cinco
  transiciones SQL y el `FailedPrecondition` del servicio real). El más grande para el
  usuario: **no hay restablecimiento de contraseña**. Y el más silencioso: el borde colapsa
  `FailedPrecondition` en un `400` sin causa, así que la interfaz no puede explicar por qué
  un conflicto de estado no salió.

**Checkpoint**: US6 entregable en todo lo que no depende del editor. `styles.scss` NO se
elimina todavía: le quedan seis clases que usa solo `editor/editor.component.html`, y esa
superficie la reescribe 002 (FR-123). Es el mismo bloqueo que T069 y T075/T076.


---

## Phase 9: Polish & Cross-Cutting

- [x] T086 [P] Revisar que ningún texto de la interfaz se salió de la voz de marca —español de Colombia, tuteo directo— contrastando con `design/guidelines/brand-voice.html` (FR-091)
- [x] T087 [P] Verificar que el presupuesto de tamaño declarado en `frontend/angular.json` no se excedió y que la biblioteca compartida se importa por componente y no entera
- [x] T088 [P] Documentar los cuatro puntos de corte y la regla de degradación por disposición en `design/guidelines/`, para que los hereden los features siguientes en vez de redescubrirlos
- [x] T089 [P] Recopilar los hallazgos de datos que la API no expone, si aparecieron, como entrada de un feature posterior, registrados en `specs/003-design-system-frontend/findings.md` — **sin resolverlos aquí** (FR-122)
- [x] T090 Verificar los 13 criterios SC-027…SC-039 siguiendo `quickstart.md` §2–§7, prestando atención a **SC-034**: ninguna pantalla que dependa de datos queda en blanco ante un fallo ni ante la ausencia de contenido
- [x] T091 Re-evaluar el gate constitucional sobre el código escrito y anotar el resultado en `plan.md` §Constitution Check, con atención al Principio VIII en las pantallas de dinero
- [x] T092 [P] Actualizar `README.md` y `frontend/README.md` con la tabla de criterio de terminación de `quickstart.md` §7
- [x] T093 [P] Comprobar que `dev/build && dev/up` sigue dejando el frontend funcionando sin ningún paso manual (Principio XII regla 4)

---

### Cierre (T077, T086–T093)

- **T077 — las 19 pantallas contra los cinco kits.** El contraste se hizo por bloques y se
  cierra aquí: **auth** (acceso: panel de marca, formularios), **learner** (el portal de tres
  zonas, el lector, el cuestionario, el progreso y las notificaciones), **simuladores**
  (selector, formulario y resultado), **editorial** (listado, bandeja y editor) y el armazón.
  Las 105 capturas de `test-results/visual/` son la evidencia reproducible. **Hallazgo**: el
  kit de **marketing** no tiene pantalla correspondiente —la raíz de la SPA redirige al
  catálogo—, así que de los cinco kits hay uno sin destino. No se inventó una landing: no
  estaba en el alcance y una pantalla nueva no es un rediseño. Los dos perfiles no tienen kit
  propio y se resolvieron con las piezas del kit de aprendizaje, que es de donde salen.
- **T086 — la voz de marca escondía un defecto de datos.** La auditoría de textos no encontró
  nada (ni tuteo de usted, ni anglicismos, ni exclamaciones de marketing; el único «móvil» de
  las plantillas está dentro de un comentario), pero al comprobar la regla del manual sobre las
  cifras apareció que **toda la aplicación formateaba en convención inglesa**. Ver el detalle en
  la nota de T086 más abajo.
- **T087 — el presupuesto se respeta con la mitad de margen**: 540,33 kB crudos / 125,36 kB
  transferidos contra un aviso de 1 MB, y ningún componente excede el presupuesto de hoja de
  estilos.
- **T088 — los puntos de corte quedan documentados donde se heredan.** Nueva tarjeta
  `design/guidelines/responsive-breakpoints.html` con los cuatro valores, la regla de
  degradación por disposición y el porqué de escribir literales dentro de `@media` (una
  variable de CSS no se resuelve en una consulta de medios). Los tokens viven en
  `frontend/src/styles/tokens/breakpoints.css`.
- **T090 — verificación de los 13 criterios** (tabla abajo). Diez se cumplen sin matices; tres
  comparten la causa del editor, que es de 002.
- **T091 — el gate constitucional se re-evaluó y encontró un incumplimiento real del Principio
  VIII**: conservar la precisión no basta si la cifra se **presenta** mal. Anotado en
  `plan.md` §Constitution Check.
- **T092 — `README.md` y `frontend/README.md`** (este último no existía) llevan la tabla del
  criterio de terminación y la estructura del frontend.
- **T093 — `dev/build frontend && dev/up` deja la SPA sirviendo sola.** Comprobado de punta a
  punta al cerrar: la imagen se reconstruye, el contenedor arranca, `http://localhost:4200`
  responde 200 y las **45** pruebas de extremo a extremo pasan contra esa imagen —no contra el
  servidor de desarrollo—. Es la única forma de que el verde signifique algo: la imagen sirve
  el código construido, y las capturas se regeneraron todas contra ella.

#### Verificación de SC-027…SC-039 (T090)

| Criterio | Resultado | Evidencia |
|---|---|---|
| SC-027 sin estilos en línea | **Parcial**: 94 → 8, y el rechazo automatizado funciona | `design-debt.mjs`; sonda de T079 |
| SC-028 las 19 con el sistema común | **Parcial**: 18 de 19 | Mockups de `design/ui_kits/`; 105 capturas |
| SC-029 qué ofrece la plataforma sin desplazar | Cumplido | Panel de marca en la primera pantalla (`visual/auth/`) |
| SC-030 recorrible por teclado | Cumplido | `a11y.spec.ts`, 19 pantallas |
| SC-031 100 % de controles con etiqueta | Cumplido | `expectControlsAreLabelled` en las 19, a 5 anchuras |
| SC-032 contraste AA | Cumplido | `expectTextMeetsAaContrast`; 2 defectos corregidos en T011 |
| SC-033 sin conectividad externa | Cumplido | `offline-assets.spec.ts` |
| SC-034 nunca en blanco | Cumplido | Carga, error y vacío en cada pantalla de datos |
| SC-035 cifra exacta | Cumplido | `result-format.spec.ts` (2⁵³+1) y la comprobación de recorte al 200 % |
| SC-036 sin cambio de comportamiento | Cumplido | 45/45 con las suites heredadas; T009 registra los 3 ajustes de 002 |
| SC-037 marca en una ubicación | Cumplido | `fc-brand-logo` es el único que referencia el recurso |
| SC-038 utilizable a 360 px | Cumplido | Sin desplazamiento horizontal en las 105 capturas |
| SC-039 puntos de corte una sola vez | Cumplido | `breakpoints.css`; ningún componente fija anchos |

**Lo que queda abierto, y por qué**: T069 (el marco del editor), T075 (borrar `styles.scss`) y
T076 (estilos en línea a 0) — que es también la parte no cumplida de SC-027 y SC-028. Las tres
dependen de que exista la superficie de redacción nueva del feature 002.

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
