# RF-02-1 — Editor de Publicaciones

## Nombre del requerimiento

Editor de Publicaciones.

## Descripción del requerimiento

El editor de publicaciones es la herramienta de autoría de contenido con la que el rol "editor" redacta y estructura el cuerpo de los artículos educativos y construye los cuestionarios asociados —preguntas, opciones, clave correcta, ponderación y umbral de aprobación—. Es el componente operativo, dentro del flujo de administración descrito en RF-02, que produce el material en estado borrador antes de su envío a revisión. Materializa la parte de creación y edición del FR-007 y la asociación de al menos un cuestionario por artículo del FR-009.

## Precondiciones

El actor debe estar autenticado con el rol "editor" y trabajar sobre un artículo propio en estado "borrador" o crear uno nuevo. Las versiones ya publicadas no son editables directamente: requieren generar una nueva versión en borrador para introducir cambios.

## Postcondiciones

Los cambios de contenido y de cuestionario quedan persistidos en la versión en borrador correspondiente, sin afectar la versión publicada vigente ni ser visibles para usuarios finales u otros editores. El cuestionario asociado queda definido y listo para que, una vez publicado el artículo, los usuarios finales lo ejecuten y sea calificado.

## Casos de uso con los que se relaciona

Es un subcaso de la Historia de Usuario 4 (curaduría y publicación de contenido) enfocado en la redacción del material; se relaciona estrechamente con RF-02, al que entrega el borrador para el flujo de aprobación; de forma indirecta con RF-01, pues el cuestionario que define será calificado desde el feed; y con el indicador de progreso, ya que las ponderaciones y el umbral determinan los puntajes que aportan los cuestionarios.

## Flujo Básico

El editor crea o abre un borrador, redacta el título, la categoría y el cuerpo del artículo, y define el cuestionario añadiendo preguntas con sus opciones, la clave correcta y la ponderación de cada una; guarda iterativamente los cambios en la versión en borrador y, cuando termina, deja la versión lista para enviarla a revisión a través del flujo descrito en RF-02.

## Flujo Alternativo

Si el editor abandona la edición, el borrador se conserva con los últimos cambios guardados para retomarlo después; si intenta editar una versión ya publicada, el sistema exige crear una nueva versión en borrador en lugar de modificar la vigente; y si el cuestionario queda sin preguntas válidas, la versión no podrá superar la validación de completitud al intentar enviarse a revisión.

## Restricciones y/o Excepciones

Un editor solo puede editar borradores propios, y el contenido en borrador nunca es visible para usuarios finales (FR-008). Cualquier valor numérico de ponderación o umbral de aprobación se maneja con precisión decimal arbitraria, sin punto flotante binario (FR-028). Debe existir al menos un cuestionario por artículo para que este pueda publicarse (FR-009). La herramienta no permite publicar directamente, pues la publicación está reservada exclusivamente al rol de coordinador editorial.
