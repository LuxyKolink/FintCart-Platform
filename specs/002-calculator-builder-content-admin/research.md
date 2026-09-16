# Phase 0 — Research: Constructor de Calculadoras, Cuestionarios Randomizados y Administración de Contenido

**Feature**: `002-calculator-builder-content-admin` | **Fecha**: 2026-08-26

**Entrada**: [spec.md](./spec.md) §"Decisiones Diferidas a la Fase de Planeación" + Constitución v1.1.1

La numeración de decisiones continúa la de `001-fintcart-platform`, que terminó en D-12.
Toda decisión aquí queda subordinada a los Principios I–XII; donde una alternativa habría
exigido enmienda constitucional, se dice explícitamente.

---

## D-13 — Almacenamiento de las imágenes de artículos

**Decisión**: las imágenes se guardan como `BYTEA` en `learning_db`, en una tabla
`article_images` propiedad del Servicio de Aprendizaje, con `STORAGE EXTERNAL` y un tope
duro de **2 MB por imagen**. Se sirven por el Gateway como recurso REST con caché
inmutable; el identificador de cada imagen es el **hash SHA-256 de su contenido**
(direccionamiento por contenido).

**Justificación**:

1. **Sin infraestructura nueva**: el despliegue del CTIC son dos VPS de **4 GB RAM / 2
   vCPU** (`deploy/vps/README.md:3`) que ya sostienen 7 PostgreSQL, Redis, RabbitMQ, 8
   servicios, el frontend y Caddy, y que necesitan 2 GB de swap solo para construir las
   imágenes. Añadir un almacén de objetos es un contenedor más, un volumen más, un juego
   de credenciales más y una segunda ruta de respaldo, sobre una caja que ya está al
   límite. Además exigiría **enmienda formal a la constitución** (§Infraestructura no
   contempla almacenamiento de objetos).
2. **El respaldo ya está resuelto**: `pg_dump` de `learning_db` se lleva las imágenes sin
   que nadie tenga que acordarse. Con un almacén externo, un respaldo de la base sin el
   respaldo del bucket produce artículos rotos, que es el peor modo de fallo posible para
   una copia de seguridad.
3. **El volumen es acotado y curado**: son ilustraciones de artículos escritas por
   editores, no contenido subido por usuarios finales a escala. Con 2 MB de tope y un
   catálogo del orden de cientos de artículos, el crecimiento es de unos pocos GB sobre
   80 GB de disco.
4. **TOAST hace el trabajo**: PostgreSQL mueve fuera de línea todo valor > 2 KB.
   `STORAGE EXTERNAL` evita además intentar comprimir bytes que ya vienen comprimidos
   (JPEG/PNG/WebP), que solo gastaría CPU.
5. **El versionado sale gratis**: al ser el identificador el hash del contenido, las filas
   de imagen son **inmutables** y se comparten entre versiones de artículo. Cada versión
   referencia los hashes que usaba, y FR-067 (cada versión conserva sus imágenes) se
   cumple sin duplicar un solo byte.

**Alternativas consideradas**:

- **MinIO / almacén compatible S3**: es la respuesta correcta a escala y la que se
  elegiría con volumen de usuario. Rechazada por el coste de infraestructura sobre 4 GB de
  RAM, por la segunda ruta de respaldo y por exigir enmienda constitucional para un
  beneficio que este volumen no justifica. **Es la salida natural si el catálogo crece o
  si se añade video**: la interfaz de Aprendizaje (`UploadImage`/`GetImage`) se diseña de
  modo que sustituir la implementación de `storer` no toque ni el dominio ni el contrato.
- **Volumen de sistema de archivos montado en el contenedor**: rechazada porque rompe el
  Principio X — un volumen local no se comparte entre réplicas y ataría el servicio a un
  nodo, incompatible con el escalamiento horizontal en Kubernetes de §Infraestructura.
- **Data URI incrustado en el cuerpo del artículo**: rechazada; infla el documento,
  impide cachear la imagen por separado y multiplica el peso de cada versión.

**Riesgo aceptado**: la base de datos crece con el contenido binario y no hay CDN. Se
mitiga con el tope de 2 MB, validación de tipo, y cabeceras `Cache-Control: immutable` en
el Gateway, que son correctas justamente porque el identificador es el hash del contenido.

---

## D-14 — Representación del cuerpo enriquecido del artículo

**Decisión**: el cuerpo deja de ser `TEXT` plano y pasa a ser un **documento de bloques en
`JSONB`** (`article_versions.body_doc`), con un vocabulario **cerrado** de nodos y marcas
validado en el servidor al guardar. NO se persiste HTML.

Vocabulario inicial:

| Nodo | Atributos |
|------|-----------|
| `doc` | — (raíz) |
| `parrafo` | — |
| `encabezado` | `nivel` (2–4) |
| `lista` | `ordenada` (bool) |
| `item_lista` | — |
| `texto` | `texto`, `marcas[]` |
| `imagen` | `image_id` (hash), `alt` (obligatorio), `pie` (opcional) |
| `calculadora` | `calculator_id`, `version` |

Marcas admitidas: `negrita`, `cursiva`, `enlace(href)`. Nada más.

**Justificación**:

1. **FR-068 se cumple estructuralmente, no por librería**: con un árbol de bloques, el
   frontend renderiza **componentes Angular** por tipo de nodo y **nunca invoca
   `innerHTML` ni `bypassSecurityTrust*`**. No hay superficie de inyección que sanear
   porque no hay HTML en ningún punto del recorrido. Con HTML saneado, en cambio, la
   seguridad depende de configurar correctamente un saneador y de que nadie más adelante
   añada un `[innerHTML]` "solo para esta vista".
2. **Validación positiva en lugar de limpieza**: al guardar, Aprendizaje rechaza cualquier
   nodo, atributo o marca fuera de la lista. Es un modelo *deny-by-default*, que es
   sustancialmente más fuerte que restregar HTML arbitrario buscando lo peligroso.
3. **Los bloques incrustados son ciudadanos de primera**: `imagen` y `calculadora` son
   nodos con atributos tipados. En HTML serían etiquetas a medida que el saneador tendría
   que admitir — precisamente la configuración más difícil de acertar.
4. **Integridad referencial verificable**: recorrer el árbol al guardar permite extraer los
   `image_id` y `calculator_id` referenciados y validarlos (FR-070: la calculadora debe
   estar publicada; FR-066: la imagen debe existir y cumplir el tope). Extraer referencias
   de una cadena de HTML sería frágil.
5. **`href` sigue siendo superficie de ataque**: la marca `enlace` valida el esquema y
   admite únicamente `http`, `https` y `mailto`. `javascript:` y `data:` se rechazan al
   guardar.

**Alternativas consideradas**:

- **HTML saneado en el servidor**: rechazada por lo anterior. Su única ventaja real —
  portabilidad del contenido a otros sistemas — se cubre serializando el documento de
  bloques a HTML en el punto de exportación, si algún día hace falta.
- **Markdown**: rechazada; FR-063 exige formato visual sin que el editor conozca ningún
  lenguaje de marcado, y Markdown no tiene forma nativa de expresar el bloque de
  calculadora sin volver a introducir HTML incrustado.

**Migración (FR-069)**: cada `body` existente se envuelve en
`{"tipo":"doc","contenido":[{"tipo":"parrafo","contenido":[{"tipo":"texto","texto": <línea>}]} …]}`,
partiendo por líneas en blanco. Es sin pérdida y reversible. `body` se conserva durante una
migración y se elimina en una segunda, ya verificado el resultado.

---

## D-15 — Lenguaje de fórmulas: gramática cerrada, AST validado y persistido

**Decisión**: el autor escribe la fórmula como **expresión de texto**; el Simulador la
**analiza al guardar** y persiste el **AST validado en `JSONB`**. La evaluación recorre el
AST. NUNCA se analiza texto en tiempo de ejecución y NUNCA se ejecuta código.

**Gramática**:

- **Literales**: decimales canónicos (`string` → `Decimal`).
- **Variables**: claves de campos de entrada de la propia calculadora.
- **Indicadores**: `@NOMBRE` (por ejemplo `@UVT`, `@SMMLV`). El prefijo `@` los separa del
  espacio de nombres de los campos del autor, de modo que añadir un indicador nuevo nunca
  puede romper una calculadora existente.
- **Aritmética**: `+`, `-`, `*`, `/`, negación unaria.
- **Comparación**: `<`, `<=`, `>`, `>=`, `==`, `!=`.
- **Lógica**: `y`, `o`, `no`.
- **Condicional**: `si(cond, entonces, si_no)`.
- **Funciones**:

  | Función | Semántica |
  |---------|-----------|
  | `pot(base, n)` | `base^n` con **n entero**; multiplicación repetida EXACTA |
  | `potd(base, x)` | `base^x` con exponente decimal; **aproximada**, ver D-16 |
  | `redondear(x, escala)` | half-even a la escala indicada |
  | `redondear_dinero(x)` | half-even a la escala monetaria del dominio |
  | `min`, `max`, `abs` | usuales |
  | `cuota(capital, i, n)` | cuota nivelada de amortización francesa |
  | `vf_serie(aporte, i, n)` | valor futuro de serie de aportes iguales |
  | `tasa_periodica(anual, m)` | división nominal `anual / m` |
  | `presente(campo)` | verdadero si un campo opcional fue suministrado |

- **PROHIBIDO**: bucles, recursión, funciones definidas por el usuario, acceso a estado
  externo, cadenas de texto como valor.

**Límites** (FR-046): ≤ 20 campos de entrada, ≤ 10 salidas, ≤ 64 nodos de AST por fórmula,
profundidad ≤ 16. Se verifican al guardar; el AST persistido ya está dentro de límites, de
modo que la evaluación tiene coste acotado por construcción.

**Justificación**: analizar al guardar y evaluar un AST cerrado da las tres propiedades que
FR-046/FR-047 piden a la vez — errores en el momento de guardar y no de ejecutar, coste
acotado sin necesidad de un vigilante de tiempo de ejecución, y ausencia total de ejecución
de código. Persistir el AST y no el texto evita además que un cambio futuro del analizador
reinterprete en silencio una fórmula ya publicada.

**Nota de diseño**: `pot` y `potd` son **funciones distintas a propósito**. Ver D-16: es la
distinción de la que depende la exactitud de las calculadoras por defecto.

**Validación declarativa aparte de las fórmulas**: las guardas de dominio de las
calculadoras actuales ("el ingreso mensual debe ser mayor que cero",
`presupuesto.rs:50`) NO se expresan dentro de las fórmulas. La definición lleva una lista
`validaciones: [{expresion, mensaje}]` evaluada antes que las salidas. Así el mensaje de
error es del autor y no un genérico de división por cero, que es exactamente lo que
distingue las calculadoras actuales de una hoja de cálculo.

**Salidas condicionales**: cada salida puede declarar un `cuando` opcional. Es necesario:
`inversion` emite `valor_futuro_real` únicamente si se suministró `inflacion_anual`
(`inversion.rs:78`), y devolverlo siempre con inflación cero implícita sugeriría que se
descontó algo cuando no se descontó nada.

---

## D-16 — Reproducibilidad de las cinco calculadoras por defecto sobre el motor

**Decisión**: **son reproducibles**. Las cinco calculadoras de FR-019 se siembran como
**siete definiciones**: `ahorro`, `credito`, `presupuesto`, `inversion`, y las tres
operaciones colombianas separadas — `ea_a_mv`, `mv_a_ea`, `gmf`.

**Hallazgos que sustentan la decisión** (inspección del código vigente):

1. **Todas las salidas son escalares**: `Outcome = Vec<(&'static str, Decimal)>`
   (`calculators/mod.rs:38`). Ninguna calculadora produce una tabla de amortización ni una
   serie. Un motor de expresiones escalares basta.
2. **No hay entradas de longitud variable**: `presupuesto` toma tres montos fijos, no una
   lista de rubros. El lenguaje no necesita agregación sobre colecciones.
3. **`rust_decimal` ya viene con la característica `maths`** (`Cargo.toml:31`) y el código
   vigente **ya usa `checked_powd`** para la raíz duodécima de
   `effective_to_nominal` (`colombia.rs:102`) y **`checked_powu`** para el factor de
   capitalización de las anualidades (`annuity.rs:26`). La distinción exacto/aproximado que
   el motor necesita **ya existe y está deliberada** en el código, con su justificación
   escrita: elevar a entero es multiplicación repetida exacta, mientras que la potencia de
   exponente decimal pasa por funciones trascendentes y en 240 meses la diferencia "llega a
   los pesos".
4. **El discriminador de texto desaparece**: `colombia::compute` despacha sobre
   `inputs.text("operacion")` (`colombia.rs:62`). Separarla en tres definiciones elimina la
   única entrada de tipo texto del sistema y deja el lenguaje **puramente numérico**, que es
   una simplificación real y no cosmética.
5. **El GMF necesita condicional y un indicador**: el tramo exento son 350 UVT
   (`colombia.rs:53`). Con `si(...)` y `@UVT` queda expresado, y además deja de estar la
   UVT cableada en una constante — que es justo lo que pide FR-057.

**Consecuencia sobre FR-049**: el riesgo señalado en el spec **queda cerrado y no requiere
renegociación**. La condición para que se mantenga cerrado es que el motor exponga `pot`
(entero, exacto) y `potd` (decimal, aproximada) como funciones separadas y que las
definiciones semilla usen exactamente la misma que usa hoy el código nativo. Se verifica con
las pruebas de regresión de SC-015, que comparan resultado a resultado contra los valores
actuales.

**Consecuencia sobre FR-019**: las "calculadoras específicas del contexto colombiano" del
quinto grupo pasan de una entrada de menú con un selector interno a tres calculadoras
nombradas. Es coherente con la redacción plural de FR-019 y mejora la experiencia; se
registra aquí para que no se lea como una desviación del alcance.

---

## D-17 — Sesión de cuestionario: dónde vive y cómo caduca

**Decisión**: tabla `quiz_sessions` en `learning_db`, propiedad del Servicio de
Aprendizaje. Vigencia de **60 minutos**. La sesión guarda el orden de preguntas y el orden
de opciones servido. Las sesiones vencidas se eliminan en el mismo barrido periódico que ya
recorre Aprendizaje.

**Justificación**: **Redis no es una opción** — el Principio IV lo acota a la blacklist de
JWT y al rate limiting del Gateway, y un almacén de sesiones de negocio está PROHIBIDO
explícitamente. Tampoco puede vivir en el cliente: si el navegador declarara qué preguntas
le sirvieron, FR-040 sería incumplible, porque el propio cliente elegiría a qué responde. La
sesión es estado de dominio de Aprendizaje y vive en su base.

**Alternativa considerada**: derivar el subconjunto de forma determinista de
`(user_id, quiz_id, attempt_no)` con una función pseudoaleatoria, sin persistir nada.
Rechazada: no permite invalidar por vencimiento, y cualquier cambio del banco de preguntas
haría irreproducible el subconjunto de un intento ya calificado, incumpliendo FR-039.

---

## D-18 — Normalización de la calificación y compatibilidad con el historial existente

**Decisión**: `score` pasa a ser un porcentaje sobre 100
(`100 × peso_acertado / peso_servido`) y `pass_threshold` pasa a interpretarse como
porcentaje. Los intentos y umbrales anteriores se **convierten en la migración**.

**Detalle de la migración** — es el punto de mayor riesgo silencioso de este feature:

1. Hoy `score` es la **suma absoluta de pesos acertados** y `pass_threshold` un valor
   absoluto comparable con ella (`init_learning.up.sql`, ambos `NUMERIC(6,2)`).
2. Antes de esta enmienda **todo intento servía todas las preguntas**, así que para cada
   cuestionario `peso_servido ≡ Σ weight` de sus preguntas.
3. La migración calcula `Σ weight` por cuestionario y reescribe
   `score := 100 × score / Σ weight` y `pass_threshold := 100 × pass_threshold / Σ weight`.
4. **Salvedad honesta**: la conversión es exacta solo si el banco de preguntas del
   cuestionario no cambió desde el intento. Si un editor añadió o quitó preguntas, la
   conversión usa el peso total de hoy y es una aproximación. No hay forma de hacerlo mejor:
   el peso servido histórico no se registró porque hasta ahora no existía el concepto. Se
   documenta en la migración y se emite un aviso con el número de cuestionarios cuyo banco
   cambió después de su primer intento.
5. `Σ weight = 0` es imposible: `questions_weight_positive` obliga a `weight > 0`.

**Efecto sobre FR-014**: el mejor puntaje histórico se recalcula sobre la escala nueva de
forma consistente para todos los intentos de un mismo cuestionario, de modo que el orden
relativo entre intentos de un usuario se preserva.

---

## D-19 — Catálogo de categorías y migración desde texto libre

**Decisión**: tabla `categories` en `learning_db`; `articles.category TEXT` se sustituye
por `articles.category_id UUID NOT NULL REFERENCES categories(id)`. Desactivación lógica
(`active BOOLEAN`), nunca borrado físico.

**Migración**: se recorren los valores distintos de `articles.category`, se normalizan
(recorte, colapso de espacios, comparación sin distinguir mayúsculas ni tildes) y se crea una
categoría por valor normalizado, conservando el original como nombre visible. Se completa
hasta el mínimo de cinco categorías temáticas de SC-009 si el catálogo real trajera menos.
Ningún artículo queda sin categoría: la restricción `NOT NULL` se añade **después** de
poblar la columna, en la misma migración.

**Justificación de la desactivación lógica**: FR-013 exige trazabilidad histórica de
versiones. Un artículo archivado cuya categoría desapareciera físicamente dejaría de ser
reconstruible. `ON DELETE` nunca se ejerce porque no hay borrado.

---

## D-20 — Vencimiento del período de gracia: quién lo ejecuta

**Decisión**: Usuarios posee el estado y la fecha de vencimiento
(`account_status = 'pending_deletion'`, `purge_due_at`). El **Orquestador** ejecuta un
barrido periódico que invoca `Users.ListAccountsDueForPurge` por gRPC y lanza, por cada
cuenta devuelta, la **saga de anonimización que ya existe** (FR-030).

**Justificación**: la saga de anonimización ya es competencia del Orquestador (Principio
VI), y decidir *cuándo* corre es secuenciación, no lógica de dominio. La pregunta "¿qué
cuentas están vencidas?" sí es dominio de Usuarios y por eso se responde con una llamada
gRPC a Usuarios, no leyendo su base (Principio III).

**Reserva del correo (FR-076)**: el índice único parcial
`profiles_email_active_uniq ... WHERE account_status = 'active'`
(`init_users.up.sql:32`) se amplía a
`WHERE account_status IN ('active','pending_deletion')`. Sin esa ampliación, un tercero
podría registrar el correo durante la gracia y la reactivación prometida por FR-074
fracasaría con una violación de índice. Consumada la anonimización, el correo pasa a
`<uuid>@anonimizado.fintcart.invalid` y sale del índice por sí solo: no hace falta ninguna
liberación explícita.

**FR-077 (sin oráculo de pertenencia)**: NO se conserva hash ni transformación alguna del
correo original. Un hash de una dirección de correo es un **oráculo de pertenencia**: como
el espacio de direcciones es enumerable y de baja entropía, cualquiera con acceso a la
tabla podría comprobar si una persona concreta tuvo cuenta, reintroduciendo exactamente la
re-identificación que la anonimización destruye.

---

## D-21 — Rol `administrador`: propagación y arranque

**Decisión**: se añade `'administrador'` al CHECK de `roles_assignment`, a los claims de rol
del JWT y a un middleware de autorización del Gateway. El primer administrador se crea
mediante la variable de entorno `BOOTSTRAP_ADMIN_EMAIL`, que Usuarios aplica de forma
**idempotente** al arrancar.

**Justificación**: la verificación de rol es middleware explícito de la capa de transporte
por mandato del Principio VII; no se dispersa en la lógica de negocio. El arranque por
variable de entorno respeta el Principio X y evita sembrar un usuario privilegiado en una
migración versionada, donde quedaría escrito en el repositorio.

**FR-082**: `administrador` NO hereda las atribuciones de `coordinador_editorial`. La
aprobación de contenido y de calculadoras sigue exigiendo coordinador editorial, y la
separación autor≠aprobador de FR-008/FR-053 se mantiene intacta.

---

## D-22 — Indicadores anuales: propiedad, resolución y snapshot

**Decisión**: tabla `financial_indicators` en `simulator_db`, propiedad del Simulador.
Resolución del valor vigente por fecha de ejecución. Cada simulación guarda un **snapshot**
de los indicadores que usó, en su propia columna `JSONB`.

**Justificación de la propiedad**: el único consumidor del valor es la evaluación de
fórmulas, que ocurre en el Simulador. Ponerlos en otro servicio obligaría a una llamada
gRPC por cada evaluación de fórmula, en la ruta caliente del cálculo.

**Justificación del snapshot (FR-058)**: sin él, reabrir una simulación de 2026 después de
cargar los indicadores de 2027 mostraría un resultado que ya no se puede explicar a partir
de los datos vigentes. Guardar los valores usados es lo que hace el historial auditable, y
es el mismo motivo por el que la simulación guarda también la versión de la definición de la
calculadora (FR-050).

**Solapamiento (FR-059)**: se impone con una restricción de exclusión de PostgreSQL sobre
`(nombre, rango_de_vigencia)` usando `daterange` y `EXCLUDE USING gist`. Es una restricción
de la base y no una comprobación de la aplicación, porque dos administradores concurrentes
son un caso real (Edge Cases).

---

## D-23 — Alerta del procedimiento anual: quién publica el evento

**Decisión**: el **Orquestador** publica el evento de aviso de vencimiento de indicadores,
tras consultar por gRPC el estado del calendario al Simulador en el mismo barrido periódico
de D-20. Notificación lo consume y envía el correo al administrador.

**Justificación**: el Simulador **no es productor de RabbitMQ** — Principio V lo restringe a
Usuarios, Aprendizaje, Orquestador y Autenticación. Es exactamente el mismo patrón que ya
resolvió D-03 para la auditoría de simulaciones, y mantenerlo evita convertir al Simulador
en productor solo por esta alerta.

---

## D-24 — Editor enriquecido en Angular

**Decisión**: **TipTap** (núcleo headless sobre ProseMirror) con dos nodos a medida,
`imagen` y `calculadora`, y el conjunto de marcas restringido al vocabulario de D-14. El
documento se persiste tal cual como el `JSONB` de D-14.

**Justificación**: el modelo de documento de ProseMirror **es** un árbol de bloques con
esquema declarado, que es exactamente la forma que D-14 necesita — no hay conversión entre
el modelo del editor y el modelo persistido, y por tanto no hay una capa de traducción donde
se pierdan atributos. Su esquema declarativo permite además que el nodo `calculadora` sea un
bloque atómico con vista propia.

**Alternativa considerada**: **Quill**. Rechazada porque su modelo Delta es una lista de
operaciones sobre texto, no un árbol de bloques: los nodos incrustados encajan peor y habría
que traducir Delta ↔ documento de bloques en ambos sentidos.

**Regla innegociable**: el esquema del cliente **no es la validación**. Aprendizaje valida
el documento recibido contra el vocabulario cerrado de D-14 antes de guardarlo, y rechaza
cualquier nodo, atributo, marca o esquema de enlace no admitido. Un editor manipulado no
puede introducir nada que el servidor no acepte explícitamente.

---

## D-25 — Ejecución de una calculadora incrustada en un artículo

**Decisión**: la ejecución de una calculadora incrustada recorre exactamente la **misma
ruta** que cualquier simulación — Gateway → Orquestador → Simulador — y se registra en el
historial igual que las demás (FR-071). El artículo solo aporta el `calculator_id`.

**Justificación**: la saga de simulación existente ya emite el evento de auditoría por el
Orquestador (D-03). Una ruta alternativa "ligera" desde el artículo dejaría esas ejecuciones
fuera del historial y de la auditoría, incumpliendo FR-071 y debilitando FR-025.

**Referencia entre servicios (FR-070/FR-072)**: Aprendizaje valida el `calculator_id` al
guardar el documento llamando por **gRPC** al Simulador, y guarda solo el identificador
opaco. Nunca lee `simulator_db` (Principio III). Si al leer el artículo la calculadora ya no
está publicada, el bloque se degrada a un aviso y el artículo sigue siendo legible.

---

## D-26 — Tipo de una simulación hecha con una calculadora de USUARIO

**Decisión**: `simulations.calc_type` admite un **sexto valor**, `'usuario'`, y el enum del
contrato un sexto miembro, `CALC_TYPE_USUARIO = 6`. La columna sigue siendo `NOT NULL`.

**El problema que resuelve**: `calc_type` se declaró `NOT NULL` con un `CHECK` de los cinco
tipos nativos (FR-019), y una simulación de una calculadora **de usuario** no tiene ninguno de
esos cinco. Hasta ahora eso hacía que insertarla fuera imposible —la encontró T091, no una
prueba— y por eso `Compute` rechaza `calculator_id` en lugar de calcular: un cliente que pedía
una calculadora concreta recibía el resultado de otra sin que nada se lo dijera.

**Justificación**: el valor no significa «desconocido» sino «definida por el usuario», que es un
dato **cierto** y no un centinela para salir del paso. Y mantiene la columna `NOT NULL`, de modo
que no riega `SimulationRow`, ni `ListHistory`, ni ningún consumidor: `calc_type` sigue siendo
un `String` que siempre tiene valor. La entrada del historial ya lleva `calculator_id` y
`calculator_version`, así que un cliente sabe exactamente de qué definición salió el número.

**Alternativa considerada**: dejar `calc_type` anulable. Es más honesto con los datos —una
calculadora de usuario no tiene tipo nativo, y `NULL` lo dice exactamente— pero riega
`SimulationRow.calc_type` a `Option<String>` y obliga a decidir qué devuelve `ListHistory` para
esas filas. La respuesta natural sería `CALC_TYPE_UNSPECIFIED`, que en la PETICIÓN significa «el
cliente olvidó el campo» —y por eso es un error— y en la respuesta significaría «no aplica». El
mismo valor con dos significados según la dirección, para ganar una honestidad que el
`calculator_id` de al lado ya aporta, no compensa.

**Alcance**: la decisión toca T091 (ejecutar por `calculator_id`), T103 (persistir
`calculator_id`/`calculator_version`/`indicators_snapshot`) y `ListHistory`. Se resolvió una vez
para las tres, que es la razón de que estuviera anotada en las tres.

---

## D-27 — Los pánicos por desbordamiento de `annuity`: cuándo se corrigen

**Decisión**: `calculators::annuity` multiplica con `*` en vez de con `checked_mul`
(`annuity.rs:74`, `:80`, `:104`), así que `cuota` y `vf_serie` **abortan** cuando el producto no
cabe en la mantisa de 96 bits. **Se corrige, pero no ahora**: primero tiene que ejecutarse el
sembrado y las migraciones contra una base real.

**Por qué no ahora**: la suite de T092 usa el código nativo como **patrón** de comparación.
Cambiar la aritmética del patrón mientras se establece la suite destruiría la evidencia que la
suite existe para dar: ya no se sabría si las semillas reproducen el código nativo de hoy o uno
modificado a la vez que se medía. El orden correcto es congelar la referencia, verificar el
sistema completo contra una base, y entonces corregir — la suite dirá si algo se movió.

**Efecto de la corrección**: las dos implementaciones cambian **igual**, así que FR-049 queda
intacto, y los 4 casos hoy incomparables (2 en `ahorro`, 2 en `credito`, contados y acotados por
la suite) pasan a comparables. Además el motor cumple lo que ya promete su documentación
—`functions.rs` dice que «ningún camino entra en pánico»—, promesa que hoy es falsa por esta vía.

**Nota**: `ahorro.rs:60` y `credito.rs:64` tienen el mismo `*`. El motor NO los hereda por su
evaluador, que usa `checked_mul` (`eval.rs:176`), y por eso hay casos en los que solo aborta el
código nativo. Las dos caras están fijadas por pruebas propias en `tests/seed_regression.rs`.

---

## D-28 — Quién siembra las definiciones semilla fuera de desarrollo

**Decisión**: un **paso de despliegue explícito** que invoca el mismo binario que `dev/seed`
invoca en local (`services/simulator/src/bin/seed.rs`). El servicio **no** siembra al arrancar.

**El problema que resuelve**: las siete calculadoras de FR-019 solo se crean en `dev/seed`.
`deploy/vps/compose.app.yaml` solo añade `BOOTSTRAP_ADMIN_EMAIL`, así que en producción el
catálogo nacía vacío: `ListCalculators` no mostraría ninguna calculadora y `gmf` no podría
calcular, porque depende del indicador `@UVT`.

**Justificación**: el binario ya es idempotente y **convergente** —compara la definición
almacenada con la compilada y añade una versión nueva cuando difieren—, así que un paso que lo
invoque se puede repetir sin efectos. Y deja el arranque del servicio **sin efectos
secundarios**, que es lo que pide el Principio X («entrypoint delgado: solo config, wiring y
shutdown»): un arranque que escribe en la base falla en una réplica de solo lectura y hace que
«qué hay en la base» dependa de qué binario arrancó último.

**Alternativa considerada**: que `main.rs` siembre antes de servir. Tiene una ventaja real —el
contenido no puede desincronizarse del binario en ningún entorno, y no hay paso de despliegue
que se pueda olvidar—, pero convierte el arranque en una escritura y aparta el entrypoint de lo
que el Principio X le pide.

**Pendiente**: el paso concreto en `deploy/` no forma parte de las tareas de este feature y no
se ha escrito. Queda anotado como requisito de puesta en producción.

**Escrito (2026-09-16)**: `deploy/vps/seed`, con el mismo patrón que `deploy/vps/migrate`
—ejecuta el binario DENTRO del contenedor del Simulador, de modo que hereda su `DB_ADDR` y el
sembrado no puede apuntar a una base distinta de la que sirve el servicio—, y documentado en
`deploy/vps/README.md`.

Al escribirlo apareció un segundo hueco, y este no se habría notado hasta el despliegue: **el
binario de siembra no estaba en la imagen de producción**. `services/simulator/Dockerfile`
compila el árbol entero —`cargo build --release` construye también `src/bin/seed.rs`— pero
solo copiaba `fintcart-simulator` a la imagen final. En desarrollo no se veía porque allí el
sembrado usa `/src/target/debug/seed`, que existe porque la imagen de desarrollo compila todo;
en el VPS, el primer `deploy/vps/seed` habría fallado con «executable file not found». Ahora
se copia como `/usr/local/bin/fintcart-seed`, y `src/bin/seed.rs` entra en el `touch` que
fuerza a Cargo a recompilar los targets propios.

Los indicadores que siembra siguen siendo **valores de EJEMPLO**, y el propio script lo
recuerda al terminar: la fuente de verdad es `UpsertIndicator` (FR-060). Ese aviso importa
más en producción que en desarrollo, porque allí nadie va a mirar la tabla para descubrir que
la UVT sembrada es redonda.

---

## D-29 — Tipo con el que se registra una SEMILLA ejecutada por `calculator_id`

**Decisión**: `simulations.calc_type` guarda el tipo nativo que la definición reproduce cuando
la ejecución viene por `calculator_id` y la calculadora es una de las siete semillas; y
`'usuario'` solo cuando la calculadora **no** es una semilla. La correspondencia vive en
`domain::dispatch::SEEDS`, que relaciona el nombre de cada semilla con su tipo nativo.

**El problema que resuelve**: D-26 justificó el sexto valor diciendo que significa «definida por
el usuario», y eso es cierto para una calculadora de un usuario. Pero **el catálogo público
ofrece las siete semillas y el ejecutor las pide por `calculator_id`** —es el camino PREFERENTE
del contrato (FR-043, `ComputeRequest.calculator_id`: «exactamente uno de los dos debe venir
relleno»)—, así que ese es el camino NORMAL de las calculadoras por defecto, no un caso raro.
Escribir `'usuario'` sobre ellas afirmaría que un usuario las definió cuando las define el
repositorio: la columna diría algo falso sobre siete calculadoras que existían antes que ella.

**Justificación**: una semilla se registra con el tipo nativo que reproduce —`gmf`, `ea_a_mv` y
`mv_a_ea` como `colombia_especifica`— y eso la deja **consistente con el historial que la
migración de T020 ya rellenó**: las 13.493 filas `credito` y las sintéticas de
`colombia_especifica` citan esas mismas semillas con esos mismos tipos. Sin esta decisión, una
simulación de `gmf` hecha por el catálogo quedaría registrada como `'usuario'` mientras una
idéntica hecha por `calc_type` queda como `colombia_especifica`, y las dos dirían ser la verdad.

**Que la atribución sea legítima lo sostiene T092**: las semillas reproducen el código nativo,
así que citar la semilla es una cuenta exacta de lo que el nativo calculó. Es el mismo permiso
con el que T020 rellenó el historial anterior.

**Alternativa considerada**: `'usuario'` para todo lo que llegue por identificador. Es más
simple —una sola regla— pero hace que `calc_type` mienta en el caso más frecuente, y el
`calculator_id` de al lado no lo compensa: un lector de la tabla que vea `'usuario'` junto a la
semilla `gmf` concluiría lo contrario de lo que pasó. La columna dejaría de ser un dato para
ser un centinela, que es exactamente lo que D-26 dijo que NO quería que fuera.

**Alcance**: toca T091 (ejecutar por `calculator_id`) y T103 (persistir `calc_type` junto a la
procedencia). Se resolvió en la misma unidad, que es donde las dos se encontraron.

---

## D-30 — Cómo se retira el código nativo, y en qué orden

**Decisión**: la retirada de `services/simulator/src/calculators/` se parte en dos, y la
segunda va **después** de que exista el paso de siembra en producción que D-28 dejó pendiente.

1. **`annuity` al dominio, con sus desbordamientos corregidos** (D-27). Hecho. No depende de
   nada y desbloquea lo demás: `domain/formula/functions.rs` importaba
   `crate::calculators::annuity` para implementar `cuota`, `vf_serie` y `tasa_periodica`, que
   son funciones del LENGUAJE de fórmulas. La capa de dominio dependía del código nativo que
   se quiere retirar, así que mientras el módulo viviera allí, borrar el directorio habría
   dejado al motor sin su aritmética.
2. **Redirigir el camino de compatibilidad y borrar los cuatro nativos que coinciden**
   (`ahorro`, `credito`, `presupuesto`, `inversion`). Sus entradas son **exactamente** las de
   sus semillas —comprobado una a una—, así que ningún cliente ve cambiar lo que puede
   enviar. Queda pendiente de (3).
3. **`colombia.rs` NO se borra con ellos.** Es el único cuyas entradas difieren de sus
   semillas: el nativo recibe `valor_uvt` como ENTRADA y `exento` como texto (`"si"`/`"no"`),
   mientras que las semillas leen `@UVT` de `financial_indicators` y toman `exento` como
   entero. Redirigirlo hoy significaría que un cliente que manda `valor_uvt` lo viera
   **ignorado en silencio** mientras el cálculo usa el valor de la base — exactamente la
   divergencia callada que el resto del proyecto se pasa los comentarios evitando. Espera a
   que la ruta antigua se retire, o a una deprecación explícita.

**El bloqueo de orden, que es la parte que no estaba escrita en ninguna tarea**: el despacho
redirigido resuelve la definición **desde la base**. Sobre una base migrada y todavía sin
sembrar, el Simulador se queda sin ninguna calculadora —la tarea quita el camino nativo y con
él la única forma de calcular—. En desarrollo eso no ocurre porque `dev/seed` corre siempre
(Principio XII); en producción el sembrado es un **paso de despliegue explícito** que D-28
describió y que **todavía no se ha escrito**. Hacer T098 antes que ese paso dejaría la primera
migración de producción sin sembrar con el simulador entero caído.

**Justificación de partir la tarea**: la descripción original —«eliminar `calculators/` y
redirigir el despacho a las definiciones semilla»— se lee como un refactor mecánico y no lo
es. Mezcla dos cosas con dependencias distintas: mudar un módulo compartido (sin dependencias)
y cambiar de dónde sale la definición que se ejecuta (que introduce una dependencia de la base
que antes no existía). Separarlas permite hacer la primera ya y deja la segunda esperando al
paso de despliegue, en vez de bloquear las dos.

**Alternativa considerada**: mantener un respaldo al código nativo cuando la semilla no esté
en la base. Es tentador —haría T098 seguro en cualquier orden— y contradice el objetivo de la
tarea: conservar las dos implementaciones «por si acaso» es exactamente lo que este feature
vino a eliminar, y un respaldo que solo se ejerce en producción sin sembrar es un camino que
ninguna prueba recorre.

---

## Resumen de impacto por servicio

| Servicio | Impacto |
|----------|---------|
| **Aprendizaje** (NestJS) | Categorías; sesiones de cuestionario; normalización de score; cuerpo en bloques; imágenes en `BYTEA`; validación del documento; referencia a calculadoras por gRPC |
| **Simulador** (Rust) | Motor de fórmulas (analizador + AST + evaluador); definiciones de calculadora; curaduría; indicadores con vigencia; snapshot en el historial; siete definiciones semilla |
| **Usuarios** (Go) | Rol `administrador`; estado `pending_deletion` + `purge_due_at`; índice de correo ampliado; `ListAccountsDueForPurge`; arranque del administrador inicial |
| **Orquestador** (Go) | Barrido periódico de purgas vencidas y de vencimiento de indicadores; publicación del evento de aviso |
| **API Gateway** (Go) | Endpoints REST nuevos; middleware de rol administrador; recurso de imagen con caché inmutable; subida multiparte |
| **Notificación** (Node) | Consumo del evento de aviso de indicadores |
| **Auditoría** (Go) | Consumo de los eventos de depuración administrativa |
| **Frontend** (Angular) | Editor TipTap; desplegable de categorías; constructor de calculadoras; pantallas de administración; render de bloques sin `innerHTML` |
| **Autenticación** (Go) | Claim de rol ampliado |
