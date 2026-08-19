---
name: fintcart-design
description: Use this skill to generate well-branded interfaces and assets for FintCart, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## FintCart in one paragraph
FintCart is an interactive **financial-education platform for Colombia** (Spanish, COP). Users read short finance articles, take quizzes to earn **puntos de progreso**, and use **5 simulators** (ahorro, crédito, presupuesto, inversión, contexto Colombia). Editors draft content; coordinators publish it. The aesthetic is **"el portal financiero"**: a dense, editorial web-portal (bordered module boxes, link lists, tabs, tables) in a **warm Colombian palette** (coral primary, marigold accent) with a **portal-purple** interactive accent.

## Quick map
- `styles.css` — link this one file (tokens + fonts).
- `tokens/` — colors, typography (Noto Sans JP / Roboto / IBM Plex Mono), spacing, elevation.
- `components/` — Button, Input, Select, Checkbox · Badge, Tag, Avatar, ProgressBar · ModuleBox, Card, Tabs.
- `ui_kits/` — learner, simulators, editorial, auth, marketing (full interactive screens).
- `assets/logo/` — logo mark + wordmark lockups.
- `guidelines/` — foundation specimen cards.

## Non-negotiables when designing for FintCart
- Spanish (Colombia), tuteo, sentence case, money as `$ 1.250.000`, rates as `11,25 % E.A.`
- Use the `ModuleBox` portal pattern for dense modules; borders over big shadows.
- Coral = primary CTA, marigold = accent/progress, purple = links/focus/active. Warm paper, not pure white.
- Noto Sans JP for headings, Roboto for UI/body, IBM Plex Mono for figures.
- Lucide icons, stroke-width 2. No hand-drawn SVG icons. Minimal emoji.
- Simulators/finance are educational — never promise returns; no real bank data.
