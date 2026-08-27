# Phase 0 — Research: Rediseño del Frontend contra el Design System

**Feature**: `003-design-system-frontend` | **Fecha**: 2026-08-26

**Entrada**: [spec.md](./spec.md) §"Decisiones Diferidas a la Fase de Planeación" + Constitución v1.1.1

La numeración de decisiones continúa la de `002-calculator-builder-content-admin`, que terminó
en D-25.

---

## D-26 — Estado real de partida: lo que hay que retirar, no lo que falta

**Hallazgo**: la aplicación **no está sin estilar**. Consume los tokens del design system y
tiene, además, una capa de primitivas hecha a mano:

| Archivo | Líneas | Qué define |
|---------|--------|------------|
| `frontend/src/styles.scss` | 116 (44 referencias a tokens) | `fc-field`, `fc-label`, `fc-input`, `fc-select`, `fc-help`, `fc-error-text`, `fc-banner` (+3 variantes), `fc-btn` (+4 variantes) |
| `frontend/src/styles/tokens/base.css` | 99 | `fc-module`, `fc-num`, `fc-eyebrow`, `fc-linklist` |

Ambos están declarados en `angular.json`. El encabezado de `styles.scss` dice literalmente
que sus primitivas están *"inspiradas en `design/components/forms/*.jsx`"*.

**Decisión**: este feature **no añade una capa de estilos, retira una**. La capa artesanal es
un duplicado parcial —19 primitivas frente a 11 componentes reales, sin `Card`, `Tabs`,
`Avatar`, `Badge`, `ProgressBar`, `Tag`, `Icon` ni `BrandLogo`— de la biblioteca compartida que
entrega el feature 002. `styles.scss` se vacía a medida que cada pantalla migra, y su
**eliminación es el criterio de terminación medible** del feature.

**Consecuencia sobre el orden de trabajo**: no se puede borrar `styles.scss` de golpe, porque
las 19 pantallas lo consumen a la vez. Se retira clase por clase, cuando ninguna plantilla
referencia ya esa clase. Ver D-28.

**Por qué importa decirlo así**: describir el trabajo como "aplicar el diseño a pantallas sin
estilo" habría llevado a añadir CSS sobre el existente, dejando dos capas compitiendo — que es
exactamente cómo se llegó a la situación actual.

---

## D-27 — Comportamiento responsive: definirlo aquí, porque no existe en ninguna parte

**Hallazgo**: **cero `@media` en todo el frontend** —ni en `styles.scss`, ni en `styles.css`,
ni en los seis archivos de tokens— y **ningún token de punto de corte** en el design system.
Los kits se dibujaron a viewports fijos (920×600 el de acceso, 1440×900 el portal de tres
zonas). La aplicación de hoy no es responsive y el diseño tampoco lo especifica.

**Decisión**: se definen **cuatro puntos de corte como tokens nuevos** del sistema —no como
valores sueltos en cada pantalla— y una regla de degradación por disposición:

| Token | Ancho | Comportamiento |
|-------|-------|----------------|
| `--bp-sm` | 480 px | Móvil. Una sola columna. Rieles laterales colapsan a secciones apiladas bajo el contenido |
| `--bp-md` | 768 px | Tableta vertical. Dos zonas: se sacrifica el riel secundario, nunca el principal |
| `--bp-lg` | 1024 px | Tableta horizontal / portátil pequeño. Tres zonas con rieles estrechos |
| `--bp-xl` | 1280 px | Escritorio. La disposición de los kits, tal cual |

Reglas por disposición:

- **Card partido de acceso**: bajo `--bp-md`, el panel de marca pasa de columna lateral a
  banda superior compacta —logotipo y titular, sin los tres indicadores—. **No se oculta
  entero**: es lo único que identifica la plataforma en la primera pantalla, y suprimirlo en
  móvil devolvería exactamente el formulario anónimo que este feature viene a corregir.
- **Portal de tres zonas**: el riel derecho (continuar, ranking, notificaciones) es el primero
  en colapsar, porque es accesorio; el riel izquierdo (categorías, progreso) colapsa después,
  a un desplegable; la columna central nunca se sacrifica.
- **Simuladores**: el riel de calculadoras pasa a un selector horizontal desplazable sobre el
  formulario.
- **Tablas de historial y de versiones**: se desplazan horizontalmente dentro de su propio
  contenedor. La página **nunca** desplaza en horizontal.
- **Ancho mínimo soportado**: 360 px.

**Alternativa considerada**: soportar solo escritorio, como los kits. Rechazada — la
educación financiera se consume mayoritariamente en móvil, y entregar un rediseño que solo se
ve bien a 1440 px sería resolver el problema estético dejando intacto uno peor.

**Nota**: los puntos de corte son una **adición al design system**, no una desviación. Se
declaran junto al resto de tokens para que el feature 004 y siguientes los hereden.

---

## D-28 — Estrategia de migración: pantalla por pantalla, con dos capas conviviendo

**Contexto**: el feature 002 estará tocando el mismo frontend en paralelo —8 pantallas nuevas,
más la reescritura de la superficie de redacción del editor—.

**Decisión**: migración **pantalla por pantalla**, agrupada por UI kit, con la capa artesanal y
la biblioteca compartida conviviendo mientras dura. NO un corte único.

**Justificación**:

1. **Un corte único es irrevisable**: 19 pantallas en un solo cambio no se puede revisar con
   criterio ni revertir por partes. Si algo se rompe, se revierte todo.
2. **La convivencia es barata aquí**: las clases artesanales y los componentes compartidos no
   compiten por el mismo selector — son mecanismos distintos (clase global frente a componente
   con estilo encapsulado). Una pantalla migrada y otra sin migrar no se interfieren.
3. **El coste real de la convivencia es estético, no técnico**: durante la migración el usuario
   ve dos estéticas. Se acota agrupando por kit y desplegando kit completo, nunca pantalla
   suelta: el usuario percibe "el módulo de aprendizaje cambió", no "esta pantalla está rara".
4. **Frontera con 002**: agrupar por kit deja el kit editorial —la única zona de colisión— para
   el final, cuando 002 ya haya asentado la superficie de redacción.

**Orden**: acceso (3) → aprendizaje (5) → simuladores (4) → perfil (4) → editorial (3).

**Criterio de terminación de cada grupo**: ninguna plantilla del grupo referencia clases
artesanales, ninguna contiene estilos en línea, y las clases que ya no usa nadie se eliminan de
`styles.scss` en el mismo cambio. `styles.scss` debe quedar vacío al terminar el último grupo.

---

## D-29 — Las pruebas de extremo a extremo ya existentes son la red de seguridad, y aguantan

**Hallazgo** — es la mejor noticia de esta investigación. Las 4 suites de extremo a extremo de
`frontend/e2e/` seleccionan casi exclusivamente por **rol y etiqueta accesible**:

| Selector | Ocurrencias | ¿Sobrevive al rediseño? |
|----------|-------------|--------------------------|
| `getByLabel` | 38 | ✅ salvo que se rompa la etiqueta |
| `getByRole` | 36 | ✅ salvo que se rompa el rol |
| `getByText` | 24 | ✅ salvo que cambie el texto visible |
| `getByPlaceholder` | 2 | ✅ |
| `locator('.fc-num')`, `locator('dd.fc-num')` | 2 | ✅ `fc-num` es primitiva de portal y **no** pertenece a la capa artesanal |
| `locator('a[href^="/articulos/"]')` | 1 | ✅ selecciona por ruta, no por maquetación |
| `locator('input[formcontrolname=…]')` | 2 | ✅ el nombre de control se declara en el componente, no en la disposición |
| **`locator('article')`** | **2** | ⚠️ **frágil** — se rompe si el lector deja de usar `<article>` |
| **`locator('fieldset')`** | **1** | ⚠️ **frágil** — se rompe si el cuestionario deja de agrupar con `<fieldset>` |
| **`locator('input[type="radio"]')`** | **1** | ⚠️ **frágil** — se rompe si las opciones dejan de ser radios |

**100 de 109 seleccionan por accesibilidad. De los 9 restantes, 4 son frágiles al rediseño.**

**Decisión**: las pruebas de extremo a extremo existentes se usan **sin reescribir** como
verificación de SC-036 ("ningún comportamiento cambia"). Se atienden **6**: los 2 por clase
(que sobreviven tal cual) y los 4 frágiles, que imponen restricciones de marcado al rediseño.

**Por qué es tan relevante**: un rediseño total suele obligar a reescribir la batería de
pruebas, y entonces esta deja de demostrar nada — se adapta la prueba al cambio y se pierde la
red. Aquí no: como seleccionan por rol y etiqueta, **fallan si el rediseño rompe la
accesibilidad**, y por tanto sirven a la vez de red de regresión funcional y de verificación
continua de FR-093…FR-095. Se ejecutan tras migrar cada grupo, no al final.

**Acción sobre los selectores por clase**: `.fc-num` es una primitiva de portal legítima que
sobrevive en `tokens/base.css` (no está en la capa artesanal a retirar), así que ambos
selectores siguen siendo válidos. Se verifican, no se cambian.

**Acción sobre los 4 selectores frágiles** — es la parte que hay que saber **antes** de
recomponer, no al descubrir el fallo:

| Elemento | Dónde | Restricción que impone |
|----------|-------|------------------------|
| `<article>` | Lector de artículos | El cuerpo del artículo **conserva** el elemento `<article>` como contenedor |
| `<fieldset>` | Cuestionario | Cada pregunta **conserva** su agrupación en `<fieldset>` |
| `<input type="radio">` | Cuestionario | Las opciones **siguen siendo** radios, no botones ni fichas seleccionables |

No son limitaciones caprichosas: los tres son el marcado **semánticamente correcto** para lo
que representan —un artículo, un grupo de opciones excluyentes, una opción única—, y los tres
son justamente lo que un lector de pantalla necesita. Conservarlos es simultáneamente lo que
mantiene verde la batería y lo que cumple FR-093…FR-095. Si alguna vez hubiera una razón real
para cambiarlos, se cambia el selector **en el mismo cambio** y se documenta por qué; lo que no
se hace nunca es descubrirlo cuando la suite ya está en rojo.

---

## D-30 — El armazón de la aplicación es una vigésima superficie, y no está en el alcance del spec

**Hallazgo**: `frontend/src/app/app.component.ts` contiene el armazón —barra superior con
logotipo, navegación por rol y cierre de sesión— con **su CSS embebido en el propio
componente**. No es ninguna de las 19 pantallas, pero **se ve en todas**.

**Decisión**: el armazón entra en el alcance, adscrito al grupo de aprendizaje (historia 2),
porque es el que define el marco del portal. Su CSS embebido se retira igual que la capa
artesanal.

**Por qué se registra como decisión y no como tarea silenciosa**: el spec dice "las 19
pantallas". Migrarlas todas dejando la barra superior con la estética anterior produciría el
peor resultado posible —un marco viejo alrededor de contenido nuevo, visible en el 100 % de las
vistas—. Es una ampliación de alcance pequeña y necesaria, y debe quedar dicha.

---

## D-31 — La landing de marketing se mantiene fuera de alcance

**Decisión**: se confirma la suposición del spec. La landing **no entra**.

**Justificación**: este feature migra pantallas existentes; la landing sería una pantalla
pública nueva, con contenido propio, decisiones de producto propias (qué se promete, qué
cifras se publican) y un público distinto — el no registrado. Meterla aquí mezclaría migración
con creación y ampliaría el alcance sin cerrar el problema que motivó el feature.

**Condición de reversión**: si el CTIC necesita una página pública para presentar la plataforma
antes de que este feature termine, la landing se separa a su propio feature y se construye
sobre la biblioteca compartida — no se improvisa dentro de este.

---

## D-32 — Estados que los kits no dibujan

**Hallazgo**: los cinco kits se dibujaron con datos de demostración siempre presentes. No
existe en ellos ni una pantalla vacía, ni un estado de carga, ni un error, ni un texto que
desborde.

**Decisión**: los estados de carga, error, vacío y desbordamiento (FR-118…FR-120) se derivan
del comportamiento real de la plataforma y se resuelven con **componentes compartidos nuevos**,
añadidos a la biblioteca del feature 002 y no a la carpeta de cada pantalla (FR-087):

| Componente | Para qué |
|------------|----------|
| `Skeleton` | Estado de carga con la forma del contenido que va a aparecer |
| `EmptyState` | Ilustración, mensaje y acción sugerida cuando no hay nada que mostrar |
| `ErrorState` | Mensaje comprensible y acción de reintento |

**Justificación**: son tres piezas que aparecen en las 19 pantallas. Resolverlas pantalla a
pantalla produciría diecinueve variantes del mismo mensaje, que es precisamente la clase de
deuda que este feature viene a saldar.

**Sobre el desbordamiento (FR-120)**: no es un componente sino una regla — ningún contenedor
fija altura, los títulos truncan con indicación visible, y las cifras monetarias **nunca**
truncan: si no caben, reduce el contenedor, porque una cifra cortada es un dato falso.

---

## Resumen de impacto

| Área | Impacto |
|------|---------|
| `frontend/src/styles.scss` | **Se vacía y se elimina** — criterio de terminación (D-26) |
| `frontend/src/styles/tokens/` | Se añaden cuatro tokens de punto de corte (D-27) |
| `frontend/src/app/app.component.ts` | Armazón migrado, CSS embebido retirado (D-30) |
| `frontend/src/app/features/**` | 19 plantillas recompuestas, 94 estilos en línea eliminados |
| `frontend/src/app/shared/ui/` | Tres componentes nuevos: `Skeleton`, `EmptyState`, `ErrorState` (D-32) |
| `frontend/e2e/` | **Sin reescribir**; se ejecutan por grupo como red de regresión (D-29) |
| `frontend/src/assets/logo/` | Deduplicación contra `styles/assets/logo/` (FR-090) |
| Backend, contratos, base de datos | **Sin tocar** (FR-121) |
