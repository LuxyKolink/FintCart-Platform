# Brief de dirección de arte v2 — "institucional sereno"

> Insumo de implementación, no capítulo. Se aprueba una sola vez y luego se ejecuta sin re-discutir.
> Alcance: `frontend/src/styles/tokens/*`, `frontend/src/app/shared/ui/*` (19 primitivas) y las plantillas de pantalla.
> **No se toca**: contratos, backend, servicios, ni las suites e2e.

---

## 1. Por qué se cambia

El sistema actual (feature 003) reconstruye a propósito la estética de portal web de 2010: cajas de
módulo con borde y barra de acento de 3 px, etiquetas *eyebrow* en mayúsculas, separadores punteados,
riel derecho y tres acentos compitiendo en el mismo viewport (coral de marca, marigoldo de "destacado",
púrpura de enlaces). En `/catalogo` hay cuatro contenedores con borde sobre el pliegue.

El problema no es el gusto: es que la jerarquía la carga **el cromo** (bordes, tintes, barras, pastillas)
en vez de la **tipografía y el espacio**. Eso produce densidad de intranet y resta credibilidad.

**Este brief retira cromo. No añade una capa nueva.**

---

## 2. Paleta

Una sola familia de acento. El color deja de decorar y pasa a señalar estado o acción.

| Token | Hex | Uso | Contraste medido |
|---|---|---|---|
| `--fc-paper` | `#FBFBF9` | fondo de página | — |
| `--fc-surface` | `#FFFFFF` | tarjetas y campos | — |
| `--fc-ink` | `#16181C` | texto principal | 17.15 : 1 |
| `--fc-ink-2` | `#4A5058` | texto secundario | 7.86 : 1 |
| `--fc-ink-3` | `#6B7178` | metadatos, ayudas | 4.76 : 1 |
| `--fc-line` | `#E3E1DC` | reglas de 1 px | — (no es texto) |
| `--fc-line-strong` | `#C9C6BE` | bordes de campo | — |
| `--fc-accent` | `#14477A` | acción primaria, enlaces | 9.16 : 1 |
| `--fc-accent-hover` | `#0F3D66` | hover/active | 11.4 : 1 |
| `--fc-accent-tint` | `#EEF2F7` | fondo de selección, no de tarjeta | — |
| `--fc-success` | `#1E6B44` | confirmación | 6.25 : 1 |
| `--fc-warning` | `#8A5A00` | advertencia | 5.72 : 1 |
| `--fc-danger` | `#9B2C1E` | error, destructivo | 7.31 : 1 |
| `--fc-focus` | `#14477A` | anillo de foco, 2 px + offset 2 px | 9.16 : 1 |

**Se eliminan**: `--fc-brand` coral, `--fc-accent-warm` marigoldo y `--fc-link` púrpura. Si un token
antiguo tiene consumidores, se remapea al valor nuevo en vez de borrarse a ciegas: el build debe quedar
sin referencias huérfanas.

Texto blanco sobre `--fc-accent`: 9.49 : 1. Texto blanco sobre `--fc-danger`: 7.57 : 1. Ambos pasan AA.

Toda pareja nueva debe superar **4.5 : 1** para texto normal y **3 : 1** para texto ≥ 24 px o negrita ≥ 19 px.
La suite `e2e/a11y.spec.ts` mide contraste sobre estilos computados: si falla, se corrige el color, no la prueba.

---

## 3. Tipografía

Se **conservan** las fuentes ya vendorizadas: Roboto para interfaz, IBM Plex Mono para cifras.
No se añaden archivos de fuente (riesgo de FOUT, licencias y peso de build).

| Rol | Tamaño / altura / peso / tracking |
|---|---|
| Display (h1 de página) | 38 / 1.15 / 500 / −0.02em |
| Título de sección (h2) | 26 / 1.25 / 500 / −0.01em |
| Título de bloque (h3) | 19 / 1.35 / 600 / 0 |
| Cuerpo de lectura | 17 / 1.65 / 400 / 0 |
| Cuerpo de interfaz | 15 / 1.5 / 400 / 0 |
| Secundario | 14 / 1.5 / 400 / 0 |
| Metadato | 13 / 1.45 / 400 / 0.01em |
| Cifra monetaria | IBM Plex Mono, `font-variant-numeric: tabular-nums`, 1em heredado, tracking 0 |

La columna de lectura usa 17 px; la de interfaz, 15 px. Ninguna pantalla baja de 15 px salvo metadatos.

---

## 4. Retícula y espacio

- `--content-max: 880px` (antes 1100). `--reading-max: 680px`.
- **Sin riel derecho.** La información que vivía ahí (progreso, avisos) se integra en el flujo, arriba o al final.
- Índice izquierdo **opcional y silencioso**: 160 px, sin borde, sin tarjeta, sin fondo. Solo una lista de enlaces.
  Si la pantalla no necesita navegación lateral, no se dibuja columna.
- Rejilla de espaciado de 4 px: se conserva (`--space-0..12`).
- Márgenes de página: 20 px a 360, 32 px a 768, 48 px a 1024+.

---

## 5. Superficie, borde y sombra

- Radio máximo **2 px**. Nada de 8/12/16.
- **Sin sombras** salvo capas superpuestas reales (menú, modal): una sola, `0 8px 24px rgba(16,20,26,.12)`.
- Borde de 1 px solo cuando separa dos superficies funcionales (campo de formulario, tabla, panel de filtros).
  Un bloque de contenido dentro de una página **no** lleva borde.
- Prohibido el fondo tintado como decoración de tarjeta. `--fc-accent-tint` se reserva para selección y foco.
- Prohibida la barra de acento de 3 px en el encabezado de un bloque.

---

## 6. Qué se retira (lista de prohibiciones)

1. **Etiquetas *eyebrow***: las mayúsculas espaciadas sobre cada título. Se sustituyen por el título mismo.
2. **Separadores punteados** en listas de enlaces.
3. **Barras de acento** de 3 px sobre encabezados.
4. **Tarjetas con fondo tintado** como decoración.
5. **Riel derecho** de progreso/avisos.
6. **Segundo y tercer acento**: cualquier coral, marigoldo o púrpura.
7. **Cajas de módulo con borde** alrededor de contenido de página.

`--fc-module`, `--fc-num`, `--fc-eyebrow` y `--fc-linklist` viven en `tokens/base.css` como primitivas de
portal. `fc-num` **se conserva** (N-15). `fc-module` y `fc-linklist` se reducen a su función mínima
(separación y lista) sin borde ni acento. `fc-eyebrow` queda **en desuso**: se retira de las plantillas y
se elimina la clase.

---

## 7. Las 19 primitivas

| Primitiva | Cambio |
|---|---|
| `fc-button` | Primario = fondo `--fc-accent` sólido, radio 2 px, 40 px de alto, padding 0 20px, peso 500. Secundario = borde 1 px `--fc-line-strong`, texto `--fc-ink`. Terciario = solo texto con subrayado en hover. **Sin** gradientes ni sombras. |
| `fc-input`, `fc-select`, `fc-checkbox` | Borde 1 px `--fc-line-strong`, 40 px de alto, radio 2 px, foco con anillo `--fc-focus` de 2 px + offset 2 px. Sin fondo gris de relleno al deshabilitar: bajar a `--fc-ink-3` y `line`. |
| `fc-card` | Superficie blanca, **sin borde**, solo `--space-5` de padding y, si agrupa, una regla superior de 1 px. |
| `fc-module-box` | Deja de ser caja. Encabezado = h2 tipográfico; separación por espacio, no por borde. |
| `fc-badge` / `fc-tag` | Forma de píldora con altura 20 px, fondo `--fc-accent-tint` **solo** para estado, texto `--fc-accent`; neutro = `line` + `ink-2`. Sin mayúsculas forzadas. |
| `fc-banner` | Franja de 1 px de borde superior **del color del estado**, con icono alineado al texto. No bloque tintado de ancho completo con fondo saturado. |
| `fc-empty-state` / `fc-error-state` | Centrado, icono 32 px en `ink-3`, título 19 px, un solo botón de acción. Sin ilustración decorativa. |
| `fc-brand-panel` | Degrada a banda compacta en móvil **y nunca se oculta** (N-14). Fondo `--fc-accent` sólido, sin degradado coral→púrpura. |
| `fc-brand-logo` | Se conserva la marca; el tratamiento pasa a monocromo sobre el acento. |
| `fc-progress-bar` | Riel `line`, barra `accent`, alto 4 px, radio 2 px. Sin etiqueta dentro; el porcentaje va en texto al lado. |
| `fc-skeleton` | Se conserva, con `prefers-reduced-motion` ya presente; barrido en `line`. |
| `fc-tabs` | Subrayado de 2 px en la pestaña activa, sin fondo tintado ni pastillas. |
| `fc-icon` | Se conserva el registro de 25 iconos Lucide. Trazo 1.5. |
| `fc-avatar`, `fc-link-button` | Se conservan; `link-button` pierde el subrayado permanente. |

---

## 8. Pantallas

- **Acceso** (`/iniciar-sesion`, `/crear-cuenta`, `/auth/verify-email`): dos zonas, formulario a 400 px y banda de
  marca que en móvil se convierte en franja superior de 96 px. Ningún degradado.
- **Aprendizaje** (`/catalogo`, `/articulos/:id`, `/cuestionarios/:id`, `/progreso`): una columna de 880 px;
  las categorías pasan de riel izquierdo con borde a una fila de enlaces de texto; el listado de artículos
  pierde las cajas individuales y usa reglas de 1 px entre filas.
- **Simuladores** (`/simuladores/:tipo`, `/simuladores/historial`): formulario a 680 px; el resultado se ancla en
  una banda con regla superior; **la cifra monetaria nunca trunca** (N-15): se reduce el contenedor, no se
  recorta el número.
- **Calculadoras** (`/calculadoras/*`): igual que simuladores; el constructor usa la misma jerarquía tipográfica.
- **Perfil / notificaciones**: lista de filas con reglas de 1 px, sin tarjetas.
- **Editorial / administración**: se migra **al final** (frontera con 002, FR-123). Solo el marco, no la superficie
  de redacción del editor.

---

## 9. Invariantes que no se negocian

- Mínimo **360 px** sin desbordamiento horizontal.
- Cuatro tokens de breakpoint **480 / 768 / 1024 / 1280**, con el literal en cada `@media` y el token citado en
  comentario (`@media` no resuelve `var()`).
- Contraste AA verificado por `e2e/a11y.spec.ts` sobre estilos computados.
- Panel de marca presente en móvil, degradado pero visible (N-14).
- Cifras monetarias sin truncar y sin convertir a coma flotante (N-15, Principio VIII).
- **Las suites e2e no se modifican** (N-13). Seleccionan por rol y etiqueta; si fallan, el fallo es del rediseño.

---

## 10. Puertas de aceptación

1. `npm run build` sin errores ni avisos de presupuesto.
2. `npm run e2e` verde (19 archivos), incluida `a11y.spec.ts`.
3. `node scripts/design-debt.mjs --check` = 0.
4. Suite visual a 360/480/768/1024/1280: panel de marca visible, acción principal visible, sin desbordamiento.
5. Revisión de una sola pasada en `/interno/galeria`, con decisión final del autor y la directora.

## 11. Correcciones al brief (2026-10-27, verificadas contra el repositorio)

Este documento se escribió a partir de la descripción del feature 003 que vive en `CLAUDE.md`.
Al ejecutar el trabajo se midió el repositorio y tres de sus premisas eran falsas. Se anotan aquí
porque el brief alimenta el capítulo de diseño del informe: una premisa falsa en un documento de
trabajo es un error de proceso; en el informe sería un dato falso.

**1. `frontend/src/styles.scss` no existía.** El brief lo describe como «116 líneas, 15 clases
artesanales» pendientes de vaciar, y lo declara criterio de terminación del feature. En realidad se
eliminó en `1aeffc5` («el editor escribe bloques, y con él desaparece la última capa artesanal»).
`scripts/design-debt.mjs --check` ya reportaba 0 pantallas artesanales antes de este trabajo. El
criterio de terminación del feature 003 estaba cumplido de antemano; lo que faltaba —y es lo que
este brief hace— es la calidad visual, no la deuda estructural.

**2. Sí existían `@media`.** El brief afirma que «no existe ni un `@media` en todo el frontend» y que
esta es la primera definición responsive. Medición: 31 ocurrencias de `@media` en
`frontend/src` en `staging` (`104b41d`), cuatro de ellas en `tokens/breakpoints.css`. Lo que faltaba
no era el mecanismo responsive sino su coherencia: los puntos de corte no estaban unificados como
tokens ni había un mínimo declarado de 360 px. La afirmación correcta para el informe es «se
unificaron cuatro puntos de corte como tokens y se fijó un mínimo de 360 px», no «no había
responsive».

**3. Los nombres de token del brief no existen.** `--fc-brand`, `--fc-accent-warm` y `--fc-link`
nunca estuvieron definidos. Los equivalentes reales eran `--brand-primary` (coral),
`--brand-accent` (marigoldo), `--brand-interactive`, `--text-link` e `--info` (púrpura), más las
escalas crudas `--coral-*` y los tokens `--cat-*`. El diagnóstico del brief —tres acentos
compitiendo— era correcto; solo los nombres estaban mal. Se conservaron los valores del brief y
los nombres del repositorio.

Los valores de la dirección de arte (§2-§5) no se modificaron: se verificaron al implementarlos y
se mantienen tal cual. Las correcciones afectan a la descripción del estado de partida, no al
destino.

> **Pendiente para el autor:** `CLAUDE.md` contiene las mismas tres afirmaciones y las repite como
> contexto del feature 003. Conviene corregirlo allí también, porque es el documento que leen los
> agentes en cada sesión y describe como pendiente un trabajo ya hecho.

## 12. Marca y acento son dos cosas distintas (decisión del autor, 2026-10-27)

La marca coral **se conserva** sobre la interfaz de acento azul. Decisión del autor, no una
herencia inadvertida, y conviene que quede escrita porque es justo el tipo de cosa que alguien
«arregla» más tarde creyendo que es un descuido.

La regla del rediseño no era «un solo color en el producto», sino **«un solo acento en la
interfaz»**. El coral competía cuando era acento de interfaz: botones, enlaces, fondos de tarjeta,
colores de categoría. Eso desapareció. Un logotipo no es un acento: es la marca. La separación
queda como principio declarado y es defendible en la sustentación con ejemplos institucionales
reales, donde el color de la marca es mucho más saturado que la cromática de la interfaz.

Consecuencias que ya están implementadas y no deben revertirse:

- El coral sobrevive **solo** en el activo de marca. No vuelve a ser token de interfaz, no tiñe
  controles, no marca estados, no se usa para categorías.
- Sobre el panel azul del acceso la marca se dibuja en blanco (`variant="inverse"`), que es la
  aplicación normal de la regla sobre fondo oscuro, no una excepción a ella.
- Si alguna pantalla futura necesita señalizar la marca con color, se hace con el activo, nunca
  reintroduciendo un segundo acento en la capa de tokens.

Para el capítulo de diseño del informe, la frase que resume la decisión: *una sola voz en la
interfaz, una sola firma en la marca*.
