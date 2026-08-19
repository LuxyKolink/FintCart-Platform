# FintCart — Design System

**FintCart** es una plataforma de **educación financiera interactiva para el mercado colombiano**.
Las personas se registran, leen artículos cortos sobre conceptos financieros (ahorro, crédito,
presupuesto, inversión y temas propios del contexto colombiano), resuelven el **cuestionario** de
cada artículo para sumar **puntos de progreso**, y usan **cinco simuladores** financieros
(ahorro, crédito, presupuesto, inversión y una calculadora del contexto colombiano).
El contenido lo curan **editores** y lo publican **coordinadores editoriales** (un editor nunca
publica su propio contenido). Todo en **español de Colombia**, gratis, sin manejar dinero ni
datos bancarios reales.

> Este design system no se construyó sobre un frontend existente: el repositorio de origen
> es de especificación/microservicios (sin UI). La dirección visual se definió con el cliente
> y a partir de dos capturas de referencia (estética de **portal web denso** con acentos
> púrpura). Por eso este sistema **propone** la marca; itera con nosotros para afinarla.

---

## Fuentes (input)

| Fuente | Qué es | Notas |
|---|---|---|
| **GitHub · [LuxyKolink/FintCart-Platform](https://github.com/LuxyKolink/FintCart-Platform)** (rama `001-fintcart-platform`) | Especificación del producto, arquitectura de microservicios, contratos (OpenAPI/proto), modelo de datos. **No contiene frontend.** | El lector puede explorar el repo para profundizar en alcance, requisitos funcionales (FR-001…FR-031) y reglas de negocio. |
| Captura 1 — *portal Yahoo!-Japan-like* | Referencia estética: portal denso, link-heavy, módulos con borde, acentos púrpura. | Inspiración de densidad y layout. |
| Captura 2 — *"Portal Editor" CMS* | Referencia para el CMS editorial (toolbar, panel de referencias, ajustes de publicación). | Base del UI kit **Editorial CMS**. |

Decisiones de marca confirmadas con el cliente: estética **portal denso**, **paleta cálida
colombiana** (coral + marigold) con **púrpura portal** para lo interactivo, tipografía
**editorial** (serif + grotesca), idioma **español (Colombia)**.

---

## Concepto: "El portal financiero"

La estética une dos ideas: la **densidad funcional** de los portales web de los 2010s
(cajas con borde y barra de cabecera, listas de servicios, pestañas, tablas) y la **calidez**
de una paleta colombiana. La densidad es una *feature*: el usuario abarca mucho de un vistazo,
como en un buen periódico. La tipografía **Noto Sans JP** en titulares refuerza el carácter de
portal japonés 2010.

---

## Content Fundamentals (cómo escribimos)

- **Idioma:** español de Colombia. **Tuteo** directo ("Aprende a tu ritmo"), nunca "usted".
- **Tono:** cercano, claro y honesto. Explica, no vende. Frases cortas y verbos de acción.
- **Persona:** hablamos de **tú** (usuario) y evitamos hablar de "nosotros" salvo en marketing.
- **Casing:** *sentence case* en títulos y botones ("Crear cuenta", no "Crear Cuenta").
  MAYÚSCULAS solo en kickers/eyebrows y badges (`EN REVISIÓN`, `NUEVO`).
- **Dinero:** pesos colombianos con separador de miles y símbolo `$` antepuesto: `$ 1.250.000`.
  Porcentajes con coma decimal: `11,25 %`. Tasas siempre como **E.A.** (Efectivo Anual).
- **Sin jerga gratuita:** si aparece un tecnicismo (E.A., UVT, CDT, Ley 1581) se explica.
- **Emoji:** uso muy limitado. Se permite 🔥 para rachas de aprendizaje; nada más en UI.
- **No prometemos rentabilidad.** Los simuladores son educativos y los valores, referenciales.

**Así sí:** "Aprende a tu ritmo y mide tu progreso." · "Compara créditos usando la misma base."
**Así no:** "Maximice su portafolio aprovechando sinergias." · "¡¡La MEJOR app de finanzas!!"

---

## Visual Foundations

- **Color.** Base de **papel cálido** (`--warm-50` #FBF8F2) en lugar de blanco puro. Tres marcas:
  **coral/tomate** (`--brand-primary` #DE4D2B, CTAs y energía), **marigold** (`--brand-accent`
  #EE9B00, progreso/destacados/acento del logo) y **púrpura portal** (`--brand-interactive`
  #6A1FB0, enlaces, foco, pestaña activa — la firma "portal"). Verde de crecimiento para
  positivos/éxito; rojo de alerta para negativos. Cada categoría del catálogo tiene su color
  (`--cat-ahorro`, `--cat-credito`, …).
- **Tipografía.** **Noto Sans JP** (sans de portal, titulares) en titulares y encabezados de
  módulo; **Roboto** en UI y cuerpo; **IBM Plex Mono** (con `tabular-nums`) en cifras monetarias
  y datos. Ambas (Noto Sans JP y Roboto) son fuentes de marca subidas por el cliente y están
  diseñadas para combinar entre sí. Base compacta de 15px por la densidad del portal.
- **Espaciado.** Grilla base **4px**, defaults apretados. Rieles fijos del portal: sidebar de
  servicios ~188–230px, columna central, riel derecho ~256px.
- **Fondos.** Papel cálido plano; **sin** gradientes decorativos salvo en superficies de marca
  (hero de auth, banda CTA de marketing) donde sí se usan degradados coral→púrpura intencionales.
  Sin texturas ni patrones repetidos.
- **Bordes.** Centrales. La caja-módulo (`.fc-module` / componente `ModuleBox`) es **1px** de
  borde cálido + barra de cabecera con **regla de acento de 3px** a la izquierda. Listas con
  separadores **punteados**.
- **Radios.** Modestos: `--radius-md` 6px por defecto; chrome casi recto (`--radius-xs` 2px) en
  pestañas y celdas de tabla; `pill` para badges y barras de progreso.
- **Sombras.** Contenidas — el **borde manda**. `--shadow-xs/sm` para cajas; `--shadow-pop` solo
  para popovers/toasts. Las tarjetas de catálogo (`Card interactive`) sí elevan al hover.
- **Animación.** Discreta y rápida (`--dur-fast` 120ms, `--ease-out`). Hover: aclarar
  (`brightness .95`) o fondo púrpura tenue en enlaces/ghost. Press: `translateY(1px)` (hundir).
  Barras de progreso animan su ancho (`--dur-slow`). Sin rebotes ni loops decorativos.
- **Foco.** Anillo púrpura (`--focus-ring`) — accesible y on-brand.
- **Imágenes.** Cuando no hay fotografía real usamos **placeholders con icono** sobre degradado
  tenue del color de la categoría (cálidos, nunca b&n). Reemplázalos por fotos reales cuando existan.
- **Transparencia/blur.** Solo en la barra superior *sticky* de marketing (`backdrop-filter`).

---

## Iconografía

- **Lucide** (https://lucide.dev) vía CDN, `stroke-width: 2`, esquinas redondeadas — coincide con
  la limpieza de la marca y la densidad del portal. **(Sustitución:** el repo de origen no incluye
  set de iconos; elegimos Lucide. Si FintCart adopta otro set, cámbialo aquí y en los kits.)
- Iconos recurrentes: `book-open` (artículos), `piggy-bank` (ahorro), `credit-card` (crédito),
  `wallet` (presupuesto), `trending-up` (inversión), `landmark` (contexto Colombia),
  `calculator` (simuladores), `clipboard-check` (cuestionarios), `bell` (notificaciones),
  `badge-check` (logros), `shield` (OAuth/seguridad).
- **Emoji** prácticamente no se usa en UI (excepción: 🔥 rachas). **Sin** iconos dibujados a mano
  en SVG salvo el logo. El **logo** (marca = baldosa coral con barras ascendentes + moneda
  marigold) vive en `assets/logo/`.

> **Nota de fuentes:** **Noto Sans JP** y **Roboto** son fuentes de marca (TTF variables subidos
> por el cliente) y se empaquetan vía `@font-face` desde `assets/fonts/`. **IBM Plex Mono** se carga
> desde **Google Fonts** (no se subió una mono). Para 100% offline, autoaloja también IBM Plex Mono.

---

## Índice del proyecto

**Raíz**
- `styles.css` — punto de entrada global (solo `@import`s). Los consumidores enlazan **este** archivo.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `elevation.css`, `fonts.css`, `base.css`.
- `assets/logo/` — `fintcart-mark.svg`, `fintcart-mark-mono.svg`, `fintcart-logo.svg`, `…-inverse.svg`.
- `guidelines/` — tarjetas-espécimen (Type, Colors, Spacing, Brand) para la pestaña Design System.
- `README.md` (este archivo) · `SKILL.md`.

**Componentes** (`components/`) — primitivas React reutilizables, vía `window.FintCartDesignSystem_cf1e0c`:
- `forms/` — **Button**, **Input**, **Select**, **Checkbox**
- `display/` — **Badge**, **Tag**, **Avatar**, **ProgressBar**
- `layout/` — **ModuleBox** (caja-módulo, firma del portal), **Card**, **Tabs**

**UI kits** (`ui_kits/`) — recreaciones interactivas de pantalla completa:
- `learner/` — app de aprendizaje: catálogo tipo portal, lector + cuestionario, perfil/progreso.
- `simulators/` — los 5 simuladores con resultados y mini-gráficos.
- `editorial/` — CMS "FintCart Editor": dashboard, editor de artículos, flujo editor → coordinador.
- `auth/` — login, registro y verificación de correo (OAuth2/PKCE).
- `marketing/` — landing pública.

---

## Cómo usar este sistema

1. Enlaza **un** archivo: `<link rel="stylesheet" href="styles.css">` (trae tokens + fuentes).
2. Usa los tokens CSS (`var(--brand-primary)`, `var(--font-display)`, …) en tu markup.
3. Para componentes React, carga `_ds_bundle.js` y lee `window.FintCartDesignSystem_cf1e0c`.
4. Copia los assets que necesites (logo, etc.) a tu proyecto; no los referencies cruzado.

## Caveats / iteración

- La **marca es propuesta** (logo, paleta cálida + púrpura portal). Afínala con nosotros.
- **Fuentes** vía Google Fonts (sustitución). Pásanos binarios si quieres offline/corporativas.
- **Iconos** = Lucide (sustitución). Cámbialo si hay un set oficial.
- Los **simuladores** calculan en el cliente para la demo; en producción la precisión decimal
  es responsabilidad del backend (regla NON-NEGOTIABLE del proyecto).
