# El lenguaje de fórmulas de las calculadoras

> Referencia para quien escribe una calculadora. Describe el lenguaje que el Servicio de
> Simulador analiza al **guardar** una definición, con qué límites, qué funciones y por qué
> `pot` y `potd` son dos funciones y no una.
>
> **Los ejemplos de este documento se comprueban en cada ejecución de las pruebas**: el
> archivo `services/simulator/tests/formula_docs.rs` extrae los bloques marcados como
> `formula`, los analiza con el analizador de verdad y falla si alguno deja de ser válido.
> Un ejemplo escrito aquí que el lenguaje no acepte no sobrevive a `cargo test`.

## Por qué existe un lenguaje y no un campo con una fórmula suelta

Tres decisiones (research D-15) y cada una responde a un problema concreto:

1. **Los errores se descubren al guardar, no al ejecutar.** Un autor que escribe
   `pot(x, 2.5)` se entera mientras edita; no un lector tres semanas después, delante de un
   artículo que dice que esa calculadora está publicada.
2. **El coste está acotado por construcción.** La definición guardada contiene un **árbol ya
   analizado y acotado** (64 nodos, 16 niveles), así que el evaluador no necesita contar nada
   ni rendirse a medias. Lo que se ejecuta es un recorrido de un árbol cerrado.
3. **No se ejecuta código.** No hay bucles, no hay recursión, no hay asignaciones y no hay
   funciones definidas por el autor. Una fórmula es **una sola expresión**.

De la primera decisión sale una consecuencia que conviene entender: **lo que se guarda es el
árbol, no el texto.** Si se guardara el texto, una mejora futura del analizador
reinterpretaría en silencio una fórmula ya publicada —un cambio de precedencia o de semántica
de `pot` alteraría resultados históricos sin tocar una sola fila—. Guardando el árbol, lo
publicado queda congelado.

## Los dos tipos

El lenguaje tiene **dos tipos y ninguna conversión implícita**:

| Tipo | Qué es |
|---|---|
| número | Un decimal exacto: `rust_decimal`, hasta 28 dígitos significativos |
| condición | El resultado de comparar o de combinar condiciones |

Que sean dos y no uno es lo que permite rechazar `si(x, 1, 2) + 1` **al guardar**: sin tipos,
sumar un condicional se descubriría al ejecutar. Nunca hay flotantes: el servicio no compila
`f32`/`f64` (`clippy.toml` los veta a nivel de tipo y el veto está en la raíz del crate), así
que una fórmula no puede producir un resultado con error de redondeo binario.

## Gramática

```text
formula      :=  condicion
condicion    :=  disyuncion
disyuncion   :=  conjuncion ( "o" conjuncion )*
conjuncion   :=  negacion ( "y" negacion )*
negacion     :=  "no" negacion | comparacion
comparacion  :=  aditiva ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) aditiva )?
aditiva      :=  multiplicativa ( ( "+" | "-" ) multiplicativa )*
multiplicativa := unaria ( ( "*" | "/" ) unaria )*
unaria       :=  "-" unaria | primaria
primaria     :=  numero | campo | indicador | llamada | "(" condicion ")"
llamada      :=  funcion_numerica "(" argumentos ")"
              |  "si" "(" condicion "," condicion , condicion ")"
              |  "presente" "(" campo ")"
numero       :=  digitos "." digitos
campo        :=  ( letra | "-" ) ( letra | digito | "_" | "-" )*
indicador    :=  "@" letra ( letra | digito | "_" )*
```

Precedencia, de menor a mayor — la misma tabla que documenta `formula/parser.rs`:

```text
o                     disyunción
y                     conjunción
no                    negación lógica
== != < <= > >=       comparación (NO se encadena)
+ -                   aditiva
* /                   multiplicativa
-x                    negación aritmética unaria
(…) f(…) @IND campo    primarios
```

**`no` está por debajo de la comparación**: `no a == b` se lee `no (a == b)`. Es lo que espera
quien escribe una condición, y la lectura contraria obligaría a paréntesis en el caso más
común.

**La comparación no se encadena.** `a < b < c` se **rechaza** en vez de evaluarse con una de
las dos lecturas posibles: en un lenguaje de dinero, `a <= b <= c` que significara otra cosa
que lo que parece es justo el fallo silencioso que hay que evitar.

## Literales

Solo hay literales decimales, y exigen dígitos **a los dos lados del punto**:

```formula
1500000.00
```

```formula
0.25
```

`.5` y `5.` **no** son válidos: no son decimales canónicos en la frontera del servicio
(`decimal_str`), y aceptarlos aquí produciría una fórmula analizable cuyo literal no se puede
serializar al árbol. Tampoco hay separadores de miles: `1.500.000` no es un número, es una
secuencia que el analizador rechaza con la columna donde se atascó.

## Palabras del lenguaje

`y`, `o`, `no`, `si` y `presente` **no pueden ser nombres de campo**. Un campo llamado `si`
haría que `si(1, 2, 3)` fuera ambiguo entre la llamada y una variable multiplicada, y el
servicio lo rechaza al guardar la definición con `definicion_invalida`.

Las claves de campo y de salida empiezan por letra o guion y siguen con letras, dígitos,
guiones bajos o guiones. El espacio y las tildes no entran: una clave tiene que poder
escribirse dentro de una fórmula sin comillas.

## Campos e indicadores

Un **campo** es un dato que pide la calculadora: `monto`, `tasa_anual`, `meses`. La fórmula lo
nombra tal cual, y referenciar un campo que no está declarado entre las entradas es un error
(`campo_inexistente`) que se ve al guardar.

Un **indicador** es un valor que publica la administración y que cambia con el tiempo —la UVT
de cada año, el IPC—: se escribe con arroba y en mayúsculas, `@UVT`. Los indicadores tienen su
propio espacio de nombres, separado del de los campos (T085): añadir un indicador llamado `UVT`
no puede cambiar el significado de una fórmula que use el campo `uvt`.

```formula
@UVT * 20
```

Un indicador sin catálogo es `indicador_desconocido`. Y **cada simulación guarda los valores de
los indicadores que usó** (FR-058): el resultado de dentro de un año sigue siendo explicable
aunque la UVT haya cambiado.

## `si` y `presente`

`si(condición, valor_si_cierto, valor_si_falso)` elige entre dos valores. Los tres argumentos
son obligatorios y las dos ramas tienen que devolver el **mismo tipo**.

`presente(campo)` dice si un campo **opcional** recibió un valor. Es la forma de escribir una
fórmula que se comporta distinto cuando el dato no está, en lugar de tratar el vacío como cero
—que es una decisión de negocio y no un detalle del lenguaje—.

```formula
si(presente(aporte_mensual), aporte_mensual, 0)
```

## Las funciones

| Fórmula | Qué hace |
|---|---|
| `abs(x)` | Valor absoluto |
| `min(a, b)` | El menor de los dos |
| `max(a, b)` | El mayor de los dos |
| `cuota(capital, i, n)` | Cuota nivelada de amortización francesa; `n` entero, 1…360 |
| `vf_serie(aporte, i, n)` | Valor futuro de aportes iguales; `n` entero, 1…360 |
| `tasa_periodica(anual, m)` | División nominal anual / `m`; `m` entero, 1…360 |
| `redondear(x, escala)` | Redondeo bancario (*half-even*) a `escala` decimales, 0…28 |
| `redondear_dinero(x)` | Redondeo bancario a la escala monetaria (2) |
| `pot(base, n)` | `base^n` con `n` **entero**. Exacta |
| `potd(base, x)` | `base^x` con `x` decimal. **Aproximada** |

### `pot` y `potd` no son la misma función

Es la distinción que más se equivoca, y por eso las dos están y no una:

- **`pot(base, n)`** exige un exponente **entero** y es **exacta**. `1.1^12` se calcula
  multiplicando doce veces, y el resultado tiene una representación decimal finita que se
  puede comprobar. Un exponente fraccionario **se rechaza** (`exponente_no_entero`) en vez de
  redondearse a escondidas.
- **`potd(base, x)`** acepta un exponente decimal y es **aproximada**: `1.1^0.5` es una raíz
  cuadrada, y ninguna raíz no exacta tiene representación decimal finita. El resultado se
  aproxima, y el autor sabe que lo ha pedido.

Fundir las dos en una sola función obligaría a elegir entre rechazar la mitad de los casos
útiles o degradar en silencio las potencias que hoy son exactas —que es lo que el Principio
VIII prohíbe—. **Si el exponente es entero, usa `pot`.**

```formula
pot(1.1, 12)
```

## Redondeo

El redondeo es **bancario (*half-even*)**, no «hacia arriba en el 5»: redondear un medio
siempre hacia arriba acumula un sesgo en una serie de cálculos. `redondear(x, escala)` permite
elegir la escala y `redondear_dinero(x)` la fija en 2, que es la de un importe.

Una fórmula puede —y suele— terminar sin redondear. La **escala de presentación** se declara
por salida (`scale` en la definición), así que cada salida se redondea una sola vez, al
presentarla:

```formula
redondear_dinero(cuota(monto, tasa_periodica(tasa_anual, 12), meses))
```

## Límites

| Límite | Valor | Por qué |
|---|---|---|
| Nodos del árbol | 64 | Coste acotado del recorrido |
| Profundidad | 16 | La recursión del evaluador es la del árbol |
| Anidamiento del análisis | 64 | Los paréntesis no son nodos, pero sí anidan el analizador |
| Entradas por calculadora | 20 | Un formulario más largo deja de ser un formulario |
| Salidas por calculadora | 10 | |
| Exponente de `pot` | 360 | `pot(1, 360)` son 360 multiplicaciones: el tope es de coste, no de negocio |
| Periodos (`n`, `m`) | 360 | Además, `n = 0` dividiría por cero dentro de las primitivas de anualidad |
| Escala de redondeo | 28 | `rust_decimal` representa como mucho 28 decimales |

La distinción entre profundidad y anidamiento importa: `((((1))))` tiene profundidad **1** —los
paréntesis son transparentes en el árbol— y anidamiento **4**. Fundir los dos límites haría que
una fórmula con paréntesis de más se rechazara por un límite que en realidad no incumple.

## Qué se rechaza, y con qué código

Cada problema llega al editor con un `code` (el vocabulario que el constructor usa para
resaltar el campo) y un `location` que señala la salida o la regla concreta —`outputs[1].expression`—:

| `code` | Cuándo |
|---|---|
| `campo_inexistente` | La fórmula nombra un campo que no está entre las entradas |
| `indicador_desconocido` | La fórmula nombra un `@INDICADOR` que no está en el catálogo |
| `expresion_mal_formada` | Token inesperado, paréntesis sin cerrar, aridad equivocada |
| `tipo_incompatible` | Una condición donde va un número, o al revés |
| `limite_excedido` | La fórmula pasa de 64 nodos, 16 niveles o del tope de periodos |
| `exponente_no_entero` | `pot`, `cuota`, `vf_serie` o `tasa_periodica` reciben un no entero |
| `funcion_desconocida` | El nombre no está en la tabla de funciones |
| `definicion_invalida` | El problema está en la definición: dos entradas con la misma clave, una clave imposible, un mínimo mayor que su máximo |

Un campo de tipo entero **cuyo valor llega con decimales** (`"12.5"` en un campo declarado
`entero`) no es un error de análisis: la fórmula es correcta y el dato no. Se rechaza al
ejecutar, nombrando el campo y el valor, y el tipo declarado es una promesa sobre el dato y no
la comprobación del dato.

## Ejemplos completos

Los cuatro salen de las definiciones semilla que la plataforma siembra (`domain/seeds/`), así
que no son ejemplos de laboratorio: son fórmulas en producción.

**Ahorro con aportes mensuales** — interés compuesto de un depósito más una serie de aportes:

```formula
deposito_inicial * pot(1 + tasa_periodica(tasa_anual, 12), meses) + vf_serie(aporte_mensual, tasa_periodica(tasa_anual, 12), meses)
```

Una regla de la misma calculadora, que exige que haya algo que proyectar:

```formula
deposito_inicial != 0 o aporte_mensual != 0
```

**Cuota de un crédito** — la cuota nivelada, y el total pagado a partir de ella:

```formula
cuota(monto, tasa_periodica(tasa_anual, 12), meses)
```

```formula
cuota(monto, tasa_periodica(tasa_anual, 12), meses) * meses
```

**Gravamen del 4x1000 sobre la UVT** — el indicador entra en la fórmula y la condición elige
entre dos ramas del mismo tipo:

```formula
si(exento == 1, min(monto, @UVT * 20), 0)
```

**Tasa mes vencido** — una salida que no es dinero y por eso declara otra escala:

```formula
tasa_periodica(tasa_anual, 12)
```

## Lo que el lenguaje NO tiene, y por qué

- **Bucles y recursión.** El coste tiene que estar acotado por construcción; con bucles haría
  falta un vigilante en tiempo de ejecución y cada ejecución sería una apuesta.
- **Variables y asignaciones.** Una fórmula es una expresión. Dos asignaciones seguidas serían
  un programa, y un programa necesita un intérprete con estado.
- **Texto.** El lenguaje es numérico: el texto se declara en la etiqueta de cada entrada y de
  cada salida, que es donde se lee.
- **Condicionales anidados sin límite.** `si` se anida como cualquier expresión, pero cuenta
  para los 16 niveles.
- **Módulo, raíz y logaritmo.** No están porque ninguna de las siete calculadoras los necesita.
  Añadirlos es añadir una fila a `formula/functions.rs` —con su aridad y su descripción— y una
  fila a este documento; el analizador no lleva ninguna lista propia de funciones.
