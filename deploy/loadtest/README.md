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

# La de la plataforma entera (k6 en el host o en un contenedor, apuntando a LOADTEST_BASE_URL):
k6 run -e LOADTEST_BASE_URL=http://localhost:8080 deploy/loadtest/k6-scenarios.js
```

## El límite de tasa es por usuario, y una VU necesita su cuenta

El borde limita **dos veces** (`services/api-gateway/internal/handler`): por IP y por usuario
autenticado, 600 peticiones por minuto cada uno (`RATE_LIMIT_RPM`). Eso obliga a dos cosas:

- **Una cuenta por VU.** Varias VUs compartiendo una cuenta suman sus peticiones al mismo contador:
  30 VUs a una petición por segundo piden unas 1.800 rpm contra un tope de 600, y la corrida
  devuelve 429 en masa. Lo que se mide entonces es el limitador, no el sistema. Por eso
  `calculadora.sh` exige `LOADTEST_ACCOUNTS ≥ LOADTEST_VUS` y lo comprueba antes de arrancar.
- **Una IP por VU.** Por la misma razón, y es lo que hace el `X-Forwarded-For` sintético de los dos
  guiones: el borde confía en esa cabecera porque corre detrás de un proxy.

`k6-scenarios.js` trae 40 cuentas por defecto para 1.000 VUs `[LOADTEST_USER_POOL]`. Con el límite
por usuario, esa combinación **no puede pasar sus propios umbrales**: 25 VUs por cuenta a ~1,5
peticiones por segundo son ~2.250 rpm contra 600. Antes de usar ese guion para verificar SC-003 o
SC-005 hay que igualar el fondo al número de VUs (o subir el límite **a sabiendas**, y decir por qué
en el informe: un límite de tasa subido para que pase una prueba deja de ser el sistema que se
despliega).

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
