# Feature Specification: Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido

**Feature Branch**: `002-calculator-builder-content-admin`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "Extensión de la Plataforma Fintcart que enmienda el feature `001-fintcart-platform` ya implementado: randomización de preguntas por artículo con número configurable de preguntas servidas; constructor de calculadoras financieras parametrizadas por el usuario (con las cinco existentes reconstruidas como definiciones por defecto); indicadores financieros anuales persistidos con vigencia y su procedimiento anual de actualización; depuración de usuarios ejecutada por un administrador y su efecto sobre el anonimato de las cuentas eliminadas; vista de editor con recursos multimedia; y gestión de categorías mediante lista desplegable."

## Contexto y Relación con el Feature 001

Esta especificación **enmienda** `001-fintcart-platform`, que ya está implementado y
desplegado. No lo reemplaza: todos los requisitos FR-001 a FR-031 y los criterios
SC-001 a SC-012 siguen vigentes salvo donde este documento los modifique explícitamente.
La numeración continúa desde donde terminó 001 (FR-032 en adelante, SC-013 en adelante)
para preservar la trazabilidad entre ambos documentos.

Requisitos de 001 **modificados** por esta enmienda:

| Requisito 001 | Naturaleza del cambio |
|---------------|-----------------------|
| FR-006 (roles) | Se añade un cuarto rol: administrador |
| FR-010 (catálogo por categorías) | Las categorías dejan de ser texto libre y pasan a un catálogo administrable |
| FR-011 (leer artículo y ejecutar cuestionario) | El cuestionario sirve un subconjunto aleatorio de preguntas |
| FR-012 (calificación) | La calificación se normaliza sobre las preguntas efectivamente servidas |
| FR-019 (cinco simuladores) | Las cinco calculadoras pasan a ser definiciones por defecto del constructor |
| FR-030 (eliminación de cuenta) | Se añade la vía administrativa y un período de gracia previo |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Catálogo administrable de categorías (Priority: P1)

Como administrador de la plataforma, quiero mantener un catálogo de categorías temáticas
para que los editores clasifiquen los artículos escogiendo de una lista y no escribiendo
texto libre, y para que el catálogo público del usuario final sea consistente.

**Why this priority**: es el cambio de menor riesgo y desbloquea la vista de editor.
Hoy cada editor escribe la categoría a mano, lo que produce duplicados por tildes,
mayúsculas o sinónimos y rompe la navegación por categorías que promete FR-010.

**Independent Test**: se puede probar por completo creando categorías, clasificando un
artículo con la lista desplegable y verificando que el catálogo público filtra por ellas,
sin depender de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un administrador autenticado, **When** crea una categoría con nombre,
   descripción y posición de orden, **Then** la categoría queda disponible y aparece en
   la posición indicada para editores y usuarios finales.
2. **Given** un editor que redacta un artículo, **When** abre el campo de categoría,
   **Then** ve una lista desplegable con las categorías activas ordenadas y no puede
   escribir un valor fuera de esa lista.
3. **Given** una categoría con artículos publicados, **When** el administrador intenta
   desactivarla, **Then** la operación es rechazada con un mensaje que indica cuántos
   artículos publicados la usan.
4. **Given** una categoría sin artículos publicados, **When** el administrador la
   desactiva, **Then** deja de ofrecerse a los editores y de aparecer en el catálogo
   público, pero se conserva para la trazabilidad histórica de los artículos archivados.
5. **Given** el catálogo de artículos ya existente con categorías escritas como texto
   libre, **When** se aplica la migración de datos, **Then** cada artículo queda asociado
   a una categoría del catálogo y ningún artículo queda sin categoría.

---

### User Story 2 - Cuestionarios con preguntas aleatorias (Priority: P1)

Como usuario final que repite un cuestionario, quiero que cada intento me presente un
subconjunto distinto de preguntas tomado del banco del artículo, para que reintentar sea
un ejercicio de aprendizaje real y no un ejercicio de memoria del orden de las respuestas.

**Why this priority**: FR-014 concede reintentos ilimitados. Con el cuestionario completo
siempre igual, el reintento degrada a memorización y el indicador de progreso deja de
medir comprensión. Es la corrección de mayor impacto pedagógico del alcance.

**Independent Test**: se puede probar por completo cargando un cuestionario con más
preguntas que su número a servir, ejecutándolo dos veces y comparando los conjuntos
servidos y las calificaciones, sin depender de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un cuestionario con 50 preguntas en su banco y un número a servir de 5,
   **When** un usuario lo inicia, **Then** recibe exactamente 5 preguntas escogidas al
   azar del banco.
2. **Given** un usuario que inicia el mismo cuestionario dos veces, **When** compara
   ambos intentos, **Then** el conjunto de preguntas y el orden de las opciones dentro
   de cada pregunta difieren entre intentos.
3. **Given** un intento en curso, **When** el usuario lo envía, **Then** la calificación
   se expresa sobre una escala de 100 calculada únicamente sobre las preguntas que le
   fueron servidas.
4. **Given** un intento en curso, **When** se envían respuestas a preguntas que no fueron
   servidas en ese intento, **Then** el sistema rechaza el envío en lugar de calificarlas.
5. **Given** un intento ya calificado, **When** el usuario o un auditor consulta el
   historial, **Then** puede ver qué preguntas se sirvieron en ese intento concreto.
6. **Given** un cuestionario cuyo banco tiene menos preguntas que su número a servir,
   **When** un usuario lo inicia, **Then** recibe todas las preguntas disponibles sin
   error.
7. **Given** una sesión de cuestionario iniciada y no enviada, **When** transcurre el
   tiempo de vigencia de la sesión, **Then** la sesión expira y el usuario debe iniciar
   un intento nuevo.

---

### User Story 3 - Constructor de calculadoras propias (Priority: P1)

Como usuario final que aplica conocimientos financieros, quiero construir mis propias
calculadoras definiendo sus campos de entrada, sus fórmulas y sus resultados, para
modelar situaciones que las calculadoras por defecto no cubren.

**Why this priority**: es el cambio de mayor alcance funcional del feature y el que
convierte el módulo de simuladores de un conjunto cerrado de cinco herramientas en una
capacidad extensible. Las demás historias del bloque de calculadoras dependen de esta.

**Independent Test**: se puede probar por completo creando una calculadora con dos
entradas y una fórmula, ejecutándola y verificando el resultado y su registro en el
historial, sin depender de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** define una calculadora con nombre,
   descripción, campos de entrada (etiqueta, unidad, mínimo, máximo, valor por defecto)
   y al menos un resultado con su fórmula, **Then** la calculadora queda guardada y
   disponible solo para él.
2. **Given** una calculadora propia guardada, **When** el usuario la ejecuta con valores
   válidos, **Then** obtiene los resultados con precisión decimal adecuada al dominio y
   la ejecución queda en su historial de simulaciones.
3. **Given** una fórmula que referencia un campo de entrada inexistente o que contiene
   una expresión mal formada, **When** el usuario intenta guardar la calculadora,
   **Then** el sistema la rechaza señalando el error concreto y no la guarda.
4. **Given** una calculadora cuya fórmula puede dividir por cero para ciertos valores,
   **When** el usuario la ejecuta con esos valores, **Then** recibe un mensaje de error
   de dominio comprensible en lugar de un resultado erróneo o un fallo del sistema.
5. **Given** un valor de entrada fuera del rango declarado para ese campo, **When** el
   usuario intenta ejecutar la calculadora, **Then** el sistema rechaza la ejecución
   indicando el campo y el rango admitido.
6. **Given** las cinco calculadoras por defecto de la plataforma (ahorro, crédito,
   presupuesto, inversión y las específicas del contexto colombiano), **When** un usuario
   las ejecuta con los mismos parámetros que antes de esta enmienda, **Then** obtiene
   exactamente los mismos resultados.
7. **Given** una definición de calculadora que excede los límites de complejidad
   admitidos, **When** el usuario intenta guardarla, **Then** el sistema la rechaza
   indicando el límite superado.

---

### User Story 4 - Indicadores financieros anuales y su actualización (Priority: P2)

Como administrador, quiero mantener en la plataforma los indicadores del contexto
financiero colombiano con su vigencia anual, para que las calculadoras los usen sin que
nadie tenga que digitarlos y para que el procedimiento anual de actualización no se olvide.

**Why this priority**: sin indicadores vigentes, las calculadoras del contexto colombiano
producen resultados desactualizados en silencio, que es el peor modo de fallo en una
plataforma de educación financiera. Habilita además que las calculadoras de la historia 3
sean genuinamente útiles.

**Independent Test**: se puede probar por completo cargando los indicadores de un año,
ejecutando una calculadora que los referencie, y verificando la alerta al acercarse el
vencimiento, sin depender de las historias de curaduría o de contenido.

**Acceptance Scenarios**:

1. **Given** un administrador autenticado, **When** carga los indicadores del año
   entrante (salario mínimo, UVT, UVR, IPC, tasa de usura) con su período de vigencia,
   **Then** quedan registrados y disponibles para las calculadoras a partir de la fecha
   de inicio de vigencia.
2. **Given** una fórmula que referencia un indicador por su nombre, **When** se ejecuta
   la calculadora, **Then** el sistema resuelve el valor vigente a la fecha de ejecución.
3. **Given** una simulación ya ejecutada y guardada, **When** los indicadores cambian de
   año, **Then** el historial sigue mostrando el resultado original y permite saber qué
   valores de indicadores se usaron.
4. **Given** que faltan menos de 30 días para que venzan los indicadores vigentes o que
   ya no hay indicadores para el período actual, **When** el sistema evalúa el estado del
   procedimiento anual, **Then** notifica al administrador por correo.
5. **Given** que no hay indicadores vigentes para el período actual, **When** un usuario
   abre una calculadora que los referencia, **Then** ve una advertencia visible de que
   los valores pueden estar desactualizados antes de ejecutarla.
6. **Given** un intento de registrar indicadores cuyo período de vigencia se solapa con
   otro ya registrado para el mismo indicador, **When** el administrador confirma,
   **Then** el sistema rechaza el solapamiento indicando el conflicto.

---

### User Story 5 - Curaduría y publicación de calculadoras (Priority: P2)

Como coordinador editorial, quiero revisar y aprobar las calculadoras que los usuarios
proponen para el catálogo público, para que una fórmula equivocada no se difunda como si
fuera contenido validado por la plataforma.

**Why this priority**: en educación financiera una calculadora pública errónea es un
riesgo reputacional y potencialmente regulatorio. Es el control de calidad que hace
seguro el constructor de la historia 3, pero no lo bloquea: las calculadoras privadas
funcionan sin ella.

**Independent Test**: se puede probar por completo proponiendo una calculadora propia
para publicación, aprobándola con un revisor distinto del autor y verificando que aparece
en el catálogo público, sin depender de las historias de contenido.

**Acceptance Scenarios**:

1. **Given** una calculadora privada, **When** su autor la propone para el catálogo
   público, **Then** pasa a estado en revisión y deja de ser editable hasta que se
   resuelva.
2. **Given** una calculadora en revisión, **When** un coordinador editorial distinto del
   autor la aprueba, **Then** queda publicada y visible para todos los usuarios.
3. **Given** una calculadora en revisión, **When** su propio autor intenta aprobarla,
   **Then** la operación es rechazada.
4. **Given** una calculadora en revisión, **When** un coordinador editorial la rechaza
   con un motivo, **Then** vuelve a estado privado y su autor recibe el motivo.
5. **Given** una calculadora publicada, **When** su autor la modifica, **Then** los
   cambios no afectan a la versión publicada hasta que pasen de nuevo por revisión.

---

### User Story 6 - Editor de contenido enriquecido con imágenes (Priority: P2)

Como editor de contenido, quiero redactar los artículos en un editor con formato visual
e insertar imágenes en línea, en lugar de escribir en un área de texto plano, para
producir material formativo legible sin conocer ningún lenguaje de marcado.

**Why this priority**: es el principal reclamo de usabilidad del flujo editorial actual y
condiciona la calidad percibida del contenido. No bloquea ninguna otra historia, pero es
prerrequisito de la historia 8.

**Independent Test**: se puede probar por completo redactando un artículo con títulos,
listas, énfasis y una imagen con su texto alternativo, publicándolo y verificando su
presentación al usuario final, sin depender de las historias de calculadoras.

**Acceptance Scenarios**:

1. **Given** un editor redactando un borrador, **When** usa la barra de herramientas,
   **Then** puede aplicar negrita, cursiva, encabezados, listas y enlaces, y ve el
   resultado con el formato aplicado mientras escribe.
2. **Given** un editor redactando un borrador, **When** inserta una imagen, **Then** el
   sistema le exige un texto alternativo y le permite añadir un pie de foto antes de
   aceptarla.
3. **Given** un artículo publicado con contenido enriquecido, **When** un usuario final
   lo lee, **Then** ve el contenido formateado e ilustrado y ningún contenido activo
   inyectado puede ejecutarse en su navegador.
4. **Given** un artículo con imágenes, **When** se crea una versión nueva y se consulta
   el historial, **Then** cada versión conserva las imágenes que tenía en su momento.
5. **Given** un archivo que no es una imagen o que excede el tamaño máximo admitido,
   **When** el editor intenta insertarlo, **Then** el sistema lo rechaza indicando el
   motivo.
6. **Given** el contenido de los artículos publicados antes de esta enmienda, **When** se
   aplica la migración, **Then** siguen siendo legibles y editables en el nuevo editor
   sin pérdida de texto.

---

### User Story 7 - Depuración de cuentas por el administrador (Priority: P2)

Como administrador, quiero depurar cuentas de usuario dejando registro y con posibilidad
de deshacer durante un plazo, para atender solicitudes de supresión y limpiar cuentas sin
destruir datos por error ni romper la trazabilidad de auditoría.

**Why this priority**: es cumplimiento normativo (Ley 1581 de 2012) y hoy solo existe la
vía auto-gestionada del titular. Un borrado administrativo sin plazo de reversión es un
riesgo operativo mayor que el problema que resuelve.

**Independent Test**: se puede probar por completo marcando una cuenta para depuración,
verificando que queda inaccesible pero reversible, y comprobando el resultado al vencer
el plazo, sin depender de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un administrador autenticado, **When** marca una cuenta para depuración,
   **Then** la cuenta queda suspendida, su titular no puede usar la plataforma y la
   operación queda registrada en el registro de auditoría junto con quién la ejecutó.
2. **Given** una cuenta marcada para depuración, **When** su titular intenta acceder
   dentro de los 30 días siguientes, **Then** puede reactivarla y recupera su perfil,
   progreso e historial intactos.
3. **Given** una cuenta marcada para depuración, **When** transcurren 30 días sin
   reactivación, **Then** el sistema ejecuta la anonimización definitiva de los datos
   personales identificables en todos los ámbitos operacionales.
4. **Given** una cuenta marcada para depuración, **When** otra persona intenta
   registrarse con ese mismo correo dentro del plazo de gracia, **Then** el registro es
   rechazado porque el correo sigue reservado.
5. **Given** una cuenta ya anonimizada definitivamente, **When** alguien se registra con
   el correo que tenía, **Then** el registro es aceptado como una cuenta nueva y sin
   ningún historial de la anterior.
6. **Given** una cuenta anonimizada, **When** se consulta el registro de auditoría,
   **Then** las operaciones históricas del titular siguen presentes bajo un
   identificador opaco que no permite re-identificarlo.
7. **Given** una cuenta anonimizada, **When** se consultan las estadísticas agregadas de
   artículos y el progreso de la plataforma, **Then** los agregados no se ven alterados
   por la anonimización.

---

### User Story 8 - Calculadoras ejecutables dentro de un artículo (Priority: P3)

Como usuario final que lee un artículo educativo, quiero usar la calculadora que ilustra
el tema sin salir del artículo, para aplicar de inmediato lo que acabo de leer.

**Why this priority**: es la historia que une los dos bloques del feature y la de mayor
valor pedagógico percibido, pero depende de que existan tanto el constructor de
calculadoras como el editor enriquecido, así que va al final.

**Independent Test**: se puede probar por completo insertando una calculadora publicada
en un artículo, ejecutándola como lector y verificando que la ejecución aparece en el
historial de simulaciones.

**Acceptance Scenarios**:

1. **Given** un editor redactando un borrador, **When** inserta un bloque de calculadora,
   **Then** puede escoger entre las calculadoras publicadas y ver una vista previa de
   cómo la verá el lector.
2. **Given** un artículo publicado con una calculadora incrustada, **When** un usuario
   final ingresa valores y la ejecuta, **Then** ve los resultados dentro del artículo sin
   navegar a otra pantalla.
3. **Given** una ejecución de una calculadora incrustada, **When** el usuario consulta su
   historial de simulaciones, **Then** la ejecución aparece registrada como cualquier otra.
4. **Given** un artículo que incrusta una calculadora, **When** esa calculadora deja de
   estar publicada, **Then** el artículo sigue siendo legible y muestra un aviso en lugar
   del bloque, sin romper la lectura.

---

### Edge Cases

- ¿Qué ocurre si un editor modifica el banco de preguntas de un cuestionario mientras un
  usuario tiene una sesión de intento abierta sobre las preguntas anteriores?
- ¿Qué ocurre si el número de preguntas a servir se reduce después de que ya existen
  intentos calificados sobre un número mayor? Los intentos históricos conservan su
  calificación normalizada y siguen siendo comparables.
- ¿Cómo se comporta el "mejor puntaje histórico" (FR-014) para cuestionarios que ya tenían
  intentos calificados antes de esta enmienda, cuando la escala de calificación cambia?
- ¿Qué ocurre si dos administradores editan el mismo indicador anual simultáneamente?
- ¿Qué ocurre si una calculadora publicada referencia un indicador que el administrador
  deja sin vigencia?
- ¿Qué ocurre si el autor de una calculadora publicada solicita la eliminación de su
  cuenta? La calculadora publicada sobrevive con autoría anonimizada.
- ¿Qué ocurre si un administrador marca para depuración su propia cuenta, o la del único
  administrador de la plataforma?
- ¿Qué ocurre si un titular reactiva su cuenta el mismo día en que vence el plazo de gracia?
- ¿Qué ocurre si un artículo referencia una imagen que ya no existe?
- ¿Qué ocurre si se intenta desactivar la última categoría activa del catálogo?
- ¿Qué ocurre si una fórmula produce un resultado que excede el rango representable?

## Requirements *(mandatory)*

### Functional Requirements

#### Catálogo de categorías

- **FR-032**: El sistema MUST mantener un catálogo de categorías temáticas administrable,
  donde cada categoría tiene nombre único, identificador legible, descripción, posición de
  orden y estado activo/inactivo.
- **FR-033**: El sistema MUST permitir a usuarios con rol administrador crear, editar,
  reordenar y desactivar categorías del catálogo.
- **FR-034**: El sistema MUST exigir que cada artículo pertenezca a exactamente una
  categoría del catálogo, y MUST impedir que un editor asigne un valor de categoría que no
  exista en él.
- **FR-035**: El sistema MUST impedir la desactivación de una categoría que tenga
  artículos en estado publicado, informando cuántos la usan. La desactivación MUST ser
  lógica: las categorías nunca se eliminan físicamente, para preservar la trazabilidad
  histórica de FR-013.
- **FR-036**: El sistema MUST migrar los valores de categoría existentes al catálogo sin
  dejar artículos sin categoría, preservando el mínimo de cinco categorías temáticas
  exigido por SC-009.

#### Cuestionarios con preguntas aleatorias

- **FR-037**: Cada cuestionario MUST declarar cuántas preguntas de su banco se sirven en
  un intento. Este número es configurable por cuestionario.
- **FR-038**: Al iniciarse un intento, el sistema MUST seleccionar aleatoriamente ese
  número de preguntas del banco del cuestionario y MUST presentar las opciones de cada
  pregunta en orden aleatorio. Cuando el banco tenga menos preguntas que el número
  declarado, MUST servir todas las disponibles sin error.
- **FR-039**: El sistema MUST registrar qué preguntas fueron servidas en cada intento y
  MUST conservar ese registro como parte del historial de intentos (FR-016).
- **FR-040**: El sistema MUST rechazar la calificación de respuestas a preguntas que no
  fueron servidas en el intento correspondiente.
- **FR-041**: La calificación de un intento MUST expresarse sobre una escala de 100
  calculada como la proporción del peso acertado sobre el peso total de las preguntas
  efectivamente servidas, de modo que intentos con subconjuntos distintos sean
  comparables entre sí para efectos del mejor puntaje histórico (FR-014).
- **FR-042**: Una sesión de intento MUST tener una vigencia limitada; vencida sin envío,
  MUST invalidarse y obligar a iniciar un intento nuevo.

#### Constructor de calculadoras

- **FR-043**: El sistema MUST permitir a cualquier usuario autenticado definir
  calculadoras propias mediante nombre, descripción, campos de entrada y resultados
  calculados.
- **FR-044**: Cada campo de entrada MUST declarar etiqueta, unidad, valor mínimo, valor
  máximo y valor por defecto; el sistema MUST rechazar ejecuciones con valores fuera del
  rango declarado, indicando el campo y el rango admitido.
- **FR-045**: El sistema MUST proveer un lenguaje de fórmulas que soporte, como mínimo:
  operaciones aritméticas, potenciación, condicionales, funciones de redondeo y
  primitivas financieras de uso común (cuota nivelada, valor futuro de una serie de
  aportes, conversión entre tasas de distinta periodicidad).
- **FR-046**: El sistema MUST validar la definición de una calculadora antes de guardarla,
  rechazando referencias a campos inexistentes, expresiones mal formadas y definiciones que
  excedan los límites declarados de complejidad, señalando el error concreto.
- **FR-047**: La evaluación de fórmulas MUST ejecutarse de forma acotada y sin ejecución de
  código arbitrario, y MUST producir errores de dominio explícitos y comprensibles para
  división por cero, desbordamiento y valores no representables.
- **FR-048**: Todos los valores de entrada, constantes, resultados intermedios y resultados
  finales de una calculadora MUST tratarse con precisión decimal arbitraria, conforme a
  FR-028. Queda PROHIBIDO el punto flotante binario en cualquier capa.
- **FR-049**: Las cinco calculadoras del alcance de FR-019 MUST ofrecerse como
  calculadoras por defecto de la plataforma, definidas con el mismo mecanismo de
  parametrización que las de usuario, y MUST producir para los mismos parámetros los
  mismos resultados que producían antes de esta enmienda.
- **FR-050**: Las ejecuciones de calculadoras de usuario MUST registrarse en el historial
  de simulaciones del usuario (FR-022) igual que las de las calculadoras por defecto,
  incluyendo la identificación de la calculadora y su versión de definición.

#### Autoría, visibilidad y curaduría de calculadoras

- **FR-051**: Una calculadora creada por un usuario MUST ser privada por defecto, visible
  y ejecutable únicamente por su autor.
- **FR-052**: La publicación de una calculadora al catálogo público, o su uso dentro de un
  artículo, MUST requerir aprobación previa por curaduría.
- **FR-053**: La aprobación de una calculadora MUST ser ejecutada por un coordinador
  editorial distinto de su autor, conforme al mismo principio de separación de
  responsabilidades de FR-008.
- **FR-054**: El rechazo de una calculadora propuesta MUST registrar un motivo y MUST
  comunicárselo a su autor.

#### Indicadores financieros anuales

- **FR-055**: El sistema MUST persistir los indicadores del contexto financiero colombiano
  (salario mínimo, UVT, UVR, IPC, tasa de usura, y los que se añadan) con su valor y su
  período de vigencia.
- **FR-056**: Los valores de los indicadores MUST representarse con precisión decimal
  arbitraria conforme a FR-028.
- **FR-057**: Las fórmulas de las calculadoras MUST poder referenciar indicadores por
  nombre, y el sistema MUST resolver el valor vigente a la fecha de ejecución.
- **FR-058**: Cada simulación registrada MUST conservar los valores de indicadores que se
  usaron, de modo que el resultado histórico siga siendo explicable y reproducible después
  de que los indicadores cambien.
- **FR-059**: El sistema MUST impedir el registro de dos vigencias solapadas para el mismo
  indicador.
- **FR-060**: El sistema MUST permitir a usuarios con rol administrador cargar y editar
  los indicadores de un período de vigencia.

#### Procedimiento anual de actualización

- **FR-061**: El sistema MUST notificar al administrador cuando los indicadores vigentes
  estén próximos a vencer o cuando no existan indicadores para el período en curso,
  usando el canal de correo ya existente (FR-023).
- **FR-062**: El sistema MUST advertir de forma visible al usuario, antes de ejecutar una
  calculadora que dependa de indicadores sin vigencia para el período actual, que los
  resultados pueden estar desactualizados.

#### Editor enriquecido y recursos multimedia

- **FR-063**: El sistema MUST proveer al editor una superficie de redacción con formato
  visual que soporte, como mínimo: énfasis, encabezados, listas y enlaces, mostrando el
  resultado formateado durante la redacción.
- **FR-064**: El sistema MUST permitir insertar imágenes en línea dentro del cuerpo de un
  artículo. En esta versión el alcance multimedia se limita a imágenes: video, audio y
  documentos adjuntos quedan explícitamente fuera.
- **FR-065**: El sistema MUST exigir texto alternativo para cada imagen insertada y MUST
  permitir un pie de foto opcional.
- **FR-066**: El sistema MUST validar el tipo y el tamaño de las imágenes insertadas,
  rechazando las que no cumplan e informando el motivo.
- **FR-067**: Las imágenes de un artículo MUST formar parte de su versionado (FR-013): cada
  versión conserva las imágenes que tenía cuando se creó.
- **FR-068**: El sistema MUST neutralizar cualquier contenido activo en el cuerpo
  enriquecido antes de presentarlo a un usuario final, de modo que no pueda ejecutarse en
  su navegador.
- **FR-069**: El sistema MUST migrar el contenido de los artículos existentes al nuevo
  formato de cuerpo sin pérdida de texto y sin invalidar sus versiones históricas.

#### Calculadoras incrustadas en artículos

- **FR-070**: El sistema MUST permitir al editor incrustar en el cuerpo de un artículo una
  calculadora publicada, con vista previa durante la redacción.
- **FR-071**: El usuario final MUST poder ejecutar una calculadora incrustada sin
  abandonar el artículo, y esa ejecución MUST registrarse en su historial de simulaciones
  (FR-022).
- **FR-072**: Cuando una calculadora incrustada deje de estar publicada, el artículo MUST
  seguir siendo legible, mostrando un aviso en lugar del bloque.

#### Depuración de cuentas y anonimato

- **FR-073**: El sistema MUST permitir a usuarios con rol administrador marcar una cuenta
  para depuración.
- **FR-074**: Una cuenta marcada para depuración MUST quedar suspendida e inaccesible para
  su titular, y MUST ser reactivable por él durante un período de gracia de 30 días,
  recuperando perfil, progreso e historial intactos.
- **FR-075**: Vencido el período de gracia sin reactivación, el sistema MUST ejecutar la
  anonimización definitiva descrita en FR-030 sobre todos los ámbitos operacionales, con
  compensación ante fallos parciales conforme a FR-027.
- **FR-076**: El correo de una cuenta MUST permanecer reservado durante el período de
  gracia, impidiendo que otra persona se registre con él. Consumada la anonimización, el
  correo MUST quedar liberado para un registro nuevo, que NO DEBE heredar ningún dato ni
  historial de la cuenta anterior.
- **FR-077**: El sistema NO DEBE conservar ninguna representación del correo original tras
  la anonimización —ni siquiera transformada o cifrada— que permita comprobar si una
  persona determinada tuvo cuenta en la plataforma.
- **FR-078**: Toda operación de depuración administrativa MUST quedar registrada en el
  registro de auditoría inmutable (FR-025), identificando al administrador que la ejecutó,
  la cuenta afectada mediante identificador opaco y la marca temporal.
- **FR-079**: La anonimización NO DEBE alterar los agregados estadísticos de contenido ni
  el progreso agregado de la plataforma.

#### Rol de administrador

- **FR-080**: El sistema MUST distinguir un cuarto rol, "administrador", que amplía los
  tres roles de FR-006 y cuyas atribuciones son: gestión del catálogo de categorías,
  gestión de los indicadores anuales y ejecución de la depuración de cuentas.
- **FR-081**: El sistema MUST rechazar el acceso a las funciones administrativas a
  cualquier usuario que no ostente el rol administrador, verificándolo de forma explícita
  en el borde de la plataforma y no solo ocultando la interfaz.
- **FR-082**: El rol administrador MUST ser independiente del rol de coordinador
  editorial: la aprobación de contenido y de calculadoras sigue siendo atribución del
  coordinador editorial (FR-008, FR-053), no del administrador.

#### Consistencia visual y accesibilidad de la interfaz

- **FR-083**: Las pantallas que este feature añade MUST presentarse con el mismo sistema
  visual que el resto de la plataforma —tipografía, color, espaciado y componentes de
  interfaz—, de modo que el usuario no perciba dos productos distintos dentro de la misma
  aplicación.
- **FR-084**: Todo control de interfaz MUST ser operable con teclado, MUST mostrar una
  indicación de foco visible y MUST tener una etiqueta asociada, de modo que la plataforma
  sea utilizable con lector de pantalla.
- **FR-085**: La interfaz NO DEBE depender de servicios externos en tiempo de ejecución para
  presentar su tipografía ni su iconografía: una interrupción de conectividad hacia terceros
  no puede degradar la legibilidad de las cifras ni la comprensión de los controles.

### Key Entities

- **Categoría**: entrada del catálogo temático. Atributos clave: identificador, nombre,
  identificador legible, descripción, posición de orden, estado activo. Un artículo
  pertenece a exactamente una categoría.
- **Sesión de Cuestionario**: intento en curso de un usuario sobre un cuestionario, que
  fija el subconjunto de preguntas servidas y el orden de sus opciones. Atributos clave:
  usuario, cuestionario, preguntas servidas, momento de emisión, vigencia. Se asocia al
  intento resultante.
- **Definición de Calculadora**: descripción parametrizada de una calculadora. Atributos
  clave: identificador, autor, nombre, descripción, campos de entrada, resultados con sus
  fórmulas, estado de visibilidad (privada, en revisión, publicada), aprobador, versión,
  y marca de si es una de las calculadoras por defecto de la plataforma.
- **Campo de Entrada**: parámetro de una calculadora. Atributos clave: clave, etiqueta,
  unidad, valor mínimo, valor máximo, valor por defecto.
- **Indicador Financiero**: valor de referencia del contexto colombiano con vigencia
  temporal. Atributos clave: nombre, valor en precisión decimal arbitraria, inicio y fin
  de vigencia, quién lo registró.
- **Recurso de Imagen**: imagen asociada a una versión de artículo. Atributos clave:
  identificador, artículo y versión a la que pertenece, texto alternativo, pie de foto,
  tipo, tamaño.
- **Estado de Cuenta**: se amplía el estado de la entidad Usuario de 001 para admitir,
  además de activa y anonimizada, el estado suspendida por depuración con su fecha de
  vencimiento del período de gracia.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-013**: Un usuario que repite tres veces un cuestionario cuyo banco tiene al menos
  el triple de preguntas que su número a servir recibe conjuntos de preguntas distintos en
  los tres intentos.
- **SC-014**: El 100 % de los intentos calificados registra qué preguntas fueron servidas,
  de modo que cualquier calificación pueda reconstruirse a partir del historial.
- **SC-015**: Las cinco calculadoras por defecto producen, para un conjunto de casos de
  regresión que cubre sus rangos de uso, resultados idénticos a los que producían antes de
  esta enmienda, incluidos los casos de borde numérico.
- **SC-016**: Un usuario sin conocimientos técnicos crea y ejecuta una calculadora propia
  de dos entradas y un resultado en menos de 5 minutos desde su primer acceso al
  constructor.
- **SC-017**: Ninguna definición de calculadora inválida (referencia inexistente,
  expresión mal formada, complejidad excesiva) llega a guardarse; el 100 % se rechaza en
  el momento de guardar con un mensaje que identifica el error.
- **SC-018**: Ninguna calculadora llega al catálogo público sin haber sido aprobada por un
  coordinador editorial distinto de su autor.
- **SC-019**: Toda simulación del historial permite conocer los valores de indicadores con
  que se calculó, incluso después de que esos indicadores hayan sido reemplazados.
- **SC-020**: El administrador recibe aviso del vencimiento de los indicadores con al
  menos 30 días de antelación, y ninguna calculadora que dependa de indicadores vencidos
  se ejecuta sin mostrar antes la advertencia correspondiente.
- **SC-021**: Un editor produce un artículo con encabezados, listas, énfasis y al menos
  una imagen sin escribir ninguna marca de formato a mano.
- **SC-022**: Ningún contenido activo introducido en el cuerpo de un artículo llega a
  ejecutarse en el navegador de un usuario final.
- **SC-023**: Una cuenta marcada para depuración es reactivable por su titular durante los
  30 días siguientes con recuperación completa de perfil, progreso e historial; vencido el
  plazo, ninguno de sus datos personales identificables permanece consultable en la
  plataforma.
- **SC-024**: Tras una anonimización, el registro de auditoría conserva el 100 % de las
  operaciones históricas del titular bajo identificador opaco, y las estadísticas
  agregadas de contenido y progreso permanecen sin variación.
- **SC-025**: Todos los artículos del catálogo están clasificados en una categoría del
  catálogo administrable; ningún artículo conserva una categoría escrita como texto libre.
- **SC-026**: Ninguna pantalla nueva introduce estilos propios fuera del sistema visual
  común; todos sus controles son alcanzables y operables solo con teclado; y la interfaz se
  presenta completa y legible con la conectividad hacia servicios externos deshabilitada.

## Assumptions

- Los requisitos FR-001 a FR-031 y los criterios SC-001 a SC-012 del feature 001 siguen
  vigentes salvo donde este documento los enmiende explícitamente; la numeración continúa
  desde 001 para preservar la trazabilidad.
- El período de gracia de la depuración de cuentas es de 30 días, decidido con el
  stakeholder. No es configurable en esta versión.
- El aviso de vencimiento de indicadores se emite con 30 días de antelación, alineado con
  el período de gracia por coherencia operativa.
- No se implementa política anti-repetición de preguntas entre intentos consecutivos: el
  muestreo es puramente aleatorio, decidido con el stakeholder.
- No se bloquea la publicación de un cuestionario cuyo banco tenga menos preguntas que su
  número a servir; en ese caso sirve todas las disponibles, decidido con el stakeholder.
- El catálogo de categorías es plano: no hay subcategorías, y un artículo pertenece a
  exactamente una categoría, decidido con el stakeholder.
- El alcance multimedia de esta versión es exclusivamente imágenes, decidido con el
  stakeholder. Video, audio y documentos adjuntos se difieren.
- La depuración administrativa reutiliza la misma anonimización de FR-030 en lugar de un
  borrado físico, para no comprometer la inmutabilidad ni la retención de cinco años del
  registro de auditoría (FR-031) ni los agregados estadísticos de contenido.
- El correo se reserva durante el período de gracia porque, sin esa reserva, un registro
  de terceros con ese correo impediría la reactivación prometida por FR-074.
- Las calculadoras publicadas sobreviven a la anonimización de su autor, con la autoría
  disociada del titular.
- La exportación de datos personales en formato portable sigue fuera de alcance, como en
  001.

## Dependencies

- Depende del feature `001-fintcart-platform` implementado: catálogo de artículos, flujo
  editorial, cuestionarios, simuladores, historial, perfiles, notificación por correo,
  registro de auditoría y saga de anonimización.
- La historia 8 (calculadoras incrustadas) depende de las historias 3 y 6.
- La historia 5 (curaduría de calculadoras) depende de la historia 3.
- La historia 6 (editor enriquecido) depende de la historia 1 para el desplegable de
  categorías.

## Decisiones Diferidas a la Fase de Planeación

> **Estado: RESUELTAS** — las tres se cerraron en [research.md](./research.md) durante
> `/speckit-plan`. Se conserva el enunciado original y se añade la resolución, para que la
> trazabilidad de por qué se decidió cada cosa no se pierda.

Las siguientes decisiones son de diseño técnico y se resuelven en `/speckit-plan` con su
investigación correspondiente. Se listan aquí para que no se den por resueltas:

1. **Almacenamiento de las imágenes**: dónde se guardan físicamente los archivos y qué
   límites de tamaño y formato se aplican. Si la opción elegida introduce un componente de
   infraestructura no contemplado hoy, requiere enmienda formal a la constitución antes de
   implementarse.

   → **Resuelta (research D-13)**: se guardan en la base de datos del propio servicio de
   contenido, con tope de 2 MB por imagen, tipos restringidos a JPEG/PNG/WebP e
   identificador derivado del contenido. **No requiere enmienda constitucional** ni
   infraestructura nueva. Decidió el despliegue real: dos servidores de 4 GB de memoria que
   ya operan al límite. La alternativa de almacén de objetos queda documentada como la
   salida natural si el catálogo crece o si se añade video.

2. **Representación del cuerpo enriquecido**: cómo se persiste el contenido con formato,
   imágenes y bloques incrustados, y cómo se garantiza la neutralización de contenido
   activo exigida por FR-068 sin perder capacidad de edición.

   → **Resuelta (research D-14)**: documento de bloques con vocabulario **cerrado**,
   validado en el servidor al guardar, en lugar de HTML saneado al leer. FR-068 pasa a
   cumplirse de forma estructural —el contenido nunca es HTML en ningún punto del
   recorrido— y no por la configuración correcta de un saneador.

3. **Alcance real del lenguaje de fórmulas**: qué operaciones exactas admite y, en
   particular, si las calculadoras específicas del contexto colombiano son reproducibles
   en él sin pérdida de exactitud. La conversión entre tasas de distinta periodicidad
   exige exponentes fraccionarios, cuya evaluación en precisión decimal arbitraria es
   aproximada, y el impuesto a las transacciones financieras exige condicionales con un
   tramo exento expresado en UVT. **Riesgo conocido**: si la investigación concluye que no
   son reproducibles con la exactitud exigida por FR-028, FR-049 debe renegociarse antes
   de implementar, manteniendo esas calculadoras como implementaciones nativas presentadas
   bajo la misma interfaz.

   → **Resuelta (research D-16): SÍ son reproducibles; FR-049 NO requiere renegociación.**
   Todas las salidas actuales son escalares, no hay entradas de longitud variable, y la
   implementación vigente **ya distingue** la potencia de exponente entero (exacta) de la
   de exponente decimal (aproximada), con esa distinción deliberada y documentada. El
   lenguaje hereda ambas como funciones separadas, y la de exponente entero **rechaza** un
   exponente fraccionario en lugar de degradar en silencio. Las calculadoras del contexto
   colombiano se separan además en tres definiciones nombradas, lo que elimina la única
   entrada de tipo texto del sistema. **Condición para que el cierre se sostenga**: la
   suite de regresión de SC-015 debe pasar antes de retirar la implementación nativa.
