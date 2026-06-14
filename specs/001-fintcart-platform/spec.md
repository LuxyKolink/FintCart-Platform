# Feature Specification: Plataforma Fintcart — Educación Financiera Interactiva

**Feature Branch**: `001-fintcart-platform`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Build Fintcart, a financial education platform for the Colombian market, based on these documents."

## Clarifications

### Session 2026-06-02

- Q: ¿Qué estructura de roles editoriales se requiere para garantizar separación de responsabilidades en el flujo de publicación? → A: Dos roles editoriales separados — "Editor" (crea/edita borradores y los envía a revisión) y "Coordinador editorial" (revisa, aprueba y publica el contenido enviado por editores); un editor no puede publicar su propio contenido.
- Q: ¿Cuál es la unidad y la regla de actualización del indicador de progreso, y qué política aplica a los reintentos de cuestionarios? → A: Progreso medido en puntos acumulados; los cuestionarios son reintentables sin límite y solo el mejor puntaje obtenido por cada cuestionario distinto contribuye al progreso del usuario.
- Q: ¿Qué nivel de cumplimiento de Ley 1581 y qué política de retención aplica a los datos personales y a la auditoría? → A: Cumplimiento estándar Ley 1581 — consulta, rectificación y eliminación de cuenta con anonimización de PII conservando el registro de auditoría inmutable; exportación de datos en formato portable diferida a una versión posterior; auditoría retenida por un período mínimo de cinco (5) años.
- Q: ¿Qué canales de notificación debe soportar la plataforma en la versión inicial? → A: Dos canales — correo electrónico para eventos críticos de seguridad y de identidad (verificación, contraseña, alertas) y bandeja in-app dentro de la plataforma para eventos de actividad del usuario; el MVP NO incluye SMS ni web push.
- Q: ¿Qué objetivo de disponibilidad (uptime) debe sostener la plataforma en condiciones normales? → A: 99,9% mensual (estándar SaaS), equivalente a un máximo de ≈43,8 minutos de indisponibilidad por mes (≈8,77 horas por año), excluyendo ventanas de mantenimiento planificado comunicadas con anticipación.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aprendizaje guiado con artículos y cuestionarios (Priority: P1)

Como persona interesada en mejorar mis conocimientos financieros, quiero registrarme en la
plataforma, leer artículos educativos sobre conceptos del contexto financiero colombiano
y resolver el cuestionario asociado a cada artículo, para que mi progreso aumente
en función de mis calificaciones y pueda medir mi aprendizaje.

**Why this priority**: Constituye la propuesta de valor central de la plataforma:
transferir conocimiento financiero al usuario final y permitirle evidenciar su avance.
Sin este flujo, la plataforma no cumple su propósito principal y los demás
componentes carecen de motivo de uso.

**Independent Test**: Una persona nueva se registra, verifica su correo, inicia sesión,
navega el catálogo de contenido publicado, lee un artículo, completa el cuestionario
asociado, recibe su calificación y observa su barra de progreso actualizada — sin
depender de simuladores ni de funcionalidades adicionales de perfil.

**Acceptance Scenarios**:

1. **Given** una persona sin cuenta, **When** se registra con un correo válido y completa el flujo de verificación, **Then** puede iniciar sesión y acceder al catálogo de contenido publicado.
2. **Given** un usuario autenticado, **When** selecciona un artículo del catálogo y lo lee, **Then** puede iniciar el cuestionario asociado a ese artículo.
3. **Given** un usuario que responde un cuestionario, **When** envía sus respuestas, **Then** el sistema lo califica, persiste el resultado y actualiza la barra de progreso del usuario en función de la calificación.
4. **Given** un usuario con historial previo, **When** consulta su perfil, **Then** visualiza los artículos vistos, las calificaciones obtenidas y su nivel de progreso actual.

---

### User Story 2 - Simuladores financieros para análisis personal (Priority: P2)

Como usuario que aplica conocimientos financieros, quiero usar calculadoras
especializadas para simular operaciones de ahorro, crédito, presupuesto, inversión y
cálculos específicos del contexto colombiano, para experimentar con escenarios
financieros realistas y aplicar los conceptos aprendidos a mi situación personal.

**Why this priority**: Los simuladores complementan el aprendizaje teórico con
experimentación práctica y refuerzan la propuesta educativa, pero el valor primario
proviene del consumo de contenido. Por eso son secundarios al flujo de aprendizaje.

**Independent Test**: Un usuario autenticado selecciona una calculadora, ingresa
parámetros financieros válidos en pesos colombianos, ejecuta la simulación, visualiza
los resultados con precisión adecuada y consulta su historial de simulaciones previas
— sin requerir consumo previo de contenido educativo.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** accede al módulo de simuladores, **Then** visualiza las cinco calculadoras disponibles: ahorro, crédito, presupuesto, inversión y calculadoras específicas del contexto colombiano.
2. **Given** un usuario que selecciona una calculadora, **When** ingresa parámetros financieros válidos (montos, tasas, plazos), **Then** el sistema produce el resultado con precisión decimal adecuada al dominio.
3. **Given** un usuario que ejecuta una simulación, **When** finaliza el cálculo, **Then** la operación queda registrada en su historial personal de simulaciones.
4. **Given** un usuario con historial de simulaciones, **When** consulta su historial, **Then** visualiza las simulaciones previas con sus parámetros, resultados y marca temporal.

---

### User Story 3 - Gestión de perfil, preferencias e historial (Priority: P3)

Como usuario de la plataforma, quiero administrar mi información personal y mis
preferencias de uso, así como revisar el historial completo de mi actividad, para
mantener control sobre mis datos y monitorear mi avance.

**Why this priority**: Aporta autonomía al usuario y mejora la experiencia y la
retención, pero no es indispensable para entregar valor educativo. Es funcionalidad
de soporte que enriquece, sin reemplazar, el flujo principal.

**Independent Test**: Un usuario autenticado accede a su perfil, edita información
personal y preferencias, recibe confirmación de los cambios y consulta el reporte
estadístico de su actividad — sin necesidad de consumir contenido nuevo ni ejecutar
simulaciones nuevas.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** accede a su perfil, **Then** puede ver y editar campos de información personal y preferencias.
2. **Given** un usuario que modifica su perfil, **When** confirma los cambios, **Then** los cambios persisten y se le notifica adecuadamente.
3. **Given** un usuario que solicita su historial, **When** consulta la sección correspondiente, **Then** visualiza un reporte estadístico con artículos vistos, calificaciones, simulaciones realizadas y progreso acumulado.
4. **Given** un usuario que solicita cambio de contraseña, **When** completa el flujo de cambio, **Then** recibe notificación del cambio y debe usar la nueva contraseña en su próximo acceso.

---

### User Story 4 - Curaduría y publicación de contenido educativo (Priority: P4)

Como editor de contenido, quiero crear, editar y versionar artículos educativos
junto con sus cuestionarios asociados, sometiéndolos al flujo de aprobación
gestionado por un coordinador editorial, para mantener la calidad y relevancia
del material disponible a los usuarios finales.

**Why this priority**: Sin esta funcionalidad la plataforma no puede mantener su
contenido actualizado en el tiempo. Sin embargo, el contenido inicial puede
cargarse mediante procedimientos manuales en una fase temprana del producto, por lo
que su prioridad para el lanzamiento es menor que la experiencia del usuario final.

**Independent Test**: Un editor redacta un nuevo artículo con su cuestionario y
lo envía a revisión; un coordinador editorial distinto del editor revisa, aprueba
y publica el contenido; ambos verifican que el artículo aparece en el catálogo
accesible a usuarios finales — sin depender de la actividad de consumo por parte
de los usuarios.

**Acceptance Scenarios**:

1. **Given** un editor con permisos correspondientes, **When** crea un artículo en estado borrador, **Then** el artículo no es visible para usuarios finales ni para otros editores.
2. **Given** un artículo en borrador, **When** el editor lo envía a revisión, **Then** el artículo cambia de estado y queda disponible para que un coordinador editorial lo apruebe.
3. **Given** un artículo en revisión, **When** un coordinador editorial distinto del editor que lo redactó lo aprueba y publica, **Then** queda disponible en el catálogo público con su versión actual identificable.
4. **Given** un artículo publicado, **When** un editor genera una nueva versión, **Then** se mantiene la trazabilidad histórica y la nueva versión requiere aprobación del coordinador editorial antes de reemplazar a la versión vigente.

---

### Edge Cases

- ¿Qué sucede cuando un usuario abandona un cuestionario sin completarlo (cierre de pestaña, pérdida de conexión)? El resultado no debe registrarse y debe poder reanudarse o reiniciarse en una sesión posterior.
- ¿Cómo responde el sistema ante respuestas inválidas o tiempos excesivos en un cuestionario?
- ¿Cómo se gestiona un correo de verificación que no llega o cuyo enlace expira?
- ¿Qué ocurre cuando un artículo es despublicado o reemplazado por una nueva versión mientras un usuario lo está consumiendo?
- ¿Cómo se procesa una simulación cuando los parámetros generan resultados de precisión extrema o sobrepasan rangos razonables?
- ¿Cómo se manejan intentos repetidos de inicio de sesión fallidos contra una misma cuenta?
- ¿Qué sucede ante una pérdida de conexión durante el envío de un cuestionario, el guardado de perfil o la ejecución de una simulación?
- ¿Cómo se reconcilia una operación distribuida (calificar → actualizar progreso → notificar → auditar) cuando uno de los pasos falla?
- ¿Cómo se evita el doble registro de progreso si un usuario reenvía el mismo cuestionario o repite la misma simulación rápidamente? Para cuestionarios, cada intento se persiste en el historial, pero el progreso solo se incrementa cuando la nueva calificación supera la mejor calificación previa del usuario en ese cuestionario; los reintentos por debajo del récord no modifican los puntos acumulados. Las simulaciones se registran individualmente y no impactan el indicador de progreso.

## Requirements *(mandatory)*

### Functional Requirements

**Identidad y acceso**

- **FR-001**: El sistema MUST permitir el registro de nuevos usuarios mediante correo electrónico y contraseña, garantizando unicidad del correo.
- **FR-002**: El sistema MUST enviar un correo de verificación al registrarse y MUST bloquear el acceso pleno hasta que el correo sea verificado.
- **FR-003**: El sistema MUST proveer un mecanismo de inicio de sesión seguro, estandarizado y apropiado para clientes web públicos.
- **FR-004**: El sistema MUST permitir el cierre de sesión con efecto inmediato y verificable en cualquier sesión activa del usuario.
- **FR-005**: El sistema MUST permitir al usuario solicitar el restablecimiento o cambio de su contraseña, notificándole al completar la operación.
- **FR-006**: El sistema MUST distinguir, como mínimo, tres roles con permisos diferenciados: "usuario final" (consume contenido y usa simuladores), "editor" (crea, edita y versiona artículos en borrador y los envía a revisión) y "coordinador editorial" (revisa, aprueba y publica artículos enviados por editores). Un editor NO PUEDE aprobar ni publicar su propio contenido.

**Contenido educativo y aprendizaje**

- **FR-007**: El sistema MUST permitir a editores crear, editar y versionar artículos educativos en estado borrador y enviarlos a revisión; la publicación oficial al catálogo público MUST estar reservada exclusivamente al rol de coordinador editorial.
- **FR-008**: El sistema MUST soportar un flujo de aprobación de contenido con, al menos, los estados borrador (visible únicamente a su editor), en revisión (visible al coordinador editorial para aprobación) y publicado (visible a usuarios finales). La transición de "en revisión" a "publicado" MUST ser ejecutada por un coordinador editorial distinto del editor que creó el artículo.
- **FR-009**: El sistema MUST permitir asociar al menos un cuestionario por artículo educativo.
- **FR-010**: El sistema MUST permitir a los usuarios finales navegar el catálogo de contenido publicado, organizado por categorías temáticas del ámbito de educación financiera.
- **FR-011**: El sistema MUST permitir a los usuarios finales leer un artículo publicado y ejecutar el cuestionario asociado.
- **FR-012**: El sistema MUST calificar el cuestionario al ser enviado y MUST persistir el resultado asociado al usuario.
- **FR-013**: El sistema MUST mantener trazabilidad histórica de versiones para cada artículo publicado.

**Progreso y perfil del usuario**

- **FR-014**: El sistema MUST mantener un indicador de progreso por usuario expresado en puntos acumulados. Los puntos aportados por cada cuestionario corresponden a la mejor calificación obtenida por el usuario en ese cuestionario; cuestionarios distintos contribuyen de forma aditiva al progreso total. Los reintentos de un mismo cuestionario son ilimitados y NO suman puntos adicionales por encima del mejor puntaje histórico del usuario en ese cuestionario.
- **FR-015**: El sistema MUST registrar el historial de artículos consumidos por usuario.
- **FR-016**: El sistema MUST registrar el historial completo de intentos de cuestionarios por usuario, persistiendo cada intento con su calificación y marca temporal incluso cuando no supere la mejor calificación previa del usuario en ese cuestionario.
- **FR-017**: El sistema MUST permitir al usuario consultar y editar su perfil y sus preferencias de uso.
- **FR-018**: El sistema MUST generar reportes estadísticos del progreso y actividad del usuario en la plataforma.

**Simuladores financieros**

- **FR-019**: El sistema MUST proveer cinco simuladores financieros: ahorro, crédito, presupuesto, inversión y calculadoras específicas del contexto financiero colombiano.
- **FR-020**: Los simuladores MUST aceptar parámetros financieros expresados en pesos colombianos (COP) como caso principal y MUST contemplar interacción con otros tipos de moneda cuando el escenario lo requiera.
- **FR-021**: Los simuladores MUST producir resultados con precisión decimal adecuada al dominio, sin pérdida por redondeo binario.
- **FR-022**: El sistema MUST persistir el historial de operaciones de simulación por usuario, incluyendo parámetros y resultados.

**Notificaciones**

- **FR-023**: El sistema MUST generar y entregar notificaciones a través de dos canales: (a) correo electrónico para eventos críticos de seguridad y de identidad — verificación de correo, cambio o restablecimiento de contraseña, alertas de seguridad; y (b) bandeja in-app dentro de la plataforma para eventos de actividad del usuario — artículos nuevos publicados, recordatorios, hitos de progreso, resultados de cuestionario. El usuario MUST poder consultar su bandeja in-app durante la sesión, visualizando estado de lectura y marca temporal de cada notificación. El MVP NO incluye SMS ni web push.
- **FR-024**: Las notificaciones MUST procesarse de forma asíncrona en ambos canales (email e in-app) sin bloquear ni degradar la experiencia del usuario, y MUST tolerar reintentos ante fallos transitorios del proveedor de email.

**Auditoría y compliance**

- **FR-025**: El sistema MUST registrar de forma inmutable y append-only todas las operaciones significativas (identidad, progreso, simulaciones, publicación de contenido).
- **FR-026**: El registro de auditoría MUST proveer trazabilidad suficiente para auditorías regulatorias en el contexto financiero colombiano.

**Coordinación distribuida**

- **FR-027**: El sistema MUST garantizar consistencia eventual en operaciones que involucren múltiples dominios (por ejemplo: calificar cuestionario → actualizar progreso → notificar → auditar), con mecanismos de compensación automática ante fallos parciales.

**Precisión monetaria (NON-NEGOTIABLE)**

- **FR-028**: Todos los valores monetarios, tasas de interés y porcentajes de cálculo financiero MUST representarse, calcularse, persistirse y transmitirse usando precisión decimal arbitraria. Queda PROHIBIDO el uso de tipos numéricos de punto flotante binario para representar dinero o tasas en cualquier capa del sistema.

**Privacidad y derechos del titular de datos (Ley 1581)**

- **FR-029**: El sistema MUST proveer al titular de datos personales (usuario), en cumplimiento de la Ley 1581 de 2012 (Hábeas Data), la capacidad de consultar dentro de la plataforma una vista completa de sus datos personales registrados (perfil, historial de cuestionarios, simulaciones, progreso) y de rectificar/actualizar su información personal de perfil.
- **FR-030**: El sistema MUST permitir al titular solicitar la eliminación de su cuenta con efecto de revocación de consentimiento. La operación MUST anonimizar los datos personales identificables del usuario en todas las bases operacionales (perfil, historial de cuestionarios, simulaciones, progreso) y MUST preservar el registro de auditoría con identificadores opacos que no permitan re-identificar al titular.
- **FR-031**: El registro de auditoría inmutable MUST conservarse por un período mínimo de cinco (5) años desde la fecha de la operación registrada. La exportación de datos personales en formato portable (data portability) NO se incluye en la versión inicial y se difiere a una versión posterior.

### Key Entities

- **Usuario**: persona registrada en la plataforma. Atributos clave: identificador, correo electrónico, estado de verificación, estado de cuenta (activa o anonimizada por revocación de consentimiento), preferencias, rol (usuario final, editor o coordinador editorial) y puntos acumulados de progreso.
- **Artículo Educativo**: contenido formativo gestionado por editores. Atributos clave: identificador, título, categoría, contenido, versión, estado de publicación, autor.
- **Cuestionario**: conjunto de preguntas asociado a un artículo. Atributos clave: identificador, artículo asociado, preguntas, criterios de calificación.
- **Resultado de Cuestionario**: registro de un intento individual de cuestionario por un usuario. Se admiten múltiples intentos del mismo usuario sobre el mismo cuestionario. Atributos clave: usuario, cuestionario, número de intento, calificación obtenida, fecha; el indicador de progreso considera únicamente el mejor puntaje histórico por usuario y cuestionario.
- **Progreso del Usuario**: estado agregado del avance del usuario. Atributos clave: usuario, puntos acumulados (suma del mejor puntaje obtenido en cada cuestionario distinto), métricas de actividad.
- **Simulación Financiera**: registro de una operación de calculadora ejecutada por un usuario. Atributos clave: usuario, tipo de calculadora, parámetros (en precisión decimal arbitraria), resultado, fecha.
- **Notificación**: mensaje dirigido a un usuario por un canal específico (email o in-app). Atributos clave: destinatario, canal, tipo, contenido, estado de entrega, estado de lectura (aplica al canal in-app) y marca temporal.
- **Registro de Auditoría**: entrada inmutable y append-only que documenta una operación significativa, retenida por un período mínimo de cinco (5) años. Atributos clave: actor (referenciable mediante identificador opaco para preservar trazabilidad tras una eventual anonimización del titular), operación, marca temporal, contexto y resultado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario nuevo puede completar registro, verificación de correo, inicio de sesión, lectura de un artículo y resolución de su cuestionario en menos de 15 minutos durante su primera visita.
- **SC-002**: Al menos el 80% de los usuarios que inician un cuestionario lo completan exitosamente dentro de la misma sesión.
- **SC-003**: El usuario puede consultar su progreso, su historial y los catálogos en menos de 1 segundo bajo condiciones normales de carga.
- **SC-004**: Los simuladores producen resultados con cero divergencias atribuibles a redondeo binario respecto a un cálculo decimal de referencia, incluyendo escenarios de borde (montos extremos, tasas atípicas, plazos largos).
- **SC-005**: La plataforma soporta al menos 1.000 usuarios concurrentes consumiendo contenido y ejecutando simulaciones manteniendo tiempos de respuesta percibidos por debajo de 2 segundos.
- **SC-006**: El 100% de las operaciones significativas (autenticación, cambios de perfil, publicación de contenido, ejecución de simulaciones, calificaciones) genera un registro auditable inmutable.
- **SC-007**: El 95% de las notificaciones — email para eventos de seguridad/identidad y bandeja in-app para eventos de actividad — están disponibles para el usuario en menos de 2 minutos desde el evento que las origina.
- **SC-008**: Las operaciones distribuidas (calificación → progreso → notificación → auditoría) presentan una tasa de inconsistencia residual menor al 0,1% gracias al mecanismo de compensación.
- **SC-009**: El catálogo de contenido educativo está organizado en al menos 5 categorías temáticas centrales del contexto financiero colombiano.
- **SC-010**: El 90% de los usuarios que completan al menos un cuestionario regresan a la plataforma dentro de los 30 días posteriores, evidenciando retención por el valor formativo y los simuladores.
- **SC-011**: Las solicitudes del titular de datos personales (consulta, rectificación, eliminación) se procesan dentro de los plazos establecidos por la Ley 1581 de 2012 (consulta de datos: ≤ 10 días hábiles; reclamos y solicitudes de supresión: ≤ 15 días hábiles).
- **SC-012**: La plataforma sostiene un objetivo de disponibilidad mensual del 99,9% en condiciones normales de operación, equivalente a un máximo de ≈43,8 minutos de indisponibilidad por mes (≈8,77 horas por año), excluyendo ventanas de mantenimiento planificado comunicadas con anticipación.

## Assumptions

- Los usuarios finales acceden desde un navegador web moderno con conexión estable; no se contempla aplicación móvil nativa en la versión inicial.
- El idioma principal del contenido y de la interfaz es español; no se contempla soporte multilingüe en la versión inicial.
- La moneda principal de los simuladores es el peso colombiano (COP); el soporte de otras monedas se limita a conversión o cálculos auxiliares cuando el escenario lo amerite.
- La autenticación se gestiona dentro del sistema; no se contempla, en la versión inicial, integración con proveedores externos de identidad (Google, Facebook, etc.).
- El acceso para usuarios finales es gratuito; no se gestionan suscripciones, pagos ni transacciones de dinero real entre el sistema y el usuario en la versión inicial.
- El público objetivo son personas mayores de edad; no se contempla un flujo dedicado a menores en la versión inicial.
- Los editores y coordinadores editoriales son perfiles internos pre-aprobados por la administración de la plataforma; no se contempla auto-postulación pública de autores ni de revisores en la versión inicial.
- El sistema NO procesa ni almacena información de cuentas bancarias reales, productos financieros activos o transacciones monetarias del usuario; los simuladores son herramientas educativas y los datos ingresados son referenciales.
- El cumplimiento regulatorio se enfoca en (a) trazabilidad y auditabilidad operacional con retención mínima de cinco (5) años dentro del contexto financiero colombiano, y (b) cumplimiento de la Ley 1581 de 2012 (Hábeas Data) para protección de datos personales — derechos de consulta, rectificación y supresión (revocación de consentimiento), con portabilidad diferida a una versión posterior. Las normas generales aplicables a servicios digitales educativos en Colombia complementan el marco.
- El objetivo de disponibilidad del 99,9% mensual asume despliegue sobre infraestructura con redundancia básica (réplicas de cómputo, balanceo de carga) y permite ventanas de mantenimiento planificado comunicadas con anticipación, las cuales NO computan contra el SLO.
