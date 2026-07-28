# RF-03-1 — Administración de Usuarios

## Nombre del requerimiento

Administración de Usuarios.

## Descripción del requerimiento

La administración de usuarios agrupa la gestión del perfil y las preferencias del usuario autenticado, la consulta de su progreso e historiales, los reportes estadísticos de su actividad, la diferenciación de roles con permisos (usuario final, editor y coordinador editorial) y el ejercicio de los derechos del titular de datos personales conforme a la Ley 1581 de 2012 —consulta, rectificación y eliminación de cuenta con anonimización de la información identificable—. Materializa los requerimientos FR-006 (roles), FR-017 (consulta y edición de perfil y preferencias), FR-018 (reportes estadísticos) y FR-029 a FR-031 (derechos del titular y retención de auditoría).

## Precondiciones

El usuario debe estar autenticado con un token JWT válido. Para rectificar o eliminar datos personales, debe ser el titular de la cuenta. La asignación de roles editoriales corresponde a perfiles internos pre-aprobados por la administración de la plataforma, sin auto-postulación pública en la versión inicial.

## Postcondiciones

Tras editar el perfil o las preferencias, los cambios se persisten y se notifica al usuario; al consultar el progreso o el historial, el sistema devuelve el reporte estadístico con artículos vistos, calificaciones obtenidas y simulaciones realizadas; y al solicitar la eliminación de la cuenta, se inicia la Saga de anonimización que disocia la información personal identificable en todas las bases operacionales, conservando el registro de auditoría con identificadores opacos (FR-030).

## Casos de uso con los que se relaciona

Corresponde a la Historia de Usuario 3 (Gestión de perfil, preferencias e historial, prioridad P3) y sus escenarios de edición, confirmación de cambios y consulta de reportes; se relaciona con RF-03 (identidad previa del usuario), con RF-01 y RF-04 (cuyas actividades nutren los historiales y estadísticas) y con los servicios de Auditoría y Orquestador, responsables de la trazabilidad y de la anonimización.

## Flujo Básico

El usuario consulta su perfil y datos personales (`GET /me/profile`) y los rectifica (`PATCH /me/profile`) ajustando su información y preferencias; consulta su progreso (`GET /me/progress`) y los reportes de su actividad; y cuando lo desea, ejerce su derecho de supresión solicitando la eliminación de la cuenta (`DELETE /me/account`), lo que dispara la Saga de anonimización con efecto de revocación de consentimiento.

## Flujo Alternativo

Si los datos enviados en la rectificación son inválidos, el sistema rechaza la actualización indicando el error; si se solicita la eliminación de la cuenta, la operación se procesa de forma asíncrona dentro del plazo de la Ley 1581 (≤ 15 días hábiles) y la cuenta queda en estado `anonymized`, lo que impide nuevas emisiones de token; y la gestión de roles editoriales es ejecutada por la administración de la plataforma, no por auto-postulación del usuario.

## Restricciones y/o Excepciones

El sistema cumple el estándar de la Ley 1581 (consulta de datos ≤ 10 días hábiles; supresión ≤ 15 días hábiles), y la exportación de datos en formato portable se difiere a una versión posterior. La anonimización nunca altera el registro de auditoría inmutable, que conserva el `actor_ref` opaco por un período mínimo de cinco (5) años (FR-031). Un editor no puede ejercer de coordinador editorial sobre su propio contenido (FR-006), y cada servicio gobierna sus propios datos sin acceso cruzado, resolviendo las referencias por identificador opaco vía gRPC.
