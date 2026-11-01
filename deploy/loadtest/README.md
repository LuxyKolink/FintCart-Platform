# Pruebas de carga

Dos guiones de k6, con criterios distintos y entornos distintos. Conviene saber cuál es cuál antes
de leer un número.

| Guion | Qué mide | Criterios | Entorno que le corresponde |
|---|---|---|---|
| `k6-scenarios.js` | La plataforma entera bajo carga: lecturas de catálogo, progreso e historial, y las acciones de cuentas concurrentes | SC-003 (lecturas < 1 s) y SC-005 (respuesta percibida < 2 s con ≥ 1.000 usuarios concurrentes) | **Desplegado** (`deploy/k8s`, ≥ 2 réplicas y HPA). Contra `dev/up` mide el portátil |
| `k6-calculadora.js` | El endpoint de ejecución de calculadoras, comparando una definición en el tope de FR-046 con una trivial | FR-047 y D-15 (coste acotado del AST) — T162 | `dev/up` y también desplegado: lo que persigue no es una cifra de latencia sino que el coste no dependa de la fórmula |

```bash
# La prueba del constructor de calculadoras, de principio a fin:
deploy/loadtest/calculadora.sh preparar    # calculadoras publicadas por el camino real + cuentas
deploy/loadtest/calculadora.sh correr      # k6 en un contenedor, dentro de la red del compose
deploy/loadtest/calculadora.sh limpiar     # borra las calculadoras, sus simulaciones y sus sagas

# La de la plataforma entera, con bolsa externa de cuentas y el perfil acordado:
docker run --rm --network fintcart_fintcart \
  -v "$PWD/deploy/loadtest:/scripts:ro" -v "/tmp/k6/pool.csv:/pool/pool.csv:ro" \
  -e LOADTEST_BASE_URL=http://api-gateway:8080 -e LOADTEST_ACCOUNTS_CSV=/pool/pool.csv \
  -e VUS=200 -e RAMP=1m -e HOLD=3m -e DOWN=30s \
  grafana/k6 run /scripts/k6-scenarios.js

# En el host, si hay binario de k6:
k6 run -e LOADTEST_BASE_URL=http://localhost:8080 \
  -e LOADTEST_ACCOUNTS_CSV=/tmp/k6/pool.csv -e VUS=200 deploy/loadtest/k6-scenarios.js
```

## Los tres flujos que el guion tenía rotos (y cómo quedaron)

El guion se escribió contra una API anterior. En esa forma reportaba fallos suyos como fallos del
producto — el modo más caro de equivocarse en un informe, porque el número existe, tiene decimales y
señala al sitio equivocado. Los tres, y qué se comprobó a mano contra el borde antes de reescribirlos:

| Flujo | Qué hacía | Qué responde el sistema | Qué hace ahora |
|---|---|---|---|
| Cuestionario | `POST /quizzes/{id}/attempts` con `{answers}` → **409 `session_id es obligatorio`** | `POST /quizzes/{id}/session` → **201** `{session_id, quiz_id, title, pass_threshold, expires_at, questions[{question_id, prompt, options[{key,text}], weight}]}`; `POST /quizzes/{id}/attempts` con `{session_id, answers:{question_id: option_key}}` → **201** `{attempt_id, attempt_no, score, passed, points_after}` | Abre sesión, responde **solo las preguntas servidas** (eligiendo la primera opción servida: el servidor no expone la correcta, que es el punto de FR-040) y envía el `session_id` |
| Simulador | `POST /simulators/fondo_emergencia/run` → **400 `tipo de cálculo desconocido`** | Solo `ahorro`, `credito`, `presupuesto` están en `calcTypeByPath`; `fondo_emergencia` solo se alcanza por `POST /calculators/{id}/run` | Ejecuta **las tres**, rotando por VU e iteración (etiqueta `calc`), con las entradas de cada definición semilla |
| Fondo de cuentas | Se auto-provisionaba `loadtest<timestamp>_<i>@fintcart.co` **dentro de la corrida** | — | `LOADTEST_ACCOUNTS_CSV` lee una bolsa ya creada; el alta sale de la ventana medida |

Las entradas de cada calculadora, leídas de `services/simulator/src/domain/seeds/generales.rs` (la
ruta por `calc_type` ya no ejecuta código nativo: resuelve la semilla, T098/FR-043, así que un
nombre inventado es 400 «campo desconocido»):

- `ahorro`: `deposito_inicial`, `aporte_mensual`, `tasa_anual`, `meses`
- `credito`: `monto`, `tasa_anual`, `meses`
- `presupuesto`: `ingreso_mensual`, `gastos_fijos`, `gastos_variables`

`setup()` conserva además un **calentamiento** fuera de las métricas: un intento y las tres
simulaciones por cuenta, para que `/me/progress` y `/simulators/history` no empiecen vacíos (una
lectura vacía es más barata y mediría un caso mejor que el real). Y es un **canario**: la primera
cuenta es estricta, así que si el contrato se mueve otra vez la corrida muere en `setup()` con el
endpoint y el cuerpo del error, en lugar de reportar miles de fallos que parecen del producto.

## Variables de entorno

| Variable | Defecto | Qué hace |
|---|---|---|
| `VUS` (alias `LOADTEST_VUS`) | `1000` | VUs objetivo de la etapa de sostenido |
| `RAMP` (alias `LOADTEST_RAMP_UP`) | `30s` | Subida de 0 a `VUS` |
| `HOLD` (alias `LOADTEST_HOLD`) | `2m` | Sostenido a `VUS` |
| `DOWN` (alias `LOADTEST_RAMP_DOWN`) | `30s` | Bajada de `VUS` a 0 |
| `LOADTEST_ACCOUNTS_CSV` | vacío | Ruta a un CSV `email,password` (con cabecera, sin comillas). Leído con `open()` en el contexto de inicialización — k6 prohíbe IO de ficheros dentro de la VU y de `setup()`. Vacio ⇒ auto-provisión interna |
| `LOADTEST_USER_POOL` | `40` | Cuántas cuentas auto-provisionar cuando no hay CSV |
| `LOADTEST_BASE_URL` | `http://localhost:8080` | Borde a medir |
| `LOADTEST_MAILHOG_URL` | `http://localhost:8025` | Solo en la auto-provisión: donde se sondea el correo de verificación |
| `K6_SETUP_TIMEOUT` | `10m` | Opción nativa de k6, con su prefijo real |

Con CSV se usan como máximo `VUS` cuentas (más cuentas que VUs no aportan nada: el reparto es una
cuenta por VU, y cada una cuesta un login y un calentamiento de `setup()`).

## El límite de tasa es por usuario, y una VU necesita su cuenta

El borde limita **dos veces** (`services/api-gateway/internal/handler`): por IP y por usuario
autenticado, 600 peticiones por minuto cada uno (`RATE_LIMIT_RPM`). Eso obliga a dos cosas:

- **Una cuenta por VU.** Varias VUs compartiendo una cuenta suman sus peticiones al mismo contador:
  30 VUs a una petición por segundo piden unas 1.800 rpm contra un tope de 600, y la corrida
  devuelve 429 en masa. Lo que se mide entonces es el limitador, no el sistema. Por eso
  `calculadora.sh` exige `LOADTEST_ACCOUNTS ≥ LOADTEST_VUS` y lo comprueba antes de arrancar.
- **Una IP por VU.** Por la misma razón, y es lo que hace el `X-Forwarded-For` sintético de los dos
  guiones: el borde confía en esa cabecera porque corre detrás de un proxy.

`k6-scenarios.js` trae 40 cuentas por defecto para los 1.000 VUs por defecto `[LOADTEST_USER_POOL]`.
Con el límite por usuario, esa combinación **no puede pasar sus propios umbrales**: 25 VUs por
cuenta a ~1,5 peticiones por segundo son ~2.250 rpm contra 600. Por eso la corrida que cuenta se
hace con una bolsa externa del tamaño del perfil (200 cuentas, `VUS=200`), y no con el defecto.

## La corrida acordada para la tesis: `VUS=200`

El defecto de `1000` no está validado y no debe usarse como cifra del informe: **nunca se corrió en
este hardware**, y con la bolsa de 200 cuentas (`/tmp/k6/pool.csv`, `Prueba-desarrollo-2026!`) serían
cinco VUs por cuenta, que frente al límite de 600 rpm por usuario es un 429 garantizado. La corrida
que se reporta es:

```bash
VUS=200 RAMP=1m HOLD=3m DOWN=30s LOADTEST_ACCOUNTS_CSV=/tmp/k6/pool.csv
```

Una cuenta por VU, y 200 cuentas es el tamaño de la bolsa: subir de ahí exige bolsa nueva o subir
`RATE_LIMIT_RPM` **a sabiendas**, y decirlo en el informe (un límite subido para que pase una prueba
deja de ser el sistema que se despliega). El mensaje que el guion imprime al arrancar deja
constancia de la procedencia del fondo y del perfil, para que la corrida sea reproducible desde su
propia salida.

## Humo del guion arreglado (2026-11-01, `dev/up`, borde :8080)

**No es una medición de SC-003/SC-005**: es la prueba de que el guion ya no falla por sus propios
defectos. 3 VUs durante 20 s (5 s de subida, 10 s de sostenido, 5 s de bajada) con la bolsa de 200
cuentas, exportando el resumen a un directorio montado:

```bash
mkdir -p /tmp/k6/out && chmod 1777 /tmp/k6/out
docker run --rm --network fintcart_fintcart \
  -v "$PWD/deploy/loadtest:/scripts:ro" -v "/tmp/k6/pool.csv:/pool/pool.csv:ro" -v "/tmp/k6/out:/out" \
  -e LOADTEST_BASE_URL=http://api-gateway:8080 -e LOADTEST_ACCOUNTS_CSV=/pool/pool.csv \
  -e VUS=3 -e RAMP=5s -e HOLD=10s -e DOWN=5s \
  grafana/k6 run --summary-export=/out/summary.json /scripts/k6-scenarios.js
```

| Métrica | Valor | Umbral |
|---|---|---|
| `http_req_failed` | **0,00 %** (0 de 165) | `< 1 %` ✓ |
| `fintcart_read_duration` p(95) | **5,31 ms** | `< 1.000 ms` ✓ |
| `fintcart_action_duration` p(95) | **22,73 ms** | `< 2.000 ms` ✓ |
| `checks` | **189/189** (7 nombres + los `setup:` de la preparación) | — |
| `iterations` / `http_reqs` | 24 / 165 en 20 s | — |

Desglose de `fintcart_unexpected_responses` en esa corrida — **vacío, que es el resultado bueno**:

```
fintcart_unexpected_responses{phase:vu}      count=0
fintcart_unexpected_responses{phase:setup}   count=0
fintcart_unexpected_responses{status:0|400|401|403|404|409|413|429|500|502|503|504}  count=0
```

Que todas las series salgan a cero y no desaparezcan del informe es deliberado: los umbrales
`count>=0` que las materializan existen para que un fallo se vea, y su ausencia también se lea.

## Exportar el resumen (`--summary-export`)

El guion no escribe ficheros ni asume ninguna ruta: k6 lo hace por ti. Si el contenedor corre como
usuario no privilegiado (la imagen `grafana/k6` usa un UID propio), **el directorio montado tiene que
ser escribible por ese UID** o el export falla en silencio y te quedas sin resumen:

```bash
mkdir -p /tmp/k6/out && chmod 1777 /tmp/k6/out     # o: chown 12345:12345 /tmp/k6/out
docker run ... -v /tmp/k6/out:/out ... grafana/k6 run --summary-export=/out/summary.json /scripts/k6-scenarios.js
```

- `--summary-export` da los agregados, incluidas las series etiquetadas de
  `fintcart_unexpected_responses` (`{status:429}`, `{phase:setup}`…) — son legibles por máquina, que
  es lo que necesita una tabla de tesis.
- La etiqueta `check` y el `path` de cada fallo no salen en ese JSON (k6 solo materializa las series
  con umbral). Para el desglose completo, muestra a muestra: `--out csv=/out/metrics.csv`.
- `--summary-mode=full` es cosmético aquí: no materializa series sin umbral.

## De dónde salieron los 160 fallos de la corrida de 200 VUs

La corrida real (200 VUs, 3 min 15 s, 74.800 peticiones) dio `http_req_failed` **0,21 % = 160
fallos** con los tres umbrales en verde. Se atribuyeron leyendo el log de acceso del borde
(`docker logs fintcart-api-gateway-1`, que registra `status` por petición):

| status | path | n |
|---|---|---|
| 429 | `POST /quizzes/{id}/session` | **160** |
| 202 | `/auth/register` | 556 (esperado: el registro responde 202) |

Las 160 peticiones rechazadas caben en **58 ms** (`20:40:34.468` → `20:40:34.526`) y **no hay un
solo 429 después de la última sesión correcta** (`20:43:34`, ya al final de la corrida). Es decir:
ocurrieron todas antes de que empezara la ventana medida.

Hipótesis, con la evidencia a favor: era el **calentamiento de `setup()`**. Cada cuenta del fondo
hace un login (2 peticiones) y cinco peticiones de calentamiento, y `setup()` corría sin
`X-Forwarded-For`, así que sus ~1.400 peticiones salían **todas de la IP del contenedor de k6**
mientras el borde limita por IP a 600 rpm. Con ~400 peticiones de login ya consumidas por bcrypt
(~60 s), el cupo que quedaba era de unas 200: pasaron ~37 sesiones, se rechazaron 160, y el resto de
la ráfaga siguió su curso. Encaja en número, en endpoint, en duración y en posición temporal — pero
es una reconstrucción, no una traza: lo que la confirma o la refuta la próxima corrida es el
desglose.

Dos cosas se hicieron al respecto:

1. **`setup()` usa ahora IPs sintéticas propias** (`10.255.x.y`, una por cuenta, fuera del rango
   `10.<vu>` de las VUs), así que su tráfico deja de compartir el cupo por IP con el contenedor. Los
   429 de la preparación no deberían reaparecer; si reaparecen, el desglose dirá de qué fase vienen.
2. **Cada respuesta no esperada queda atribuida** en `fintcart_unexpected_responses` con
   `status`, `check`, `phase` (`vu` = ventana medida, `setup` = preparación) y `path`. El veredicto
   del informe se lee así: `phase:vu` en cero es «la plataforma no falló»; `phase:setup` distinto de
   cero es «el arnés se tropezó consigo mismo», y ya no se suma al mismo número.

Ojo con un detalle que hace que los dos números no siempre coincidan: `http_req_failed` cuenta
cualquier 4xx/5xx, mientras que el contador cuenta las respuestas que no son la esperada por su
`check` — un 200 donde se esperaba 201 no mueve `http_req_failed` y sí mueve el contador.

## Lo que se midió (T162)

Con `dev/up` en un portátil cargado (los siete PostgreSQL, RabbitMQ, Redis, los ocho servicios y k6
compartiendo la máquina), 124 segundos por corrida, `POST /calculators/{id}/run` —que pasa por el
borde, el Orquestador, el Simulador y la escritura del historial (FR-050)—:

| Concurrencia | Peor caso admisible (p95) | Control trivial (p95) | Fallos |
|---|---|---|---|
| 30 VUs (~24 req/s) | **112 ms** | 60 ms | 0 |
| 60 VUs (~42 req/s) | **155 ms** | 110 ms | 0 |

Y el número que da sentido a los anteriores, medido **sin red y sin base** en el crate
(`services/simulator/tests/bounded_cost.rs`):

```
peor caso admisible (10 salidas × pot(·, 1200)): ~290 µs por ejecución
```

Leído junto: el peor caso admisible —las dos palancas de FR-046 al tope, diez salidas con `pot` al
exponente máximo— cuesta **~290 µs de CPU**, y en la petición completa se traduce en decenas de
milisegundos más que una definición trivial porque el Simulador compite por la CPU con todo lo demás
en una máquina saturada. Lo que importa para SC-005 es dónde queda el p95: **112 ms y 155 ms contra
un presupuesto de 2.000 ms**, con cero errores y sin que la latencia se desborde al doblar la
concurrencia. El coste del AST está acotado, y el tope no lo pone el host: lo pone la validación.

Dos detalles del método que hacen que los números signifiquen algo:

- **El control tiene también diez salidas.** Con una sola salida, el p95 del control era 55 ms frente
  a los 100 ms del peor caso, y la diferencia se habría atribuido al evaluador cuando lo que
  costaba era devolver y guardar diez resultados en vez de uno. Con diez salidas en los dos, la
  comparación aísla la fórmula.
- **Se invirtió el orden** para descartar que la diferencia fuera de posición (el peor caso se
  ejecuta primero en cada iteración). Invertido —el control primero— la relación es la misma: la
  diferencia sigue a la definición, no al orden.

Para reproducirlo:

```bash
deploy/loadtest/calculadora.sh preparar
LOADTEST_VUS=30 deploy/loadtest/calculadora.sh correr
deploy/loadtest/calculadora.sh limpiar
```

## Dos trampas que costaron una corrida cada una

- **El cuerpo de la petición es `{"inputs":{…}}`**, no el mapa de entradas pelado. El borde
  decodifica con campos desconocidos prohibidos, así que `{"base":"0.05"}` responde
  `400 unknown field "base"`. La primera corrida dio **100 % de fallos a 2 ms** —un número
  demasiado bonito—, y por eso el guion imprime el cuerpo del primer fallo: sin eso, «✗ 0 / ✗ 4530»
  no distingue un 400 del cuerpo, un 401 de un token caducado o un 429 del limitador, que se
  arreglan en tres sitios distintos.
- **`localhost` dentro del contenedor de k6 es el propio contenedor.** La dirección del borde no va
  en el archivo de entorno que genera `calculadora.sh`; la pone `correr` (`api-gateway:8080`, el
  nombre del servicio en la red del compose) y se puede apuntar a otro despliegue con
  `LOADTEST_BASE_URL`.

## Lo que la prueba deja en la base (y no es un incidente)

`calculadora.sh` crea cuentas de verdad, y `dev/token` las registra **siempre**, aunque ya existan
—es lo que lo hace idempotente—. Volver a registrar un correo ya registrado falla, como debe: el
Simulador y Auth responden `FailedPrecondition` y el Orquestador deja una saga `registro` **fallida**
con `paso 0 (auth.create_credential)`. Después de varias corridas hay decenas de esas filas. No son
incidentes: son intentos de alta duplicada de una herramienta de desarrollo, y conviene saberlo
antes de mirar la tabla de sagas y creer que el registro se está cayendo. Las sagas de las
simulaciones —esas sí, una por ejecución— las borra `calculadora.sh limpiar`.
