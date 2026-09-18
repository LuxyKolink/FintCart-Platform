# Hallazgos de la verificación — feature 002

Registro de lo que apareció **al comprobar contra la pila real**, no al escribir el código. Igual
que el de 003: cada entrada tiene la evidencia que la sostiene, porque un hallazgo sin forma de
reproducirlo es una anécdota.

## 1. «error interno» no dice qué falló, y eso cuesta más que el fallo

**Qué pasa.** Cuando un servicio interno falla, el Gateway responde `500` con
`{"code":"internal"}` y el servicio anota `"error": "rpc error: code = Internal desc = error
interno"`. La causa —a qué servicio se llamó, con qué plazo, por qué— no viaja a ninguna parte.

**Evidencia.** `services/api-gateway` registra la petición con su duración, y el servicio que
falló registra el mismo texto enmascarado:

```
{"path":"/me/report","status":500,"duration":222695677}
{"service":"users","method":"/users.v1.UsersService/GetActivityReport","duration":221996207,
 "code":"Internal","error":"rpc error: code = Internal desc = error interno"}
```

**Por qué importa.** `GetActivityReport` no falla sola: falla porque **una de las dos** llamadas
que hace por gRPC —Aprendizaje para `quizzes_attempted`, Simulador para `simulations_run`— falló
antes. Con este texto, quien depura no puede saber cuál de las dos, ni si fue plazo agotado,
puerto cerrado o un `Internal` de verdad. Diagnosticar esto costó veinte minutos de leer registros
de cuatro contenedores a la vez; con el nombre del salto y el código del servicio de destino,
habría costado una línea.

**Qué no es.** No es un fallo funcional: la ruta responde bien cuando sus dependencias responden.
Es un fallo de **observabilidad**, y por eso no lo cubre ninguna prueba de extremo a extremo.

## 2. Los fallos de 5–6 segundos aparecen solo con la suite completa, no en aislado

**Qué pasa.** En dos corridas completas seguidas de la batería de extremo a extremo, algunas
peticiones —repartidas entre Aprendizaje, Usuarios y Simulador— fallan con `500` tras **5,4–6,1 s**.
Las mismas pruebas, ejecutadas una por una, pasan.

**Evidencia.**

| Cuándo | Respuestas `500` | De ellas, >4 s |
|---|---|---|
| 2026-09-16 17 h | 5 | 0 |
| 2026-09-16 20 h | 4 | 0 |
| 2026-09-17 01 h | 21 | **5** |

Las cinco lentas, con su duración: `/auth/register` 5,47 s · `/oauth/authorize` 5,48 s y 5,53 s ·
`/simulators/credito/run` 5,67 s · `/quizzes/{id}/attempts` 6,05 s. Y la prueba concreta que
falla —`us2-simuladores`, cuyo resultado no aparecía— pasa en aislado en 8,8 s.

**Qué se descartó, midiendo.** Índices: `simulations` (179 filas, no las 13.493 que dejó la
migración de 002, que corrió sobre otra copia) tiene `simulations_user_created_idx` y
`simulations_calculator_idx`; `quiz_attempts` (22 filas) tiene `quiz_attempts_user_quiz_idx`.
Colas: `notification_events_queue` con 0 filas y sus índices en pie. Conexiones: 2–4 por base,
ninguna consulta activa de más de un segundo. El plazo del Gateway es de **20 s**, así que estos
fallos no son su plazo agotándose.

**Qué queda.** El patrón es de **contención del anfitrión**: ocurre en la hora en que se
encadenaron cuatro corridas completas, una migración y una copia de base de datos, y no ocurre
cuando la pila está ociosa. Cargar la página completa de cada prueba en un mismo contenedor de
Docker, con los siete servicios y siete PostgreSQL compartiendo CPU, produce paradas de varios
segundos por encima del plazo de algún salto interno.

**Qué hacer antes de una demostración.** Levantar la pila de cero (`dev/down && dev/up`) y
ejecutar la batería **una vez**. Es honesto decirlo así: hoy la batería completa no es
repetible dos veces seguidas en esta máquina, y eso hay que saberlo antes de defender, no durante.

## 3. El proto anuncia RPC que responden `Unimplemented`

**Qué pasa.** Seis RPC del Simulador están declaradas en el contrato y devuelven
`Unimplemented` con el identificador de la tarea que las implementará:

```
"simulator.UpsertIndicator", "simulator.ListIndicators",
"simulator.GetIndicatorCalendarStatus", "simulator.SubmitCalculatorForReview",
"simulator.ApproveCalculator", "simulator.RejectCalculator"
```

**Por qué se hizo así.** El contrato se escribió antes que la implementación para poder
compilar los cinco stacks y no inventar la interfaz después. Declarar y no implementar es
honesto mientras quede dicho; el mensaje lleva la tarea para que sea verificable.

**Qué falta.** Un cliente **no puede distinguir** «esta función no está hecha» de «esta función
falló» sin leer el texto del error, porque las dos llegan como `Unimplemented`/`500` sin un
código propio. Cuando se implementen, esa ambigüedad desaparece sola; mientras tanto, conviene
saber que la interfaz de administración de indicadores **está anunciada y no existe**.


---

## 4. La lista de CORS del borde no incluía `PUT`: toda una familia de rutas era inusable desde el navegador

**Fecha**: durante T108/T109 (el primer `PUT` que un navegador ejercita).

**Qué pasó**: al guardar la corrección de una vigencia de indicador, la pantalla mostraba «Parece que perdiste
la conexión». Los registros del borde enseñaban el `OPTIONS` de la petición con **200** y ninguna línea del
`PUT`: el navegador respondió al preflight y **descartó la petición real**, así que el cliente recibió
`status === 0` —el mismo que cuando no hay red— sobre una ruta que por `curl` funcionaba perfectamente.

**Causa**: `AllowedMethods` en `routes.go` listaba GET, POST, PATCH, DELETE y OPTIONS. Faltaba `PUT`, y la
superficie tiene tres rutas `PUT`: `/calculators/{calculatorId}` (T088), `/editorial/quizzes/{quizId}` (T162,
editar un cuestionario) y la nueva de indicadores.

**Alcance real**: la edición de un cuestionario publicable llevaba rota desde T162 y ninguna prueba la
ejercitaba desde un navegador —las de extremo a extremo crean cuestionarios con `POST` y nunca los editan—. El
síntoma era además **engañoso**: el mensaje culpaba a la red del usuario, y ese mensaje es correcto por
construcción (el navegador no expone el motivo de un descarte por CORS), así que no había forma de llegar a la
causa leyéndolo.

**Arreglo**: añadir `PUT` a la lista. Y una prueba nueva
(`TestCORSAllowsEveryMethodTheSurfaceUses`) que recorre los métodos que la superficie declara y exige que el
preflight los permita: se verificó que **falla con la lista vieja y pasa con la nueva**, porque una prueba que
no distingue las dos versiones no protege de nada. Es un fallo que solo se manifiesta en un navegador, así que
sin ella volvería a colarse.

**Lección**: el error de red (`status === 0`) tiene dos causas —no hay red, o el navegador descartó la
petición— y el código del cliente no puede distinguirlas. Cuando aparece en una ruta que por `curl` funciona,
lo primero que hay que mirar es CORS, no la red.

---

## 5. La barrera de accesibilidad confundía un campo de fecha con un orden de tabulación cíclico

**Fecha**: durante T108, al añadir la pantalla de indicadores a la barrera.

**Qué pasó**: el recorrido por teclado de `/admin/indicadores` se detenía en «Aplica desde» y no llegaba al botón
de envío, aunque el botón sí era alcanzable. La barrera afirmaba que el teclado no llegaba a una acción que sí
alcanzaba.

**Causa**: el recorrido cortaba al volver a ver un elemento ya visitado —«el orden cicló»—, y un
`<input type="date">` **nativo recibe la tabulación cuatro veces** en Chromium sin dejar el elemento: día, mes,
año y el selector. Cuatro paradas seguidas del mismo control parecían un ciclo.

**Arreglo**: el final de la página ya tiene su propia señal (`document.activeElement` sale al navegador) y un
ciclo infinito lo corta el presupuesto de paradas, así que la detección de ciclo se sustituye por un contador
de repeticiones **consecutivas** con umbral por encima de las cuatro paradas del campo de fecha. La suite pasó
de 19 a 20 pantallas con este arreglo, y sin él ninguna pantalla con un campo de fecha podría haberse añadido
a la barrera: el falso positivo habría bloqueado justo la comprobación que existe para no romper la
accesibilidad en silencio.

**Lección**: es el segundo falso positivo de esta barrera (el primero fue seguir tabulando a mitad de página
tras una navegación de la SPA), y los dos apuntan a lo mismo: una heurística de «esto ya lo vi» sobre un DOM
que se comporta de maneras legítimas distintas. Cuando una barrera se equivoca, la tentación es añadir una
excepción en la pantalla señalada; las dos veces el arreglo correcto estuvo en la barrera.

---

## 6. Una regla de análisis estático apuntaba a una carpeta que no existe

**Fecha**: durante T108, al añadir la pantalla de indicadores a la regla de T171.

**Qué pasó**: T171 configuró la prohibición del tipo `number` (Principio VIII) sobre
`src/app/features/calculators/**/*.ts` y `src/app/features/admin/indicators/**/*.ts`. La primera carpeta **no
existe**: el constructor visual es T097 y todavía no se ha escrito. El dinero que hay hoy en pantalla vive en
`src/app/features/simulators/`, que no estaba en la lista.

**Alcance**: la regla llevaba desde T171 aplicándose al conjunto vacío en su mitad más importante, y el
«verde» que producía no significaba lo que decía. Al apuntarla a la carpeta real, las violaciones fueron
**cero** —el dinero ya era `string` en todas partes, que es el resultado que se quería—, así que el efecto
práctico fue nulo y el valor del arreglo es que ahora la regla protege de verdad.

**Arreglo**: las tres carpetas en la lista (la real, la que llegará y la de indicadores), con el comentario
que explica por qué están las tres.

**Lección**: un análisis estático que no encuentra nada no distingue «el código está bien» de «la regla no está
mirando». Un glob sobre una carpeta que no existe se ve en una línea de configuración, y solo se ve **si
alguien escribe el primero de los archivos que la regla dice proteger**.

---

## 7. Evidencia nueva del hallazgo 2 (contención del anfitrión): las peticiones se cancelan a los 5 s

**Fecha**: durante T108/T109, corriendo la batería de extremo a extremo completa.

**Dato**: con los quince contenedores levantados y el servidor de desarrollo del SPA (2,7 GB de memoria)
recompilando, peticiones que en reposo tardan **3 ms** se quedaron en **5,4-5,6 s** y el cliente las canceló:
`POST /oauth/authorize` (la verificación de la contraseña es costosa a propósito), `GET /admin/indicators`,
`POST /simulators/ahorro/run`. En los registros aparecen como `grpc_code: Canceled` y `HTTP 500`, que es lo que
ve quien lee el log: **no** un «tardó mucho», sino una cancelación.

**Comprobado**: no es la base (3 conexiones en reposo, ninguna activa), ni el grupo de conexiones del
Simulador, ni ninguno de los dos servicios. Las mismas llamadas por `curl` con la máquina en reposo tardan
3 ms, doce veces seguidas.

**Consecuencia práctica**: una prueba de extremo a extremo que falle con un plazo de 5 s durante la batería
completa **puede pasar sola**, y así se verificó (`us1-aprendizaje` falló en la batería y pasó en 10,5 s
ejecutada aparte). Antes de una demostración: `dev/down && dev/up`, esperar a que el SPA termine de componerse
y correr la batería **una vez**.

**Medición del 17 de septiembre, con la batería de 49 pruebas y cuatro procesos de navegador**: tres pruebas
fallaron esperando el correo de verificación y **el correo llegó 165 segundos después del registro** (el
registro devolvió 202 y la interfaz mostró «te enviamos un correo»; lo que tardó fue la cadena
saga → outbox → RabbitMQ → Notificación → SMTP). Con el plazo de veinte segundos que traía el ayudante, esas
tres pruebas fallaban por el anfitrión y no por lo que comprueban, así que el plazo subió a **un minuto**
(`e2e/support/mailhog.ts`). No se debilita la aserción: si la cadena está rota, el correo no llega nunca y la
prueba falla igual, un minuto más tarde.

**Lo que NO se ha tocado**: los plazos de las aserciones de `us1`–`us4`. Son la garantía dura (N-13) y
ajustarlos para que pasen en una máquina cargada convertiría el fallo del anfitrión en un fallo del producto
que nadie vería. Si la batería completa no pasa, se documenta; no se afloja.

## Hallazgo 8 — El delta de proto no preveía cómo llega la aprobación al Orquestador

**Qué pasa**: `contracts/events/events-catalog-delta.md` asigna `calculator.published` al
Orquestador —el Simulador no es productor, Principio V—, pero los tres deltas de proto
(aprendizaje, simulador, usuarios) no añaden ningún RPC al contrato del ORQUESTADOR. El borde
solo podía llamar al Simulador, que no publica: la aprobación habría quedado sin evento y T115
sin forma de existir.

**Arreglo**: `OrchestratorService.ApproveCalculator` —síncrona, con resultado propio y no un
`SagaHandle`— más la saga de dos pasos (aprobar, leer la versión publicada, emitir). Se
documenta aquí porque el hueco no está en el código sino en el plan: quien lea los deltas para
implementar US7 (purga) o US8 (calculadora incrustada) tiene que saber que **un evento asignado
al Orquestador implica un RPC nuevo en su contrato**, y que eso no lo dice ningún delta.

## Hallazgo 9 — El delta REST sigue sin aplicarse a `contracts/openapi/gateway.yaml`

**Qué pasa**: el documento OpenAPI versionado tiene 27 rutas y ninguna de la enmienda 002: no
está el constructor de calculadoras, ni los indicadores, ni las categorías administrables, ni la
curaduría que se acaba de implementar (T116). El delta con las ~20 rutas existe
(`contracts/openapi/gateway-delta.yaml`) y los manejadores del borde existen, pero el documento
no.

**Consecuencia**: `contracts/` es la superficie compartida y el documento REST es el contrato
del borde, así que hoy la única descripción fiable de esas rutas es el código del Gateway. No
bloquea a nadie —nada genera código desde ese archivo y Swagger UI documenta lo que hay en el
`.yaml`— y por eso no se arregla a medias aquí: aplicar el delta entero es T004, y hacerlo ruta
a ruta dejaría un documento que describe parte de una familia y no el resto, que es peor que uno
desactualizado de forma homogénea.

## Hallazgo 10 — La prueba de US4 no limpia lo que crea, y una tanda fallida la deja fallando por otra razón

**Qué pasa**: `us4-editorial.spec.ts` crea un artículo, le añade una versión y la envía a
revisión. Si la prueba falla a mitad —o si se ejecuta varias veces— las versiones se acumulan en
`en_revision`, y su localizador
`locator('article').filter({ hasText: 'Cuerpo del artículo de prueba' })` deja de resolver a UN
elemento. La prueba protegida (N-13) no se toca, así que el fallo **no se arregla desde el
código**: hay que limpiar la base.

**Medido**: ocho versiones en revisión con el mismo cuerpo hicieron fallar `us4` en el segundo
fallo consecutivo de la tarde, y el mensaje que da —«strict mode violation … resolved to 3
elements»— habla de un localizador, no de los datos. Es la misma clase de problema que ya se
documentó para los indicadores y para las calculadoras (hallazgos 7 y 11): **una prueba que deja
datos cambia el estado de la siguiente ejecución**, y en las que no se pueden tocar la limpieza es
una operación de operador, no de código.

**Operación**: antes de una tanda (sobre todo si la anterior falló), limpiar los datos de prueba:

```sql
-- learning_db
DELETE FROM article_versions WHERE state IN ('en_revision', 'borrador');
DELETE FROM articles WHERE title ~ '(Artículo editorial|Artículo E2E|Artículo de barrera)';
```

### Actualización (T156, verificada en la instalación desde cero)

El hallazgo describía la situación con **las cinco** pruebas que creaban artículos sin limpiarlos.
Una de ellas (`calculadora-incrustada.spec.ts`) ya limpiaba; las otras cuatro **también limpian
ahora**, con el mismo patrón y el mismo helper (`support/articles.ts`), que pasó de un prefijo a una
lista de prefijos —y la salvaguarda del borrado exige que el título empiece por uno de ellos, de modo
que añadir una prueba que cree un artículo sin declarar su prefijo **falla en voz alta** en lugar de
borrar por título cualquier cosa—.

Medido al terminar la suite completa sobre una instalación recién sembrada: **un artículo** de prueba
(el de `us4-editorial`, protegido por N-13) y **trece simulaciones** (las de `us2-simuladores`,
también protegida). Antes eran nueve artículos. Las dos fuentes que quedan no se pueden arreglar sin
tocar las pruebas protegidas, así que siguen necesitando la limpieza de operador que este hallazgo
documenta:

```sql
-- Aprendizaje
DELETE FROM articles WHERE title LIKE 'Artículo E2E%';
-- Simulador
DELETE FROM simulations;
```

Un entorno limpio antes de una demostración es: las cinco categorías y los cinco artículos de la
siembra, siete calculadoras, cinco indicadores, cero intentos y cero simulaciones.

---

## Hallazgo 11 — Una barra de navegación que crece desborda en un punto de corte que no puede saberlo

**Qué pasa**: al añadir tres entradas a la navegación (T117–T119) la barra dejó de caber a
**768 px** y la captura visual lo cazó con **185 px de desbordamiento horizontal**. El corte de
colapso a menú estaba en `--bp-md` (768 px) y **no depende del ancho sino del número de enlaces**:
con siete enlaces cabía, con diez no.

**Arreglo**: el colapso sube a `--bp-lg` (1024 px), que es el punto de corte siguiente del
sistema. Una tableta de 768 a 1023 px ve el menú desplegable, que es lo que ya veía por debajo de
768.

**Lo que deja dicho**: la captura visual de cada pantalla a los cuatro anchos es lo único que
podía detectar esto —ninguna prueba de unidad mira el ancho— y añadir navegación es una razón
legítima para volver a medir. Queda escrito en `app.component.css`, junto al corte.

## Hallazgo 12 — Un enlace nuevo puede romper una prueba protegida por su NOMBRE

**Qué pasa**: la segunda bandeja de curaduría se llamó «Revisión de calculadoras», y el enlace de
la bandeja de artículos se llama «Revisión». Los localizadores de Playwright resuelven por
**subcadena**, así que `getByRole('link', { name: 'Revisión' })` pasó a resolver DOS elementos y
rompió `us4-editorial`, `visual/editorial` y `visual/admin` —las tres, en los tres tramos que
entran a la bandeja—. N-13 dice exactamente esto: **un nombre, un enlace**.

**Arreglo**: la etiqueta nueva pasa a ser «Curaduría». Se cambia la etiqueta, **no la aserción**:
las pruebas de US1–US4 son la garantía dura y ajustarlas para que quepan destruiría lo único que
protege la accesibilidad y los recorridos.

## Hallazgo 13 — La imagen de desarrollo del Simulador prometía `clippy` y `fmt` y no los traía

**Qué pasa**: `services/simulator/Dockerfile.dev` documenta en su punto 2 que la imagen «CONSERVA
el toolchain, para poder entrar con `docker compose exec` y ejecutar `cargo test` o `cargo clippy`»,
y la advertencia del propio Dockerfile invita a correr ahí el `--all-targets -- -D warnings` que
exige la Constitución §Calidad y Pruebas. **Los dos componentes no estaban instalados**:
`rust:1.97-slim-bookworm` trae `cargo` y `rustc`, no `rustfmt` ni `clippy`.

**Cómo apareció**: al retirar el código nativo (T098) había que correr el análisis estático completo
sobre el árbol tocado, y el contenedor contestó `'cargo-clippy' is not installed`. La comprobación
llevaba haciéndose fuera del contenedor, con un toolchain distinto del que compila el servicio —con
el riesgo de que un lint pase en uno y falle en el otro—.

**Arreglo**: `RUN rustup component add clippy rustfmt` en `Dockerfile.dev`, **antes** de copiar el
código, para que la capa no se invalide al tocar `src/`. Verificado reconstruyendo la imagen: los dos
binarios existen dentro y el análisis corre en el mismo toolchain que compila.

**Lo que deja dicho**: el verificador tiene que vivir donde vive el código. Una promesa en un
comentario no la comprueba nadie hasta que alguien la necesita, y entonces cuesta más.

**Aparte, y sin arreglar porque es del arnés de pruebas y no del código**: `cargo test -- --ignored`
ejecuta también los ejemplos de documentación marcados como `ignore` —el de
`src/repo/tx.rs` es un fragmento con `pool` sin definir—, así que esa invocación informa un fallo que
no existe. Las pruebas de base se corren con `cargo test --tests -- --ignored` (28 en verde), que es
lo que ejecuta el CI.

## Hallazgo 14 — El ejecutor leía `min`/`max`/`default` y el contrato manda `min_value`/`max_value`/`default_value`

**Qué pasaba**: el Gateway serializa las cotas de una entrada como `min_value`, `max_value` y
`default_value` —así están en su DTO, así las manda al Simulador y así las recibe de él— y el tipo
del frontend declaraba `min`, `max` y `default`. `field.min` valía `undefined` **siempre**: el
ejecutor no comprobaba ninguna cota y no rellenaba ningún valor por defecto.

**Por qué nadie lo notó**: no es un error de compilación, y todas las calculadoras con las que se
probó se ejecutaban con valores dentro del rango y escribiendo el valor a mano. El defecto no
producía ningún síntoma hasta que alguien declaraba una cota y confiaba en ella — que es
exactamente lo que hace el constructor visual (T097), la primera pantalla que declara cotas y
espera verlas respetadas.

**Arreglo**: los nombres del cable se usan tal cual, sin traducir, y hay dos pruebas escritas
contra el JSON que manda el borde —no contra una definición inventada por la prueba, que es lo que
dejó pasar el defecto—: el valor por defecto se rellena y una cota fuera de rango se rechaza.

**Lo que deja dicho**: dos vocabularios para el mismo dato no fallan cuando se escribe el segundo,
fallan cuando alguien confía en él. Y una prueba que construye sus datos con los nombres
equivocados comprueba el código equivocado.

## Hallazgo 15 — El motivo de un rechazo no llegaba al usuario: la cadena de la saga aplanaba el mensaje

**Qué pasaba**: una calculadora con la regla `monto > 1000` y el mensaje «El monto tiene que
superar 1000» —escrito por su autor— respondía, al ejecutarla con 500:

```
{"code":"bad_request","message":"petición inválida"}
```

El mensaje existía, viajaba por tres servicios y se perdía en los dos últimos eslabones:

1. **El Orquestador** devolvía `status.Error(InvalidArgument, err.Error())`, donde `err.Error()`
   era la cadena completa del fallo de la saga: `server: argumento inválido: server: saga fallida y
   compensada (simulacion): paso 0 (simulator.compute): ejecutar la simulación de <uuid>: rpc
   error: code = InvalidArgument desc = El monto tiene que superar 1000`. El motivo estaba al
   final, detrás de nombres internos y de un identificador de usuario.
2. **El borde** sustituía todo 400 por «petición inválida».

**Arreglo, en los dos sitios**: el Orquestador baja al estado gRPC **más profundo** de la cadena
—el del participante que rechazó la operación, que es el único redactado para quien llama— y
conserva su código; el borde deja pasar el mensaje de la familia 400 tal cual. Los demás códigos
(401, 403, 404, 409, 429) mantienen su texto fijo: sus mensajes genéricos sí informan y pasarlos
pondría delante del usuario el prefijo interno de cada servicio.

**Dos detalles del lenguaje que costaron trabajo y quedan escritos en el código**:

- `status.FromError` sobre un error **envuelto** devuelve el código del participante pero el
  mensaje de la cadena entera. Quedarse con él propaga el aplanado.
- `errors.Unwrap` —el singular— devuelve `nil` para un `fmt.Errorf("%w: %w", …)`, porque desde Go
  1.20 eso construye un error con `Unwrap() []error`. Hay que recorrer el árbol. La prueba lo cazó
  porque no se conformaba con el código correcto: comprobaba el **mensaje**.

**Lo que deja dicho**: FR-045 existe para poder explicar por qué no se calcula, y su `message` lo
escribe el autor. Un camino de tres servicios puede perderlo sin que nada falle, así que el texto
tiene que comprobarse de extremo a extremo —`e2e/constructor-calculadora.spec.ts` lo hace con una
cota, y la regla del autor quedó verificada contra la pila real con `curl`—.

---

## Hallazgo 16 — El historial no puede nombrar una simulación hecha con una calculadora de usuario

**Qué pasa**: `T110` hizo que cada simulación conserve su procedencia —`calculator_id`,
`calculator_version`, `indicators_used`— y el historial la muestra: la fila lleva «versión 1»
(T110) junto a la fecha, los resultados y los parámetros. Pero el **badge que dice qué
calculadora se usó** sale de `history-rows.ts::calcLabelOf`, que busca el `calc_type` en
`calculators.config.ts` —la tabla de las cinco calculadoras clásicas del cliente—. Para una
calculadora **de usuario** el `calc_type` es `usuario` (D-26) y no está en esa tabla, así que la
celda muestra la palabra cruda `usuario`.

**Por qué no se arregla aquí**: el nombre de la calculadora no viaja en la entrada del historial
—el contrato lleva el identificador y la versión—, y resolverlo en el cliente costaría una
petición por fila al catálogo de calculadoras. Las dos salidas honestas son añadirlo al DTO del
borde (una unión con `calculator_definitions` en la consulta del historial) o dejar que el
historial muestre el identificador corto. La primera es un cambio de contrato y la segunda enseña
un UUID, que no es más útil que `usuario`.

**Lo que sí queda comprobado**: la procedencia se registra y se muestra (la versión), y la fila
existe en el historial de quien ejecutó desde el artículo —`e2e/calculadora-incrustada.spec.ts`
lo afirma—, que es lo que FR-071/FR-050 piden. Lo que falta es cosmético y está acotado a las
calculadoras de usuario.

**Un detalle de presentación que conviene saber y que la prueba afirma a conciencia**: el
historial muestra el valor **canónico** que devolvió el Simulador (`50000`) y no el formateado del
ejecutor (`50.000,00`), porque el formateo del historial depende del tipo declarado en
`calculators.config.ts` —`money`, `rate`— y una calculadora de usuario declara una **escala**, no
un tipo. No es una cifra falsa: es la misma cifra sin formato. Cerrarlo bien exigiría que la
escala viajara en la entrada del historial, que es el mismo cambio de contrato del párrafo
anterior.

---

## Hallazgo 17 — La siembra fallaba en una base vacía: la instalación nueva se quedaba sin calculadoras

**Qué pasaba**: `dev/seed` abortaba con

```text
error: simulador: fallo de persistencia: error returned from database: new row for relation
"calculators" violates check constraint "calculators_published_has_version"
```

`repo/seeds.rs` insertaba las siete semillas con `state = 'publicada'` y **sin
`published_version`**, y la restricción de T113 —«una calculadora publicada cita la definición
aprobada», que es SC-018 escrita en el esquema— lo rechaza. En una base nueva, el resultado era que
**la plataforma arrancaba sin ninguna calculadora** y el mensaje hablaba de una restricción, no de
una siembra.

**Por qué no lo cazó nada hasta ahora**, que es la parte que importa:

- Las semillas se siembran con `dev/seed`, un paso MANUAL de desarrollo. Ninguna prueba automática
  lo ejecutaba.
- Todas las pruebas que tocan las semillas corren sobre una base que **ya las tiene**. Como la
  siembra es idempotente, el `INSERT` no se ejecuta y el camino que fallaba no se recorría nunca.
- Las pruebas de repositorio usan `pg-mem`, que **no impone las restricciones** del esquema real.
- Y el entorno de desarrollo se había ido migrando por encima: las filas venían de antes de que la
  restricción existiera y la migración de T113 rellenó el campo. El defecto solo aparece al
  recorrer el camino completo **desde cero**, que es exactamente el camino de un despliegue.

**Arreglo**: el `INSERT` escribe `published_version = 1` en la misma fila (la clave foránea que
apunta a la definición está diferida a propósito, así que el orden dentro de la transacción —la
calculadora primero, su definición después— es válido).

**Lo que lo cierra para siempre**: `services/simulator/tests/seeds_db.rs` vacía las semillas, siembra
contra el esquema **real**, y comprueba fila por fila que las siete nacen publicadas *con su versión
aprobada* y con su definición; después siembra otra vez y exige que no se cree ni se versione nada.
La primera ejecución de esa prueba encontró un error propio (borrar las definiciones antes que la
calculadora no se puede: la calculadora cita su versión aprobada), que también quedó documentado.

**Lección para el resto del proyecto**: una idempotencia que evita el `INSERT` esconde el `INSERT`.
Toda siembra de arranque necesita una prueba que corra sobre el estado vacío, no solo sobre el
estado ya sembrado.

---

## Hallazgo 18 — La prueba de carga de la plataforma no puede pasar sus propios umbrales con el fondo de cuentas que trae

**Qué pasa**: `deploy/loadtest/k6-scenarios.js` —la que verifica SC-003 y SC-005— trae un fondo de
**40 cuentas** para **1.000 VUs** y las reutiliza (`data.tokens[__VU % data.tokens.length]`). El
comentario que lo justifica dice que «en la vida real muchas pestañas concurrentes pertenecen a una
fracción mucho menor de cuentas», y para el límite por IP es cierto: el guion manda un
`X-Forwarded-For` sintético por VU precisamente para eso. Lo que el comentario no tuvo en cuenta es
que el borde limita **dos veces** (`internal/handler`: `RateLimitByIP` y `RateLimitByUser`, 600 rpm
cada uno), y que 25 VUs compartiendo una cuenta suman sus peticiones al mismo contador de usuario:
~1,5 peticiones por segundo y por VU son ~2.250 rpm contra un tope de 600. El resultado serían 429
en masa, y un 429 cuenta como `http_req_failed` —cualquier respuesta que no sea 2xx—, así que el
umbral `http_req_failed: rate<0.01` del propio guion **no puede cumplirse** con esa configuración.
Peor: los 429 son rapidísimos, así que las latencias de SC-003/SC-005 saldrían bonitas midiendo lo
único que no se quería medir.

**Cómo apareció**: montando la prueba de T162 para el endpoint de ejecución
(`deploy/loadtest/k6-calculadora.js`). La primera corrida dio **100 % de fallos a 2 ms** con 30 VUs
sobre 10 cuentas: el limitador por usuario. Al arreglarlo —una cuenta por VU— y volver a leer el
guion de la plataforma se vio que el mismo problema estaba ahí, latente, esperando a que alguien
lanzara la corrida de 1.000 VUs para creerse un número falso.

**Arreglo y lo que queda**: la prueba de T162 exige `LOADTEST_ACCOUNTS ≥ LOADTEST_VUS` y aborta si
no se cumple, para que no pueda arrancar con una configuración que no puede dar un número válido. El
guion de la plataforma **no se ha modificado** (es de 001 y su arreglo —fondo igual al número de
VUs, o subir `RATE_LIMIT_RPM` a sabiendas para el entorno desplegado— es una decisión de
despliegue): lo que se ha hecho es dejar el aviso en su cabecera, donde lo va a leer quien lo
ejecute, y documentarlo en `deploy/loadtest/README.md`.

**La lección**: un límite de tasa por identidad convierte «un fondo de cuentas» en «un fondo de
cuotas». Un guion con umbrales de error se autodenuncia si se corre; uno sin ellos habría dado un
número creíble y falso.

---

## Hallazgo 19 — El aviso de indicador sin vigencia diagnosticaba mal, en dos de los tres sitios donde aparece

**Qué pasaba**: tres textos afirman la misma consecuencia cuando un indicador se queda sin vigencia
para el año en curso:

| Dónde | Qué decía |
|---|---|
| `services/notification/src/email/templates.ts` (cuerpo del correo de FR-061) | «Las calculadoras que lo referencian están dando resultados con el valor anterior, así que pueden estar desactualizadas sin que nadie lo note.» |
| `frontend/.../admin/indicators/indicators.component.html` (intro de la pantalla) | «sin vigencia, una calculadora que usa `@UVT` sigue calculando con el valor anterior.» |
| `frontend/.../simulators/forms/simulator-form.component.html` (aviso de FR-062) | «Los resultados pueden estar desactualizados.» |

**Y no siempre es verdad.** Hay DOS caminos de ejecución y se comportan distinto —medido en vivo
para T161, moviendo la vigencia de la UVT fuera del año:

```
GET /indicators/current                  → sin vigencia: [UVT]
POST /calculators/gmf/run                → 400 «no hay valor vigente para el indicador @UVT»
POST /simulators/colombia_especifica/run → 200 (el valor llega escrito por el usuario, valor_uvt)
```

`Indicators::resolve` (Simulador) devuelve **solo** la vigencia que cubre el día de hoy y **no tiene
respaldo al valor anterior**: `validity @> $2::date`, sin `ORDER BY` ni `LIMIT`, porque el `EXCLUDE`
de FR-059 garantiza que a lo sumo una fila responda. Así que una calculadora **por definición** no
da un resultado desactualizado: **falla**. Y una del camino **nativo** sí sigue calculando, con el
valor que el usuario escriba, que es para lo que el aviso sirve.

**Por qué importa un texto equivocado**: el correo del procedimiento anual es lo único que el
administrador lee sobre una operación de negocio, y su valor entero es que se le crea. Un aviso que
diagnostica mal —«están dando resultados con el valor anterior»— enseña a comprobar en el sitio
equivocado, y cuando el administrador ve que la calculadora no calcula, la conclusión razonable es
que el aviso exagera. El siguiente correo se archiva sin leer.

**Arreglo**: el correo y la pantalla de administración nombran **las dos** consecuencias —las que
toman el valor del catálogo no pueden calcular; las que lo reciben escrito siguen con el que se les
dé— y el aviso del ejecutor de simuladores se queda como está, porque dice lo que pasa en el camino
que usa (el nativo), con el comentario de `calculators.config.ts` ya explicándolo. La aserción del
correo en `services/notification/test/templates.spec.ts` se cambió junto con el texto: una prueba
que siguiera exigiendo la frase vieja habría inmovilizado el defecto.

**Cómo se encontró**: verificando SC-020 para T161. Los dos caminos devolvieron cosas distintas y la
diferencia estaba en el texto del aviso, no en el motor. Ninguna prueba podía verlo: el mensaje
afirmaba un comportamiento del sistema en un archivo de plantillas y el comportamiento real vivía en
otro servicio.

---

## Hallazgo 20 — `category.deactivated` se publicaba y no lo recibía nadie: el exchange lo tiraba en silencio

**Qué pasaba**: al aplicar el delta del catálogo de eventos (T005) y compararlo con los bindings
**reales** del broker en ejecución, en vez de con lo que el diseño decía:

```
$ rabbitmqctl list_bindings source_name routing_key destination_name | grep fintcart.events
fintcart.events   account.anonymized        audit.q
fintcart.events   auth.password_changed     audit.q
fintcart.events   auth.password_changed     notification.q
fintcart.events   calculator.published      audit.q
fintcart.events   indicator.calendar_alert  audit.q
fintcart.events   indicator.calendar_alert  notification.q
fintcart.events   learning.article_published audit.q
...
(faltaba categoría, y no por error de grep: no existía)
```

Aprendizaje publicaba `category.deactivated` desde T056 (FR-035: auditar la desactivación de una
categoría). El Orquestador declara el exchange, las colas y los bindings, y **no tenía ni la
constante ni el enlace**. Un exchange `topic` con una routing key sin binding no devuelve error:
**descarta el mensaje**. Así que la desactivación se cobraba, la promesa de FR-035 se quedaba sin
cumplir, y no había ni un log, ni una métrica, ni una alerta que lo dijeran.

**Lo peor no era el olvido, era el comentario que lo tapaba.** En `services/learning/src/events/
publisher.ts` la constante dice, textualmente, `/** Debe coincidir EXACTAMENTE con
orchestrator/internal/events/topology.go */`. Coincidía con todo menos con lo que importaba:
topology.go no la tenía. Es el mismo patrón que el defecto 17 (el de la siembra): una afirmación
en un comentario que nadie comprueba, en un sitio donde comprobarla es barato.

**Por qué nada lo cazó**, y esto es lo que hubo que cambiar:

1. La prueba que existía —`TestEveryCatalogEventHasSomewhereToGo`, en
   `services/orchestrator/internal/events/topology_test.go`— recorre `allCatalogEvents`, una lista
   **escrita a mano**, y el propio comentario de la lista avisaba de que había que ampliarla al
   añadir un evento. Una barrera que depende de que alguien se acuerde de ampliarla no es una
   barrera: es una nota. Nadie se acordó.
2. El productor sí estaba probado, pero contra **su propia** constante local (`EVENT_CATEGORY_
   DEACTIVATED`), que es el nombre que se envía — verifica que el cable dice lo que el productor
   cree, no que alguien del otro lado escuche.
3. El arranque del Orquestador no falla ante un binding incompleto, y RabbitMQ tampoco: un exchange
   `topic` acepta cualquier routing key. El sistema entero funciona igual con el defecto dentro.

**Arreglo**, en tres partes:

- `topology.go`: `EventCategoryDeactivated = "category.deactivated"` y su entrada en
  `BindingsAudit`, con el comentario del hallazgo y la razón de por qué va SOLO a Auditoría (una
  desactivación no genera correo). El comentario de `BindingsAudit`, que decía «los ONCE eventos del
  catálogo» cuando ya había trece, pasa a decir catorce.
- **La barrera de verdad**: `frontend/scripts/events-barrier.mjs`, enganchada a `npm run lint`.
  En vez de leer una lista escrita a mano, **lee a los productores**: recoge todo literal con forma
  de evento asignado a un identificador que contenga «event» —`EventUserRegistered`,
  `EVENT_CATEGORY_DEACTIVATED`, `eventType`, cualquier convención— en los fuentes de `services/`
  (sin pruebas ni stubs generados), y exige que cada uno esté declarado y enlazado. Comprueba
  además las dos direcciones entre el catálogo y los bindings, y que ninguna cola sea distinta de
  `notification.q`/`audit.q`. **Su primera ejecución falló con el defecto delante**: la primera
  versión del regex se dejaba `EVENT_CATEGORY_DEACTIVATED` porque buscaba «event» en minúsculas —
  el mismo error de forma que el defecto que perseguía, así que el patrón pasó a ser
  insensible a mayúsculas y la forma se exige por el punto (`user.activity` sí, `simulation` no)—.
- La prueba de Go se conserva, porque prueba lo complementario (que lo declarado esté enlazado, con
  el canal falso delante), pero deja de ser la única defensa y su comentario lo dice.

**Comprobado en vivo después del arreglo** — reinicio del Orquestador, binding en el broker y
camino completo hasta la base:

```
$ rabbitmqctl list_bindings | grep category.deactivated
fintcart.events   category.deactivated   audit.q          ← ya está

$ curl -X DELETE localhost:8080/admin/categories/<id>     ← 204
$ psql audit_db: SELECT operation, actor_ref FROM audit_log WHERE ...
 category.deactivated | f88b1b48-…                        ← la fila que antes no existía
```

**La lección, que es la del defecto 17 con otro traje**: una promesa del sistema que nadie
comprueba no se rompe cuando alguien la incumple, sino cuando alguien la mira. Y la forma de
mirarla es **comparar la documentación con el sistema en ejecución** (`rabbitmqctl list_bindings`),
no con el diseño. T005 era una tarea de documentación y encontró un fallo de integración; eso es
exactamente lo que una tarea de contrato debe hacer.

---

## Hallazgo 21 — «Regenerar los stubs» no es reproducible sin `cargo` en el host, y la imagen del servicio no sirve para hacerlo

**Qué se intentó**: cerrar T006 regenerando los cinco stacks con `contracts/generate.sh`. El
script tiene un pre-check que se planta si falta alguna herramienta, y en esta máquina no hay
`cargo` —solo dentro de la imagen del Simulador—, así que el camino natural es hacer el paso de
Rust en el contenedor. **No funciona**, por dos motivos que no están escritos en ninguna parte:

1. `build.rs` afirma que `CARGO_MANIFEST_DIR` está en `services/<svc>` y sube dos niveles para
   encontrar `contracts/proto`. Dentro de la imagen de desarrollo el crate vive en `/src`, que no
   cumple esa forma, así que el script de construcción **panica**:
   `CARGO_MANIFEST_DIR debería estar en services/<svc>`. La ruta del contenedor es exactamente lo
   que la aserción rechaza.
2. `protoc` tampoco está en la imagen final —a propósito: los stubs están versionados y exigir el
   compilador en cada `cargo build` obligaría a tener la versión correcta en cada máquina—, así que
   `tonic-build` falla con «Could not find `protoc`».

Y un detalle que costó un intento: la imagen tiene ENTRYPOINT al binario del servicio, así que
`docker run … fintcart-simulator cargo build` **ejecuta el servidor** con `cargo build` como
argumentos, y el error que devuelve («faltan variables de entorno obligatorias: DB_ADDR,
GRPC_PORT») no tiene nada que ver con lo que se estaba intentando. Hay que pasar
`--entrypoint cargo`.

**Cómo se resolvió**: montando el árbol en una ruta que respete la forma que `build.rs` espera
(`-w /repo/services/simulator`), montando el `protoc` del host —está enlazado estáticamente, así
que corre dentro de la imagen— y apuntando `PROTOC`. Se hizo **sobre una copia** del crate en
`/tmp`, no sobre el repositorio, para no dejar ficheros generados con otro propietario.

**Resultado de T006**: los cinco stacks regeneran **byte a byte idénticos** a lo que está
versionado —cinco servicios Go, tres destinos de TypeScript, el Simulador en Rust—, así que los
stubs están al día. La prueba de que el script es un no-op es más fuerte que cualquier commit de
stubs: significa que el contrato que consume el código es el que está en `contracts/`.

**Lo que se dejó escrito**: el procedimiento que funciona, con sus dos condiciones, va en la
cabecera de `contracts/generate.sh`. Era un conocimiento de una hora que no estaba en ningún
sitio, y sin él el siguiente intento empieza por el mismo panic.

---

## Hallazgo 22 — Un arnés de pruebas de migración que se cae deja esquemas en la base (y luego cuelga)

**Qué pasó**: al escribir el arnés de las pruebas de migración (T023/T024/T122) contra PostgreSQL 16
real, una ejecución de `jest` **se colgó hasta agotar el tiempo**. En la base quedaron dos esquemas
`mig_*` y una conexión en estado `idle in transaction (aborted)`.

La causa encadenada: un fichero de migración que aborta **dentro de su propio `BEGIN`** deja la
sesión en «transacción abortada», y desde ahí toda orden posterior falla —incluido el
`DROP SCHEMA` de la limpieza—. El esquema se quedaba, la conexión también, y la siguiente ejecución
acumulaba basura. El arnés era el que estaba mal, no las migraciones.

**Arreglo**: el arnés hace `ROLLBACK` en dos sitios, y en los dos por razones distintas —al limpiar,
porque no puede saber si quedó una transacción abierta; y al capturar el fallo de una migración,
porque es el único sitio donde se sabe con certeza—. Se comprueba al final de cada suite que no
queden esquemas `mig_*`: un arnés que ensucia la base en la que corre acaba dando por buenas
ejecuciones que miden un estado que ya no es el de partida.

---

## Hallazgo 23 — La migración de categorías no se podía volver a aplicar tras revertirla

**Qué pasaba**: `20260902101500_link_articles_to_categories` se aplicaba bien, se revertía bien, y
**volver a aplicarla fallaba**:

```
ERROR: duplicate key value violates unique constraint "categories_slug_key"
DETAIL: Key (slug)=(ahorro) already exists.
```

La razón: su `down` devuelve `articles.category` pero **no borra las categorías** que creó el `up`
—no puede: borrarlas se llevaría por delante las que haya creado el administrador, y el `down` no
distingue unas de otras—. Así que al reaplicar, el paso que crea categorías desde el texto libre se
encontraba con los slugs ya tomados.

**Por qué importa**: revertir y volver a aplicar es el **camino de recuperación normal** de
`golang-migrate` —es lo que se hace cuando hay que deshacer una migración para arreglar algo—, y aquí
terminaba en un error que no explica nada. El ciclo `up → down` de T166 no lo vio porque se probó
sobre una base sin artículos: es un defecto que **solo existe con datos dentro**, igual que el de la
siembra (hallazgo 17) solo existía con la base vacía.

**Arreglo**: la migración pasa a ser **idempotente en su efecto** —`ON CONFLICT (slug) DO NOTHING`
y las posiciones contadas desde el máximo existente, porque `categories_position_active_uniq`
también chocaría—. La categoría que ya estaba se queda con su nombre y el relleno la encuentra por
slug igual que antes. Cambiar una migración ya aplicada se justifica aquí porque el cambio solo
AÑADE tolerancia: en una base ya migrada el fichero no se vuelve a ejecutar y su efecto no cambia.

**Verificado sobre los datos reales de desarrollo**, no solo sobre datos sintéticos: respaldo de
`(id, category_id)` de los 5 artículos, `down` + `up` de la migración, y después
**0 artículos sin categoría** y **0 artículos cuyo destino cambió** respecto al respaldo. Es decir:
el arreglo hace posible la reaplicación sin alterar el resultado de la primera.

**Cómo se encontró**: la prueba que pedía T024 («ningún artículo queda con `category_id` nulo y los
duplicados por tildes colapsan») incluía la reaplicación como parte del ciclo. Una prueba que solo
comprobara el `up` habría dado el visto bueno a una migración de un solo uso.

---

## Hallazgo 24 — El lint de Aprendizaje llevaba 26 errores, CI lo ejecuta, y la regla del Principio VIII fallaba sobre código correcto

**Qué pasaba**: `npm run lint` en `services/learning` devolvía **26 errores**, y el job de CI lo
ejecuta con el comentario «Lint (incluye la prohibición de number — Principio VIII)». El job llevaba
rojo sin que nadie lo mirara.

Cuatro de esos errores eran de la regla que más importa en este proyecto —la del Principio VIII,
NON-NEGOTIABLE— y **los cuatro eran correctos**:

```ts
questionsToServe: number                  // un CONTEO de preguntas
Number.isInteger(questionsToServe)        // validar un conteo
random: () => number = Math.random        // una fuente de aleatoriedad
```

La regla prohibía el tipo `number` a secas en `src/quizzes/**`, y ahí conviven las calificaciones
(`score`, `weight`, `pass_threshold`) con valores que no son dinero. Una regla que señala código
correcto es una regla que se acaba desactivando —y al desactivarla deja de proteger lo que
protegía—, así que **no se silenció: se la hizo precisar el NOMBRE**, que es lo que de verdad
distingue un valor financiero de un conteo. Los 22 restantes (aserciones redundantes, `any` que
venía de `sharp` sin tipos, tipos de retorno que faltaban, un `async` sin `await`, un `throw` de algo
que no era un `Error`) se corrigieron en el código.

**El detalle que más vale de todo esto**: al escribir la versión precisa de la regla, la primera
búsqueda del vocabulario financiero usaba la bandera `i` y sin fronteras de palabra, así que
encontraba `tasa` dentro de **«pregun-tasa-servir»** —es decir, la regla nueva tenía el mismo tipo de
falso positivo que la vieja, sobre el nombre del parámetro que la había motivado—. Lo cazó su propia
auto-prueba. Ahora el vocabulario exige empezar en frontera de palabra (`montoTotal` sí) y no seguir
en minúsculas (`preguntasAServir` no).

**La prueba de que sigue sirviendo**: `services/learning/scripts/lint-viii-selftest.mjs`, enganchado
a `npm run lint`, comprueba **nueve formas de valor financiero** que deben seguir fallando —parámetro,
propiedad de clase, miembro de tipo, `Number()`, `Math.round` y cuatro en camelCase: `montoTotal`,
`passThreshold`, `tasaInteres`, `valorUvt`— y **tres usos legítimos** que deben seguir pasando. Sin
esa auto-prueba, este cambio habría sido un ajuste de configuración que nadie vuelve a mirar: la
forma de degradar una barrera no es quitarla, es hacerla más laxa sin dejar constancia.

---

## Hallazgo 25 — La siembra nunca escribió el documento: las cinco versiones del catálogo no tenían cuerpo

**Qué pasaba**: `dev/seed` inserta los artículos del catálogo con SQL directo, y su `INSERT`
nombraba cinco columnas de `article_versions`, entre ellas `body` — el texto plano de 001—
pero **no `body_doc`**. Como el lector tenía una caída al texto (`bodyDoc: row.body_doc ??
null`, y `body` viajando al lado en el contrato), nada fallaba: la plataforma entera leía el
cuerpo de los artículos sembrados por el camino viejo y nadie se enteraba de que el documento
no estaba.

**Cómo apareció**: no lo encontró una prueba, lo encontró **la guarda de la migración de
T135**, que se niega a borrar `body` cuando alguna versión no tiene documento. Al aplicarla
sobre la base de desarrollo:

```
article_versions: 5 de 5 versión(es) sin documento; borrar `body` las dejaría sin cuerpo
```

Es el hallazgo 17 otra vez, con el signo cambiado. Aquel era «una siembra que se salta el
`INSERT` oculta el `INSERT`»; este es «una siembra que escribe una columna y no la otra
oculta que la columna que falta no la lee nadie… hasta que deja de existir». Y la lección de
fondo es la misma: **una siembra que escribe SQL directo se salta TODOS los invariantes que
el camino de escritura sostiene**, así que sus filas solo están tan bien formadas como el
cuidado de quien la escribió, y el único momento en que se nota es cuando alguien aprieta el
invariante con una migración.

**Arreglo**: la siembra escribe el documento (derivado del texto literal, con la misma regla
que la migración) y repara las versiones que sembró antes sin él, desde su propio texto y sin
tocar las que ya lo tienen. Además el `INSERT` elige su forma en tiempo de ejecución —con
`body` si la columna sigue existiendo, sin ella después de T135— para que el mismo script
sirva en una base a medio migrar y en una ya migrada: un script de desarrollo que solo
funciona en el punto exacto de la cadena de migraciones es un script que alguien va a ejecutar
en el punto equivocado.

---

## Hallazgo 26 — `jsonb_path_query(doc, '$.**.texto')` devuelve cada nodo DOS veces

**Qué pasaba**: la guarda de la migración de T135 comprueba que el texto de `body` es el que
el documento dice. La primera versión extraía los textos con
`jsonb_path_query(body_doc, '$.**.texto')` —la forma que uno escribe primero para «todos los
textos a cualquier profundidad»— y la migración **se negaba a borrar datos correctos**:

```
article_versions: 1 de 1 versión(es) tienen texto en `body` que el documento NO dice
```

El descenso recursivo devuelve cada nodo tantas veces como caminos lo alcanzan: el texto de un
párrafo aparece como descendiente del documento y otra vez como descendiente del párrafo, así
que el texto derivado salía duplicado y la comparación no cuadraba nunca.

**Cómo se encontró**: la propia prueba de la migración, en su caso más simple —«borra la
columna y deja el documento como única fuente»—, fallando sobre un dato que estaba bien. Sin
esa prueba, el camino habría sido el peor: alguien ve el error, revisa los datos, no encuentra
nada, y **afloja la guarda** para que pase. Una guarda aflojada por un falso positivo no
vuelve a proteger nada.

**Arreglo**: un CTE recursivo explícito que recorre el árbol llevando su ruta de índices. La
ruta sirve para dos cosas a la vez: recorrer sin repetirse y **ordenar** los textos como los
ordena el documento, que es justo lo que necesitaba la comparación. Se aplica también a la
reversión, donde la duplicación se habría visto como un cuerpo que dice cada párrafo dos
veces —un defecto que nadie habría notado hasta leer el texto entero con atención—.

**Y una tercera trampa, de las pruebas**: las consultas al catálogo del sistema
(`information_schema.columns`, `pg_constraint`) sin filtrar por `table_schema` devuelven las
columnas y restricciones de **todas** las tablas con ese nombre, empezando por la de `public`.
Dos pruebas del esquema de la migración medían así la base entera en lugar del esquema que
acababan de migrar —y una de ellas «veía» la columna eliminada como si siguiera—. Es la misma
clase de error que el `search_path` sin `public` que el arnés ya usaba para no resolverse
contra el esquema real: aquí el filtro que falta es el que impide leer el esquema ajeno.

---

## Hallazgo 27 — La contraseña que el README mandaba generar rompía la conexión a la base

**Qué pasaba**: el procedimiento de despliegue decía, para las dos contraseñas:

```bash
openssl rand -base64 32
```

Ese alfabeto incluye `/`, `+` y `=`, y `PG_PASSWORD` **viaja dentro de una URL**. En
`compose.app.yaml` cada servicio recibe su DSN así:

```yaml
DB_ADDR: "postgres://fintcart:${PG_PASSWORD}@${DATA_HOST}:5433/auth_db?sslmode=disable"
```

y `deploy/vps/migrate` construye la misma forma. Con un `/` dentro de la contraseña, la URL
deja de tener un host: el cliente busca… algo. El error que aparece en la primera migración
en la máquina real fue:

```
error: dial tcp: lookup fintcart on 127.0.0.11:53: server misbehaving
```

«lookup **fintcart**»: la mitad de la cadena que había antes del `/`. El mensaje no menciona
la contraseña, ni la URL, ni la base; menciona un nombre de host que nadie escribió en ningún
sitio. Es un error que manda a buscar en el sitio equivocado —a la red, a Docker, al DNS— y
lo encontró el ensayo de despliegue, no una prueba: en local la contraseña es una constante
de desarrollo (`dev_only_password`) que no tiene caracteres problemáticos, así que el defecto
**solo existe en el camino de despliegue y solo con secretos generados**.

**Arreglo, en dos capas**:

1. La receta pasa a `openssl rand -hex 32` (64 caracteres de `[0-9a-f]`, seguro en una URL, en
   una variable de entorno y en un `psql`), en el README y en las dos plantillas.
2. `deploy/vps/migrate` **se niega a trabajar** con una contraseña que rompa la URL, y lo dice
   con el motivo:

```
error PG_PASSWORD contiene caracteres que rompen la URL de conexión (/, ?, #, @, %, :, &, + o =).
      Generarla con: openssl rand -hex 32  ·  y usar el MISMO valor en .env.app
```

Fallar en `migrate` y no en los servicios es deliberado: es el primer paso que usa la
contraseña, y es donde el mensaje puede explicar la causa. En los servicios, el mismo error
llega como un fallo de conexión propio de cada lenguaje. La comprobación incluye el detalle
que hace falta para repararlo: si las bases ya se crearon, hay que rehacer los volúmenes o
cambiar la contraseña dentro de las siete instancias, porque Postgres guarda la suya en su
directorio de datos.

---

## Hallazgo 28 — Los dos primeros pasos del README no funcionaban en las máquinas del CTIC

Ninguno de los dos se podía saber desde el repositorio, y los dos aparecieron en el primer
intento de seguir el procedimiento al pie de la letra:

**1. El espejo de Ubuntu no es alcanzable.** Las máquinas salen a Internet —`archive.ubuntu.com`
responde 200, `download.docker.com` responde 200, `registry-1.docker.io` responde 401— pero
`co.archive.ubuntu.com`, el espejo colombiano que Ubuntu Server trae configurado, resuelve a
una IPv6 **sin ruta** y su IPv4 tampoco responde. El primer `apt update` del README falla, y
con él toda la instalación de Docker. Queda escrito en el paso 1, con el `sed` que apunta apt
a `archive.ubuntu.com` y una copia del archivo original antes de tocarlo.

**2. `migrate` y `seed` no tenían bit de ejecución.** El README los invoca como `./migrate`
desde el primer día, y en el repositorio los dos ficheros eran `-rw-r--r--`. El primer intento
real terminó en `bash: ./migrate: Permission denied` — un error que no dice nada del proyecto
y que cualquiera que siga la documentación va a encontrar. Corregido en el repositorio (`git`
versiona ese bit, así que el arreglo viaja con el código y no hay que acordarse de hacer
`chmod` en cada máquina).

---

## Hallazgo 29 — `golang-migrate` no imprime los `RAISE NOTICE`, así que el «aviso» de la migración de T015 no podía existir

T015 pedía que su migración **emitiera el recuento de cuestionarios cuyo banco cambió tras su
primer intento**, y T168 pedía revisar ese aviso durante el ensayo. En la ejecución real sobre
las máquinas del colegio, el aviso no apareció por ningún lado.

Antes de darlo por bueno se comprobó **si el canal existe**, con una migración de prueba en la
máquina de datos:

```sql
DO $$ BEGIN RAISE NOTICE 'ESTE AVISO TIENE QUE VERSE: % de algo', 42; END $$;
```

La migración se aplicó (la tabla de la prueba quedó creada), y el aviso **no se imprimió**.
`golang-migrate` no conecta el manejador de notificaciones del servidor: un `RAISE NOTICE`
dentro de una migración no llega al operador. Así que el canal que T015 daba por hecho no
existe, y añadir el aviso hoy no habría servido para nada.

Y hay una segunda capa, que es la de fondo: para los intentos **anteriores** a esta enmienda el
recuento **tampoco era calculable**. Lo que se sirvió en cada intento no se registraba en
ninguna parte —por eso la enmienda añade `served_snapshot`—, y el relleno de la migración usa
las preguntas ACTUALES del cuestionario. Si el banco cambió después de un intento, el
`served_snapshot` que se le pone es el banco de hoy, no el que se sirvió: la información se
perdió cuando no había columna donde ponerla. Lo que sí garantiza la migración, y se verificó
en la base real del VPS, es que **a partir de ahí** todo intento lleva lo que se sirvió
(`served_snapshot` `NOT NULL`), y que la nota está acotada a 0–100
(`CHECK (score >= 0 AND score <= 100)`), con la FK a la sesión en `ON DELETE SET NULL` para que
el historial siga siendo reconstruible cuando las sesiones se purguen (FR-016).

Queda escrito en el README del despliegue, en la sección de la enmienda, para que nadie más lo
busque en el registro de `migrate`.

---

## Hallazgo 30 — La imagen de producción del frontend no podía escribir su configuración

**Qué pasaba**: al levantar la plataforma en la máquina del CTIC, el contenedor del
frontend entraba en bucle de reinicio:

```
/docker-entrypoint.d/40-fintcart-config.sh: line 4:
  can't create /usr/share/nginx/html/config.js: Permission denied
```

El Dockerfile hace `COPY --from=build /out /usr/share/nginx/html` — que deja el árbol como
`root` — y después baja a `USER 101` (el `nginx` sin privilegios de la imagen). El script de
arranque escribe `config.js` en ese mismo directorio, así que el usuario sin privilegios no
podía crear el fichero, el contenedor se reiniciaba, y el SPA se habría quedado sin saber a
qué API apuntar.

**Por qué no se veía en ninguna prueba**: el entorno de desarrollo usa **otro Dockerfile**
(`frontend/Dockerfile.dev`). La ruta de escritura de la imagen de producción no se ejecutaba
en ningún sitio hasta que alguien la desplegó de verdad. Es el mismo patrón que el hallazgo
27 y que el `HEALTH_PORT`: **el camino de despliegue es el que nadie recorre hasta el final**,
así que los defectos se acumulan justo ahí.

**Arreglo, sin dar permisos de escritura sobre lo que se sirve**: `config.js` pasa a vivir en
`/var/lib/fintcart-config`, un directorio propio con dueño el usuario `101`
(`RUN install -d -m 0755 -o 101 -g 101 /var/lib/fintcart-config`), y nginx lo sirve con
`location = /config.js { root /var/lib/fintcart-config; }`. La alternativa —`chown` del
directorio que se sirve— habría funcionado igual y se descartó a propósito: dejaría al
proceso que sirve los ficheros con permiso para reescribirlos, que es exactamente la
diferencia entre «este contenedor no necesita privilegios» y «este contenedor, si lo
comprometen, no puede cambiar lo que entrega».

---

## Hallazgo 31 — El certificado depende de que el CTIC abra 80/443 a Internet, no solo al campus

**Qué pasó**: con la plataforma entera levantada y funcionando —el catálogo de calculadoras
respondía por dentro de la red de la aplicación, el SPA se servía, las bases migradas—, el
dominio no servía nada por HTTPS:

```
tls: handshake ... "TLS alert, internal error"      (desde la propia máquina)
challenge failed ... http-01 ... "Timeout during connect (likely firewall problem)"
```

Caddy no tenía certificado, y sin certificado rechaza el handshake. La petición a Let's
Encrypt fallaba, pero **desde la red del campus los tres puertos estaban abiertos**: 22, 80 y
443 respondían desde el portátil del autor. Es decir, el perímetro del CTIC filtraba por
origen: dejaba pasar el tráfico del campus y no el de los validadores de Let's Encrypt, que
vienen de fuera.

**Cómo se distingue esto de un defecto propio**, que es lo que importa: se comprobaron los
puertos **desde fuera de la máquina** (22/80/443 abiertos), se verificó que Caddy escucha en
80 y 443 (`ss -ltn`), y se comprobó que el resto de la plataforma responde por dentro
(`docker run --network … http://api-gateway:8080/calculators` devuelve las siete calculadoras
sembradas). Con esas tres cosas, lo único que queda en pie es el filtrado por origen del
perímetro.

**Qué hacer**: pedir al CTIC que abra 80 y 443 a Internet —su cuadro de entrega ya los lista
como «puertos solicitados para acceso desde internet (fuera del campus)»—. Caddy reintenta 30
días, así que el certificado aparece solo en cuanto lo hagan. Queda escrito en el README del
despliegue, junto con la salida provisional (`tls internal`, aviso del navegador) para
enseñar la plataforma antes de eso.

---

## Hallazgo 32 — El humo del despliegue: dos premisas mías falsas y una carrera

La suite de humo del despliegue (T170, `frontend/e2e/prod/humo.spec.ts`) falló dos veces antes
de pasar, y las dos veces el defecto era de la prueba, no de la plataforma. Queda anotado
porque el patrón se repite: **una prueba nueva contra un entorno nuevo casi siempre está mal la
primera vez, y solo se sabe ejecutándola**.

**Premisa falsa 1 — «lo sembrado incluye el catálogo»**: la prueba exigía categorías activas
porque en el entorno de desarrollo hay cinco. En el despliegue el catálogo son dos conjuntos
distintos: la **taxonomía** (categorías) la crean las migraciones de Aprendizaje, y el
**contenido** (artículos) lo escribe un editor desde la SPA, que no se siembra. La prueba pedía
contenido editorial donde el contrato promete taxonomía.

**Premisa falsa 2 — la clave de la respuesta**: el borde devuelve `{"categories": […]}`, no
`{"items": […]}`. La prueba leía `items` con un `?? []` de consuelo, así que la respuesta
correcta —cinco categorías servidas— se convirtió en «cero categorías» y el fallo apuntaba a la
plataforma. Arreglado leyendo la clave del contrato: un `?? []` silencioso transforma un cambio
de forma en «no hay contenido», que es justo el síntoma que se quiere ver.

**Y una carrera, no un problema de accesibilidad**: la comprobación de accesibilidad de la
pantalla de acceso falló una vez de tres ejecutando la suite completa y pasó siempre en
solitario. Por Internet, el fragmento perezoso de esa pantalla tarda más que en local: la
barrera —recorrido por teclado, contraste real medido sobre el color computado— empezaba sobre
un formulario que aún no existía, y el fallo se leía como de accesibilidad cuando era de reloj.
Se quitó la carrera esperando a que el botón estuviera disponible, que **no rebaja la
barrera**: mide la pantalla terminada en vez de una a medio cargar. Un `retry` habría escondido
el problema. Verificado estable con tres pasadas seguidas (7/7, 7/7, 7/7).

---

## Hallazgo 33 — La barrera de accesibilidad perdió una pantalla sin decirlo

*(La barrera es de 003 —FR-093…FR-096—, pero el hallazgo es de la misma familia que el 10
—pruebas que dejan residuos—, así que se registra aquí, con el resto de defectos.)*

**Qué pasaba**: la comprobación de accesibilidad de la pantalla del cuestionario busca un
artículo que traiga cuestionario recorriendo el catálogo, y miraba **solo los cinco primeros**.
El catálogo se sirve `ORDER BY a.created_at DESC` (`articles.repository.ts`), así que cada
artículo publicado después —el que crea `us4` en cada pasada de la suite, o cualquiera de
demostración— se coloca delante y empuja hacia abajo el artículo sembrado que sí tiene
cuestionario. Cuando pasa del quinto puesto, la prueba se salta la pantalla con `test.skip`, la
suite termina **en verde** y la barrera cubre 18 pantallas en vez de 19.

Se vio al ejecutar la suite completa después de publicar un artículo de demostración: `58 passed
· 1 skipped`. No se había tocado nada de accesibilidad; lo que cambió fue el contenido.

**Por qué importa más de lo que parece**: un `test.skip` condicionado por el orden de los datos
es una pérdida de cobertura disfrazada de resultado normal. Un límite fijo sobre una lista que
crece hacia arriba garantiza que algún día se pierda — y no avisa el día que ocurre, sino que
llevaba perdiéndose desde la primera pasada con contenido nuevo—.

**Arreglo**: se recorre el catálogo **entero** hasta encontrar el artículo con cuestionario. El
`test.skip` se queda, pero ahora significa lo que dice —que ningún artículo de la fixture trae
cuestionario— y no «que el artículo cayó fuera de la ventana». Verificado: la barrera pasa 5/5
sin ningún salto.

**Lo que NO se toca, y por qué**: el mismo patrón existe en `e2e/us1-aprendizaje.spec.ts`, que
mira **solo el primer artículo** y se salta el paso del cuestionario en cuanto hay un artículo
más reciente. Esa spec está protegida por N-13 —sus aserciones son la garantía dura del feature
y ajustarlas destruye justo lo que protegen—, así que ahí el arreglo no es de la prueba sino del
procedimiento: **la ejecución que demuestra cobertura completa es la de una pila recién sembrada**
(`dev/down --volumes && dev/up && dev/migrate && dev/seed`), que ya está documentada como paso
previo a cualquier demostración. En una pila limpia el primer artículo del catálogo es el que
trae cuestionario y el paso se ejecuta.

---

## Hallazgo 34 — La imagen oficial de Playwright trae los navegadores, no el paquete

**Qué pasaba**: al meter la suite del despliegue en un contenedor (`deploy/vps/Dockerfile.e2e`,
T173) se dio por hecho que la imagen oficial `mcr.microsoft.com/playwright` trae Playwright
instalado, además de los navegadores. **No lo trae**: `npx playwright --version` dentro de la
imagen no encontró el paquete y **se lo descargó de la red, en la versión más nueva** (1.63.0,
cuando el frontend tiene la 1.62.0). El humo habría corrido con otro motor que las 59 pruebas
de desarrollo, y el desajuste no se habría visto al construir sino al lanzar el primer test,
con un error de navegador que no dice nada de versiones.

**Por qué importa**: `npx` resolviendo «lo último» dentro de una imagen que se cree fija es la
forma más silenciosa de perder la reproducibilidad: mismo Dockerfile, mismas capas, y de pronto
otro motor. Y aquí las dos versiones están relacionadas de verdad —Playwright espera el binario
`chromium-1234` que trae la etiqueta de la imagen—, así que el desacople se paga en fallos
raros.

**Arreglo**: la versión se instala **fija** (`@playwright/test@1.62.0`) y, en la misma
construcción, (1) se comprueba que `npx playwright --version` devuelve la esperada y (2) se
**arranca un Chromium de verdad** (`chromium.launch()`). Lo segundo vale por sí solo: demuestra
que el paquete y el navegador de la imagen se entienden, que es justo lo que un desajuste de
versiones rompe. Construir la imagen en la máquina pasó de «descarga lo que pille» a una
afirmación comprobada.

---

## Hallazgo 35 — La prueba de solo lectura reinició un servicio de producción

**Qué pasaba**: después de una pasada del humo, `docker ps` mostraba `learning` «Up 19 seconds»
cuando llevaba once horas en pie. El registro de eventos de Docker lo confirmó sin ambigüedad: en
el segundo exacto de la ejecución, el contenedor antiguo se renombró (`78cc0718d32d_…`), se mató y
se creó uno nuevo. La causa estaba en el propio guion: `docker compose run --build` —al
reconstruir imágenes del proyecto, Compose recrea los servicios cuya imagen cambió—.

**Por qué importa**: el humo promete ser de solo lectura y hasta aquí lo era *en la base de
datos*; en la máquina, en cambio, estaba reiniciando un servicio del despliegue. En una máquina de
4 GB con las nueve piezas de pie, un reinicio no pedido no es una anécdota: es una caída durante
el tiempo de arranque, y el operador no tiene forma de saber que la causó una prueba.

**Arreglo**: la imagen de la suite se construye aparte y **solo ella** (`compose build e2e` no
toca dependencias; eso exige `--with-dependencies`). Verificado comparando los identificadores de
los diez contenedores antes y después de una pasada: **idénticos**.

**La lección, que es más general**: «solo lectura» hay que decirlo del sistema entero, no solo de
los datos. Un comando de prueba que reconstruye, reinicia o reconcilia el despliegue no es un
comando de prueba.

---

## Hallazgo 36 — Las capturas del humo quedaban como root y su dueño no podía borrarlas

**Qué pasaba**: todo lo que la suite escribe —capturas, rastros, el JSON de la última pasada—
cae en `deploy/vps/e2e-results/`, una carpeta del anfitrión montada desde el contenedor. El
contenedor corría como root, así que esos ficheros quedaban como root: al borrar la carpeta, el
`rm -rf` del operador falló con «Permission denied» sobre el `.last-run.json` que había escrito la
pasada anterior, y hubo que recurrir a `sudo`.

**Por qué importa**: una prueba que deja basura que su dueño no puede borrar es una prueba que se
deja de ejecutar —y, peor, la que se ejecuta «un poco sucia» deja de ser reproducible—. Nadie
ejecuta a gusto algo que exige `sudo` para limpiarse.

**Arreglo**: el contenedor corre con el uid del operador (1000 por defecto, el mismo que la imagen
oficial usa para `pwuser`; `E2E_UID`/`E2E_GID` lo ajustan) y la carpeta de resultados se crea en la
construcción con permiso de escritura. Verificado: las capturas nuevas salen con uid 1000 y el
`rm -rf` funciona sin `sudo`.

---

## Hallazgo 37 — Una variable obligatoria en un servicio bajo perfil bloquea el proyecto entero

**Qué pasaba**: al añadir el servicio `e2e` a `compose.app.yaml` se declaró `E2E_BASE_URL` como
obligatoria (`${E2E_BASE_URL:?falta E2E_BASE_URL}`), con la idea de que nadie lanzara el humo sin
decir contra qué. El primer comando que se intentó después —`docker compose up -d --force-recreate
--no-deps caddy`, que no tiene nada que ver con el humo— respondió:

```
error while interpolating services.e2e.environment.E2E_BASE_URL: required variable
E2E_BASE_URL is missing a value: falta E2E_BASE_URL: di contra qué dominio lanzas el humo
```

**Por qué importa**: Compose interpola **el fichero entero** antes de mirar qué perfiles están
activos, así que un servicio que no se va a arrancar puede impedir levantar, migrar o sembrar el
despliegue. La protección de una pieza pasó a ser un cerrojo para todas las demás — y el
despliegue de producción quedó a un comando de distancia de no poder reiniciarse.

**Arreglo**: el valor por defecto es el dominio de Caddy (`${E2E_BASE_URL:-https://${DOMAIN}}`),
que es lo que se quiere el 99 % de las veces y nunca `localhost`. La exigencia de decirlo en voz
alta se queda donde de verdad hace falta: en el guion `deploy/vps/e2e` (que siempre lo fija) y en
la propia suite, que aborta con su mensaje si llega vacío. Un requisito de una pieza va en la
pieza, no en el fichero que comparten todas.

---

## Hallazgo 38 — `git checkout` rompe el montaje por bind, y el contenedor sigue leyendo el fichero viejo

**Qué pasaba**: se quitó `tls internal` del `Caddyfile` —en la máquina, el árbol es un clon del
repositorio— y Caddy seguía sirviendo el certificado de su autoridad interna, además de conservar
la directiva dentro del contenedor (`grep -c "tls internal" /etc/caddy/Caddyfile` dentro del
contenedor daba 1, mientras en disco daba 0).

**Por qué**: un montaje por bind ata el contenedor a un **inodo**, no a un nombre. `git checkout`
no edita el fichero: escribe uno nuevo y lo renombra encima, así que el inodo viejo —con la
directiva— siguió vivo dentro del contenedor mientras el árbol de fuera ya era otro. Que el
contenedor y el disco discrepen así no da ningún aviso: los dos «tienen» el fichero, y solo uno es
el que se aplica.

**Arreglo y regla**: para que un fichero montado entre en vigor hay que **recrear** el contenedor
(`docker compose up -d --force-recreate --no-deps <servicio>`), y eso conviene saberlo justo
después de un `git pull`. Los servicios con el código horneado en la imagen no tienen el problema
—cambia el identificador de la imagen y Compose los recrea solo—, pero los ficheros montados
(`Caddyfile`, y cualquier otro `:ro`) sí. La trampa es silenciosa: `up -d` dice que todo está
«up-to-date» mientras el contenedor corre una configuración que ya no está en el repositorio.

---

## Hallazgo 39 — La configuración de tiempo de ejecución tenía solo la mitad, y la prueba miraba el fichero y no el cableado

**Qué pasaba**: al intentar registrar una cuenta en el despliegue del colegio, la pantalla
devolvía **`405 Not Allowed` de nginx**. La causa no estaba en el registro: la configuración de
tiempo de ejecución estaba implementada **a medias**. Existía la mitad del servidor —
`frontend/Dockerfile` escribía `config.js` al arrancar el contenedor y nginx lo servía, con su
`location` propia y su comentario explicando por qué vive fuera del árbol estático— y faltaba la
del cliente: **no había ni una referencia a `window.__FINTCART_CONFIG__` en todo el SPA** y el
`index.html` no lo cargaba. El bundle usaba el valor compilado, `apiBaseUrl: '/v1'` —un
marcador en `environment.ts`—, así que cada llamada al API salía hacia `/v1/...`; Caddy no tiene
nada para esa ruta, caía al `handle` del frontend y nginx respondía `405` a un POST sobre un
fichero estático (y `200` con HTML a un GET, que es todavía más silencioso).

**Por qué no lo cazó nadie**: la prueba del humo comprobaba que el borde **sirve** `/config.js`
y que su contenido apunta al API del propio dominio —y eso lo hacía bien, el fichero estaba
impecable—. Lo que no miraba era el **cableado**: que el SPA lo use. Un fichero de configuración
correcto que nadie lee es indistinguible de no tenerlo, y la prueba pasaba en verde igual. Se
descubrió usándolo.

**Arreglo**: `frontend/src/config.js` (valor de desarrollo, servido por el servidor de
desarrollo), el `<script src="/config.js">` en `index.html` antes del bundle, y la aplicación en
`main.ts` antes de `bootstrapApplication` —fuera de un `APP_INITIALIZER`, para que ningún
servicio pueda construirse antes— tolerando que el fichero no exista. El `config.js` del
contenedor lleva además el cliente OAuth, con la `redirect_uri` derivada del dominio (el
`environment.ts` compilado apuntaba a `https://app.fintcart.co`, que no es este despliegue).

**La prueba que faltaba** es la que importa: navega, envía el formulario de acceso con una
cuenta que no existe —no crea nada— y comprueba **a dónde va la petición y quién responde**:
`POST {origen}/api/oauth/authorize` con `401` del borde. Eso distingue el `405` de nginx (el SPA
no pasa por el borde), el `404` del borde (ruta equivocada) y el `401` (correcto). Se añade la
misma comprobación sobre `POST /api/auth/register`, que es por donde salió el fallo.

**Y una errata de nombre que casi lo repite**: el contenedor escribe `__FINTCART_CONFIG__` y el
código nuevo que escribí leía `__FINTICART_CONFIG__` —un guion bajo de diferencia—. Lo delató el
editor al no encontrar el texto, no una prueba: con el nombre equivocado el SPA habría arrancado
igual, con el valor compilado, y el fallo habría sido idéntico al de arriba.

---

## Hallazgo 40 — El despliegue no tenía cliente OAuth: nadie podía iniciar sesión

**Qué pasaba**: la tabla `oauth_clients` de la base desplegada estaba **vacía**. `dev/seed`
registra el cliente de la SPA (`fintcart-spa`) desde el primer día, y el sembrado del despliegue
no lo hacía: solo escribía las calculadoras y los indicadores. Se podía registrar una cuenta y
verificar el correo, pero al iniciar sesión el servidor de autenticación no reconocía al cliente
y el flujo era imposible.

**Por qué importa**: es el mismo error de diseño que el hallazgo 17 —«El sembrado escribe lo que
la plataforma necesita para FUNCIONAR»—, repetido en otra tabla. El sembrado del despliegue se
escribió pensando en «los datos de producto» (calculadoras, indicadores) y dejó fuera un dato de
infraestructura sin el cual no hay sesión. Y como la plataforma se ve en pie —el SPA carga, el
catálogo público responde—, no parece roto hasta que alguien intenta entrar.

**Arreglo**: `deploy/vps/seed` registra el cliente con la `redirect_uri` **derivada del dominio**
del despliegue (`https://<dominio>/auth/callback`), que es exactamente la que
`frontend/Dockerfile` escribe en `config.js`: el servidor compara ambas y rechaza el flujo si
difieren, así que las dos salen del mismo sitio. `ON CONFLICT DO UPDATE` sobre `redirect_uris`,
para que un cambio de dominio se corrija al volver a sembrar.

---

## Hallazgo 41 — `SMTP_PASSWORD` con espacios rompe `source .env.app`

**Qué pasaba**: al cargar el entorno con `set -a && . ./.env.app` para una consulta puntual, la
shell intentaba ejecutar un trozo de la contraseña: `./.env.app: line 33: qafu: command not
found`. La contraseña de aplicación de Gmail se pega con espacios —Google los ignora— y en un
fichero de entorno eso convierte el resto de la línea en una orden.

**Por qué importa poco y por qué se registra igual**: con `docker compose --env-file` no pasa
nada, porque Compose lee el fichero sin shell y conserva el valor entero —y por eso el correo
funciona—. Pero cualquiera que haga `source .env.app` para una comprobación manual se encuentra
un error que no menciona la contraseña ni el fichero. Pasó tres veces en esta sesión.

**Arreglo recomendado** (no aplicado, para no tocar credenciales en caliente): entrecomillar el
valor (`SMTP_PASSWORD="…"`), que Compose acepta y quita las comillas. O, mejor, pegar la
contraseña sin espacios: Google los ignora igual.

---

## Hallazgo 42 — El borde acepta un registro que la capa de dominio va a rechazar, y el fallo llega tarde y sin motivo

**Qué pasaba**: `POST /api/auth/register` con una contraseña de cinco caracteres devuelve **`202`
con su `saga_id`** —«aceptado»— y el rechazo aparece después, en el orquestador, como una saga
`failed` en el paso 0:

```
paso 0 (auth.create_credential): crear credencial de …: rpc error: code = InvalidArgument
desc = server: la contraseña no cumple la política: mínimo 12 caracteres
```

**Lo que está bien, y conviene decirlo primero**: la política **sí se aplica**, y se aplica donde
tiene que aplicarse —en el servicio de autenticación, no en el borde—. La prueba de que la
validación en profundidad funciona es justamente ese rechazo: con la contraseña corta no se creó
**nada** (0 credenciales, 0 perfiles, 0 correos), y la saga se compensó sola.

**Lo que está mal es el camino del error**: el borde ya conoce el contrato —valida campos
obligatorios y rechaza campos desconocidos—, pero no valida la política de contraseña, así que
acepta una petición que sabe que la capa de dominio va a tirar. El cliente recibe un `202`, se le
dice «revisa tu correo», y el registro no existe: para saber qué pasó hay que ir a la tabla de
sagas. Un `400` inmediato con el motivo es la misma decisión de negocio comunicada a tiempo.

En la SPA no se nota, porque el formulario valida el mínimo antes de enviar (y por eso se escapó:
la validación del cliente tapaba la del borde). Se ve con cualquier cliente que no sea el
formulario —una consola, un script, una integración—.

**Anotado, no arreglado**: exigir la política en el borde es tocar el contrato del Gateway y sus
pruebas, y no es un riesgo de seguridad —la contraseña débil NO entra en la base—. Queda como
mejora de la calidad del error, no como defecto abierto.

**Y la lección operativa, que es de esta sesión**: se descubrió haciendo un sondeo contra
producción que yo creía de solo lectura («contraseña inválida, luego rechazará»). **No lo era**:
el borde aceptó, arrancó dos sagas de registro y devolvió `saga_id`. Solo no quedó nada porque la
validación en profundidad lo impidió. Contra un entorno real, un sondeo solo es inocuo si se
conoce la validación del servidor hasta el final —y si no se conoce, hay que asumir que escribe—.
En este caso la comprobación posterior (0 credenciales, 0 perfiles, 0 correos) es la que permitió
afirmar que no había daño, en vez de suponerlo.

---

## Hallazgo 43 — `docker compose restart` no relee el fichero de entorno, así que el paso documentado para conceder el rol de administrador no funcionaba

**Qué pasaba**: el procedimiento documentado para que exista un administrador era poner el
correo en `BOOTSTRAP_ADMIN_EMAIL` y **reiniciar** `users`:

```bash
docker compose -f compose.app.yaml --env-file .env.app restart users
```

Se hizo exactamente eso, en el orden documentado, y el rol no apareció: la cuenta seguía con
`usuario_final`. Un `up -d` en su lugar lo arregló en diez segundos.

**Por qué**: `restart` no vuelve a crear el contenedor —lo para y lo arranca—, así que conserva
el entorno con el que se creó. Las variables nuevas de `.env.app` no llegan: `--env-file` se lee
al **crear**, no al reiniciar. Para aplicar variables hay que recrear (`up -d`) o forzarlo
(`--force-recreate`).

**Por qué importa más de lo que parece**: la instrucción era la única vía a un administrador en
el despliegue —el rol no se concede por API (FR-008) ni se siembra en una migración (D-21)—, y
fallaba **en silencio**: no hay error, simplemente el rol nunca aparece y la conclusión natural
es «BOOTSTRAP_ADMIN_EMAIL no funciona» o «lo he puesto mal». El README, el mensaje final de
`deploy/vps/seed` y el propio hallazgo 40 daban la orden equivocada.

**Arreglo**: las dos instrucciones dicen ahora `up -d users`, con el porqué escrito al lado. La
lección general: `restart` reinicia un proceso, no redefine su configuración; cualquier cosa que
venga de `.env` exige recrear el contenedor.

**Y de paso**: el despliegue no tenía forma de conceder los roles editoriales —`dev/seed role`
es de desarrollo y `administrador` no hereda `coordinador_editorial` (FR-082)—, así que la parte
editorial no se podía enseñar en el despliegue sin escribir SQL a mano. Nace `deploy/vps/rol`.
