# UI Kit — CMS Editorial ("FintCart Editor")

Recreación del **flujo editorial** inspirado en la captura del "Portal Editor". Curaduría y
publicación de artículos con separación de responsabilidades.

**Roles (conmutables en la barra superior):**
- **Editor** — crea borradores, los edita y los **envía a revisión**.
- **Coordinador** — **aprueba y publica** contenido de otros editores. *No puede publicar su
  propio contenido* (regla FR-008): el editor muestra un aviso en ese caso.

**Pantallas:** dashboard con tabla de artículos por estado (Borrador / En revisión / Publicado),
y editor de artículo con toolbar, cuerpo editable, panel de publicación, referencias y cuestionario.

**Archivos:** `index.html`, `App.jsx`. Compone `ModuleBox`, `Card`, `Badge`, `Tag`, `Button`,
`Avatar`. Usa el púrpura portal como color de la herramienta editorial.
