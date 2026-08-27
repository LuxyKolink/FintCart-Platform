# Feature Specification: Rediseño del Frontend contra el Design System

**Feature Branch**: `003-design-system-frontend`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "Rediseño del frontend Angular contra el design system de FintCart: migrar las diecinueve pantallas existentes a los cinco UI kits de `design/ui_kits/`, eliminando la deuda de estilo acumulada. Depende de la capa de componentes que entrega el feature 002: este feature NO vuelve a portar componentes, los CONSUME."

## Contexto: por qué existe este feature

El design system de FintCart (`design/`, commit `d71e5dd`) se autoró **después** de la
aplicación y **contra un repositorio que no tenía frontend** — su propio README lo dice. Se
escribió como referencia en un stack distinto y nunca se llevó a la aplicación real. El
resultado es un desfase que se puede medir:

| Capa | Design system | Aplicación hoy |
|------|---------------|----------------|
| Tokens de color, tipografía, espaciado, elevación | 6 archivos | ✅ **idénticos byte a byte**, ya en uso |
| Logotipos | 5 SVG | ✅ presentes, pero **duplicados en dos rutas** |
| Componentes de interfaz | 11, como referencia | ⚠️ **19 primitivas hechas a mano**, duplicado parcial de los que entrega el feature **002** |
| Composición de pantallas | 5 kits de referencia, 1.554 líneas | ❌ **19 pantallas ad-hoc con 94 estilos en línea** |

La aplicación **sí** consume los tokens: no está sin estilar. Lo que tiene es una capa de
primitivas artesanal —15 clases de formulario y aviso en un archivo de estilos propio,
comentado como "inspiradas en" los componentes del design system, más 4 primitivas de portal—
que cubre una fracción de los 11 componentes reales. Todo lo que esas 19 primitivas no
alcanzan a resolver se resolvió con **94 atributos de estilo escritos a mano** dentro de las
plantillas. Esa es la causa concreta y verificable de que la interfaz se perciba pobre y
desalineada respecto del diseño aprobado, y no una impresión subjetiva.

Dicho de otro modo: la capa de primitivas artesanal es un **duplicado parcial de la
biblioteca compartida que entrega el feature 002**. Retirarla es el final medible de este
feature.

**Este feature no rediseña nada nuevo**: lleva a la aplicación un diseño que ya existe,
está aprobado y está versionado en el repositorio.

## Relación con los features 001 y 002

- **001** entregó las 19 pantallas y toda la funcionalidad que sostienen. Este feature **no
  cambia ningún comportamiento** de 001: es exclusivamente de presentación.
- **002** entrega la biblioteca de componentes compartida y 8 pantallas nuevas ya construidas
  sobre ella. Este feature **consume** esa biblioteca y no vuelve a crearla.
- **Frontera explícita con 002**: 002 reescribe la superficie de redacción del editor de
  artículos. Este feature toca el **marco** que la rodea —cabecera, paneles laterales,
  estados de publicación— y **no** la superficie de redacción. Sin esa frontera, las dos
  ramas colisionan en el mismo componente.

Numeración continuada: FR-086 en adelante, SC-027 en adelante.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrada a la plataforma con identidad de marca (Priority: P1)

Como persona que llega por primera vez a FintCart, quiero que la pantalla de acceso me diga
qué es esta plataforma y transmita confianza, para decidir si me registro en lugar de
encontrarme un formulario anónimo que no explica nada.

**Why this priority**: es la primera pantalla que ve cualquier usuario y hoy es la más pobre
de las 19: un recuadro estrecho con dos campos, sin logotipo, sin propuesta de valor y sin
ninguna señal de marca. Es además el kit más pequeño, así que es la validación más barata de
que la biblioteca de componentes sirve para componer pantallas reales.

**Independent Test**: se puede probar por completo abriendo acceso, registro y verificación
de correo, y comparándolos con el kit de referencia. No depende de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** una persona no autenticada, **When** abre la pantalla de acceso, **Then** ve un
   panel de marca con el logotipo, la propuesta de valor de la plataforma y los indicadores
   de contenido disponible, junto al formulario.
2. **Given** la pantalla de acceso, **When** la persona la recorre, **Then** encuentra la
   opción de mantener la sesión iniciada, el enlace de recuperación de contraseña, el acceso
   federado y el enlace a registro, todos presentes y operativos.
3. **Given** una persona que se registra, **When** completa el formulario, **Then** ve el
   consentimiento de tratamiento de datos personales de forma explícita antes de enviar.
4. **Given** una persona que acaba de registrarse, **When** llega a la verificación de correo,
   **Then** puede introducir el código recibido y ve un estado de éxito claro que la conduce
   al catálogo.
5. **Given** cualquiera de las tres pantallas, **When** se inspecciona su marcado, **Then** no
   contiene ningún estilo escrito en línea.

---

### User Story 2 - El portal de aprendizaje (Priority: P1)

Como usuario que consume contenido, quiero que el catálogo, el lector, el cuestionario y mi
progreso se vean como el portal denso que define la marca, para abarcar mucho de un vistazo
en lugar de navegar entre cajas sueltas.

**Why this priority**: son las cinco pantallas donde el usuario pasa el tiempo y donde vive
el valor del producto. La estética de "portal denso" es la decisión de marca central, y es
justamente la que hoy no se aprecia en ninguna parte.

**Independent Test**: se puede probar recorriendo catálogo → artículo → cuestionario →
progreso → notificaciones y comparando con el kit, sin depender de las demás historias.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** abre el catálogo, **Then** ve un portal de tres
   zonas: categorías y progreso a un lado, artículo destacado y catálogo con pestañas al
   centro, y continuar/ranking/notificaciones al otro lado.
2. **Given** un usuario que abre un artículo, **When** lo lee, **Then** el texto se presenta
   en un ancho cómodo de lectura, con panel lateral de progreso y contenido relacionado.
3. **Given** un usuario que resuelve un cuestionario, **When** lo envía, **Then** ve su
   calificación presentada con los elementos visuales del sistema y la opción de reintentar.
4. **Given** un usuario que consulta su progreso, **When** abre la pantalla, **Then** ve sus
   puntos, estadísticas e historial con los mismos indicadores visuales que el resto del
   portal.
5. **Given** la bandeja de notificaciones, **When** el usuario la abre, **Then** distingue de
   un vistazo lo leído de lo no leído.

---

### User Story 3 - Los simuladores financieros (Priority: P2)

Como usuario que hace cálculos, quiero que las cinco calculadoras se presenten con las cifras
en pesos destacadas y legibles, para leer un resultado financiero sin esfuerzo.

**Why this priority**: es la funcionalidad diferencial del producto y la que más exige de la
presentación —cifras monetarias, unidades, comparaciones—, pero el usuario ya puede usarla
hoy, así que va después de acceso y aprendizaje.

**Independent Test**: se puede probar ejecutando una simulación de cada tipo y revisando
selector, formulario, resultado e historial.

**Acceptance Scenarios**:

1. **Given** un usuario en el módulo de simuladores, **When** abre la vista, **Then** ve las
   calculadoras disponibles en un riel y el formulario de la seleccionada junto a él.
2. **Given** un resultado de simulación, **When** se presenta, **Then** las cifras monetarias
   usan la tipografía de datos del sistema y se distinguen del texto corrido.
3. **Given** cualquier cifra monetaria o tasa mostrada, **When** se verifica su tratamiento,
   **Then** conserva la precisión decimal recibida sin ninguna conversión que pueda
   redondearla.
4. **Given** el historial de simulaciones, **When** el usuario lo consulta, **Then** puede
   comparar ejecuciones sin abrir cada una.

---

### User Story 4 - Perfil, privacidad y reportes (Priority: P2)

Como titular de mis datos, quiero que las pantallas de perfil, contraseña, reporte y
eliminación de cuenta se vean parte de la misma plataforma, para confiar en un trámite que
trata datos personales.

**Why this priority**: son pantallas de baja frecuencia pero de alta consecuencia —incluyen
la eliminación de cuenta bajo Ley 1581—, y una interfaz descuidada en un trámite legal resta
confianza justo donde más hace falta.

**Independent Test**: se puede probar recorriendo las cuatro pantallas y verificando el
tratamiento de las cifras del reporte.

**Acceptance Scenarios**:

1. **Given** un usuario en su perfil, **When** edita sus datos y preferencias, **Then** los
   controles son los mismos que en el resto de la plataforma.
2. **Given** la pantalla de eliminación de cuenta, **When** el usuario la abre, **Then** la
   consecuencia de la operación y su período de reversión se comunican de forma destacada e
   inequívoca, sin depender de un párrafo de texto corrido.
3. **Given** el reporte de actividad, **When** se presenta, **Then** las cifras usan la
   tipografía de datos y conservan su precisión decimal.

---

### User Story 5 - El marco del flujo editorial (Priority: P2)

Como editor o coordinador editorial, quiero que el entorno de trabajo editorial se vea como
una herramienta coherente, para moverme entre borradores, revisión y versiones sin fricción.

**Why this priority**: es uso interno y de menor volumen que el resto, pero es donde se
produce todo el contenido de la plataforma. Va después de las pantallas de usuario final.

**Depende de**: coordinación con el feature 002, que reescribe la superficie de redacción.

**Independent Test**: se puede probar recorriendo el listado de artículos por estado, la
bandeja de revisión y el historial de versiones, sin tocar la superficie de redacción.

**Acceptance Scenarios**:

1. **Given** un editor autenticado, **When** abre el entorno editorial, **Then** ve sus
   artículos agrupados por estado con distintivos visuales que los diferencian.
2. **Given** un coordinador editorial, **When** revisa un artículo enviado, **Then** el
   entorno le presenta la decisión de aprobar o rechazar de forma destacada.
3. **Given** un editor que intenta aprobar su propio artículo, **When** lo intenta, **Then**
   el entorno se lo comunica con un aviso claro y no con un error genérico.
4. **Given** el historial de versiones, **When** se consulta, **Then** cada versión muestra su
   estado, su autor y su fecha de forma consistente con el resto de la plataforma.
5. **Given** la pantalla del editor de artículos, **When** este feature la modifica, **Then**
   los cambios se limitan al marco que rodea la superficie de redacción.

---

### User Story 6 - Consistencia y accesibilidad verificables (Priority: P1)

Como responsable del producto, quiero que la coherencia visual y la accesibilidad queden
garantizadas por una verificación automática, para que la deuda de estilo no vuelva a
acumularse pantalla a pantalla como ocurrió la primera vez.

**Why this priority**: es lo que distingue este feature de un maquillaje temporal. Sin una
barrera automática, el siguiente cambio urgente reintroduce el primer estilo en línea y en
seis meses estamos igual. Es P1 aunque no sea visible para el usuario final.

**Independent Test**: se puede probar introduciendo deliberadamente un estilo en línea y un
control sin etiqueta, y comprobando que la verificación los rechaza.

**Acceptance Scenarios**:

1. **Given** la aplicación completa, **When** se inspecciona el marcado de sus pantallas,
   **Then** no queda ningún estilo escrito en línea.
2. **Given** un cambio que introduce un estilo en línea, **When** se somete a verificación,
   **Then** es rechazado antes de integrarse.
3. **Given** cualquier pantalla, **When** un usuario la recorre solo con teclado, **Then**
   alcanza todos los controles, y el que tiene el foco es siempre visible.
4. **Given** cualquier control de formulario, **When** se examina, **Then** tiene una etiqueta
   asociada que un lector de pantalla puede anunciar.
5. **Given** la aplicación, **When** se carga sin conectividad hacia servicios externos,
   **Then** se presenta completa y legible.

---

### Edge Cases

- ¿Cómo se comporta el portal de tres zonas cuando la ventana es demasiado estrecha para
  sostenerlas? Los kits solo definen anchos fijos y no responden a esta pregunta.
- ¿Qué ocurre con el catálogo cuando aún no hay artículos publicados, o con el progreso
  cuando el usuario no ha resuelto ningún cuestionario? Los kits se dibujaron con datos de
  demostración siempre presentes.
- ¿Cómo se presenta un título de artículo o de categoría mucho más largo que el del kit?
- ¿Cómo se presenta una cifra monetaria de magnitud inusual sin romper la maquetación ni
  perder dígitos?
- ¿Qué ve el usuario mientras una pantalla carga sus datos, y qué ve si la carga falla? Los
  kits no dibujan estados de carga ni de error.
- ¿Qué ocurre si el feature 002 y este modifican la misma pantalla editorial en paralelo?
- ¿Cómo se comporta la interfaz con el tamaño de fuente del navegador aumentado?

## Requirements *(mandatory)*

### Functional Requirements

#### Sistema visual común

- **FR-086**: Todas las pantallas de la aplicación MUST presentarse con el sistema visual
  común —tipografía, color, espaciado, elevación y componentes de interfaz—, de modo que el
  usuario perciba un único producto. Esto **incluye el marco de navegación común** que rodea a
  todas ellas: migrar las pantallas dejando el marco con la apariencia anterior produciría una
  inconsistencia visible en el 100 % de las vistas.
- **FR-087**: Las pantallas MUST componerse con los componentes de la biblioteca compartida.
  Este feature NO DEBE crear componentes propios dentro de una pantalla concreta: cuando una
  pantalla necesite uno que no exista, MUST añadirse a la biblioteca compartida para que
  quede disponible para las demás.
- **FR-088**: Ninguna plantilla de pantalla MUST contener estilos escritos en línea. Toda
  decisión visual MUST expresarse mediante un componente compartido o mediante estilos que
  consuman los valores del sistema.
- **FR-089**: El sistema MUST impedir automáticamente la reintroducción de estilos en línea,
  rechazando el cambio antes de que se integre.
- **FR-090**: Los recursos de marca MUST existir en una única ubicación; MUST eliminarse la
  duplicación actual sin romper ninguna referencia.
- **FR-091**: Los textos de la interfaz MUST seguir la voz de marca definida: español de
  Colombia, con tuteo directo.
- **FR-092**: La interfaz NO DEBE depender de servicios externos en tiempo de ejecución para
  presentar su tipografía ni su iconografía, en continuidad con FR-085.

#### Adaptabilidad a distintos tamaños de pantalla

- **FR-124**: La aplicación MUST presentarse de forma utilizable en pantallas de teléfono,
  tableta y escritorio, con un ancho mínimo soportado de 360 px.
- **FR-125**: Los puntos de corte entre tamaños MUST declararse **una sola vez** como parte del
  sistema visual común, y NO DEBE fijarlos cada pantalla por su cuenta.
- **FR-126**: Al reducirse el ancho disponible, cada disposición MUST degradar de forma
  declarada y predecible: el contenido principal **nunca** se sacrifica, y lo accesorio colapsa
  antes que lo esencial.
- **FR-127**: La página NO DEBE desplazarse horizontalmente en ningún tamaño. El contenido que
  no quepa —tablas, series de datos— MUST desplazarse dentro de su propio contenedor.

#### Accesibilidad

- **FR-093**: Toda pantalla MUST ser recorrible por completo con teclado, alcanzando todos sus
  controles interactivos en un orden coherente con su disposición visual.
- **FR-094**: El control que tiene el foco MUST señalarse siempre de forma visible.
- **FR-095**: Todo control de formulario MUST tener una etiqueta asociada que un lector de
  pantalla pueda anunciar.
- **FR-096**: El contraste entre texto y fondo MUST cumplir el nivel AA de las pautas de
  accesibilidad para contenido web.
- **FR-097**: La interfaz MUST seguir siendo utilizable con el tamaño de fuente del navegador
  aumentado, sin pérdida de contenido ni de funcionalidad.

#### Acceso a la plataforma

- **FR-098**: Las pantallas de acceso, registro y verificación de correo MUST presentar la
  identidad de marca junto al formulario: logotipo, propuesta de valor y los indicadores de
  contenido disponible.
- **FR-099**: La pantalla de acceso MUST ofrecer, además de las credenciales, la opción de
  mantener la sesión iniciada, la recuperación de contraseña, el acceso federado y el enlace a
  registro.
- **FR-100**: El registro MUST presentar de forma explícita el consentimiento de tratamiento
  de datos personales antes del envío.
- **FR-101**: La verificación de correo MUST presentar la introducción del código y un estado
  de éxito que conduzca al catálogo.

#### Portal de aprendizaje

- **FR-102**: El catálogo MUST presentarse como un portal de tres zonas: navegación por
  categorías y progreso, contenido destacado y catálogo con pestañas, y accesos de
  continuación, ranking y notificaciones.
- **FR-103**: El lector de artículos MUST presentar el texto en un ancho cómodo de lectura,
  con acceso lateral al progreso y al contenido relacionado.
- **FR-104**: El cuestionario MUST presentar su calificación y la opción de reintentar con los
  elementos visuales del sistema.
- **FR-105**: La pantalla de progreso MUST presentar puntos, estadísticas e historial con los
  mismos indicadores visuales que el resto del portal.
- **FR-106**: La bandeja de notificaciones MUST distinguir visualmente lo leído de lo no
  leído.

#### Simuladores

- **FR-107**: El módulo de simuladores MUST presentar las calculadoras disponibles en un riel
  junto al formulario de la seleccionada.
- **FR-108**: Las cifras monetarias y las tasas MUST presentarse con la tipografía de datos
  del sistema, distinguibles del texto corrido.
- **FR-109**: La presentación de cifras monetarias y tasas NO DEBE aplicar ninguna conversión
  que pueda alterar su precisión decimal, conforme a FR-028.
- **FR-110**: El historial de simulaciones MUST permitir comparar ejecuciones sin abrir cada
  una.

#### Perfil y datos personales

- **FR-111**: Las pantallas de perfil, cambio de contraseña, reporte de actividad y
  eliminación de cuenta MUST usar los mismos controles que el resto de la plataforma.
- **FR-112**: La pantalla de eliminación de cuenta MUST comunicar de forma destacada e
  inequívoca la consecuencia de la operación y su período de reversión, sin depender de texto
  corrido.
- **FR-113**: Las cifras del reporte de actividad MUST presentarse con la tipografía de datos
  y conservar su precisión decimal.

#### Entorno editorial

- **FR-114**: El entorno editorial MUST presentar los artículos agrupados por estado con
  distintivos visuales que los diferencien.
- **FR-115**: La bandeja de revisión MUST presentar de forma destacada la decisión de aprobar
  o rechazar.
- **FR-116**: Cuando un editor intente aprobar su propio contenido, el entorno MUST
  comunicárselo con un aviso comprensible y no con un error genérico, preservando la regla de
  FR-008.
- **FR-117**: El historial de versiones MUST presentar estado, autor y fecha de cada versión de
  forma consistente con el resto de la plataforma.

#### Estados de contenido

- **FR-118**: Toda pantalla que dependa de datos MUST presentar un estado de carga y un estado
  de error comprensible, y no una pantalla en blanco.
- **FR-119**: Toda pantalla que liste contenido MUST presentar un estado vacío con sentido
  cuando aún no hay nada que mostrar.
- **FR-120**: La presentación MUST tolerar textos y cifras más largos que los de referencia sin
  romper la maquetación ni ocultar información.

#### Alcance y frontera

- **FR-121**: Este feature NO DEBE alterar ningún comportamiento funcional existente: es
  exclusivamente de presentación. NO DEBE modificar contratos de interfaz, reglas de negocio ni
  almacenamiento.
- **FR-122**: Si una pantalla necesitara un dato que la plataforma no expone hoy, la carencia
  MUST reportarse como hallazgo y NO DEBE resolverse dentro de este feature.
- **FR-123**: Los cambios sobre la pantalla del editor de artículos MUST limitarse al marco que
  rodea la superficie de redacción, cuya reescritura pertenece al feature 002.

### Key Entities

Este feature no introduce ni modifica ninguna entidad de datos. Es exclusivamente de
presentación (FR-121).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-027**: Cero estilos escritos en línea en las plantillas de pantalla, frente a los 94
  actuales; y un intento de reintroducir uno es rechazado automáticamente.
- **SC-028**: Las 19 pantallas existentes se presentan con el sistema visual común; una
  persona que recorra la aplicación no encuentra ninguna que desentone.
- **SC-029**: Un usuario que llega por primera vez identifica, sin desplazarse, qué ofrece la
  plataforma antes de introducir sus credenciales.
- **SC-030**: Las 19 pantallas son recorribles por completo solo con teclado, con el foco
  siempre visible.
- **SC-031**: El 100 % de los controles de formulario tiene una etiqueta asociada anunciable
  por lector de pantalla.
- **SC-032**: Todo el texto de la interfaz cumple el contraste AA frente a su fondo.
- **SC-033**: La aplicación se presenta completa y legible con la conectividad hacia servicios
  externos deshabilitada.
- **SC-034**: Toda pantalla que dependa de datos presenta estado de carga, de error y de vacío;
  ninguna queda en blanco ante un fallo o ante la ausencia de contenido.
- **SC-035**: Ninguna cifra monetaria mostrada difiere de la que entrega la plataforma, ni
  siquiera en el último decimal.
- **SC-036**: Ningún comportamiento funcional cambia: la batería de pruebas de extremo a
  extremo heredada sigue pasando sin modificar sus aserciones de comportamiento.
- **SC-037**: Los recursos de marca existen en una sola ubicación y ninguna referencia queda
  rota.
- **SC-038**: Todas las pantallas y el marco de navegación son utilizables a 360 px de ancho:
  ningún contenido queda inalcanzable y la página no se desplaza horizontalmente en ningún
  tamaño.
- **SC-039**: Los puntos de corte están declarados una sola vez en el sistema visual común;
  ninguna pantalla fija anchos por su cuenta.

## Assumptions

- La biblioteca de componentes compartida que entrega el feature 002 está disponible antes de
  empezar. Este feature la consume y no la construye (FR-087).
- La landing de marketing **queda fuera de alcance**: este feature migra las 19 pantallas
  existentes, y la landing sería una pantalla pública nueva que hoy no existe, con su propio
  contenido y su propia decisión de producto. Se difiere a un feature posterior. Es la
  suposición más fácil de revertir de este documento si el criterio es el contrario.
- Los kits de referencia son autoridad **visual**, nunca de comportamiento. Su propia
  documentación advierte que sus simuladores calculan en el cliente, mientras que en la
  plataforma real el cálculo y la precisión decimal son responsabilidad del backend.
- Los kits se dibujaron a anchos fijos y con datos de demostración siempre presentes. Los
  estados de carga, error, vacío y desbordamiento (FR-118…FR-120) no aparecen en ellos y se
  derivan del comportamiento real de la plataforma.
- El conjunto de iconos actual es una sustitución elegida por el design system, no una marca
  de FintCart. Si aparece un set propio, el cambio se localiza en la biblioteca compartida.
- Los tokens visuales ya están en la aplicación y son idénticos a los del design system: no
  forman parte del trabajo.
- Se conserva la estructura de navegación y las rutas actuales: este feature cambia cómo se ve
  cada pantalla, no dónde vive.

## Dependencies

- **Feature 002**, capa de componentes compartida: prerrequisito duro de todas las historias.
- **Feature 002**, superficie de redacción del editor: prerrequisito de coordinación para la
  historia 5, para no colisionar sobre la misma pantalla (FR-123).
- **Feature 001**: la funcionalidad que estas pantallas presentan ya existe y no se toca.
- El design system versionado en `design/`: tokens, guías, componentes de referencia y los
  cinco kits.

## Decisiones Diferidas a la Fase de Planeación

Se resuelven en `/speckit-plan` con su investigación. Se listan para que no se den por
resueltas:

1. **Comportamiento responsive de cada disposición**: los kits definen anchos fijos —920 px el
   de acceso, 1440 px el portal de tres zonas— y no dicen qué ocurre al estrechar la ventana.
   Hay que decidir, disposición por disposición, qué se reordena, qué se colapsa y qué se
   oculta, y hasta qué ancho mínimo se da soporte.

   → **Resuelta (research D-27)**: cuatro puntos de corte como tokens del sistema (480 / 768 /
   1024 / 1280), mínimo 360 px, y una regla de degradación declarada por disposición. Los
   requisitos que gobiernan esa decisión son **FR-124…FR-127**, añadidos tras la revisión de
   consistencia: la decisión existía en la investigación pero no tenía requisito que la
   exigiera ni criterio que la declarara cumplida.
2. **Estrategia de migración**: pantalla por pantalla frente a un corte único. La tensión es
   real: el feature 002 estará modificando el mismo frontend en paralelo, y una migración
   larga convive con dos estéticas simultáneas mientras dura.
3. **Alcance de la landing de marketing**: este documento la deja fuera (ver Assumptions). Si
   entra, es una pantalla nueva con contenido propio y no una migración, y merece su propio
   conjunto de requisitos.
