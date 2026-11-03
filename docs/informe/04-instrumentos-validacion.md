# Instrumentos de validación con usuarios

> Documento de trabajo. **No es un capítulo del informe**: es el paquete de instrumentos que
> produce los datos del Cap. 13 (Evaluación del sistema) y del Anexo de instrumentos.
> Estado: **plantilla cerrada, sin aplicar**. Ninguna tabla de este documento contiene datos.
> Fecha de cierre de la versión: 2026-11-01.

---

## 0. Alcance, orden de aplicación y reglas de este documento

| Aspecto | Decisión |
|---|---|
| Producto evaluado | La SPA de FintCart en español (Colombia), desplegada en `https://fintcart.bucaramanga.upb.edu.co`, sobre el commit que se anota en cada sesión |
| Público | Comunidad de una universidad pública de Bucaramanga: estudiantes, y en menor medida docentes y personal administrativo |
| Moneda de todos los ejemplos | COP (peso colombiano), formato `$1.234.567` |
| Instrumentos | (1) consentimiento informado · (2) encuesta de percepción · (3) sesión moderada con SUS y tareas · (4) planilla de captura |
| Orden de aplicación | Encuesta **después** de que el participante haya usado el producto al menos una vez; SUS **al final** de la sesión, antes de la entrevista de cierre. Un mismo participante no debe responder la encuesta y hacer la sesión el mismo día: contamina la percepción con la tarea |
| Objetivo que estos instrumentos sirven | **OE5** (evaluar con usuarios, midiendo usabilidad y confianza) con insumos para **OE2** (diseño de la experiencia y el sistema visual). Los OE1, OE3 y OE4 **no se validan aquí**: se verifican con la matriz de trazabilidad, las suites de prueba y las mediciones de rendimiento. La §2.3 explica qué señal indirecta aporta la encuesta a cada uno y por qué no basta |

**Tres reglas que gobiernan todo lo que sigue:**

1. **Ningún dato se inventa.** Cada tabla es una plantilla vacía. Si al cierre de la fase 5 una
   celda no tiene dato, queda vacía y se declara como tal; no se estima, no se imputa, no se
   redondea "para que se vea mejor".
2. **Las cifras monetarias se transcriben como cadena decimal exacta**, nunca como número de coma
   flotante: `"1234567.89"`, no `1234567.89`. Es la misma regla del Principio VIII aplicada al
   instrumento, y evita que el análisis reintroduzca por la puerta de atrás el error que el sistema
   prohíbe en el código.
3. **Ningún promedio sustituye a una distribución.** No se construye un "índice de calidad de la
   interfaz" sumando ítems de la encuesta (§2.6). Un promedio alto con la mitad de los participantes
   en desacuerdo no es un resultado: es un promedio que esconde el desacuerdo.

### Nota sobre las fuentes (leer antes de citar)

Las tres fuentes de este documento están en `refs/referencias.bib` (46 entradas a la fecha de esta
revisión) y verificadas contra el original: el instrumento SUS y su regla de puntuación son de
`brooke1996sus`; las bandas de interpretación, de `bangor2008empirical`; la definición de usabilidad,
de `iso2018usability`. Las claves se escriben como `\cite{...}` desde ya, no en prosa, para que el
traslado de este documento al Cap. 13 no reintroduzca la atribución a mano.

Una advertencia sobre la entrada de Brooke: **no lleva `pages`**. El registro del editor da 207–212 y
la literatura sobre el SUS cita 189–194; la entrada prefiere omitir la paginación antes que elegir
una de las dos sin haber visto el impreso. Por eso **aquí no se cita ninguna página suya**, y el
Cap. 13 tampoco debe hacerlo: si el dato hace falta, hay que consultar el volumen en papel
(ISBN 0-7484-0314-0).

La columna en inglés de la tabla de §3.2 no es una cita en sentido bibliográfico: es el registro de
contra qué se tradujo cada ítem. Se conserva justamente por eso, aunque el ítem ya esté citado en la
prosa que lo introduce. `15-referencias.tex` imprime la lista completa (`\nocite{*}`), así que las
tres entradas aparecen en la bibliografía aunque el Cap. 13 no llegara a citarlas.

---

## 1. Consentimiento informado

*(Una página. Se imprime y se entrega en papel; se lee en voz alta si el participante lo pide. No
lleva lenguaje jurídico porque no hace falta: lo que sigue describe lo que realmente se hace.)*

---

**Consentimiento informado para participar en una prueba de usabilidad**

**Quién hace esto.** Soy estudiante de la Universidad Pontificia Bolivariana, sede Bucaramanga, y
estoy haciendo mi trabajo de grado sobre una plataforma web de educación financiera llamada FintCart.
La plataforma ya está construida; lo que estoy haciendo ahora es preguntarle a personas como usted
si se entiende.

**Para qué lo invito.** Para que use la plataforma durante unos 30 o 40 minutos y me cuente en voz
alta lo que va entendiendo o lo que no. Con eso puedo encontrar las partes que confunden y corregirlas
antes de entregar el trabajo.

**Qué se registra.**

- Notas escritas que yo tomo mientras usted usa la plataforma.
- El tiempo que le toma completar cada tarea y si la completó, la completó con mi ayuda o no la
  completó.
- Un cuestionario corto de 10 preguntas al final sobre qué tan fácil le pareció usar el sistema.
- **Audio**, si usted lo autoriza. Sirve para no perder sus palabras exactas. Si no autoriza el
  audio, tomo notas y ya; puede participar igual.

**Qué no se registra.** No se graba la pantalla ni el video de su cara. No se piden datos de su
cuenta bancaria, ni su cédula, ni su correo personal, ni información sobre su situación financiera
real. Las tareas se hacen con datos inventados que le entrego yo en una tarjeta.

**Es voluntario y se puede retirar.** Usted decide. Si dice que no, no pasa nada y no tengo por qué
enterarme del motivo. Si empieza y en cualquier momento quiere parar, para; si quiere que borre lo
que llevamos, lo borro. No hay ninguna consecuencia académica, laboral ni de ningún otro tipo por
participar ni por retirarse.

**Anonimización.** Usted no aparece con su nombre en ninguna parte. En mis notas y en el informe
aparece como `P01`, `P02`, y así. La lista que relaciona los códigos con los nombres existe solo
mientras dura la recolección, se guarda aparte de las notas y se destruye al terminar el análisis.
Las citas textuales que use en el informe van con el código, nunca con el nombre. Si una cita
contiene algo que lo identifique (el nombre de su programa, de su jefe, de su barrio), lo quito o la
descarto.

**Quién ve esto.** Yo y mi directora de trabajo de grado. El audio y las notas no se publican ni se
comparten con terceros. El informe final es público, pero lo que queda en él son distribuciones,
códigos y citas anonimizadas.

**Cuánto dura el audio.** Se transcribe, se anonimiza la transcripción y el archivo de audio se
elimina al cerrar el análisis. La transcripción sin nombres se conserva como soporte del informe.

**Contacto.** Si después de la sesión quiere preguntar algo, pedir que borre sus datos o retirar lo
que dijo, escriba a: *[correo institucional del autor — completar]*. También puede dirigirse a la
dirección del programa: *[completar]*.

---

**Autorización**

Entiendo lo anterior y acepto participar.

- [ ] Acepto participar en la sesión.
- [ ] Autorizo la grabación de audio. (Si no marca esta casilla, igual puede participar.)
- [ ] Autorizo que se citen mis palabras de forma anónima en el informe.

Nombre: ______________________________  Firma: ______________________________

Fecha: ____ / ____ / ______  Código asignado: `P____`

Testigo (opcional): ______________________________

*Copia para el participante; copia para el archivo del proyecto.*

---

## 2. Encuesta de percepción

### 2.1 Para qué existe y qué no mide

La encuesta mide **percepción declarada**, no desempeño. La distinción no es retórica:
ISO 9241-11:2018 define la usabilidad por la eficacia, la eficiencia y la satisfacción con que se
alcanzan objetivos \cite{iso2018usability}, y una encuesta de percepción solo puede tocar la tercera.
Sirve para dos cosas concretas: (a) saber si la dirección de arte del brief §1–§9 se lee como se
quiso —legible, jerárquica, contenida, confiable— y (b) recoger, de un grupo más grande que las cinco
o ocho sesiones, dónde duele. **No** sirve para demostrar que la plataforma enseña más, y ninguna de
sus preguntas lo pretende (§5).

### 2.2 Datos de caracterización

No son escala. Se usan para describir la muestra y para segmentar el análisis si algún ítem se
comporta de forma rara en un subgrupo.

| Código | Pregunta | Opciones |
|---|---|---|
| D01 | Vínculo con la universidad | Estudiante de pregrado · Estudiante de posgrado · Docente · Personal administrativo · Externo a la universidad |
| D02 | ¿Con qué frecuencia usa la plataforma? | Primera vez hoy · Menos de una vez al mes · Una o dos veces al mes · Una o más veces por semana |
| D03 | Dispositivo en el que la usó hoy | Celular · Tableta · Computador portátil · Computador de escritorio |
| D04 | ¿Usó una versión anterior de la plataforma antes del rediseño? | Sí · No · No estoy seguro |
| D05 | ¿Cuánto sabe de temas financieros? *(autopercepción, no prueba de conocimiento)* | Muy poco · Poco · Regular · Bastante · Mucho |

> D04 es la variable de control más importante de todo el instrumento: quien vio la versión anterior
> compara, y la comparación no es lo que se está midiendo. Si la muestra queda muy cargada hacia
> "Sí", los resultados se leen con esa advertencia explícita y no se presentan como percepción de
> primer uso.

### 2.3 Mapa: ítem → objetivo → dimensión del brief

Escala de todos los ítems `P`: **Likert de 5 puntos con etiquetas ancladas** —
`1` Totalmente en desacuerdo · `2` En desacuerdo · `3` Ni de acuerdo ni en desacuerdo ·
`4` De acuerdo · `5` Totalmente de acuerdo · `NS` No sabría decir *(se registra aparte y **no** se
codifica como 3: "no sé" no es "neutral")*.

| Ítem | Afirmación (se lee tal cual, sin explicarla) | Objetivo | Dimensión del brief |
|---|---|---|---|
| P01 | El texto de las pantallas se lee sin esfuerzo. | OE2 | Legibilidad (§3) |
| P02 | Las cifras de dinero se distinguen con claridad del texto que las rodea. | OE2 | Legibilidad (§3, N-15) |
| P03 | El tamaño de la letra permite leer sin tener que hacer zoom. | OE2 | Legibilidad (§3, mínimo 360 px §9) |
| P04 | En cada pantalla entiendo de un vistazo cuál es el título y qué es lo principal. | OE2 | Jerarquía (§3, §5) |
| P05 | El orden de los elementos sigue el orden en que necesito hacer las cosas. | OE2 | Jerarquía (§4) |
| P06 | La pantalla tiene la información justa; no me sobra decoración. | OE2 | Contención (§6) |
| P07 | El color se usa para señalar un estado o una acción, no para adornar. | OE2 | Contención (§2, §6) |
| P08 | La plataforma se ve como un sistema institucional serio. | OE2 | Confianza (§1, §5) |
| P09 | Confiaría en esta plataforma para tomar una decisión con mi dinero. | OE5 | Confianza (§1) |
| P10 | Los resultados de las calculadoras se muestran con la precisión necesaria para usarlos. | OE3 (indirecto) · OE5 | Confianza (Principio VIII, N-15) |
| P11 | Puedo terminar lo que vengo a hacer sin que otra persona me ayude. | OE5 | Confianza en la tarea |
| P12 | Si necesito volver a un resultado anterior, sé dónde buscarlo. | OE5 · OE3 (indirecto) | Confianza en la tarea |
| P13 | Cuando algo sale mal, el mensaje me dice qué hacer. | OE4 (indirecto) · OE5 | Confianza en la tarea |
| P14 | Volvería a usar esta plataforma para aprender sobre finanzas. | OE5 | Confianza en la tarea (adopción) |
| P15 | Encontré las funciones que esperaba encontrar en una plataforma de educación financiera. | OE1 (indirecto) | — (cobertura) |
| P16 | La plataforma cubre el recorrido completo: leer, practicar, calcular y ver el progreso. | OE1 (indirecto) | — (cobertura) |

**Cómo se lee este mapa, sin adornarlo.** Quince de los dieciséis ítems caen sobre OE2 y OE5, que es
lo que una encuesta de percepción puede medir. Los ítems marcados *(indirecto)* no verifican OE1, OE3
ni OE4: recogen si el usuario **nota** que faltan funciones (P15, P16), si **percibe** que el sistema
responde sin fallar (P10, P12) y si los mensajes de error le sirven (P13). La verificación dura de
esos tres objetivos son la matriz de trazabilidad, las 311 pruebas unitarias y 59 e2e, y las
mediciones de Lighthouse y k6. Si un ítem de estos sale mal, es una señal para investigar; si sale
bien, **no** es evidencia de que el requerimiento se cumplió.

### 2.4 Ítems de elección forzada y de ordenamiento

**F01 — Elección forzada entre dos afirmaciones.** Sin opción intermedia: obliga a tomar partido,
que es justo lo que una escala Likert permite evitar.

> Al usar la plataforma, ¿cuál de estas dos frases se acerca más a lo que le pasó?
> **(a)** La interfaz me ayudó a concentrarme en el contenido.
> **(b)** La interfaz me llamó más la atención que el contenido.

**F02 — Ordenamiento de dos columnas sobre los mismos cinco atributos.** Mide la brecha entre lo que
el participante valora y lo que el producto le entrega; esa brecha es más informativa que cualquier
promedio.

> (I) Ordene de 1 a 5 estos atributos según **cuánto le importan** en una plataforma educativa
> (1 = el que más le importa): legibilidad · jerarquía clara · rapidez · confianza · sobriedad
> estética.
> (II) Ahora ordene **los mismos cinco** según **qué tan bien los cumple FintCart** (1 = el que mejor
> cumple).

**F03 — Elección forzada sobre la contención.** Es la afirmación central del rediseño ("se retira
cromo") puesta a prueba como decisión, no como gusto.

> Si tuviera que quitar **una sola** cosa de la pantalla para simplificarla, ¿qué quitaría?
> **(a)** Los bordes y recuadros alrededor del contenido.
> **(b)** Los fondos de color de las tarjetas.
> **(c)** Nada; no sobra nada.
> **(d)** No sabría qué quitar.

### 2.5 Preguntas abiertas

Redactadas para no sugerir la respuesta: no contienen adjetivos valorativos, no mencionan el
rediseño, no ofrecen categorías.

| Código | Pregunta |
|---|---|
| A01 | Cuente con sus palabras qué fue lo primero que vio en la primera pantalla y qué hizo después. |
| A02 | ¿Hubo algún momento en que no supo qué hacer o qué significaba algo? Cuente cuál y qué hizo. |
| A03 | Si pudiera cambiar una sola cosa de la interfaz, ¿cuál sería y por qué? |
| A04 | ¿Qué información necesita ver para confiar —o para desconfiar— en un resultado que le da la plataforma? |

> A02 se pregunta siempre, incluso si el participante dijo que todo estuvo claro. "No hubo ninguno"
> es una respuesta válida y se registra como tal: es un dato, no un fracaso de la pregunta.

### 2.6 Plan de análisis

**Por ítem, no por índice.** Para cada `P01…P16` se reporta, en una fila:

| Columna | Contenido |
|---|---|
| n válido | Respuestas 1–5 (excluye `NS` y vacíos) |
| n NS | Cuántos marcaron "No sabría decir" |
| Distribución | Conteo en 1, 2, 3, 4 y 5 (cinco números, no un promedio) |
| Mediana | Mediana de los valores 1–5 |
| Rango intercuartílico | Q1–Q3, para mostrar dispersión |
| % de acuerdo | `(n4 + n5) / n válido`, en entero |
| % en desacuerdo | `(n1 + n2) / n válido`, en entero |
| Comentario | Una línea: qué se observa, sin adjetivos |

Con `n` cercano a 15, un porcentaje sobre 15 personas salta en pasos de 6.7 puntos. Por eso se
**publica el conteo al lado del porcentaje** (`9 de 15, 60 %`) y se redondea a enteros.

**Lo que no se hace.**

- **No se promedia la escala en un índice único.** Un "índice de percepción de la interfaz" de 4.1
  sobre 5 no significa nada: la escala no está validada como una sola dimensión, y el promedio tapa
  que tres personas contestaron 1 en el mismo ítem. El número que se reporta como titular es
  **cuántos ítems alcanzaron ≥ 70 % de acuerdo y cuáles no**, con su lista.
- **No se hacen pruebas de significancia.** Con `n ≈ 15` de conveniencia y sin aleatorización, un
  valor `p` sería decoración. Si se quiere una referencia, se reporta el intervalo de confianza
  exacto (Clopper–Pearson) de una proporción y se advierte que no corrige el sesgo de selección.
- **No se compara contra el rediseño anterior** con estos datos: no hay medición de la versión
  anterior con el mismo instrumento y no se va a fabricar una retroactivamente.
- **No se agrupan "NS" con el punto medio.** Se reportan aparte; el porcentaje de "no sabría decir"
  en un ítem es, por sí mismo, un hallazgo (significa que la afirmación no fue interpretable).

**Ítems de elección forzada y ordenamiento.** F01 y F03: tabla de frecuencias con conteo y porcentaje.
F02: rango medio de cada atributo en (I) y en (II), y la diferencia `rango(I) − rango(II)` por
atributo, que es la brecha relevante; también cuántas veces cada atributo quedó de primero.

**Preguntas abiertas.** Análisis temático en dos pasadas: la primera, abierta, para listar temas; la
segunda, cerrada, para codificar cada respuesta contra esa lista. Se reporta la frecuencia de cada
tema, se conservan de dos a cuatro citas por tema con su código de participante, y las citas que se
usen en el informe se transcriben literales —incluidos los errores de escritura— porque corregirlas
cambia lo que la persona dijo.

### 2.7 La muestra y sus límites, declarados antes de recogerla

| Aspecto | Compromiso |
|---|---|
| Meta | **Mínimo 15 respuestas completas**, objetivo operativo 20 |
| Marco muestral | Ninguno. Muestra de conveniencia por invitación directa (grupos de clase, correo institucional, oficina) |
| Qué implica | No es probabilística. No representa a la universidad, ni a los estudiantes de ingeniería, ni a nadie más que a quienes respondieron |
| Sesgo esperado | Autoselección (responde quien tiene interés en finanzas o en la plataforma), proximidad al autor, y en D04 quien ya conocía la versión anterior |
| Tasa de respuesta | Se reporta cuántos se invitaron y cuántos respondieron. Si se invitaron 40 y respondieron 15, eso es un dato del informe, no un detalle |
| Respuestas incompletas | Se reportan aparte y no se rellenan |
| Anonimato | El formulario no pide nombre ni correo. Si se recoge por un canal que identifica (por ejemplo, un enlace personalizado), se declara el canal en el informe |

---

## 3. Guion de sesión moderada (SUS + tareas)

### 3.1 Formato

| Parámetro | Valor |
|---|---|
| Sesiones | **Mínimo 5, máximo 8**, individuales |
| Duración | 35–45 min: 5 de apertura y consentimiento, 20–25 de tareas, 5 de SUS, 5–10 de cierre |
| Modalidad | Presencial, en un equipo del autor; el participante opera el equipo, nunca el moderador |
| Equipo | Computador portátil con navegador actualizado y resolución ≥ 1280 px. Opcional: una segunda sesión en celular a 360 px con 2 de los participantes, para ver el mínimo declarado |
| Versión evaluada | Se anota **el commit desplegado** al inicio de la sesión. Sin ese dato la sesión no es evidencia |
| Cuentas | Cuentas de prueba creadas de antemano, con datos sembrados: al menos 2 artículos leídos, 1 cuestionario presentado y 2 simulaciones guardadas en el historial, para que T5 tenga algo que encontrar |
| Registro | Notas en la planilla (§4), audio si hay autorización, y el SUS en papel al final |
| Moderador | Una sola persona en todas las sesiones: el autor. Se declara como limitación (§5.2) |

### 3.2 El instrumento SUS, en español

Diez afirmaciones \cite{brooke1996sus}, en su orden y con su alternancia de positivo y negativo, sobre
una escala de 1 a 5 con las mismas anclas de la encuesta. Se lee la afirmación y se pide el número. **No se explica el ítem**: si el participante pregunta qué significa, se responde
"lo que usted entienda por esa frase" y se anota que preguntó.

Se incluye el original en inglés al lado porque la traducción es del autor y debe quedar auditable:
un cambio de matiz en un ítem par o impar mueve la puntuación.

| # | Afirmación en español (la que se lee) | Original \cite{brooke1996sus} | Signo |
|---|---|---|---|
| 1 | Creo que me gustaría usar este sistema con frecuencia. | I think that I would like to use this system frequently. | Positivo |
| 2 | Encontré el sistema innecesariamente complejo. | I found the system unnecessarily complex. | Negativo |
| 3 | Me pareció que el sistema era fácil de usar. | I thought the system was easy to use. | Positivo |
| 4 | Creo que necesitaría el apoyo de una persona con conocimientos técnicos para poder usar este sistema. | I think that I would need the support of a technical person to be able to use this system. | Negativo |
| 5 | Me pareció que las distintas funciones del sistema estaban bien integradas. | I found the various functions in this system were well integrated. | Positivo |
| 6 | Pensé que había demasiada inconsistencia en este sistema. | I thought there was too much inconsistency in this system. | Negativo |
| 7 | Imagino que la mayoría de las personas aprendería a usar este sistema muy rápido. | I would imagine that most people would learn to use this system very quickly. | Positivo |
| 8 | Encontré el sistema muy engorroso de usar. | I found the system very cumbersome to use. | Negativo |
| 9 | Me sentí muy seguro usando el sistema. | I felt very confident using the system. | Positivo |
| 10 | Necesité aprender muchas cosas antes de poder empezar a usar este sistema. | I needed to learn a lot of things before I could get going with this system. | Negativo |

> **Sobre la palabra "sistema".** Se conserva "sistema" y no se traduce como "plataforma" ni
> "aplicación" porque es la palabra del instrumento original y porque "sistema" obliga al
> participante a referirse al conjunto, no a una pantalla bonita. Si un participante pregunta "¿el
> sistema es toda la página o solo lo que estoy viendo?", la respuesta es: "todo lo que está usando".

### 3.3 Regla de puntuación del SUS

Se aplica la regla de Brooke \cite{brooke1996sus}, sin variantes:

1. Cada ítem se responde de 1 a 5.
2. **Ítems impares (1, 3, 5, 7, 9), positivos:** contribución = `respuesta − 1`. Rango 0–4.
3. **Ítems pares (2, 4, 6, 8, 10), negativos:** contribución = `5 − respuesta`. Rango 0–4.
4. Suma de las diez contribuciones: rango **0–40**.
5. Puntuación SUS = `suma × 2.5`, rango **0–100**.

**Comprobación de la fórmula (no es un dato de nadie):** si las diez respuestas fueran 5 en los
impares y 1 en los pares —el mejor caso posible— la suma es 40 y la puntuación 100. Si fueran 1 en los
impares y 5 en los pares, la suma es 0 y la puntuación 0. El punto medio de la escala (todo 3) da
`(2×5 + 2×5) × 2.5 = 50`. Esa es la única aritmética de este documento.

**Tres advertencias que se aplican al reportar:**

- **El SUS no es un porcentaje.** Una puntuación de 72 no significa "72 % de usabilidad". Se reporta
  como puntuación SUS, y si se compara con las bandas de interpretación publicadas
  \cite{bangor2008empirical} se dice explícitamente que esas bandas provienen de otro conjunto de
  sistemas, de otro idioma y de una muestra distinta de la de este trabajo.
- **Un ítem sin responder invalida la puntuación** de esa sesión. No se imputa la media: la sesión
  queda como "SUS no calculable" y se reporta así. Con 5 a 8 sesiones, perder una duele, y por eso
  el moderador revisa las diez casillas antes de que el participante se levante.
- **Se reporta la puntuación de cada sesión y la mediana del conjunto**, no solo la media, y se dice
  cuántas sesiones hubo. Un SUS de 8 sesiones no es un SUS poblacional.

### 3.4 Guion de tareas sobre el producto real

Cinco tareas, en orden fijo para todos los participantes. Cada una tiene un criterio de éxito
observable, no una opinión: el criterio de éxito mide **eficacia** y el cronómetro mide
**eficiencia**, en el sentido de ISO 9241-11:2018 \cite{iso2018usability}. Los datos de entrada van
impresos en una tarjeta que se entrega en el momento; no se dictan, para no introducir errores de
transcripción.

| # | Tarea (se lee la consigna tal cual) | Pantalla(s) | Datos de la tarjeta | Criterio de éxito | Límite |
|---|---|---|---|---|---|
| T1 | "Entre a la plataforma con el usuario y la contraseña de esta tarjeta." | `/iniciar-sesion` → `/catalogo` | correo y contraseña de prueba | Llega al catálogo y ve la lista de artículos | 3 min |
| T2 | "Busque un artículo sobre ahorro, ábralo y léalo hasta el final. Cuando termine, dígame en voz alta una idea del artículo que no conociera." | `/catalogo` → `/articulos/:id` | — | Abre un artículo y enuncia una idea concreta tomada del texto | 6 min |
| T3 | "Haga una simulación de ahorro con estos datos y luego explíqueme el resultado: cuánto puso usted y cuánto ganó por intereses." | `/simuladores/ahorro` | depósito inicial `$1.000.000`, aporte mensual `$200.000`, tasa anual `0.09`, plazo `24` meses | Ejecuta el cálculo y distingue correctamente **monto final**, **total aportado** e **interés ganado** en sus palabras | 6 min |
| T4 | "Ahora haga una simulación de crédito con estos datos y dígame cuánto pagaría en total y cuánto de eso son intereses." | `/simuladores/credito` | monto `$10.000.000`, tasa anual `0.18`, `36` cuotas | Ejecuta el cálculo y reporta **cuota mensual** y **total pagado** | 6 min |
| T5 | "Encuentre la simulación de ahorro que acaba de hacer y vuelva a decirme el monto final. Después muéstreme su progreso en la plataforma." | `/simuladores/historial`, `/progreso` | — | Encuentra el registro con la cifra y llega a progreso | 4 min |

**Reglas de administración de tareas:**

- La consigna se lee **una vez**. Se puede repetir literalmente si el participante lo pide.
- **Umbral de ayuda:** 90 segundos sin acción significativa, o pedido explícito de ayuda. La ayuda se
  presta en escalera y se anota el nivel: (1) "¿qué está buscando?"; (2) "¿qué esperaría encontrar
  en esta pantalla?"; (3) señalar la zona de la pantalla; (4) indicar el control. Los niveles 3 y 4
  convierten la tarea en **"completada con ayuda"**, nunca en "completada".
- Si la tarea se abandona, se pasa a la siguiente y **no se vuelve atrás**.
- El cronómetro se detiene al cumplirse el criterio de éxito, no cuando el participante deja de hablar.
- Para T3 y T4 se anota literalmente lo que el participante dice al explicar el resultado: ahí es
  donde se ve si entendió la cifra o solo la leyó.

### 3.5 Guion del moderador

**Lo que se dice, en este orden.**

| Momento | Texto (leer o parafrasear de cerca) |
|---|---|
| Apertura | "Gracias por venir. Soy [nombre], estudiante de la UPB. Estoy evaluando la plataforma, no a usted: si algo no se entiende, el problema es del diseño y su comentario me sirve para arreglarlo." |
| Consentimiento | "Le voy a entregar este consentimiento. Léalo con calma y dígame si tiene preguntas. Es voluntario y puede parar cuando quiera." |
| Grabación | "¿Autoriza que grabe solo audio? Si prefiere que no, tomo notas igual." |
| Pensamiento en voz alta | "Mientras usa la plataforma, quiero que piense en voz alta: qué está mirando, qué espera que pase, qué le confunde. No es una conversación pulida; mientras más suelto, mejor. Si se queda callado un rato, le voy a recordar que hable." |
| Tareas | "Le voy a dar cinco tareas, una por una, en una tarjeta. No hay respuestas correctas. Haga lo que haría normalmente." |
| Recordatorio neutro | "¿Qué está pensando?" · "¿Qué esperaba que pasara ahí?" · "Siga hablando, por favor." |
| Al fallar | "Está bien, sigamos con la siguiente." *(sin explicar el error)* |
| Cierre de tareas | "Listo, terminamos las tareas. Gracias." |
| SUS | "Ahora le voy a leer diez frases sobre el sistema. Para cada una me da un número de 1 a 5, donde 1 es totalmente en desacuerdo y 5 totalmente de acuerdo. No hay término medio obligado: si de verdad no sabe, dígamelo." |
| Cierre | "¿Hay algo que no le pregunté y que cree que debo saber?" |
| Despedida | "Muchas gracias. Le recuerdo que sus datos van anonimizados; si quiere retirar algo, este es el correo." |

**Lo que nunca se dice.** Esta lista es la parte más importante del guion: cada frase de aquí
convierte la sesión en una encuesta de cortesía.

| Prohibido | Por qué |
|---|---|
| "¿Le gusta?" / "¿Qué le pareció bonito?" | Mide gusto, no usabilidad. Invita a halagar |
| "¿No ve el botón de calcular?" | Enseña la respuesta y destruye el dato de si el control era encontrable |
| "Eso antes era peor." / "¿Verdad que ahora se ve más limpio?" | Ancla al participante en la hipótesis del autor; convierte el resultado en confirmación |
| "¿Prefiere esta versión a la anterior?" | Es la comparación que no se está midiendo; además presupone que vio la anterior |
| "La idea del rediseño es quitar las cajas." | Explica la intención estética y contamina P06, F03 y A03 |
| "No se preocupe, eso es un error de la plataforma." | Disculpa antes de tiempo; cambia el tono y el participante deja de reportar fallos |
| "¿Está seguro?" | Sugiere que se equivocó y lo hace cambiar de respuesta |
| "Muy bien" / "Perfecto" / "Exacto" | Refuerzo diferencial: el participante aprende qué respuestas agradan |
| "Esta es la última tarea, ya casi." | Apuro artificial; altera los tiempos |
| Cualquier explicación de cómo funciona el motor de fórmulas, el decimal o el diseño | El participante no debe aprender el sistema durante la sesión |
| Hablar del trabajo de grado, del jurado o de la nota | Cambia el marco: el participante intenta ayudar al autor |

### 3.6 Hoja de observación

Una fila por tarea. Se llena **durante** la sesión, no al final.

**Encabezado de sesión**

| Campo | Valor |
|---|---|
| Código de participante | `P____` |
| Fecha y hora de inicio / fin | |
| Commit desplegado | |
| Dispositivo · sistema · navegador · resolución | |
| Modalidad | Escritorio · móvil 360 px |
| Consentimiento firmado | Sí / No |
| Autoriza audio | Sí / No |
| Vínculo (D01) · frecuencia de uso (D02) · uso previo (D04) | |
| Moderador | |
| Incidencias técnicas (red, despliegue, cuenta) | |

**Tabla de tareas** *(plantilla vacía)*

| Tarea | Inicio (mm:ss) | Fin (mm:ss) | Duración (s) | Resultado | N.º errores | Tipo de error | Ayuda prestada (nivel) | Cita textual | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| T1 Iniciar sesión | | | | | | | | | |
| T2 Leer artículo | | | | | | | | | |
| T3 Simulación de ahorro | | | | | | | | | |
| T4 Simulación de crédito | | | | | | | | | |
| T5 Historial y progreso | | | | | | | | | |

**Valores admitidos en las columnas de juicio** (vocabulario cerrado, para que dos codificadores no
inventen categorías distintas):

| Columna | Valores |
|---|---|
| Resultado | `completada` · `completada con ayuda` · `no completada` · `no aplica (incidencia técnica)` |
| Tipo de error | `navegación` (no encuentra dónde ir) · `interpretación` (lee mal la etiqueta o el resultado) · `dato` (introduce mal un valor) · `validación` (el sistema rechaza y no se entiende por qué) · `ninguno` |
| Ayuda prestada | `ninguna` · `n1 recordatorio` · `n2 pregunta guía` · `n3 señalamiento` · `n4 indicación directa` |

**Notas de cierre de sesión** *(plantilla vacía)*

| Campo | Registro |
|---|---|
| Puntuaciones SUS 1–10 | |
| Puntuación SUS calculada | |
| ¿Algún ítem quedó sin responder? | Sí / No — *si sí, la puntuación no se calcula* |
| Frase de cierre del participante ("¿algo que no le pregunté?") | |
| Impresión del moderador, marcada como impresión | |

---

## 4. Planilla de captura

Cuatro tablas, con formato fijo. Se llenan en ese orden y se guardan como CSV con codificación UTF-8
y separador coma. Los nombres de columna son los definitivos: no se renombran al analizar, para que
la trazabilidad del Cap. 13 al dato crudo sea verificable.

### 4.1 Tabla `encuesta_respuestas` — una fila por respuesta

| Columna | Tipo | Valores / formato | Obligatorio |
|---|---|---|---|
| `id_respuesta` | texto | `E001`… | Sí |
| `fecha` | fecha | `AAAA-MM-DD` | Sí |
| `hora` | hora | `HH:MM` | Sí |
| `canal` | categórico | `presencial` · `enlace` · `qr` · `correo` | Sí |
| `consentimiento` | booleano | `1` / `0` — sin `1` la fila no se usa | Sí |
| `dispositivo` | categórico | `celular` · `tableta` · `portatil` · `escritorio` | Sí |
| `navegador` | texto | `chrome` · `firefox` · `safari` · `edge` · `otro` | Sí |
| `version_commit` | texto | hash corto del despliegue | Sí |
| `D01`…`D05` | categórico | valores de §2.2 | Sí |
| `P01`…`P16` | ordinal | `1`–`5`, `NS`, vacío | Sí |
| `F01` | categórico | `a` · `b` | Sí |
| `F02I_legibilidad` … `F02I_estetica` | ordinal | `1`–`5` (rango en importancia) | Sí |
| `F02II_legibilidad` … `F02II_estetica` | ordinal | `1`–`5` (rango en cumplimiento) | Sí |
| `F03` | categórico | `a` · `b` · `c` · `d` | Sí |
| `A01`…`A04` | texto | literal, sin corregir ortografía | No |
| `observaciones` | texto | notas del codificador | No |

### 4.2 Tabla `sesiones` — una fila por sesión

| Columna | Tipo | Valores / formato |
|---|---|---|
| `cod_sesion` | texto | `P01`…`P08` |
| `fecha` · `hora_inicio` · `hora_fin` | fecha/hora | `AAAA-MM-DD`, `HH:MM` |
| `duracion_min` | entero | minutos totales |
| `commit` | texto | hash corto desplegado |
| `modalidad` | categórico | `escritorio` · `movil360` |
| `navegador` · `resolucion` | texto | |
| `consentimiento` | booleano | `1` / `0` |
| `audio_autorizado` | booleano | `1` / `0` |
| `D01` · `D02` · `D04` | categórico | valores de §2.2 |
| `incidencia_tecnica` | texto | vacío si no hubo |
| `SUS_01`…`SUS_10` | ordinal | `1`–`5`, vacío si no respondió |
| `SUS_completo` | booleano | `1` si las diez están respondidas |
| `SUS_suma` | entero | 0–40, vacío si no calculable |
| `SUS_puntuacion` | decimal | `suma × 2.5`, vacío si no calculable |
| `frase_cierre` | texto | literal |
| `notas_moderador` | texto | marcado explícitamente como impresión |

### 4.3 Tabla `tareas` — una fila por sesión y tarea

| Columna | Tipo | Valores / formato |
|---|---|---|
| `cod_sesion` | texto | `P01`…`P08` |
| `tarea` | categórico | `T1` · `T2` · `T3` · `T4` · `T5` |
| `inicio_s` · `fin_s` · `duracion_s` | entero | segundos desde el inicio de la sesión |
| `resultado` | categórico | `completada` · `completada con ayuda` · `no completada` · `no aplica` |
| `errores_n` | entero | conteo |
| `tipos_error` | lista | subconjunto de `navegacion`, `interpretacion`, `dato`, `validacion` |
| `ayuda_nivel` | categórico | `ninguna` · `n1` · `n2` · `n3` · `n4` |
| `cita` | texto | literal de lo que dijo al explicar el resultado (T3, T4) |
| `cifra_reportada` | texto | cifra que el participante leyó, **como cadena decimal exacta** |
| `observaciones` | texto | |

### 4.4 Tabla `codificacion_abiertas` — una fila por respuesta abierta codificada

| Columna | Tipo | Valores / formato |
|---|---|---|
| `id_respuesta` | texto | `E001`… |
| `pregunta` | categórico | `A01` · `A02` · `A03` · `A04` |
| `texto` | texto | literal |
| `tema` | texto | etiqueta del libro de códigos |
| `pasada` | entero | `1` (abierta) · `2` (cerrada) |
| `cita_usable` | booleano | `1` si puede ir al informe sin identificar a nadie |
| `nota` | texto | por qué se marcó o no |

### 4.5 Reglas de llenado

1. **Nunca se deja un campo ambiguo**: vacío significa "no hay dato", no "no aplica". Si es "no
   aplica" se escribe `NA`; si no se preguntó, `NP`.
2. **Una fila, un hecho.** No se agregan dos participantes en una fila ni dos tareas.
3. **El dato crudo no se corrige.** Si el participante escribió "no se", queda `no se`. La limpieza
   se hace en el análisis y se declara.
4. **La versión desplegada es obligatoria** en `encuesta_respuestas` y en `sesiones`. Sin commit, el
   dato no es rastreable y no entra al informe.
5. **Los archivos de audio y las transcripciones no viven en el repositorio.** Se guardan fuera y se
   referencian por `cod_sesion`.

---

## 5. Lo que estos instrumentos no pueden afirmar

Esta sección existe para que el Cap. 13 no prometa más de lo que midió. Cada punto es una frase que
**no** puede aparecer en el informe con estos datos.

### 5.1 Sobre la muestra

- **No hay generalización estadística.** `n ≈ 15–20` encuestas y 5–8 sesiones de conveniencia no
  representan a la comunidad universitaria, ni a los estudiantes de Bucaramanga, ni a los usuarios
  potenciales de FintCart. Se describe **esta** muestra y se dice cómo se reclutó.
- **No hay grupo de control.** Sin comparación contra la versión anterior ni contra otro producto
  medido con el mismo instrumento, no se puede atribuir ninguna diferencia al rediseño. Un SUS alto
  describe el sistema tal como está; no demuestra que el rediseño lo mejoró.
- **El reclutamiento tiene sesgo conocido:** invitación directa del autor, proximidad (compañeros de
  programa, conocidos) y autoselección por interés en finanzas. Ambas cosas empujan las respuestas
  hacia lo favorable, y no hay forma de corregirlo con este diseño.
- **El tamaño no permite segmentar.** Comparar "estudiantes vs. administrativos" o "celular vs.
  escritorio" con 15 respuestas produce celdas de 3 o 4 personas. No se hace, y si se hace, se
  reporta como anécdota explícita.

### 5.2 Sobre la medición

- **Efecto del moderador.** El moderador es el autor del producto y de la interfaz. Su presencia, su
  tono y su lenguaje corporal empujan a la cortesía. El guion §3.5 reduce el problema; no lo elimina.
  Se declara como limitación en el Cap. 13, no en una nota al pie.
- **Efecto del pensamiento en voz alta.** Hablar mientras se usa una interfaz hace la tarea más lenta
  y puede cambiar cómo se explora la pantalla. Los tiempos de §3.4 sirven para detectar bloqueos
  graves, no como benchmarks comparables con otros productos.
- **El SUS es una escala de percepción, no de desempeño.** Mide "qué tan fácil le pareció", no "qué
  tan fácil fue". Un participante puede puntuar 90 y no haber completado T4.
- **La traducción del SUS es propia.** Los diez ítems están traducidos por el autor. Se publican en
  paralelo al original (§3.2) para que la traducción sea auditable, pero los valores de referencia
  publicados para el SUS provienen de la versión inglesa aplicada a otros sistemas: la comparación es
  orientativa, no equivalente.
- **Cinco a ocho sesiones detectan problemas gruesos, no finos.** Alcanzan para ver si una tarea
  falla de forma sistemática; no para estimar una tasa de éxito con precisión. Con 5 sesiones, una
  diferencia de un participante mueve la tasa 20 puntos.
- **La escala Likert no es intervalo.** Reportar medias de ítems individuales es discutible y por eso
  el plan de análisis §2.6 reporta distribuciones y medianas. Cualquier promedio se acompaña de la
  distribución completa.

### 5.3 La afirmación que estos instrumentos no autorizan

La más importante, y la que hay que vigilar al escribir el capítulo:

> **Preferir la nueva interfaz no es evidencia de que se aprenda más.**

Ninguno de estos instrumentos mide aprendizaje. ISO 9241-11:2018 descompone la usabilidad en
eficacia, eficiencia y satisfacción \cite{iso2018usability}; las tareas de §3.4 miden las dos primeras,
el SUS recoge la tercera como satisfacción percibida \cite{brooke1996sus}, y ninguna de las tres es
aprendizaje. Las tareas miden si se completó un recorrido, no si se comprendió el contenido. Para
sostener que la plataforma "enseña" haría falta un diseño distinto: medición de conocimiento antes y
después con instrumento validado, grupo de comparación y, si se quiere hablar de efecto, asignación
aleatoria. Ese diseño no está en este trabajo y no se va a simular.

Lo que sí se puede afirmar, con estos datos, es acotado y verificable:

1. Si las tareas se completaron y con cuántos errores y ayudas, por tarea y por sesión.
2. Cómo se distribuyó la percepción en cada ítem, en esta muestra.
3. Qué puntuaciones SUS se obtuvieron y qué dispersión tuvieron.
4. Qué problemas concretos reportaron los participantes, con sus palabras.
5. Si los problemas encontrados son de una pantalla específica (accionable) o del modelo de
   interacción (grave).

El OE5, tal como quedó redactado en el capítulo 03, dice: "put the platform into operation and
evaluate it with representative users … to establish whether a student completes real tasks unaided
and whether the interface is trusted with money, **reporting that as usability and never as a gain in
financial literacy**". Con estos instrumentos se cumple la primera mitad de forma defendible. La
segunda se cumple **parcialmente**, y el informe debe decirlo con esas palabras: se midieron
condiciones para el aprendizaje —que el contenido se lea, que la tarea se complete, que la cifra se
entienda—, no aprendizaje.

> Nota de coherencia (2026-11-02). Una redacción anterior de este documento atribuía al OE5 la frase
> "medir el impacto educativo". El capítulo 03 la retiró a propósito: sería una promesa que ningún
> instrumento de esta tesis puede cumplir sin un estudio controlado. Si alguien encuentra esa frase
> en una versión vieja, la versión vigente es esta.

### 5.4 Deudas de este documento

| # | Deuda | Consecuencia si no se cierra |
|---|---|---|
| 1 | El guion no está aprobado por la directora | La fase 5 no puede arrancar (§11 del plan: "aprobar el guion antes de la fase 5") |
| 2 | No hay cuentas de prueba con datos sembrados (2 artículos leídos, 1 cuestionario, 2 simulaciones) | T5 no tiene qué encontrar y la sesión pierde la mitad de su valor |
| 3 | Las credenciales de la tarjeta de T1 no existen todavía | T1 no es ejecutable |
| 4 | El correo de contacto del consentimiento está sin completar | El consentimiento no es válido tal como está |
| 5 | No hay decisión sobre si se evalúa también a 360 px en móvil | Si no se decide, se evalúa solo escritorio y se declara |

---

## 6. Registro de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| v2 | 2026-11-01 | Atribuciones del SUS convertidas a `\cite` contra las entradas ya verificadas (`brooke1996sus`, `bangor2008empirical`, `iso2018usability`); la nota de fuentes pasa a advertir que la entrada de Brooke no lleva paginación; se retira la deuda bibliográfica de §5.4. Sin cambios en ítems, tareas, puntuación ni límites |
| v1 | 2026-11-01 | Instrumentos redactados: consentimiento, encuesta de 16 ítems Likert con mapa a OE1–OE5 y a las cinco dimensiones del brief, 3 ítems de elección forzada y ordenamiento, 4 preguntas abiertas, guion de sesión de 5 tareas sobre rutas reales, SUS en español con original en paralelo y regla de puntuación, planilla de captura de 4 tablas y límites declarados |
