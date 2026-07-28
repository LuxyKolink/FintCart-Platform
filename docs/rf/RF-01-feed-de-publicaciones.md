# RF-01 — Feed de Publicaciones

## Nombre del requerimiento

Feed de Publicaciones.

## Descripción del requerimiento

El feed de publicaciones es la vista principal de consumo de contenido para el usuario final, donde se presenta el catálogo de artículos educativos publicados, organizados por categorías temáticas del ámbito de la educación financiera colombiana. Permite navegar, filtrar por categoría y paginar el contenido disponible, abrir un artículo para leerlo y acceder al cuestionario asociado a cada uno. Constituye la propuesta de valor central de la plataforma y materializa los requerimientos funcionales FR-010 (navegación del catálogo de contenido publicado), FR-011 (lectura de un artículo publicado y ejecución de su cuestionario) y FR-009 (al menos un cuestionario por artículo educativo).

## Precondiciones

El usuario debe estar autenticado mediante OAuth2 (Authorization Code + PKCE) con un token JWT válido y vigente, y su correo electrónico debe estar verificado, dado que el acceso pleno permanece bloqueado hasta completar la verificación (FR-002). Asimismo, debe existir en el módulo de Aprendizaje al menos un artículo en estado "publicado", aprobado por un coordinador editorial, para que el catálogo presente contenido consumible.

## Postcondiciones

Tras consultar el feed, el usuario obtiene una lista paginada de artículos publicados acorde con los filtros aplicados; al abrir un artículo, el sistema registra la visualización en el historial del usuario (`article_views`, FR-015) y deja disponible el cuestionario asociado para su ejecución. El estado del catálogo se mantiene consistente con las versiones vigentes publicadas, sin exponer borradores ni versiones en revisión.

## Casos de uso con los que se relaciona

Se relaciona directamente con la Historia de Usuario 1 (Aprendizaje guiado con artículos y cuestionarios, prioridad P1) y sus escenarios de aceptación de navegación, lectura y calificación; se conecta con RF-02 y RF-02-1, que producen el contenido que el feed expone; con RF-03, que provee la autenticación previa; y con el indicador de progreso del usuario, dado que la calificación del cuestionario alimenta los puntos acumulados.

## Flujo Básico

El usuario autenticado solicita el catálogo a través del API Gateway (`GET /catalog/articles`), que traduce la petición REST a gRPC contra el servicio de Aprendizaje y devuelve la lista paginada de artículos publicados; el usuario opcionalmente filtra por categoría, selecciona un artículo (`GET /catalog/articles/{articleId}`), lo lee, inicia el cuestionario asociado y, al enviarlo (`POST /quizzes/{quizId}/attempts`), dispara la Saga de calificación → progreso → notificación → auditoría coordinada por el Orquestador, que califica el intento, persiste el resultado y actualiza la barra de progreso.

## Flujo Alternativo

Si el usuario aplica un filtro de categoría sin resultados, el sistema devuelve una lista vacía indicando que no hay contenido para esa categoría; si el artículo solicitado fue despublicado o reemplazado por una nueva versión mientras se consultaba, el Gateway responde con 404 o sirve la versión vigente; si el usuario abandona el cuestionario sin enviarlo (cierre de pestaña o pérdida de conexión), el intento no se persiste y puede reiniciarse o reanudarse en una sesión posterior.

## Restricciones y/o Excepciones

Solo se exponen artículos en estado "publicado" —los borradores y los enviados a revisión no son visibles para el usuario final (FR-008)—; el acceso requiere un token JWT válido que no figure en la blacklist de Redis, y toda lectura está sujeta al rate limiting aplicado por el Gateway. Los identificadores de autor y categorías se resuelven por identificador opaco vía gRPC, sin acceso cruzado entre bases de datos (database-per-service). Un token inválido o revocado produce 401 y un rol sin permiso produce 403.
