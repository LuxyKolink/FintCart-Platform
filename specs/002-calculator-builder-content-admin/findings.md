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
