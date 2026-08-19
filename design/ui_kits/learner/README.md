# UI Kit — App de aprendizaje (Learner)

Recreación interactiva del producto principal: el **portal de aprendizaje** de FintCart.

**Pantallas / flujo**
- **Catálogo (home):** layout de portal de 3 columnas — riel de categorías + progreso, columna
  central con artículo destacado y catálogo con pestañas, riel derecho (continuar, ranking,
  notificaciones).
- **Lector + cuestionario:** artículo en ancho de lectura con cita destacada, panel lateral de
  progreso y relacionados, y cuestionario reintentable con calificación.
- **Perfil / progreso:** resumen de puntos, estadísticas e historial de cuestionarios.

**Archivos:** `index.html` (carga React + bundle + datos), `App.jsx` (chrome + pantallas),
`data.js` (contenido de demo en español).

Compone `ModuleBox`, `Card`, `Tabs`, `Tag`, `Badge`, `ProgressBar`, `Avatar`, `Button`, `Input`.
