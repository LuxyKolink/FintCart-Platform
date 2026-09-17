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
