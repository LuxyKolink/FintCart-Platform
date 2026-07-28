# RF-02 — Administración de Publicaciones

## Nombre del requerimiento

Administración de Publicaciones.

## Descripción del requerimiento

La administración de publicaciones comprende el ciclo de vida editorial completo de los artículos educativos y sus cuestionarios: creación de borradores, edición, versionamiento, envío a revisión, aprobación, publicación al catálogo público y archivado/retiro de versiones. Encarna el flujo de aprobación con separación de responsabilidades entre el rol "editor" (crea borradores y los envía a revisión) y el rol "coordinador editorial" (revisa, aprueba y publica), garantizando que un editor no pueda publicar su propio contenido. Materializa los requerimientos FR-007 (creación, edición y versionamiento por editores), FR-008 (flujo de aprobación con estados y separación de responsabilidades) y FR-013 (trazabilidad histórica de versiones).

## Precondiciones

El actor debe estar autenticado y poseer el rol "editor" o "coordinador editorial" (FR-006), perfiles internos pre-aprobados por la administración de la plataforma. Para aprobar y publicar, debe existir una versión en estado "en revisión" y el coordinador editorial debe ser distinto del editor que la creó. Para generar una nueva versión, debe existir un artículo previamente publicado.

## Postcondiciones

Al completarse el flujo, la versión correspondiente queda en el estado resultante —en revisión, publicada o archivada— preservando la trazabilidad histórica; una versión publicada queda disponible en el feed para usuarios finales e identificada como la versión vigente del artículo; y se emite el evento de publicación hacia la bandeja in-app de notificación y hacia el registro de auditoría inmutable.

## Casos de uso con los que se relaciona

Se relaciona con la Historia de Usuario 4 (Curaduría y publicación de contenido educativo, prioridad P4) y sus escenarios de aceptación de creación de borrador, envío a revisión, aprobación por un coordinador distinto y nuevo versionamiento; depende de RF-03 y RF-03-1 para la autenticación y la asignación de roles; se apoya en RF-02-1, que es la herramienta de autoría del contenido; y alimenta a RF-01, que consume el contenido ya publicado.

## Flujo Básico

Un editor crea un borrador (`POST /editorial/articles`) y elabora su contenido; cuando lo considera listo, lo envía a revisión (`POST /editorial/versions/{versionId}/submit`), cambiando el estado a "en revisión"; un coordinador editorial distinto revisa la versión y la aprueba y publica (`POST /editorial/versions/{versionId}/publish`), transición que fija `approved_by ≠ created_by` y deja la versión "publicada" como vigente. Para actualizaciones, el editor genera una nueva versión en borrador que repite el flujo de aprobación antes de reemplazar a la versión vigente.

## Flujo Alternativo

Si el coordinador que intenta publicar es el mismo editor que creó la versión, el sistema rechaza la operación con 403 (FR-008); si la versión no cumple los criterios de completitud, el coordinador puede devolverla a borrador para corrección; un coordinador puede archivar o retirar una versión publicada, dejando el artículo sin versión vigente visible; y si se envía a revisión una versión ya enviada, la transición se ignora por idempotencia.

## Restricciones y/o Excepciones

La separación de responsabilidades es una invariante del sistema: el editor no puede aprobar ni publicar su propio contenido. Las transiciones de estado se limitan a las permitidas por la máquina de estados (borrador → en revisión → publicado → archivado), sin saltos ilegales como archivado → publicado directo. La visibilidad está restringida por estado (borrador solo a su editor; en revisión al coordinador). Toda transición significativa se audita de forma inmutable, y el versionamiento conserva la historia completa sin sobrescribir versiones previas (FR-013).
