# Glosario y estilo del informe

> Artefacto de trabajo, no un capítulo. Fija la terminología y las reglas de prosa que los
> capítulos deben cumplir, y se ejecuta: `node docs/informe/scripts/prose-barrier.mjs`.
> Nace de `00-plan.md:342` («fijar un glosario bilingüe único desde el día 1, para que la
> traducción sea consistente en terminología»). Estado: vigente desde 2026-11-03.
> Las líneas citadas son las del árbol en `development` en esa fecha; si una cita no cuadra,
> el archivo manda y esta tabla se corrige.

## 1. Contrato de lengua (verificado contra los archivos)

| Archivo:línea | Qué declara | Consecuencia |
|---|---|---|
| `preamble/packages.tex:19` | `\usepackage[spanish, es-noshorthands, main=english]{babel}` | El inglés es la lengua por defecto; el español se carga para el front matter y las cadenas institucionales. `es-noshorthands` desactiva el `"` activo del español: una comilla recta **nunca** es una comilla tipográfica. |
| `preamble/packages.tex:20` | `\usepackage{csquotes}` | `\enquote{…}` es el único comando de cita textual; no se escriben comillas a mano. |
| `preamble/packages.tex:32` | `\usepackage[style=apa, backend=biber]{biblatex}`, **sin** `language=` | biblatex-apa resuelve a `american-apa`: referencias y citas en inglés estadounidense (`&`, «et al.», «and»). |
| `main.tex:28` | `\selectlanguage{spanish}` antes del front matter | Portadas, contenido, resumen y listas quedan en español. |
| `main.tex:58` | `\selectlanguage{english}` antes de los `\include` | El cuerpo de los capítulos se escribe en inglés estadounidense. |

**Regla, y no una sugerencia.** La prosa del cuerpo va en **inglés estadounidense**. Los títulos
de `\section{}` y `\subsection{}` son **español canónico y no se traducen jamás**: cada archivo de
`chapters/` abre con `% TRANSLATION UNIT: translate this file only` y su `\section{}` ya está en
español (`chapters/09-diseno-ui-ux.tex:2,8`). El front matter permanece en español. Una grafía
británica solo es admisible **dentro de un título citado**, y esa línea termina en `% style-ok`
para que la barrera no la marque.

## 2. Tabla de términos

Columna 1 es el término **en inglés, tal como se usa en el informe**. No se inventan sinónimos: si
un concepto no está aquí, se añade (§5), no se improvisa en el capítulo.

| Term (English) | Definition | Do not use | Where the repository fixes it |
|---|---|---|---|
| simulator | The Rust service that parses, stores and evaluates formulas: `SimulatorService`. In prose, «the simulator service»; the thing a student runs is a **calculator**. | «calculator» for the service; «simulador» in English prose; «engine» | `contracts/proto/fintcart/simulator/v1/simulator.proto:7-15`; `services/simulator/` |
| calculator | The parameterised definition a user runs: identity row in `calculators` plus the immutable `calculator_definitions` version it serves. A calculator is *data*, not code. | «simulator», «template», «app», «tool» | `services/simulator/migrations/20260902120000_calculators.up.sql:3-8,16-30` |
| simulation | One stored run: a row in `simulations`, carrying the exact `calculator_id` + `calculator_version` it was computed with. | «calculation», «result» (the result is the output, not the run) | `services/simulator/migrations/20260902123000_simulations_calculator_ref.up.sql:9-11` |
| formula engine | Parser → AST persisted as `JSONB` → bounded evaluator, everything in `rust_decimal`. | «calculation engine», «expression evaluator», «rules engine» | `services/simulator/src/domain/formula/mod.rs:1-25` |
| `pot` | Power with **integer** exponent. Exact. | «pow», «power» bare, «the power function» | `services/simulator/src/domain/formula/functions.rs:190`; `ast.rs:58` |
| `potd` | Power with **decimal** exponent. **Approximate** (`exp`/`ln`). A different function, never a variant of `pot`. | «pot with decimals», «the same calculation» | `services/simulator/src/domain/formula/functions.rs:192-193`; `ast.rs:60` |
| seed definition | One of the **ten** built-in definitions shipped as data through `Draft::parse`, owned by nobody (`is_builtin`). | «default calculator», «hard-coded calculator», «sample calculator» | `services/simulator/src/domain/seeds/mod.rs:1,145-154` |
| catalogue entry | A `calculators` row in `state = 'publicada'`; what `ListCalculators` serves and what a student sees. | «seed» (a seed is not the catalogue), «template» | `20260902120000_calculators.up.sql:29-30`; `simulator.proto:36` |
| design token | Named CSS custom property in `frontend/src/styles/tokens/` — the single source of a value (color, space, breakpoint, type). | «style variable», «theme value», «magic number» | `frontend/src/styles/tokens/*.css`; breakpoints in `breakpoints.css:33-38` |
| primitive | One of the **19** hand-made standalone Angular components exported by `shared/ui/index.ts`. `gallery/` is a showcase, not a primitive. | «component» (reserved for the 11 in `design/components/`), «widget» | `frontend/src/app/shared/ui/index.ts:1-19`; `specs/003-design-system-frontend/research.md:26` |
| UI kit | One of the **five** full-screen HTML recreations in `design/ui_kits/`: `auth`, `learner`, `marketing`, `simulators`, `editorial`. | «template», «mockup», «theme» | `design/README.md:129-133` |
| student | The person who consumes content and runs calculators. Role `usuario_final`. | «learner» (salvo el nombre del kit, §2.5), «end user», «apprentice», «user» cuando el rol importa | `services/users/migrations/20260727120000_init_users.up.sql:46`; `04-instrumentos-validacion.md:15` |
| editor | The **person** with role `editor`: writes, versions and submits content. | «the editor» para la pantalla (§2.6); «author» como rol | `specs/001-fintcart-platform/spec.md:148` |
| editorial coordinator | The person with role `coordinador_editorial`: reviews, approves, publishes. Does not inherit administrator powers. | «reviewer», «publisher», «coordinator» | `specs/001-fintcart-platform/spec.md:148` |
| administrator | The person with role `administrador`: categories, yearly indicators, purge. Independent of `coordinador_editorial`. | «admin» en prosa, «superuser», «root» | `services/users/migrations/20260903090000_roles_administrador.up.sql:15`; `specs/002-calculator-builder-content-admin/spec.md:504-510` |
| writing surface / editing screen | The **UI** where an editor edits (`fc-tiptap-editor` and its screen). | «the editor» a secas | `frontend/src/app/features/editorial/editor/`; `design/README.md:131` |
| quiz | The instrument: a bank of questions plus `questions_to_serve` and a pass threshold. | «test», «exam», «questionnaire» | `contracts/proto/fintcart/learning/v1/learning.proto:246-255` |
| quiz session | What `StartQuizSession` serves: N random questions, options shuffled, no `correct_key`, expires in 60 min, gradeable once. | «attempt» | `learning.proto:281-292`; `services/learning/src/quizzes/session.service.ts:1-8` |
| quiz attempt | One graded submission, stored in `quiz_attempts`; `score` is a percentage over 100 and `attempt_no` increments per quiz. | «session», «try» | `services/learning/migrations/20260727120000_init_learning.up.sql:102-121`; `learning.proto:310-315` |
| simulation history | The rows in `simulations` that `ListHistory` returns to their owner. | «simulations_run», «log» | `simulator.proto:17-18` |
| `simulations_run` | An `int64` **counter** in `ActivityReport`, fetched over gRPC from the simulator. A different thing from the history. | «history», «total simulations» | `contracts/proto/fintcart/users/v1/users.proto:144-149` |

### 2.1 `simulator` vs `calculator` — el par más peligroso

El servicio es el **simulator**; la definición que el estudiante ejecuta es la **calculator**. Un
`Compute` sobre una calculadora produce una **simulation**, que es la fila que aparece en el
historial. Decir «the simulator» para la pantalla de una calculadora confunde el despliegue con el
producto y hace imposible escribir el capítulo 07, donde servicio y definición conviven en la misma
frase.

**Las calculadoras nativas no son las definiciones semilla.** `services/simulator/src/calculators/`
es el código Rust heredado de FR-019: tras T098 solo sobrevive `colombia`, y las otras cuatro se
retiraron cuando el camino por `calc_type` pasó a resolver la definición semilla
(`calculators/mod.rs:1-20`). Ese camino es hoy **compatibilidad de contrato**
(`simulator.proto:65-66`), no el camino preferente. Escribir «the five native calculators» como
sinónimo de las semillas es falso dos veces: son código contra datos, y son cinco contra diez.

### 2.2 `formula engine`, `pot` y `potd`

El **formula engine** es el analizador, el AST persistido y el evaluador acotado
(`domain/formula/mod.rs`). `pot` eleva a un exponente **entero** y es exacta; `potd` eleva a un
exponente **decimal** y es aproximada porque resuelve por `exp`/`ln`
(`functions.rs:3-17` y `190-193`). Son dos nombres distintos a propósito: fundirlos perdería en
silencio la exactitud del Principio VIII. En prosa nunca se dice «the power function»: se nombra
la función, y si el exponente es decimal se dice que el resultado es aproximado.

### 2.3 `seed definition`, «default calculator» y «catalogue entry»

Las semillas son **diez** (`seeds/mod.rs:1`): siete resiembran las cinco de FR-019 y tres son
contenido nuevo. El comentario de `calculators.up.sql:18` todavía dice «las siete semillas» y está
desactualizado: manda el código. «Default calculator» no se usa —sugiere una preferencia del
usuario que no existe—; la semilla es `is_builtin`. Una **catalogue entry** es otra cosa: la fila
publicada que el catálogo sirve. Una semilla puede estar publicada o no; una entrada de catálogo
siempre lo está.

### 2.4 `design tokens`, `primitives` y `UI kit`

Los **tokens** son valores con nombre y dueño único. Las **primitives** son los 19 componentes
Angular de `shared/ui/index.ts`; no son los 11 componentes React de `design/components/`, y esa
distinción es la que sostiene el argumento del capítulo 09 (una capa artesanal duplicaba 19
primitivas frente a 11 componentes reales, `research.md:26`). El **UI kit** es la recreación de
pantalla completa contra la que se compara visualmente; hay cinco. Un UI kit no es un componente ni
un token.

### 2.5 `student`, y la única excepción de `learner`

La persona es **student**. El repositorio la nombra `usuario_final` en el rol y «estudiantes» en
los instrumentos (`04-instrumentos-validacion.md:15`); «learner» no aparece en la prosa del
informe. La excepción es el **nombre del kit de diseño**: `design/ui_kits/learner/`
(`design/README.md:129`), admisible solo en el capítulo 09 y solo como «the learner kit». Fuera de
ahí, «learner» es un error.

### 2.6 Los cuatro roles y la colisión de `editor`

`usuario_final` → **student**; `editor` → **editor**; `coordinador_editorial` → **editorial
coordinator**; `administrador` → **administrator** (`init_users.up.sql:46` para los tres primeros,
`roles_administrador.up.sql:15` para el cuarto; atribuciones en
`specs/001-fintcart-platform/spec.md:148` y `specs/002-calculator-builder-content-admin/spec.md:504-510`).

La colisión: «editor» nombra a la persona **y** al artefacto de software. El repositorio ya la
sufre —`design/README.md:131` llama al CMS «FintCart Editor» y en la misma línea «editor de
artículos»—. Regla dura: **la persona es «the editor»; la pantalla o el componente es «the writing
surface» o «the editing screen», nunca «the editor» a secas.** Si una frase no se entiende sin
saber cuál de los dos es, la frase está mal escrita.

### 2.7 `quiz`, `quiz session`, `quiz attempt`

El **quiz** es el instrumento. La **quiz session** es el conjunto aleatorio servido por
`StartQuizSession`: existe para que el estudiante no reciba el banco entero ni la clave correcta, y
caduca. El **quiz attempt** es la entrega calificada y persistida en `quiz_attempts`, con
`score` porcentual y `attempt_no`. Un intento consume una sesión; una sesión no es un intento.

### 2.8 `simulation history` vs `simulations_run`

El historial son **filas** (`simulations`) que el dueño puede listar y anonimizar. `simulations_run`
es un **contador** `int64` del `ActivityReport` que Usuarios obtiene por gRPC del simulador
(`users.proto:149`); no dice qué se calculó ni con qué versión. No son intercambiables.

## 3. Reglas de estilo, con un ejemplo del propio repositorio

1. **Grafía estadounidense.** «behavior», no «behaviour»; el repositorio ya nombra
   `frontend/src/styles/tokens/colors.css` con la grafía estadounidense.
2. **Coma serial.** «amounts, rates, and fees», no «amounts, rates and fees»; el título inglés que
   el repositorio ya cita, «Youth, money, and behavior» (`refs/refs-inventory.md:53`), es el mismo
   caso.
3. **Títulos en sentence case.** `\section{Diseño de interfaz y experiencia}`
   (`chapters/09-diseno-ui-ux.tex:8`): mayúscula solo en la primera palabra y en nombres propios;
   nunca Title Case. Lo mismo para subtítulos en inglés: `\subsection{Deployment manifests}`
   en la plantilla comentada (`chapters/16-anexos.tex:15`).
4. **Porcentaje con espacio.** `60 %`, no `60%`; el instrumento ya lo escribe así
   (`04-instrumentos-validacion.md:252`).
5. **Fechas.** En tablas, `2026-11-01` (`04-instrumentos-validacion.md:6`); en prosa,
   «November 2026» —nunca `11/01/2026` ni «Nov-26»—; el front matter en español dice «noviembre
   de 2026». El repositorio ya usa el nombre del mes en prosa (`docs/anteproyecto/referencias.md:253`).
6. **Pies de figura y tabla en inglés, sentence case, con punto final.**
   `\caption{Causes and effects tree of the problem.}` (`chapters/01-planteamiento.tex:19`);
   etiqueta `fig:`/`tab:` en minúscula.
7. **Solo `\parencite{}` y `\textcite{}`.** Es lo que exige el capítulo:
   `chapters/04-marco-referencial.tex:10-11`. `\cite{}` no se usa en prosa: APA distingue cita
   parentética de narrativa y `\cite{}` no la expresa.
8. **Nada de `\nocite{*}` en un capítulo entregado.** `chapters/15-referencias.tex:9-14` es
   andamiaje de borrador: imprime entradas no citadas para poder revisarlas. Si al cierre la lista
   debe incluir obras no citadas, se dice en el capítulo y se justifica; no se deja el comando.
9. **Miles con separador en prosa.** `1,234,567.89`, nunca `1234567.89`
   (`04-instrumentos-validacion.md:27`).

## 4. La regla del dinero

Hay tres formas y no se mezclan.

- **Cifra citada de la interfaz:** se conserva el render es-CO del producto, `$1.234.567,89`, y se
  introduce como tal. Ejemplo: «The result panel shows `$1.234.567,89`, the exact figure the
  student sees.» El render está fijado por
  `frontend/src/app/shared/format-number.ts:10-14` y por la prueba `result-format.spec.ts:23`.
- **Cantidad escrita en prosa:** `COP 1,234,567.89`. Código ISO, espacio, coma de miles y punto
  decimal: es texto del informe, no del producto. Ejemplo: «The deposit reaches COP 1,234,567.89
  after 24 months.»
- **Valor crudo de la API:** es una **cadena decimal exacta**, `"1234567.89"`
  (`04-instrumentos-validacion.md:26-27`). Nunca se muestra como número ni como flotante; si hay
  que enseñarlo, va en `\texttt{}` y con comillas, porque las comillas forman parte del valor.

Ninguna de las tres es estilo: el Principio VIII prohíbe representar dinero con punto flotante en
todas las capas (`.specify/memory/constitution.md:177`), y una cifra redondeada en el informe
reintroduce por la prosa el error que el código prohíbe.

## 5. Cómo se añade un término

1. Añade la fila a la tabla de §2 con las cuatro columnas y una cita `archivo:línea` verificable.
2. Si el término prohíbe una variante, añádela a `FORBIDDEN_TERMS` en
   `docs/informe/scripts/prose-barrier.mjs` y documenta la sustitución en la columna «Do not use».
3. Ejecuta `node docs/informe/scripts/prose-barrier.mjs`; debe salir 0. `--check` es la puerta
   silenciosa para el guion de compilación.
4. `% style-ok` solo para un título citado, nunca para silenciar una decisión propia.

## 6. Conocido sin resolver

**Brooke (1996), páginas 189-194 frente a 207-212.** El registro del editor da 207-212 y la
literatura sobre el SUS cita 189-194; la entrada de `refs/referencias.bib` omite `pages` antes que
elegir una de las dos (`04-instrumentos-validacion.md:42-46`). Queda **sin resolver** hasta que
alguien vea el volumen impreso (ISBN 0-7484-0314-0). No se cita ninguna página suya, ni en el
capítulo 13 ni en el anexo, y no se «arregla» eligiendo la más frecuente en la literatura: una
página inventada en APA es un dato falso, no un detalle de formato.
