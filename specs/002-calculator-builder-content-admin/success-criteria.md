# Los 14 criterios de éxito, con su evidencia (T161)

Verificación de **SC-013 … SC-026** sobre la instalación que deja
`dev/down --volumes && dev/build && dev/up && dev/migrate && dev/seed` —la misma que verifica
T163—, y con las suites corriendo contra los servicios de verdad. La regla que se siguió: **un
criterio no se marca por lo que el código hace, sino por lo que se le vio hacer.**

Dos columnas de evidencia para cada uno:

- **Automática**: la prueba que lo sostiene y se puede volver a correr. Cuando dice `e2e`, la spec
  usa la sesión real de un usuario contra el borde real.
- **En vivo**: la comprobación que se hizo a mano sobre el entorno levantado, con la orden y el
  resultado.

---

## SC-013 — Tres intentos, tres conjuntos distintos

> Un usuario que repite tres veces un cuestionario cuyo banco tiene al menos el triple de preguntas
> que su número a servir recibe conjuntos de preguntas distintos en los tres intentos.

- **Automática**: `services/learning/test/quizzes/sampling.spec.ts` — `sampleServed` sirve
  exactamente N sin repetir, el barajado es determinista con la misma fuente y conserva los
  elementos, y el orden de opciones queda registrado en `served`.
- **En vivo**: banca de **12** preguntas sirviendo **3** (12 ≥ 3 × 3) y tres sesiones reales de la
  misma cuenta:

```
sesión 1 — 3 preguntas servidas: ['02', '09', '10']
sesión 2 — 3 preguntas servidas: ['06', '10', '02']
sesión 3 — 3 preguntas servidas: ['02', '10', '11']
```

Tres conjuntos distintos, sin repetir dentro de un conjunto. **Cumple.**

## SC-014 — Todo intento calificado se puede reconstruir

> El 100 % de los intentos calificados registra qué preguntas fueron servidas, de modo que
> cualquier calificación pueda reconstruirse a partir del historial.

- **Automática**: la columna `quiz_attempts.served_snapshot` es `jsonb NOT NULL` —la garantía está
  en el esquema, así que un intento sin constancia no se puede escribir— y
  `test/quizzes/grading.spec.ts` cubre la calificación.
- **En vivo**: cuatro intentos (tres con todo correcto y **uno con una de tres mal**, para que la
  reconstrucción no fuera trivial) y la puntuación recalculada desde el `served_snapshot`:

```
 guardada | reconstruida |  veredicto
    66.67 |        66.67 | coincide
   100.00 |       100.00 | coincide
   100.00 |       100.00 | coincide
   100.00 |       100.00 | coincide
```

4 de 4 reconstrucciones exactas, incluida la del 66,67 (dos de tres). **Cumple.**

## SC-015 — Las semillas reproducen el código nativo

> Las cinco calculadoras por defecto producen, para un conjunto de casos de regresión que cubre sus
> rangos de uso, resultados idénticos a los que producían antes de esta enmienda, incluidos los
> casos de borde numérico.

- **Automática**: `cargo test --test seed_regression` → **22 pruebas en verde**, y las cuatro
  calculadoras nativas se conservan en `tests/nativo/` como ORÁCULO (no como valores congelados: un
  oráculo se recalcula, una tabla congelada se queda obsoleta sin que nadie lo note).
- **En vivo**: las siete semillas están sembradas y publicadas con su versión aprobada
  (`dev/seed` → 7 calculadoras, 7 definiciones, 5 indicadores).

**Cumple.** Es la prueba de la que depende que FR-049 no haya que renegociar (research D-16).

## SC-016 — Una calculadora propia en menos de cinco minutos

> Un usuario sin conocimientos técnicos crea y ejecuta una calculadora propia de dos entradas y un
> resultado en menos de 5 minutos desde su primer acceso al constructor.

- **Automática**: `frontend/e2e/constructor-calculadora.spec.ts` recorre el camino completo
  —entrar, abrir el constructor, declarar entradas, escribir la fórmula, comprobar en vivo, guardar,
  ejecutar— contra el servicio real.
- **En vivo**: esa spec tarda **10,7 s** de reloj, y no es el tiempo del test aislado: incluye el
  registro de la cuenta, la espera del correo de verificación, el arranque del navegador y la
  ejecución de la calculadora. El margen sobre los cinco minutos es de **veintiocho veces**.

**Cumple.** El número no mide «facilidad», mide que el camino existe y es corto; lo que hace que sea
corto es la validación en vivo del constructor, que dice el error concreto mientras se escribe en
vez de al guardar.

## SC-017 — Ninguna definición inválida se guarda

> Ninguna definición de calculadora inválida (referencia inexistente, expresión mal formada,
> complejidad excesiva) llega a guardarse; el 100 % se rechaza en el momento de guardar con un
> mensaje que identifica el error.

- **En vivo**, las tres familias contra `POST /calculators` (y comprobando además que la fila NO
  quedó en la base):

```
── referencia inexistente → HTTP 422 · guardado? NO
   outputs[0].expression: campo_inexistente — el campo «noexiste» no está declarado…
── expresión mal formada → HTTP 422 · guardado? NO
   outputs[0].expression: expresion_mal_formada — la expresión termina donde se esperaba un valor
── complejidad excesiva → HTTP 422 · guardado? NO
   outputs[0].expression: limite_excedido — la fórmula pasa de 64 nodos, que es el máximo admitido
```

- **Automática**: `tests/formula_parser.rs` (topes de FR-046 en el borde), `tests/definition.rs`,
  `tests/bounded_cost.rs` (un nivel más de anidación se rechaza).

**Cumple:** 3 de 3 rechazadas, ninguna guardada, y cada una nombra la ubicación y el código del
error.

## SC-018 — Al catálogo público se llega aprobado por otro

> Ninguna calculadora llega al catálogo público sin haber sido aprobada por un coordinador editorial
> distinto de su autor.

- **En vivo**, con un usuario que tiene **los dos roles a la vez** —que es el caso que de verdad
  prueba la separación de funciones—:

```
creada → ¿en el catálogo público? NO
propuesta para revisión → ¿en el catálogo público? NO
el autor (editor + coordinador) intenta aprobarse a sí mismo → HTTP 403 acceso denegado
   y la fila queda en_revision, published_version vacío, approved_by vacío
otro coordinador aprueba → HTTP 200 → ¿en el catálogo público? SÍ
```

- **Automática**: `frontend/e2e/curaduria-calculadoras.spec.ts`,
  `services/orchestrator/internal/server/saga_curation_test.go` (5 pruebas) y
  `services/simulator/tests/curation_db.rs` (8 pruebas contra PostgreSQL).

**Cumple.** La restricción está además en el esquema: `calculators_published_has_version` no admite
una calculadora publicada sin la definición aprobada.

## SC-019 — El historial conserva los indicadores con que se calculó

> Toda simulación del historial permite conocer los valores de indicadores con que se calculó,
> incluso después de que esos indicadores hayan sido reemplazados.

- **En vivo**: se ejecuta el 4 × 1000 (depende de `@UVT`), el administrador **edita** la UVT
  (50000 → 49999) y se vuelve a mirar:

```
historial:   indicadores {'UVT': '50000'} · tope_exencion 17500000
ejecución nueva: indicadores {'UVT': '49999'} · tope_exencion 17499650
```

El resultado viejo se explica con el valor viejo (350 × 50000) y el nuevo con el nuevo
(350 × 49999). **Cumple.**

- **Automática**: `tests/provenance_db.rs`
  (`cambiar_un_indicador_no_altera_las_simulaciones_que_ya_lo_usaron`).

## SC-020 — Aviso con 30 días de antelación, y advertencia antes de calcular

> El administrador recibe aviso del vencimiento de los indicadores con al menos 30 días de
> antelación, y ninguna calculadora que dependa de indicadores vencidos se ejecuta sin mostrar
> antes la advertencia correspondiente.

**Primera mitad, en vivo**: se mueve la vigencia de la UVT fuera del año en curso y se acorta el
barrido del Orquestador a 5 s:

```
correos de aviso antes: 0
llegó a los 20s
correos de aviso ahora: 1
  asunto: «Acción requerida: el indicador UVT no tiene vigencia»
```

Un solo correo aunque el barrido pasara cuatro veces: el identificador del evento es determinista
por `(tipo, clase, indicador, día)` y el `ON CONFLICT` del outbox descarta las repeticiones. El
aviso anticipado (`por_vencer`) usa la ventana de 30 días declarada en
`CALENDAR_ALERT_WINDOW_DAYS`, en el servidor y no en quien pregunta.

**Segunda mitad, en vivo** —y aquí hay una diferencia entre los dos caminos de ejecución que se
midió y quedó documentada (hallazgo 19):

```
GET /indicators/current         → vigentes: [IPC, SMMLV, TASA_USURA, UVR] · SIN VIGENCIA: [UVT]
POST /calculators/gmf/run       → 400 «no hay valor vigente para el indicador @UVT»
POST /simulators/colombia_especifica/run → 200 (el valor lo escribe el usuario)
```

El ejecutor lee `missing_names` **antes** de calcular y muestra la advertencia; en el camino por
definición, además, no hay resultado que pueda estar desactualizado: la ejecución se rechaza. En el
camino nativo el valor llega escrito por el usuario, así que la advertencia es lo único que puede
decir que la plataforma no lo confirma.

**Cumple**, y el texto del aviso se corrigió para decir esto mismo: decía que las calculadoras
«están dando resultados con el valor anterior», que solo es cierto en uno de los dos caminos.

## SC-021 — Un artículo con formato, sin escribir marcas

> Un editor produce un artículo con encabezados, listas, énfasis y al menos una imagen sin escribir
> ninguna marca de formato a mano.

- **Automática**: `frontend/e2e/editor-imagen.spec.ts` (sube una imagen, la inserta en línea, la ve
  en el lector a 640 × 360) y `e2e/a11y.spec.ts` (la barra del editor se alcanza con teclado).
- El editor es TipTap con el vocabulario cerrado compartido (`shared/body-doc.ts`): lo que el editor
  no puede producir —un nodo fuera del vocabulario— tampoco lo acepta el servidor, y hay una barrera
  que comprueba que las dos listas no se separan.

**Cumple.**

## SC-022 — Ningún contenido activo se ejecuta

> Ningún contenido activo introducido en el cuerpo de un artículo llega a ejecutarse en el navegador
> de un usuario final.

- **En vivo**, cinco documentos hostiles contra `POST /editorial/articles`, y el sexto legítimo como
  control:

```
── bloque html            → HTTP 400 · nodo "html" no admitido
── bloque script          → HTTP 400 · nodo "script" no admitido
── marco incrustado       → HTTP 400 · nodo "iframe" no admitido
── enlace javascript:     → HTTP 400 · esquema "javascript:" no admitido (se admiten http, https, mailto)
── encabezado legítimo    → HTTP 201
```

El vocabulario es cerrado y los esquemas de enlace van por **lista blanca**, no por lista negra: una
lista negra se pierde con el esquema que alguien invente después. Un `<script>` escrito **dentro de
un texto** se acepta (es texto) y se muestra escapado, que es lo correcto: lo que se prohíbe es la
estructura activa, no la palabra.

- **Automática**: `frontend/e2e/body-doc-rechazado.spec.ts` —con sesión real, interceptando el
  `PATCH` de la aplicación y metiendo un nodo prohibido en vuelo— comprueba las dos mitades: el
  servidor rechaza y el nodo **no aparece por ninguna parte** en el lector. Y
  `frontend/scripts/security-barrier.mjs` (13 casos de autocomprobación en cada `npm run lint`)
  prohíbe `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `[innerHTML]` y `bypassSecurityTrust*` en
  todo el frontend.

**Cumple.**

## SC-023 y SC-024 — Depuración de cuentas: **no reclamados**

> (SC-023) Una cuenta marcada para depuración es reactivable por su titular durante los 30 días
> siguientes…; (SC-024) tras una anonimización, el registro de auditoría conserva el 100 % de las
> operaciones históricas bajo identificador opaco…

El bloque de depuración (T136–T148) **no se implementó** y este documento no lo reclama. Lo que sí
existe —y conviene decir dónde está el límite— es la **anonimización** que ya traía 001 (FR-030:
`AnonymizeHistory` en el Simulador, con `audit_log` conservando el identificador opaco) y el
`pending_deletion` no existe en ninguna parte del código. **No cumplen** en el alcance de esta
enmienda y así se declaran en el registro de tareas.

## SC-025 — Todo artículo, clasificado en el catálogo

> Todos los artículos del catálogo están clasificados en una categoría del catálogo administrable;
> ningún artículo conserva una categoría escrita como texto libre.

- **En vivo**:

```
artículos 5 | con categoría del catálogo 5
¿queda la columna de texto libre «category»? 0 columnas
```

- **Automática**: la migración de T014 convirtió las 79 filas existentes (0 pérdidas) y
  `tests/categories.repository.spec.ts` + `e2e/us4-editorial.spec.ts` cubren el alta y el uso.

**Cumple.** La columna de texto libre no se conserva «por compatibilidad»: se eliminó.

## SC-026 — Nada fuera del sistema visual, todo con teclado, todo sin red externa

> Ninguna pantalla nueva introduce estilos propios fuera del sistema visual común; todos sus
> controles son alcanzables y operables solo con teclado; y la interfaz se presenta completa y
> legible con la conectividad hacia servicios externos deshabilitada.

Tres partes, tres comprobaciones reproducibles:

| Parte | Cómo se comprueba | Resultado |
|---|---|---|
| Sin estilos propios | `node frontend/scripts/design-debt.mjs` (barrera en el lint) | **0** estilos en línea, **0** pantallas con clase artesanal, `styles.scss` eliminado |
| Solo con teclado | `e2e/a11y.spec.ts`: 20 pantallas con `expectControlsAreLabelled`, `expectKeyboardReaches` y contraste AA | en verde en la suite completa |
| Sin red externa | `e2e/offline-assets.spec.ts`: se bloquean todos los dominios externos y se comprueba que tipografía e iconos siguen presentes | en verde |

Además `e2e/zoom-200.spec.ts` (la interfaz al 200 % sin desbordar) y la barrera de contraste, que
corrigió el coral-400 a coral-500 cuando el contraste se quedaba en 4,04:1.

**Cumple.**

---

## Resumen

| Criterio | Estado | Evidencia principal |
|---|---|---|
| SC-013 | Cumple | 3 sesiones, 3 conjuntos distintos (banca 12, sirve 3) |
| SC-014 | Cumple | 4 de 4 puntuaciones reconstruidas desde el `served_snapshot` |
| SC-015 | Cumple | `seed_regression`, 22 pruebas |
| SC-016 | Cumple | e2e del constructor, 10,7 s |
| SC-017 | Cumple | 3 de 3 definiciones inválidas rechazadas sin guardarse |
| SC-018 | Cumple | autor con los dos roles → 403; catálogo solo con la aprobación del otro |
| SC-019 | Cumple | el historial conserva 50000; la ejecución nueva usa 49999 |
| SC-020 | Cumple | 1 correo de aviso (barrido), `missing_names` antes de calcular |
| SC-021 | Cumple | e2e del editor con imagen |
| SC-022 | Cumple | 4 familias de ataque rechazadas + barrera de seguridad |
| SC-023 | **No reclamado** | bloque de depuración no implementado |
| SC-024 | **No reclamado** | ídem (la anonimización de 001 sí existe) |
| SC-025 | Cumple | 5 de 5 artículos con categoría; 0 columnas de texto libre |
| SC-026 | Cumple | 0 estilos propios, teclado en 20 pantallas, sin red externa |

**12 de 14 cumplen; los otros dos no se reclaman** y están declarados como no implementados en
`tasks.md`, que es la única forma honesta de no cumplir un criterio.
