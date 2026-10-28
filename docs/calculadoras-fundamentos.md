# Fundamentos de las calculadoras financieras

Fundamento matemático de las calculadoras del Simulador y **qué parte de ese fundamento
puede escribir el lenguaje de fórmulas** (`docs/lenguaje-de-formulas.md`). No describe
código: describe qué se puede pedir al motor y con qué límites, para que quien diseñe una
calculadora nueva sepa de antemano qué es una fórmula de una línea y qué es un problema de
optimización disfrazado.

Convenciones de todo el documento: las tasas son **fracciones**, no porcentajes (el 12 % se
escribe `0.12`); `i` es la tasa **periódica**, `j` la **nominal anual**, `EA` la efectiva
anual, `n` el número de periodos y `VP`/`VF` los valores presente y futuro. El dinero es
siempre decimal exacto: no hay un solo literal en coma flotante.

## 1. Regímenes de matemática financiera

### 1.1 Interés simple

$$VF = VP \cdot (1 + i \cdot n) \qquad I = VP \cdot i \cdot n$$

**El DSL lo expresa.** Es una suma y dos productos; no hay ninguna potencia que redondear:

```formula
monto * (1 + tasa_anual * anios)
```

El interés simple es el único régimen que es **exactamente correcto en decimal sin ninguna
salvedad**: un producto de tres decimales es otro decimal, y la escala de presentación lo
redondea una sola vez. Por eso es el término de comparación honesto frente al compuesto —
ver 3.6.

### 1.2 Interés compuesto

$$VF = VP \cdot (1 + i)^{n} \qquad I = VP \cdot \bigl[(1+i)^n - 1\bigr]$$

**El DSL lo expresa, y lo expresa de forma exacta.** `pot(base, n)` eleva a un entero por
multiplicación repetida (`functions.rs:279`), y por eso el resultado tiene una representación
decimal finita comprobable:

```formula
monto * pot(1 + tasa_anual, anios)
```

La regla que se deriva de esto y que no se puede saltar: **si el exponente es entero, `pot`**.
Escribirlo con `potd` no cambia el número por casualidad, cambia el número **siempre** que la
base no tenga un logaritmo cómodo, y convierte una potencia exacta en una aproximación
pedida sin querer.

Con capitalización subanual la tasa periódica no se divide a ojo: si `j` es la nominal anual
y `m` los periodos por año,

$$i = \frac{j}{m} \qquad VF = VP\left(1+\frac{j}{m}\right)^{m\cdot t}$$

```formula
monto * pot(1 + tasa_periodica(tasa_nominal_anual, 12), meses)
```

### 1.3 Nominal contra efectiva

La **nominal** es una tasa de referencia que se divide entre los periodos; la **efectiva** es
la que realmente se aplica en cada periodo. La relación es

$$i_p = \frac{j}{m} \qquad EA = \left(1+i_p\right)^{m} - 1$$

**El DSL lo expresa, y aquí hay una trampa que el lenguaje no esconde:**
`tasa_periodica(anual, m)` es una **división nominal** y nada más (`annuity.rs:74`). Sirve
para el lado izquierdo de la igualdad, **no** para convertir una efectiva en periódica. Una
tasa efectiva anual no se convierte en mensual dividiendo entre doce:

```formula
pot(1 + tasa_periodica(tasa_nominal_anual, 12), 12) - 1
```

Esa es la efectiva anual a partir de la nominal (exacta, exponente entero); la semilla
`mv_a_ea` es exactamente esta fórmula. El sentido contrario **no** es exacto y está en 1.4.

**Consecuencia para las semillas de §4.** `fondo_emergencia` y `meta_ahorro` reciben una
**efectiva anual** —lo que un banco colombiano cotiza— así que **no** usan `tasa_periodica`:
convierten con `potd(1 + tasa_anual, 1 / 12) - 1`, igual que `cdt_dias` y `ea_a_mv`.
`tasa_periodica` sigue siendo la conversión correcta para `ahorro`, `credito` e `inversion`,
cuya tasa de entrada es nominal por contrato (FR-049). La distinción no es de estilo: sobre
una E.A., la división nominal devuelve una tasa periódica MAYOR, y con ella
`fondo_emergencia` promete un saldo que la cuenta no va a alcanzar y `meta_ahorro` pide un
aporte MENOR que el necesario.

### 1.4 Efectiva anual ↔ nominal mes vencido

$$i_{mv} = (1+EA)^{1/12} - 1 \qquad EA = (1+i_{mv})^{12} - 1$$

El sentido **EA → MV no tiene representación decimal finita** en general: es una raíz
duodécima, es decir una exponenciación por un exponente fraccionario, que solo se resuelve
con logaritmo y exponencial. Por eso el DSL tiene `potd`, y por eso este es el único punto de
todo el catálogo donde la aproximación es inevitable y **declarada**:

```formula
potd(1 + tasa_ea, 1 / 12) - 1
```

`pot(1 + tasa_ea, 1 / 12)` **se rechaza** con `exponente_no_entero` (`parser.rs:721`), que es
lo correcto: aceptarlo redondeando el exponente a cero devolvería `0` sin avisar. La semilla
`ea_a_mv` documenta el mismo caso con una cifra: una E.A. del 24 % equivale a un 1,809 %
mensual, no al 2 % que sugiere dividir entre doce.

El sentido **MV → EA sí es exacto** y usa `pot`:

```formula
pot(1 + tasa_mv, 12) - 1
```

### 1.5 Anualidad vencida

El pago se hace al **final** de cada periodo. Para `n` pagos iguales `A`:

$$VF = A \cdot \frac{(1+i)^n - 1}{i} \qquad VP = A \cdot \frac{1 - (1+i)^{-n}}{i}$$

$$A = \frac{VP \cdot i \cdot (1+i)^n}{(1+i)^n - 1}$$

**El DSL lo expresa entero**, y a propósito: las tres son primitivas del catálogo de
funciones y no se reescriben a mano.

| Concepto | Fórmula del DSL |
|---|---|
| Valor futuro de la serie | `vf_serie(aporte_mensual, tasa_periodica(tasa_anual, 12), meses)` |
| Cuota nivelada | `cuota(monto, tasa_periodica(tasa_anual, 12), meses)` |

Dos razones para no escribir la fórmula cerrada en la definición aunque sea posible:

1. **`i = 0` divide por cero.** `vf_serie` y `cuota` resuelven el caso aparte
   (`annuity.rs:95` y `annuity.rs:127`): «ahorrar bajo el colchón» es un escenario real y no
   una curiosidad. Escribir la cerrada a mano obliga a un `si` —que es lo que hace la semilla
   de la sección 4.2, porque **no existe** una primitiva inversa para el aporte—.
2. **El valor presente no se escribe con exponente negativo.** En el DSL no existen
   (`parser.rs:721`). Se usa la forma algebraicamente idéntica
   $A\cdot\bigl((1+i)^n-1\bigr)/\bigl(i\cdot(1+i)^n\bigr)$, que es la misma que ya usa
   `annuity.rs:114-122` para no tener que truncar una división intermedia.

El **valor presente de una anualidad vencida** queda así, sin un solo exponente negativo:

```formula
aporte_mensual * (pot(1 + tasa_mensual, meses) - 1) / (tasa_mensual * pot(1 + tasa_mensual, meses))
```

### 1.6 Valor presente contra valor futuro

$$VF = VP\,(1+i)^n \qquad VP = \frac{VF}{(1+i)^n}$$

**El DSL lo expresa en los dos sentidos, y el descuento no necesita exponente negativo:**
dividir por la potencia es exactamente descontar.

```formula
monto / pot(1 + tasa_anual, anios)
```

Esta es la forma que usa la semilla `inversion` para el valor futuro real, y la razón está
escrita en `generales.rs:314-317`: descontar al final permite reutilizar el mismo valor
futuro que ya se devolvió, de modo que las dos cifras que ve el usuario cuadren entre sí.
Una segunda fórmula con `pot(1 + π, -n)` no solo sería ilegal: sería una segunda fuente del
mismo número.

### 1.7 Inflación y poder adquisitivo

$$\text{poder adquisitivo} = \frac{VF}{(1+\pi)^n} \qquad (1+i_{real}) = \frac{1+i_{nominal}}{1+\pi}$$

**El DSL lo expresa**, por lo mismo que 1.6: se descuenta dividiendo.

```formula
monto / pot(1 + inflacion_anual, anios)
```

La forma de Fisher (la de la derecha) es una división de dos binomios y también entra. Lo que
se debe evitar es la **suma** `i_nominal - π`, que es la aproximación de primer orden y no la
identidad: en un escenario del 20 % de inflación la diferencia entre restar y dividir es de
puntos porcentuales, no de decimales.

Con el indicador anual en lugar de un campo, `pot` sigue siendo la función correcta porque
`anios` es un campo entero:

```formula
monto / pot(1 + @IPC, anios)
```

### 1.8 Tasas anticipadas (avanzadas)

$$i_{vencida} = \frac{i_{anticipada}}{1 - i_{anticipada}} \qquad i_{anticipada} = \frac{i_{vencida}}{1 + i_{vencida}}$$

**El DSL lo expresa.** Es una división, y la única precaución es de dominio, no de lenguaje:
el denominador se anula en `i = 1`, así que la definición declara la regla
`tasa_anticipada < 1` con su mensaje, en lugar de dejar que el motor devuelva un error de
representabilidad que no nombra el parámetro.

```formula
tasa_anticipada / (1 - tasa_anticipada)
```

---

**Resumen de la sección.** De los ocho regímenes, siete son exactos en el DSL y uno —la raíz
con la que se pasa de efectiva anual a periódica— es aproximado y usa `potd`. La frontera no
la pone el lenguaje: la pone la aritmética. Un exponente entero es multiplicación repetida;
cualquier otra cosa deja de serlo.

## 2. Anclas regulatorias colombianas

Un **indicador** es un valor que publica la administración y que entra en las fórmulas como
`@NOMBRE`. Su forma no es libre: vive en `simulator_db.financial_indicators`
(`migrations/20260902121500_financial_indicators.up.sql`), con

- `name TEXT` + `CHECK (name ~ '^[A-Z][A-Z0-9_]*$')` — mayúsculas, dígitos y guion bajo;
- `value NUMERIC(20,6) NOT NULL` + `CHECK (value >= 0)` — escala 6, nunca negativa;
- `validity DATERANGE` **semiabierto** `[inicio, fin)` y `EXCLUDE USING gist (name WITH =,
  validity WITH &&)` — dos vigencias del mismo indicador no pueden solaparse.

El `EXCLUDE` es lo que hace que «qué valor regía el día D» tenga **una sola** respuesta. Y
como la vigencia es un rango y no un año, admite perfectamente indicadores de publicación
**mensual**, que es el caso de la tasa de usura.

### 2.1 El catálogo que existe hoy

`services/simulator/src/domain/seeds/mod.rs:84` declara la lista que el analizador conoce
sin consultar la base:

```text
INDICATORS = ["IPC", "SMMLV", "TASA_USURA", "UVR", "UVT"]
```

| Indicador | Existe | Unidad y escala en `value` | Vigencia real | Quién lo consume hoy |
|---|---|---|---|---|
| `UVT` | **sí** | pesos, `49799.000000` | anual (enero) | `gmf` — tope de exención `@UVT * 350` |
| `IPC` | **sí** | **fracción** anual, `0.055300` | anual (enero, variación 12 meses) | nadie todavía; lo pide 4.4 |
| `TASA_USURA` | **sí** | **fracción** efectiva anual, `0.286500` | **mensual** (Superfinanciera certifica cada mes) | nadie todavía; lo pide 3.7 de la matriz |
| `SMMLV` | **sí** | pesos, `1423500.000000` | anual (enero) | nadie todavía |
| `UVR` | **sí** | pesos, `392.400000` | diaria (Banco de la República) | nadie todavía |

> **El valor sembrado de `TASA_USURA` es de RELLENO y no es un certificado.**
> `services/simulator/src/repo/seeds.rs` (`YEAR_INDICATORS`) carga `0.25` —un 25 % E.A.,
> redondo y reconocible como ficticio—, mientras que los valores certificados recientes
> rondan el 28–30 % E.A. y cambian **cada mes**. Hoy no hay ninguna fórmula que consuma el
> indicador, así que el relleno es inocuo; **antes de la primera que lo consuma** hay que
> reemplazarlo por el valor certificado del mes (o cargarlo por `UpsertIndicator`, FR-060).
> El código no elige una cifra plausible a propósito: una tasa de usura inventada con
> apariencia de real se citaría como real, que es el fallo que la plataforma existe para
> evitar.

Los cinco nombres están ya en el catálogo **antes** de que exista una calculadora que los use,
y eso es deliberado: la lista es la del catálogo y no la de lo que hoy se consume
(`seeds/mod.rs:81-83`). Una fórmula puede escribir `@IPC` hoy sin un cambio de esquema.

**La unidad es la convención, no una restricción de la base.** El `CHECK` de
`financial_indicators` valida el formato del nombre y el signo del valor, **no la unidad**. Si
`TASA_USURA` se cargara como `28.650000` en lugar de `0.286500`, la expresión
`tasa_anual > @TASA_USURA` seguiría analizando, seguiría ejecutando y estaría equivocada por
un factor de cien. De ahí la regla que la administración tiene que respetar:

- un nombre que empieza por `TASA_` se guarda como **fracción** (`0.2865`), igual que un campo
de tipo `tasa`;
- un nombre que es una cuantía (`UVT`, `SMMLV`, `UVR`) se guarda en **pesos**;
- `IPC` se guarda como **fracción** anual (`0.0553`), no como índice ni como porcentaje.

### 2.2 Lo que no debe ser un indicador

Dos constantes del contexto colombiano son **literales de la definición** y no indicadores, y
la distinción no es de gusto:

| Constante | Valor | Dónde vive | Por qué no es indicador |
|---|---|---|---|
| Tarifa del GMF | `0.004` | `colombia.rs:58` (`tarifa_gmf!()`) | Es la tarifa fijada por ley (E.T. art. 872). Si cambia, cambia para todos a la vez y con fecha conocida de reforma: es una reforma legal, no un dato anual |
| Retención en la fuente sobre rendimientos | `0.07` | 4.3 (semilla `cdt_dias`) | Igual: E.T. art. 383. Un literal, no una serie |
| Exención del GMF | `350` UVT | `colombia.rs:69` (`exencion_uvt!()`) | Es el **número de UVT**, no un valor en pesos: lo anual es la UVT, que ya es `@UVT` |

El criterio general: **lo que se actualiza cada año y tiene fecha de vigencia es indicador; lo
que cambia por una ley es literal.** Un indicador con valor `0.004` obligaría a cargar una
vigencia nueva cada vez que se quiera corregir una errata, y dejaría una simulación histórica
explicada por un valor que nunca estuvo en la ley.

Una errata vigente en `docs/lenguaje-de-formulas.md`: el ejemplo del GMF (líneas 126 y 264)
dice
`min(monto, @UVT * 20)` mientras que la semilla `gmf` usa `@UVT * 350`. El ejemplo **analiza**
—que es lo único que comprueba `tests/formula_docs.rs`— pero el número normativo es 350
(art. 878 E.T.); el 20 no corresponde a ninguna figura del GMF. La semilla es la que manda.

### 2.3 Lo que hay que añadir

Dos huecos reales, ninguno de esquema:

| Nombre propuesto | Unidad | Vigencia | Por qué |
|---|---|---|---|
| `TASA_USURA_MICROCREDITO` | fracción E.A. | mensual | La usura **no es una sola cifra**: la Superfinanciera certifica una por modalidad de crédito (consumo y ordinario, microcrédito, consumo de bajo monto). `TASA_USURA` se queda como la de **consumo y ordinario**, que es la que un lector busca en el 90 % de los casos |
| `TASA_USURA_BAJO_MONTO` | fracción E.A. | mensual | Ídem; sin ella, una calculadora de tope para crédito de bajo monto publicaría un tope más bajo que el legal y diría que un crédito legal es usura |

Ninguno de los dos rompe nada: los dos cumplen `^[A-Z][A-Z0-9_]*$`, los dos caben en
`NUMERIC(20,6)` y los dos se resuelven con una fila de administración y una fecha.
**No hace falta tocar el esquema ni migrar.**

Lo que **no** hay que añadir, y conviene decirlo porque la tentación es fuerte:

- **`GMF_TARIFA`.** Ya está justificado arriba: es ley, no serie.
- **`IPC_MENSUAL`.** El poder adquisitivo se calcula con la variación **anual** y un exponente
  entero (`pot(1 + @IPC, anios)`). Añadir la serie mensual invitaría a
  `potd(1 + @IPC_MENSUAL, meses)`, que introduce una aproximación donde hoy hay una potencia
  exacta y dos indicadores para el mismo dato — el segundo de los cuales se desincroniza del
  primero en cuanto alguien cargue uno de los dos doce meses.
- **`TRM`.** Es un precio diario, no un ancla de indexación; una calculadora que convierta
  moneda no es una calculadora de este catálogo (no hay tipo `texto` para la moneda destino y
  no la va a haber, `ast.rs:33-40`).

### 2.4 Cómo entra un indicador en una fórmula

Un indicador se escribe `@NOMBRE` y tiene **espacio de nombres propio**, separado del de los
campos (T085):

```formula
@UVT * 350
```

Tres consecuencias que afectan al diseño de una calculadora:

1. **Un indicador no es una entrada.** El usuario no lo teclea, así que no se puede validar
   con un rango del campo: la guarda se escribe como **regla del autor**. `gmf` lo hace con
   `@UVT > 0` (`colombia.rs:216`), y no es un adorno: `financial_indicators_value_non_negative`
   admite el CERO, así que un `@UVT` de cero daría `tope_exencion = 0` y ninguna exención a
   quien la pidió.
2. **Cada simulación guarda el snapshot** de los indicadores que usó (FR-058). El resultado
   de hace un año sigue siendo explicable aunque la UVT haya cambiado.
3. **Un indicador en minúsculas no se puede cargar nunca.** El léxico exige
   `^[A-Z][A-Z0-9_]*$` igual que la base, y `@uvt` se rechaza al analizar con un mensaje sobre
   la escritura en lugar de uno sobre un dato que falta (`lexer.rs:237`).

## 3. Matriz de factibilidad

Diez calculadoras candidatas contra el lenguaje **tal como está hoy**. «Expresable» significa:
se puede escribir como una fórmula que el analizador acepta al guardar, con ≤ 64 nodos, ≤ 16
niveles y sin exponentes negativos, sin logaritmos y sin bucles.

| # | Calculadora | ¿Expresable hoy? | Fórmula en el DSL | Razón si no |
|---|---|---|---|---|
| 3.1 | Fondo de emergencia | **Sí** | `gasto_mensual * meses_cobertura` | — |
| 3.2 | Ahorro para una meta | **Sí**, con `si` | `si(tasa_periodica(tasa_anual, 12) == 0, (meta - ahorro_inicial) / meses, (meta - ahorro_inicial) * tasa_periodica(tasa_anual, 12) / (pot(1 + tasa_periodica(tasa_anual, 12), meses) - 1))` | — |
| 3.3 | CDT a días | **Sí**, con `potd` | `capital * potd(1 + tasa_ea, dias / 365)` | — |
| 3.4 | Poder adquisitivo con IPC | **Sí** | `monto / pot(1 + @IPC, anios)` | — |
| 3.5 | Cuota + seguros y comisión | **Sí** | `cuota(monto, tasa_periodica(tasa_anual, 12), meses) + seguro_mensual + comision_mensual` | — |
| 3.6 | Interés simple contra compuesto | **Sí** | `monto * (pot(1 + tasa_anual, anios) - (1 + tasa_anual * anios))` | — |
| 3.7 | Tope de usura | **Sí** | `max(monto * (tasa_anual - @TASA_USURA), 0)` | — |
| 3.8 | Capacidad de endeudamiento | **Sí**, con `si` y una reescritura algebraica | `si(tasa_periodica(tasa_anual, 12) == 0, ingreso_mensual * porcentaje_cuota * meses, ingreso_mensual * porcentaje_cuota * (pot(1 + tasa_periodica(tasa_anual, 12), meses) - 1) / (tasa_periodica(tasa_anual, 12) * pot(1 + tasa_periodica(tasa_anual, 12), meses)))` | — |
| 3.9 | VPN con horizonte fijo | **Sí**, hasta 20 flujos | `flujo_1 / pot(1 + tasa_descuento, 1) + flujo_2 / pot(1 + tasa_descuento, 2) - inversion_inicial` | — |
| 3.9 | VPN general y TIR | **No** | — | Sin sumatoria ni búsqueda de raíces (3.9) |
| 3.10 | «¿En cuántos meses pago?» | **No** | — | Requiere `ln` (3.10) |

**Resultado: 8 de 10 entran completas, una entra a medias y una no entra.** Dos de las ocho
necesitan un `si` que no es cosmético —sin él la fórmula divide por cero en el caso `i = 0`— y
una necesita una reescritura algebraica para no usar exponentes negativos. Las que no entran
no fallan por un detalle de sintaxis: piden una operación que el lenguaje no tiene (una
inversa con logaritmo, o una sumatoria de longitud variable).

> **Nota sobre la tasa de 3.1 y 3.2.** Las dos filas se implementaron (4.1 y 4.2) con la tasa
> **efectiva anual** —`potd(1 + tasa_anual, 1 / 12) - 1`— y no con la división nominal que
> aparece en la matriz, porque el banco colombiano cotiza E.A. y sobre una E.A. la nominal pide
> un aporte menor que el necesario. La matriz responde «¿es expresable?», y la respuesta no
> cambia; la fórmula que se entrega es la de §4.

### 3.1 y 3.2 — por qué el `si` del caso `i = 0`

`vf_serie` y `cuota` resuelven el tipo cero **dentro de la primitiva** (`annuity.rs:95` y
`annuity.rs:127`), así que una calculadora que solo use esas dos **no necesita `si`**. El
`si` aparece cuando la fórmula **no** es una primitiva:

- el **aporte** de una meta es la inversa de `vf_serie`, y no hay primitiva inversa, así que
  hay que escribirla: $A = VF\cdot i/\bigl((1+i)^n-1\bigr)$, donde `VF` es lo que hay que
  acumular **al final** del plazo —`meta − ahorro_inicial·(1+i)^n`, con el saldo inicial ya
  capitalizado (4.2)—. Con `i = 0` el denominador es exactamente cero (`pot(1, n) = 1`) y la
  evaluación falla;
- la **capacidad de endeudamiento** despeja el capital, y le pasa lo mismo.

El `si` es **perezoso**: `eval.rs:227-237` evalúa solo la rama elegida, así que la rama que
divide por cero no llega a ejecutarse. Si no lo fuera, el `si` no serviría para nada y la
fórmula fallaría incluso con la guarda puesta — que es el detalle que convierte este truco en
algo que hay que comprobar y no en algo que se supone.

### 3.3 — por qué `potd` y no `pot`

`dias / 365` es una división de decimales: su resultado casi nunca es entero, y `pot` **rechaza**
un exponente no entero al guardar (`parser.rs:721`). El año financiero de 365 días no es una
convención que el motor pueda demostrar entera, así que la potencia es aproximada y el autor
tiene que decirlo escribiendo `potd`. Es el mismo caso que `ea_a_mv`.

### 3.7 — el tope de usura es una comparación, no un cálculo

Lo que se responde aquí no es «cuánto cuesta» sino «¿está por encima de lo legal?», y por eso
la salida útil es un **exceso en pesos** (`max(tasa - @TASA_USURA, 0) * monto`) y no un
booleano: el lenguaje tiene tipo condición y un campo de salida tiene que ser numérico. Si se
quisiera una salida «sí/no», se expresa como `1`/`0` con `si`, igual que hace `gmf` con su
entrada `exento` (`colombia.rs:88-92`).

La comparación con el indicador es válida porque los dos lados son del mismo tipo: `tasa_anual`
es un campo `tasa` y `@TASA_USURA` un indicador, y el analizador los trata a ambos como número.

### 3.8 — la reescritura que evita el exponente negativo

La fórmula de libro es $P = A\cdot\bigl(1-(1+i)^{-n}\bigr)/i$, y **no se puede escribir**: no
existen exponentes negativos. La forma equivalente

$$P = A\cdot\frac{(1+i)^n - 1}{i\,(1+i)^n}$$

solo usa `pot` con exponente entero positivo, y **no es un truco de este documento**: es
exactamente la forma que `annuity.rs:114-122` elige para `level_payment`, con el argumento de
que la potencia negativa obligaría a «una división intermedia con resto —y por tanto a
truncar— antes de que el numerador entre en juego». Al reescribir por la misma vía se obtiene
el mismo redondeo que la primitiva, no uno parecido.

### 3.9 — VPN entra con horizonte fijo; TIR no entra

El VPN de un proyecto con `k` flujos **conocidos de antemano** es una suma de `k` términos,
cada uno con exponente entero:

$$VPN = -I_0 + \sum_{t=1}^{k} \frac{CF_t}{(1+r)^t}$$

```formula
flujo_1 / pot(1 + tasa_descuento, 1) + flujo_2 / pot(1 + tasa_descuento, 2) + flujo_3 / pot(1 + tasa_descuento, 3) - inversion_inicial
```

Funciona **mientras `k` sea fijo y pequeño**: cada flujo es una entrada (tope de 20,
`limits.rs:42`) y cada término son ~6 nodos, así que el presupuesto de 64 nodos
es el que fija el horizonte práctico — del orden de seis flujos por salida. Lo que **no** se
puede es un VPN de horizonte variable, porque sumar `k` términos con `k` desconocido es un
bucle y el lenguaje no tiene bucles: una fórmula es **una sola expresión**.

La **TIR** no entra por dos motivos independientes, y basta con que falle uno:

1. es la raíz de un polinomio de grado `k`, y no hay ninguna operación de búsqueda de raíces
   —ni siquiera `sqrt`— en la tabla de funciones (`functions.rs:88-101`);
2. el método que la resolvería (bisección, Newton) es una **iteración**, es decir un bucle.

Añadir `raiz(x)` no la resolvería: `raiz` no busca la raíz de una función, calcula una raíz
cuadrada de un número. La TIR necesita un solucionador y un solucionador es un programa, no
una expresión.

### 3.10 — «¿en cuántos meses pago?» no entra: falta el logaritmo

Despejar `n` de la cuota nivelada es una de las dos inversas que no existen:

$$n = -\frac{\ln\!\left(1 - \dfrac{VP\cdot i}{A}\right)}{\ln(1+i)}$$

Necesita **logaritmo** y además un signo negativo sobre el resultado. El lenguaje no tiene
`ln`, no tiene exponente negativo y no tiene forma de iterar hasta acercarse a `n`. Lo que sí
se puede es la dirección contraria —dado `n`, cuánto es la cuota— y una aproximación honesta
por **tabla de horizontes**: una calculadora con cinco salidas condicionales `si` que digan
en qué tramo cae el saldo después de 12, 24, 36, 48 y 60 meses. Es peor que un despeje, pero
es correcto.

Es la misma razón por la que el despeje de la **tasa** tampoco entra:
$i$ de $VP = A(1-(1+i)^{-n})/i$ no tiene forma cerrada, se resuelve iterando.

## 4. Diseño de tres semillas

Las tres se escriben en el **mismo lenguaje que escribe un autor** y se analizan con
`Draft::parse`, exactamente como cualquier calculadora (`seeds/mod.rs:18-25`). No son
`Definition` con el AST a mano: si lo fueran, no pasarían por las mismas comprobaciones que
todo lo demás y una semilla con dos campos homónimos se guardaría por la puerta de atrás.

Escalas que se usan: `2` para dinero (`NUMERIC(19,2)`, la de `round_money`) y `6` para tasas
(`NUMERIC(9,6)`, la que usan las semillas existentes).

**Convención de tasa: las tres trabajan en EFECTIVA ANUAL.** La tasa que el usuario teclea es
la que su banco le cotiza (E.A.) y se lleva a la tasa del periodo con
`potd(1 + tasa_anual, 1 / 12) - 1` —la ecuación de 1.4, aproximada y declarada—, **nunca**
dividiendo entre doce: `tasa_periodica(anual, 12)` es una división **nominal** (1.3) y sobre
una E.A. devuelve una tasa mayor, con lo que el saldo prometido queda por encima del real y
el aporte necesario por debajo. Es la misma convención que `cdt_dias` usa desde el principio
con `dias / 365`.

**Simplificaciones conocidas.** Una sola: la **retención en la fuente** de `cdt_dias` se
modela como el 7 % del rendimiento ÍNTEGRO, sin excluir el componente inflacionario, así que
la retención queda ligeramente **sobrerestimada** y el neto por debajo del que paga el banco.
Es deliberado: excluir la parte inflacionaria exige el IPC del periodo, que es un indicador
anual y no el del plazo, y un dato inventado sería peor que un centavo de más.

> **Sobre los nombres de las claves.** Todas las claves son `[a-z][a-z0-9_]*`: el léxico de
> identificadores solo admite alfanumérico y guion bajo (`lexer.rs:222-228`), así que un campo
> llamado `tasa-anual` no se podría escribir dentro de una fórmula.

---

### 4.1 `fondo_emergencia` — cuánto hace falta para dejar de depender de un sueldo

**Propósito.** Traducir «quiero tener N meses de gastos guardados» a una cifra, y decir a qué
distancia se está hoy y a qué distancia se estará en un año con el aporte que el usuario ya
está haciendo. La pregunta que responde no es «cuánto ahorro» sino **«cuánto me falta»**, que es
la única que cambia una decisión.

**Indicadores.** Ninguno. Todo lo que entra son datos del usuario.

#### Entradas

| `clave` | `etiqueta` | `tipo` | `unidad` | `min` | `max` | `default` | `requerido` |
|---|---|---|---|---|---|---|---|
| `gasto_mensual` | Gasto mensual | `monto` | COP | `1` | — | — | `true` |
| `meses_cobertura` | Meses de cobertura | `entero` | meses | `1` | `60` | — | `true` |
| `ahorro_inicial` | Ahorro disponible hoy | `monto` | COP | `0` | — | `0` | `false` |
| `aporte_mensual` | Aporte mensual previsto | `monto` | COP | `0` | — | `0` | `false` |
| `tasa_anual` | Rendimiento anual efectivo (E.A.) | `tasa` | fracción | `0` | — | `0` | `false` |

El tope de `60` meses no es una regla de negocio: es una barrera de representabilidad, igual
que el `MAX_PERIODS` de las semillas existentes. Cinco años de gastos ya es una cobertura
extrema y un tope más alto solo invita a teclear un cero de más.

`tasa_anual` **opcional con default `0`** y no opcional «ausente»: la fórmula la usa sin
`si`, y ausente significaría cero implícito — que es exactamente lo que el default hace, pero
visible en el formulario prerrellenado.

La etiqueta dice **(E.A.)** porque lo es: el banco cotiza efectiva anual y el campo la recibe
tal cual. La conversión a mensual está en la fórmula, no en el dedo del usuario.

#### Validaciones

| `texto` | `mensaje` |
|---|---|
| `gasto_mensual > 0` | el gasto mensual debe ser mayor que cero |
| `ahorro_inicial >= 0` | el ahorro disponible no puede ser negativo |
| `aporte_mensual >= 0` | el aporte mensual no puede ser negativo |
| `tasa_anual >= 0` | el rendimiento de una cuenta de ahorro no puede ser negativo |

#### Salidas

| `clave` | `etiqueta` | `escala` | `texto` |
|---|---|---|---|
| `fondo_objetivo` | Fondo objetivo | 2 | `gasto_mensual * meses_cobertura` |
| `cobertura_actual` | Cobertura actual | 2 | `ahorro_inicial / gasto_mensual` |
| `faltante_inicial` | Falta hoy | 2 | `max(gasto_mensual * meses_cobertura - ahorro_inicial, 0)` |
| `proyeccion_12_meses` | Saldo en 12 meses | 2 | `(ahorro_inicial * pot(1 + (potd(1 + tasa_anual, 1 / 12) - 1), 12) + vf_serie(aporte_mensual, (potd(1 + tasa_anual, 1 / 12) - 1), 12))` |
| `brecha_12_meses` | Falta en 12 meses | 2 | `max((gasto_mensual * meses_cobertura) - (ahorro_inicial * pot(1 + (potd(1 + tasa_anual, 1 / 12) - 1), 12) + vf_serie(aporte_mensual, (potd(1 + tasa_anual, 1 / 12) - 1), 12)), 0)` |
| `rendimiento_12_meses` | Rendimiento en 12 meses | 2 | `(ahorro_inicial * pot(1 + (potd(1 + tasa_anual, 1 / 12) - 1), 12) + vf_serie(aporte_mensual, (potd(1 + tasa_anual, 1 / 12) - 1), 12)) - (ahorro_inicial + aporte_mensual * 12)` |

Dos cosas que hace la proyección y antes no hacía:

- **La tasa es la equivalente, no la doceava.** `potd(1 + tasa_anual, 1 / 12) - 1` es la
tasa mensual que compone a la E.A. declarada (1.4). Dividir entre doce —lo que hacía la
primera versión— es una tasa NOMINAL, más alta, y producía una proyección que la cuenta no
iba a pagar: en E1, 3 613,61 pesos de más.
- **El ahorro inicial capitaliza.** `ahorro_inicial * pot(1 + i, 12)` y no `ahorro_inicial`
a secas: el saldo ya está en la misma cuenta que los aportes y devenga la misma tasa. Como
`(1+i)^12` es la E.A. salvo el residual de `potd`, el factor es el anual y no hace falta
escribir `(1 + tasa_anual)` a mano — que además se desincronizaría si la convención cambiara.
Dejarlo congelado subestimaba la proyección en `ahorro_inicial · E.A.` (180 000 pesos en E1)
y con ella la brecha.

`rendimiento_12_meses` resta **lo aportado**, saldo inicial incluido, y no solo los doce
aportes: desde que el saldo rinde, su rendimiento está dentro de `proyeccion_12_meses` y
omitirlo daría una cifra que no cuadra con el saldo que el usuario tiene al lado.

`brecha_12_meses` usa `max(…, 0)` y no un `si`: un faltante negativo no es información útil
—«me sobran 300 000» ya lo dice `proyeccion_12_meses`— y devolverlo restado de un tope sería
peor que recortarlo a cero.

#### Forma almacenada

```json
{
  "inputs": [
    { "clave": "gasto_mensual",   "etiqueta": "Gasto mensual",        "tipo": "monto",  "unidad": "COP",     "min": "1", "requerido": true },
    { "clave": "meses_cobertura", "etiqueta": "Meses de cobertura",   "tipo": "entero", "unidad": "meses",   "min": "1", "max": "60", "requerido": true },
    { "clave": "ahorro_inicial",  "etiqueta": "Ahorro disponible hoy", "tipo": "monto",  "unidad": "COP",     "min": "0", "default": "0", "requerido": false },
    { "clave": "aporte_mensual",  "etiqueta": "Aporte mensual previsto", "tipo": "monto", "unidad": "COP",    "min": "0", "default": "0", "requerido": false },
    { "clave": "tasa_anual",      "etiqueta": "Rendimiento anual efectivo (E.A.)", "tipo": "tasa", "unidad": "fracción", "min": "0", "default": "0", "requerido": false }
  ],
  "validations": [
    { "ast": {"op":"gt","left":{"op":"field","key":"gasto_mensual"},"right":{"op":"num","value":"0"}},
      "texto": "gasto_mensual > 0",
      "mensaje": "el gasto mensual debe ser mayor que cero" }
  ],
  "outputs": [
    { "clave": "fondo_objetivo", "etiqueta": "Fondo objetivo",
      "ast": {"op":"mul","left":{"op":"field","key":"gasto_mensual"},"right":{"op":"field","key":"meses_cobertura"}},
      "texto": "gasto_mensual * meses_cobertura", "escala": 2 }
  ]
}
```

(Se muestran una regla y una salida completas en lugar de las diez: las demás tienen la misma
forma, con `cuando` y `cuando_texto` presentes solo cuando la salida es condicional. Los
decimales van **como cadena** y no como número JSON —`decimal_str::serde_decimal`—, que es lo
que impide que un cliente con `f64` los redondee al leer.)

#### Comprobación token a token

`proyeccion_12_meses` = `(ahorro_inicial * pot(1 + (potd(1 + tasa_anual, 1 / 12) - 1), 12) + vf_serie(aporte_mensual, (potd(1 + tasa_anual, 1 / 12) - 1), 12))`

| Tokens | Lectura | Resultado |
|---|---|---|
| `ahorro_inicial` | `campo` declarado, `monto` | número |
| `*` | multiplicativa | — |
| `pot` | `funcion_numerica` de la tabla, aridad **2**; posición 1 es `Exponent` | — |
| `( 1 + ( potd ( 1 + tasa_anual , 1 / 12 ) - 1 )` | base del factor: literal más la tasa mensual equivalente | número |
| `, 12 )` | exponente de `pot` = literal entero no negativo (`parser.rs:721`) | `12` |
| `+` | aditiva | — |
| `vf_serie` | aridad **3**; posición 2 es `Periods` | — |
| `( aporte_mensual ,` | argumento 0 y coma | `Any` → campo `monto` |
| `( potd ( 1 + tasa_anual , 1 / 12 ) - 1 )` | argumento 1: una EXPRESIÓN, no un literal | número |
| `, 12 )` | argumento 2 = `Periods` | literal entero |
| `)` | cierra el paréntesis exterior de la suma | — |

**Por qué `potd` en un sitio y `pot` en el otro.** Los exponentes son distintos: el de `potd`
es `1 / 12`, una **división de literales** que no es entera; el de `pot` es `12`, un literal
entero. `pot` rechaza el primero al guardar con `exponente_no_entero` (`parser.rs`) y acepta el
segundo, que es exactamente la separación de D-16: `pot` es exacta —multiplicación repetida—
para el exponente entero, `potd` es aproximada para el decimal. Lo que hace posible la
expresión es que **`potd` no declara `ArgConstraint` en la posición 1** (`functions.rs:172-181`),
así que su exponente admite cualquier expresión numérica; `vf_serie` sí acota su tercer
argumento a `Periods`, y por eso ahí va el literal `12`.

**Nodos por salida.** `proyeccion_12_meses` **28** de 64 · `brecha_12_meses` **34** ·
`rendimiento_12_meses` **34**. Profundidad máxima **10** de 16 (en `brecha_12_meses`: `max` →
`-` → `+` → `*` → `pot` → `+` → `-` → `potd` → `+` → `tasa_anual`). La conversión de tasa se
escribe tres veces en la salida más larga y el árbol sigue cabiendo con holgura: es el precio
de que no existan variables (5.3), y el mismo que paga `meta_ahorro`.

**Por qué no lleva `si`.** El caso `tasa_anual = 0` no rompe nada: `potd(1, x)` es exactamente
`1`, así que la tasa mensual es exactamente `0` y `vf_serie` lo resuelve dentro de la primitiva
como `A · n` (`annuity.rs:95-101`) sin que `pot` llegue a usarse. Añadir un `si` aquí
duplicaría una guarda que ya existe en el módulo que sabe hacerla, y una guarda duplicada es
una que se puede desincronizar.

#### Ejemplos

**E1 — caso típico.** `gasto_mensual` 2 500 000 · `meses_cobertura` 6 · `ahorro_inicial`
3 000 000 · `aporte_mensual` 400 000 · `tasa_anual` 0.06 (E.A.)

`i = potd(1.06, 1/12) - 1 = 0.00486755056534303754119894558…`;
`(1+i)^12 = 1.0599999999999999999999999999752…` — doce multiplicaciones exactas sobre una base
aproximada, así que el factor devuelve la E.A. salvo el residual de `potd`, del orden de
10⁻²⁹.

| Salida | Valor sin redondear | Presentado |
|---|---|---|
| `fondo_objetivo` | `15000000` | **15 000 000.00** |
| `cobertura_actual` | `1.2` | **1.20** |
| `faltante_inicial` | `12000000` | **12 000 000.00** |
| `proyeccion_12_meses` | `8110611.336814867830841194681…` | **8 110 611.34** |
| `brecha_12_meses` | `6889388.663185132169158805318…` | **6 889 388.66** |
| `rendimiento_12_meses` | `310611.336814867830841194681…` | **310 611.34** |

Los 310 611,34 de rendimiento son 180 000 del saldo inicial (`3 000 000 × 0,06`, exacto porque
`(1+i)^12 = 1,06`) más 130 611,34 de los doce aportes. La versión anterior de esta tabla decía
**7 934 224,95**, y era un error doble que casi se cancelaba: 3 613,61 de MÁS por dividir la
E.A. entre doce y 180 000 de MENOS por dejar el saldo congelado. Por eso el fallo no se veía.

Ningún valor cae en un empate de medio centavo, así que el redondeo *half-even* y el «hacia
arriba» darían lo mismo aquí; la razón de usar *half-even* se ve en series largas, no en un
caso suelto.

**E2 — tasa cero.** `gasto_mensual` 1 800 000 · `meses_cobertura` 3 · `ahorro_inicial` 0 ·
`aporte_mensual` 300 000 · `tasa_anual` 0

| Salida | Valor | Presentado |
|---|---|---|
| `fondo_objetivo` | `5400000` | **5 400 000.00** |
| `cobertura_actual` | `0` | **0.00** |
| `faltante_inicial` | `5400000` | **5 400 000.00** |
| `proyeccion_12_meses` | `3600000` (= 300 000 × 12) | **3 600 000.00** |
| `brecha_12_meses` | `1800000` | **1 800 000.00** |
| `rendimiento_12_meses` | `0` | **0.00** |

Es el caso que demuestra que la primitiva resuelve el tipo cero: sin la rama de
`annuity.rs:95`, aquí habría una división por cero. Con la tasa equivalente el cero es
EXACTO —`potd(1, 1/12) = 1` y no `1.0000000000000000000000000001`—, que es lo que hace que la
rama se alcance de verdad.

**E3 — ya cubierto.** `gasto_mensual` 2 000 000 · `meses_cobertura` 6 · `ahorro_inicial`
13 000 000 · `aporte_mensual` 0 · `tasa_anual` 0.02

`fondo_objetivo` **12 000 000.00** · `cobertura_actual` **6.50** · `faltante_inicial`
**0.00** (`max` recorta) · `proyeccion_12_meses` **13 260 000.00** (el saldo solo, un año al
2 %) · `brecha_12_meses` **0.00** (la proyección supera el objetivo) · `rendimiento_12_meses`
**260 000.00**.

Es el caso que muestra el defecto corregido sin ninguna serie de por medio: sin aportes, todo
el rendimiento del año es del saldo inicial, y con la versión anterior esta salida decía
**0.00**.

### 4.2 `meta_ahorro` — cuánto hay que apartar cada mes para llegar

**Propósito.** La inversa de `ahorro`: dado un objetivo y un plazo, cuánto hay que aportar
cada mes. Es la pregunta que de verdad se hace («¿cuánto tengo que guardar?») y es también el
**único caso de las tres semillas donde un `si` es imprescindible**: la primitiva `vf_serie`
resuelve `i = 0` internamente, pero no existe la primitiva inversa, así que el despeje se
escribe a mano y se topa con el mismo cero.

**Indicadores.** Ninguno.

#### Entradas

| `clave` | `etiqueta` | `tipo` | `unidad` | `min` | `max` | `default` | `requerido` |
|---|---|---|---|---|---|---|---|
| `meta` | Meta de ahorro | `monto` | COP | `1` | — | — | `true` |
| `ahorro_inicial` | Ahorro ya disponible | `monto` | COP | `0` | — | `0` | `false` |
| `meses` | Plazo en meses | `entero` | meses | `1` | `360` | — | `true` |
| `tasa_anual` | Rendimiento anual esperado (E.A.) | `tasa` | fracción | `0` | — | `0` | `false` |

#### Validaciones

| `texto` | `mensaje` |
|---|---|
| `meta > 0` | la meta de ahorro debe ser mayor que cero |
| `ahorro_inicial >= 0` | el ahorro disponible no puede ser negativo |
| `ahorro_inicial < meta` | el ahorro disponible ya cubre la meta: no hay nada que aportar |
| `tasa_anual >= 0` | el rendimiento no puede ser negativo |

La tercera regla no es cosmética: garantiza `meta - ahorro_inicial > 0`, y sin ella la rama de
tasa cero de la fórmula dividiría entre `meses` un importe nulo o negativo y devolvería un
aporte de signo contrario al que se pidió, presentado como si fuera válido.

#### Salidas

| `clave` | `etiqueta` | `escala` | `texto` |
|---|---|---|---|
| `monto_pendiente` | Falta por acumular | 2 | `meta - ahorro_inicial` |
| `aporte_mensual_requerido` | Aporte mensual necesario | 2 | la expresión de 4.2.1 |
| `aporte_mensual_sin_rendimiento` | Aporte sin rendimiento | 2 | `(meta - ahorro_inicial) / meses` |
| `total_aportado` | Total aportado | 2 | la expresión de 4.2.1, multiplicada por `meses` |
| `aportado_por_el_rendimiento` | Lo que aporta el rendimiento | 2 | `(meta - ahorro_inicial) - ` la expresión de 4.2.1 ` * meses` |

#### 4.2.1 La expresión, completa

```formula
si((potd(1 + tasa_anual, 1 / 12) - 1) == 0, (meta - ahorro_inicial) / meses, (meta - ahorro_inicial * pot(potd(1 + tasa_anual, 1 / 12), meses)) * (potd(1 + tasa_anual, 1 / 12) - 1) / (pot(potd(1 + tasa_anual, 1 / 12), meses) - 1))
```

Es el fondo de amortización: $A = VF\cdot i\big/\bigl((1+i)^n-1\bigr)$, con `i` periódica
mensual **efectiva**, es decir la EQUIVALENTE de la E.A. que el usuario declara
(`potd(1 + tasa_anual, 1 / 12) - 1`, ecuación 1.4).

**`VF` es un valor FUTURO y ése es el punto entero de la fórmula.** Lo que hay que acumular
con los aportes es `meta − ahorro_inicial·(1+i)^n`, **no** `meta − ahorro_inicial`: `meta` es
un importe en t = meses y `ahorro_inicial` uno en t = 0, así que restarlos sin capitalizar
mezcla épocas y le regala al saldo inicial el rendimiento que sí devenga. La confusión es
fácil porque la identidad en valor PRESENTE —
$A = \bigl(meta/(1+i)^n - ahorro_{inicial}\bigr)\cdot i\big/\bigl(1-(1+i)^{-n}\bigr)$— es la
misma fórmula: allí el saldo inicial tampoco aparece capitalizado, pero porque el descuento ya
está aplicado a la meta. El lenguaje no tiene exponentes negativos (5.1), así que la forma
implementada es la de valor futuro, y en ella el saldo tiene que crecer. Llamar «VP» al
numerador de la forma implementada es lo que hacía invisible el error: `VP` es un importe de
hoy, y lo que se despeja aquí es un importe de dentro de `n` meses.

La expresión tuvo dos correcciones, y conviene no confundirlas porque la segunda escondía a la
primera:

| versión | numerador | E1 (`aporte_mensual_requerido`) |
|---|---|---|
| tasa nominal y saldo congelado | `meta - ahorro_inicial` con `tasa_anual / 12` | 687 325,36 |
| tasa efectiva y saldo congelado | `meta - ahorro_inicial` | 689 696,01 |
| **tasa efectiva y saldo capitalizado** | `meta - ahorro_inicial * pot((1+i), meses)` | **675 281,36** |

La segunda fila era peor que la primera en el sentido que importa: arreglar la tasa sin
arreglar el saldo dejó el aporte 14 414,65 MÁS alto cada mes, y un plan que termina 376 200
pesos por ENCIMA de la meta es tan inútil como uno que no llega. La prueba
`el_aporte_de_meta_ahorro_lleva_exactamente_a_la_meta` cierra esa puerta: proyecta hacia
adelante el aporte que la semilla publica y exige que el saldo final sea la meta, sin oráculo
alguno.

| Tokens | Lectura | Resultado |
|---|---|---|
| `si` | palabra del lenguaje, no puede ser campo (`parser.rs:109`) | — |
| `( potd ( 1 + tasa_anual , 1 / 12 ) - 1 ) == 0` | comparación entre dos expresiones aditivas | condición, tipo `condición` |
| `,` | separador del primer argumento | — |
| `( meta - ahorro_inicial ) / meses` | rama del caso `i = 0`, donde el factor es `1` y el hueco se reduce al de hoy | número |
| `,` | separador del segundo argumento | — |
| `( meta - ahorro_inicial * pot ( … ) )` | el hueco EN t = meses: la meta menos el saldo inicial ya capitalizado | número |
| `* ( potd ( 1 + tasa_anual , 1 / 12 ) - 1 )` | multiplicativa por la tasa periódica | número |
| `/` | división, asociativa por la izquierda | — |
| `( pot ( potd (…) , meses ) - 1 )` | paréntesis → `pot` con exponente `meses`, que es un campo **`entero`** | número |
| `)` | cierra `si` | — |

`pot(potd(…), meses)` y no `pot(1 + (potd(…) - 1), meses)`: es el mismo factor —`1 + (x - 1)`
devuelve `x` exactamente en `Decimal`— y cuesta 9 nodos en vez de 13, que es la diferencia
entre caber en el presupuesto de FR-046 y no caber, porque el factor aparece dos veces en la
rama general. La tasa `i` sí se escribe como `(base - 1)` donde hace falta compararla con cero
o multiplicar por ella.

**Tipos.** `si` exige que las dos ramas devuelvan el mismo tipo (`parser.rs:558-580`): las dos
son número, y la condición es de tipo condición. Si una rama fuera una comparación, el
guardado fallaría con `tipo_incompatible`.

**Nodos.** `si`(1) + condición(11) + rama cero(5) + rama general(35) = **52** de 64.
Profundidad **9** de 16 (`si` → `/` → `-` → `pot` → `potd` → `+` → `tasa_anual`). Repetir esta
expresión en `total_aportado` da 54 nodos, y en `aportado_por_el_rendimiento` 58 (profundidad
11): las dos caben, y es el precio de que no existan variables (5.3). El factor de
capitalización es lo que se lleva los nodos —aparece dos veces en la rama general, una anidada
dentro de la otra— y es la razón de que la semilla esté 6 nodos por debajo del tope.

**Aridades.** `si` 3 (exacta, `parser.rs:631-640`); `potd` 2; `pot` 2. Un
`tasa_periodica(tasa_anual, 12, 12)` fallaría al guardar con `expresion_mal_formada`, y un
`pot(1 + …, 1 / 12)` fallaría con `exponente_no_entero`.

**Por qué el `si` es imprescindible y no defensivo.** Con `tasa_anual = 0` el denominador es
`pot(potd(1, 1/12), meses) - 1 = pot(1, meses) - 1 = 0`: la rama general divide por cero
**exactamente**. Y el cero es exacto en las dos puntas de la cadena —`potd(1, x) = 1` y
`pot(1, n) = 1`—, así que la rama se alcanza de verdad. No es un caso raro — «ahorro sin
rendimiento» es el escenario de quien guarda en efectivo. Y el `si` funciona porque es
**perezoso**: `eval.rs:227-237` evalúa solo la rama elegida, así que la que divide por cero no
llega a ejecutarse.

La rama del cero escribe `(meta - ahorro_inicial) / meses` y no el hueco capitalizado, y **no
es una inconsistencia**: si `i = 0` el factor es `1^meses = 1` exacto, así que
`meta - ahorro_inicial·1` **es** `meta - ahorro_inicial`. Escribir la forma capitalizada costaría
diez de los 64 nodos para decir lo mismo, y el presupuesto de FR-046 es de la expresión
completa.

#### Forma almacenada (fragmento de `outputs`)

```json
{
  "clave": "aporte_mensual_requerido",
  "etiqueta": "Aporte mensual necesario",
  "ast": {
    "op": "if",
    "cond": {"op":"eq",
      "left":{"op":"sub",
        "left":{"op":"call","func":"potd","args":[
          {"op":"add","left":{"op":"num","value":"1"},
            "right":{"op":"field","key":"tasa_anual"}},
          {"op":"div","left":{"op":"num","value":"1"},
            "right":{"op":"num","value":"12"}}]},
        "right":{"op":"num","value":"1"}},
      "right":{"op":"num","value":"0"}},
    "then": {"op":"div",
      "left":{"op":"sub","left":{"op":"field","key":"meta"},"right":{"op":"field","key":"ahorro_inicial"}},
      "right":{"op":"field","key":"meses"}},
    "else": {"op":"div",
      "left":{"op":"mul",
        "left":{"op":"sub","left":{"op":"field","key":"meta"},"right":{"op":"mul",
          "left":{"op":"field","key":"ahorro_inicial"},
          "right":{"op":"call","func":"pot","args":[
            {"op":"call","func":"potd","args":[
              {"op":"add","left":{"op":"num","value":"1"},
                "right":{"op":"field","key":"tasa_anual"}},
              {"op":"div","left":{"op":"num","value":"1"},
                "right":{"op":"num","value":"12"}}]},
            {"op":"field","key":"meses"}]}}},
        "right":{"op":"sub",
          "left":{"op":"call","func":"potd","args":[
            {"op":"add","left":{"op":"num","value":"1"},
              "right":{"op":"field","key":"tasa_anual"}},
            {"op":"div","left":{"op":"num","value":"1"},
              "right":{"op":"num","value":"12"}}]},
          "right":{"op":"num","value":"1"}}},
      "right":{"op":"sub",
        "left":{"op":"call","func":"pot","args":[
          {"op":"call","func":"potd","args":[
            {"op":"add","left":{"op":"num","value":"1"},
              "right":{"op":"field","key":"tasa_anual"}},
            {"op":"div","left":{"op":"num","value":"1"},
              "right":{"op":"num","value":"12"}}]},
          {"op":"field","key":"meses"}]},
        "right":{"op":"num","value":"1"}}}
  },
  "texto": "si((potd(1 + tasa_anual, 1 / 12) - 1) == 0, (meta - ahorro_inicial) / meses, (meta - ahorro_inicial * pot(potd(1 + tasa_anual, 1 / 12), meses)) * (potd(1 + tasa_anual, 1 / 12) - 1) / (pot(potd(1 + tasa_anual, 1 / 12), meses) - 1))",
  "escala": 2
}
```

`texto` y `ast` no son dos copias: `ast` es lo que se **evalúa** y `texto` lo que el autor
escribió, para que el constructor reabra la calculadora con la fórmula original
(`repo/calculators.rs:974-982`). No se vuelve a analizar nunca.

#### Ejemplos

**E1 — caso típico.** `meta` 20 000 000 · `ahorro_inicial` 2 000 000 · `meses` 24 ·
`tasa_anual` 0.09 (E.A.)

`i = potd(1.09, 1/12) - 1 = 0.0072073233161366904855292224…`;
`(1+i)^24 = 1.18809999999999999999999999991…` — la E.A. al cuadrado (1.1881), como debe ser
para 24 meses, salvo el residual de `potd`.

| Salida | Valor sin redondear | Presentado |
|---|---|---|
| `monto_pendiente` | `18000000` | **18 000 000.00** |
| `aporte_mensual_requerido` | `675281.3644812855171657092561…` | **675 281.36** |
| `aporte_mensual_sin_rendimiento` | `750000` | **750 000.00** |
| `total_aportado` | `16206752.7475508524119770221472…` | **16 206 752.75** |
| `aportado_por_el_rendimiento` | `1793247.2524491475880229778528…` | **1 793 247.25** |

El rendimiento cubre 1 793 247,25 de los 18 millones: el 10.0 % del hueco. Y la comprobación
que importa: `2 000 000 × (1+i)^24 + 675 281,36… × ((1+i)^24 − 1)/i = 20 000 000` — el plan
llega, ni un peso de más. Con el aporte de la versión anterior (689 696,01) el mismo plan
terminaba en **20 376 200,00**, es decir `2 000 000 × ((1,09)² − 1) = 376 200,00` por encima de
la meta: exactamente el rendimiento del saldo inicial que aquel numerador olvidaba.

**E2 — tasa cero (la rama del `si`).** mismos datos con `tasa_anual` 0

| Salida | Valor | Presentado |
|---|---|---|
| `monto_pendiente` | `18000000` | **18 000 000.00** |
| `aporte_mensual_requerido` | `18000000 / 24` | **750 000.00** |
| `aporte_mensual_sin_rendimiento` | `750000` | **750 000.00** |
| `total_aportado` | `18000000` | **18 000 000.00** |
| `aportado_por_el_rendimiento` | `0` | **0.00** |

Sin el `si`, aquí el motor devolvería un error de división en lugar de esta tabla.

**E3 — meta corta con tasa alta.** `meta` 5 000 000 · `ahorro_inicial` 0 · `meses` 18 ·
`tasa_anual` 0.12 (E.A.)

`i = potd(1.12, 1/12) - 1 = 0.0094887929345829741263550691…`;
`(1+i)^18 = 1.1852965873569365845447238575…`, que es `1.12^1.5`, como debe ser para 18 meses.

`aporte_mensual_requerido` **256 043.38** (sin redondear `256043.3807748634938576141163…`) ·
`aporte_mensual_sin_rendimiento` **277 777.78** · `total_aportado` **4 608 780.85** ·
`aportado_por_el_rendimiento` **391 219.15**.

Nótese que `277 777.78` es un cociente no finito: se guarda sin redondear y se presenta con la
escala de la salida, que es la única razón por la que `aporte_mensual_sin_rendimiento` y
`aporte_mensual_requerido` no arrastran un centavo de diferencia entre sí.

### 4.3 `cdt_dias` — lo que rinde un CDT en `d` días

**Propósito.** Un CDT colombiano se pacta a **días** y se ofrece en **efectiva anual**. La
cuenta que hace todo el mundo —`capital * tasa_ea * dias / 365`— es **interés simple** y
sobreestima el rendimiento en un plazo largo. La calculadora existe para mostrar la cifra
correcta, con interés compuesto y la retención que de verdad se paga.

**Indicadores.** Ninguno **usado en este diseño**. La tasa de referencia del mercado no se
modela porque depende de la entidad y el monto, no de una norma; si algún día se quiere
publicar una referencia, el nombre correcto sería `TASA_CDT_90` con vigencia mensual, y no
un indicador «general». Lo que **sí** es un literal y no un indicador es la tarifa de
retención del 7 %, por la misma razón que la del GMF (2.2).

> **Simplificación conocida.** La retención se calcula sobre el rendimiento **íntegro**, sin
excluir el componente inflacionario, así que queda ligeramente **sobrerestimada** y el neto
por debajo del que paga el banco. Es deliberado: la exclusión exige el IPC del plazo, que no
es el indicador anual del catálogo, y un dato inventado sería peor que un centavo de más.

#### Entradas

| `clave` | `etiqueta` | `tipo` | `unidad` | `min` | `max` | `default` | `requerido` |
|---|---|---|---|---|---|---|---|
| `capital` | Capital invertido | `monto` | COP | `1` | — | — | `true` |
| `tasa_ea` | Tasa efectiva anual | `tasa` | fracción | — | — | — | `true` |
| `dias` | Plazo en días | `entero` | días | `1` | `1825` | — | `true` |
| `aplica_retencion` | Retención del 7 % | `entero` | 1 = sí | `0` | `1` | `1` | `false` |

`aplica_retencion` es un entero `0`/`1` y no una casilla de texto: el lenguaje no tiene tipo
texto (`ast.rs:33-40`) y el rango `[0, 1]` hace que un valor distinto se **rechace** en lugar
de leerse como «no», que es exactamente lo que hace `exento` en `gmf` (`colombia.rs:196-208`).

`dias` es `entero` por una razón técnica y no semántica: es lo que permite que un día se use
como exponente en `pot` si el diseño futuro necesita un plazo entero de años. Aquí el
exponente es `dias / 365`, que es decimal y por eso va por `potd`.

#### Validaciones

| `texto` | `mensaje` |
|---|---|
| `capital > 0` | el capital invertido debe ser mayor que cero |
| `tasa_ea >= 0` | la tasa efectiva anual de un CDT no puede ser negativa |

La segunda regla no es un rango declarado sino una **regla del autor**, porque `tasa` no lleva
`min` en las semillas existentes. Y no es opcional: con `tasa_ea < -1` la base
`1 + tasa_ea` queda en cero o negativa, `potd` no es representable y el usuario vería un error
del motor en lugar de un mensaje sobre su dato.

#### Salidas

| `clave` | `etiqueta` | `escala` | `cuando` |
|---|---|---|---|
| `valor_final` | Valor al vencimiento | 2 | — |
| `intereses` | Intereses brutos | 2 | — |
| `tasa_periodo` | Tasa del periodo | 6 | — |
| `retencion` | Retención en la fuente | 2 | — |
| `neto_recibido` | Neto recibido | 2 | — |

#### 4.3.1 Las expresiones, completas

Factor común a todas, y se escribe **entero** en cada una (el lenguaje no tiene variables):

```formula
capital * potd(1 + tasa_ea, dias / 365)
```

```formula
capital * potd(1 + tasa_ea, dias / 365) - capital
```

```formula
potd(1 + tasa_ea, dias / 365) - 1
```

```formula
si(aplica_retencion == 1, redondear_dinero((capital * potd(1 + tasa_ea, dias / 365) - capital) * 0.07), 0)
```

```formula
capital * potd(1 + tasa_ea, dias / 365) - si(aplica_retencion == 1, redondear_dinero((capital * potd(1 + tasa_ea, dias / 365) - capital) * 0.07), 0)
```

#### Comprobación token a token

| Tokens | Lectura | Resultado |
|---|---|---|
| `capital` | `campo` declarado, `monto` | número |
| `*` | multiplicativa | — |
| `potd` | `funcion_numerica`, aridad **2** | — |
| `( 1 + tasa_ea` | argumento 0 = base | `Add` de literal y campo |
| `, dias / 365 )` | argumento 1 = **exponente decimal** | `Div` de campo y literal |

**Lo que hace posible esta fórmula es una diferencia de una línea en `functions.rs`: `potd`
no declara `ArgConstraint` en la posición 1** (`functions.rs:172-181`), así que su exponente
admite cualquier expresión numérica. `pot(1 + tasa_ea, dias / 365)` se rechazaría al guardar
con `exponente_no_entero` (`parser.rs:749-764`) porque ni `dias / 365` es un literal entero ni
`dias` es el campo del exponente: el exponente es una **expresión calculada**.

**Nodos por salida.** `tasa_periodo` 8 · `valor_final` 9 · `intereses` 11 · `retencion` 19 ·
`neto_recibido` **29** de 64. Profundidad máxima **10** de 16 (en `neto_recibido`: `-` → `si`
→ `redondear_dinero` → `*` → `-` → `*` → `potd` → `+` → `/` → `dias`).

**Aridades.** `potd` 2 (`functions.rs:150-165`), `redondear_dinero` **1**, `si` 3. Escribir
`redondear_dinero(x, 2)` falla al guardar: la escala es un argumento de `redondear`, no de
`redondear_dinero`, y es un error fácil de cometer porque las dos empiezan igual.

**Por qué el `si` está en la retención y no en la tasa.** Aquí el caso `tasa_ea = 0` **no**
rompe nada: `potd(1, x) = 1` exacto, intereses cero, y no hay ninguna división por la tasa. El
`si` de esta semilla protege otra cosa —que la retención sea cero cuando no aplica— y por eso
su condición compara un entero `0/1` y no una tasa. **No todos los `si` son la guarda del cero**;
poner uno donde no hace falta es tan malo como omitirlo donde sí.

**Por qué la retención se redondea dentro.** El `si` devuelve el impuesto **ya redondeado** y
luego se resta, igual que `gmf` resta el gravamen redondeado del monto (`colombia.rs:186-196`).
Si se restara el valor sin redondear, `neto_recibido` no cuadraría con el extracto por un
centavo — y un centavo que no cuadra es la clase de error que nadie reporta y todos desconfían.

#### Nota sobre el año de 365 días

La convención `dias / 365` ignora el 29 de febrero; el error máximo es de un día sobre 365, es
decir menos de tres milésimas del rendimiento, y es la misma convención que ya usa `ea_a_mv`
con `1 / 12`. Si un día se necesita la base 360 (mes comercial), **cambia un literal** y nada
más. Y si se necesitara la base real, no se puede: requeriría saber cuántos bisiestos hay
entre dos fechas, y el lenguaje no tiene fechas.

#### Ejemplos

**E1 — 90 días al 11 % E.A.** `capital` 10 000 000 · `tasa_ea` 0.11 · `dias` 90 ·
`aplica_retencion` 1

`dias / 365 = 0.2465753424657534246575342466…`; `1.11^0.24657… = 1.0260665482818713785271…`

| Salida | Valor sin redondear | Presentado |
|---|---|---|
| `valor_final` | `10260665.48281871378527151947107991…` | **10 260 665.48** |
| `intereses` | `260665.48281871378527151947107991…` | **260 665.48** |
| `tasa_periodo` | `0.0260665482818713785271…` | **0.026067** |
| `retencion` | `260665.482818… × 0.07 = 18246.58379731…` | **18 246.58** |
| `neto_recibido` | `10260665.4828… - 18246.58` | **10 242 418.90** |

**E2 — 30 días al 7.5 % E.A.** `capital` 5 000 000 · `tasa_ea` 0.075 · `dias` 30 ·
`aplica_retencion` 1

| Salida | Valor sin redondear | Presentado |
|---|---|---|
| `valor_final` | `5029809.32782213917475976435969272…` | **5 029 809.33** |
| `intereses` | `29809.32782213917475976435969272…` | **29 809.33** |
| `tasa_periodo` | `0.0059618655644278349519…` | **0.005962** |
| `retencion` | `2086.6529475496…` | **2 086.65** |
| `neto_recibido` | `5029809.3278… - 2086.65` | **5 027 722.68** |

**E3 — 360 días al 13 % E.A. sin retención.** `capital` 20 000 000 · `tasa_ea` 0.13 ·
`dias` 360 · `aplica_retencion` 0

| Salida | Valor sin redondear | Presentado |
|---|---|---|
| `valor_final` | `22562194.41643204255120314975683827…` | **22 562 194.42** |
| `intereses` | `2562194.41643204255120314975683827…` | **2 562 194.42** |
| `tasa_periodo` | `0.1281097208216021275601…` | **0.128110** |
| `retencion` | `0` | **0.00** |
| `neto_recibido` | `22562194.4164… - 0` | **22 562 194.42** |

Compárese con el interés simple que da la cuenta mental: 20 000 000 × 0.13 × 360/365 =
2 564 383.56. La diferencia —2 189 pesos— es pequeña porque el plazo es corto; con cinco
años la cuenta simple se queda corta en millones, y ese es el motivo de que esta calculadora
exista.

## 5. Qué NO se puede expresar y por qué

Las ausencias no son huecos pendientes: cada una corresponde a una decisión de diseño que se
puede rastrear en el código. Lo que sigue es la lista con su evidencia.

### 5.1 Exponentes negativos

`pot(1.1, -12)` **no es una fórmula válida**, y el rechazo ocurre al guardar, no al ejecutar:

- `functions.rs:231` — `ArgConstraint::Exponent => (0, MAX_EXPONENT)`: el mínimo del
exponente es **cero**. El tope superior es `MAX_EXPONENT = MAX_PERIODS = 1200`
  (`functions.rs:59`, `inputs.rs:150`), una barrera de coste, no de negocio.
- `parser.rs:721` — el analizador solo acepta como exponente un `Expr::Num` cuyo valor sea
  entero **y no negativo**; `parser.rs:736` es el mensaje para el resto: «una expresión
  calculada no permite demostrar que lo sea».

Y hay una distinción que conviene no confundir: **negar el resultado sí está permitido**.
`-pot(1.1, 12)` es legal, porque la negación unaria de la gramática
(`unaria := "-" unaria`) actúa sobre el valor y no sobre el exponente. Lo que no existe es un
exponente negativo **dentro** de la potencia.

**Consecuencia de diseño, y no es un obstáculo menor:** toda fórmula de valor presente se
escribe dividiendo. $VP = VF/(1+i)^n$, no $VF\cdot(1+i)^{-n}$. Es exactamente la elección que
`annuity.rs:116-122` documenta para `level_payment`, y por la misma razón: la potencia negativa
obliga a una división intermedia con resto —y por tanto a truncar— antes de que el numerador
entre en juego. Lo que parece una limitación impuesta resulta ser la forma que ya se usa por
precisión.

### 5.2 Logaritmos y raíces

`ln`, `log`, `raiz` y `sqrt` **no están en la tabla de funciones**. La evidencia es literal:
`Func::from_name` (`functions.rs:88-101`) reconoce exactamente diez nombres y devuelve `None`
para cualquier otro, lo que produce `funcion_desconocida`; `Func::ALL` (`functions.rs:114-125`)
es la misma lista. El documento del lenguaje lo dice en
`docs/lenguaje-de-formulas.md:283-284`: «Módulo, raíz y logaritmo. No están porque ninguna de
las siete calculadoras los necesita». Añadir uno es una fila en `from_name`, una en `ALL`,
una en `help` y una en la tabla del documento — el analizador no lleva lista propia.

Lo que **sí** hay es `potd`, y no es un logaritmo: es una potencia de exponente decimal que
`rust_decimal` resuelve internamente con `exp`/`ln`. Sirve para **elevar**, no para
**despejar**: `potd(1.11, 0.5)` da la raíz cuadrada de 1.11, pero ninguna fórmula puede
preguntar «¿a qué exponente hay que elevar 1.11 para obtener 2?». Esa pregunta es un logaritmo
y queda fuera.

Es la razón de que 3.10 no entre, y la razón de que la TIR tampoco.

### 5.3 Bucles, sumatorias y variables

Una fórmula es **una sola expresión**, no un programa:

- La gramática arranca en `formula := condicion` y `condicion` nunca produce una secuencia
de sentencias (`docs/lenguaje-de-formulas.md:45-62`).
- El AST (`ast.rs:87-200`) no tiene variante de asignación, ni de variable, ni de bloque: sus
nodos son literales, campos, indicadores, operadores binarios, `si`, `presente` y llamadas.
- No hay forma de **nombrar un resultado intermedio**. Un campo de salida no se puede
  referenciar desde otra salida: nombrarlo da `campo_inexistente`, porque el espacio de
  nombres de una fórmula es `inputs` + indicadores y nada más (`ast.rs:353-356`). Por eso las
  semillas repiten la sub-expresión entera —`ahorro` la escribe con macros para que las dos
  apariciones sean literalmente el mismo texto (`generales.rs:53-73`)—, y por eso
  `neto_recibido` de 4.3 repite el factor de capitalización en lugar de citar `valor_final`.

Sin variables no hay sumatoria de longitud variable, así que **un VPN de horizonte variable no
es expresable** (3.9). Y sin bucles no hay búsqueda de raíces, así que **no hay TIR**.

El coste de esta ausencia es cero en ejecución y alto en autoría: la fórmula más larga de 4.3
tiene 29 nodos donde un lenguaje con variables necesitaría 12 y un nombre.

### 5.4 El presupuesto de 64 nodos y 16 niveles

- `limits.rs:31` — `MAX_NODES = 64`; `limits.rs:39` — `MAX_DEPTH = 16`. Se comprueban **al
guardar**, con `limits::check`, y no se vuelven a mirar al ejecutar: por eso el motor no
necesita un vigilante de tiempo de ejecución.
- `limits.rs:42` y `limits.rs:45` — `MAX_INPUTS = 20` y `MAX_OUTPUTS = 10`, con
  `MIN_INPUTS = 1` (`limits.rs:58`) y `MIN_OUTPUTS = 1` (`limits.rs:65`).
- `functions.rs:49` — `MAX_SCALE = 28`, la escala máxima de `rust_decimal`; `parser.rs:748-762`
  exige además que la escala de `redondear` sea un **literal**, para que el redondeo sea una
  propiedad de la definición y no del dato.

**Cuenta cada nodo, incluidos los literales y los campos** (`limits.rs:26-30`): `meses` es un
nodo. En la práctica el límite no aprieta a una calculadora de una pregunta —la más larga de
este documento usa 58 de 64 (`aportado_por_el_rendimiento` de 4.2, que repite el despeje
entero)— pero sí acota un VPN: cada flujo son ~6 nodos más, así que el
tope práctico son cinco o seis flujos por salida, y por eso el VPN de horizonte fijo entra
(3.9) y el general no.

Profundidad y anidamiento son **dos límites distintos** y conviene no confundirlos:
`((((1))))` tiene profundidad 1 y anidamiento 4. El anidamiento del analizador es 64
(`docs/lenguaje-de-formulas.md:201`) y la profundidad del árbol 16.

### 5.5 Lo que falta por otras razones

| Ausencia | Evidencia | Consecuencia práctica |
|---|---|---|
| Tipo texto | `ast.rs:33-40` — solo `monto`, `tasa`, `entero` | Una opción «sí/no» se modela como entero `0/1` con rango, como `exento` en `gmf` |
| Fechas | No hay tipo fecha ni función de diferencia de días | El plazo se pide en días; no se puede calcular con dos fechas ni aplicar el calendario real (4.3) |
| Comparación encadenada | `parser.rs:334-352` — `a < b < c` se rechaza con un mensaje que sugiere `y` | Una condición de tres tramos se escribe `a < b y b < c` |
| Recursión y funciones del autor | `docs/lenguaje-de-formulas.md:22-24` | No hay forma de definir una sub-fórmula reutilizable; se repite |
| Constante `e` | No hay literal simbólico, solo decimales | La capitalización continua $e^{rt}$ solo se aproxima con un literal truncado, y **no se recomienda**: introduce una aproximación no declarada donde `pot` sería exacta |
| Indicadores no negativos | `financial_indicators_value_non_negative` | Un indicador jamás será negativo, así que una tasa negativa **de mercado** no puede venir de ahí; tiene que ser un campo |

### 5.6 El resumen que importa

El lenguaje cubre **todo el interés compuesto, toda la amortización francesa, todo el
descuento y toda la indexación**. No cubre **despejar exponentes ni tasas**, porque las dos
cosas son el mismo problema: invertir una función que solo se sabe evaluar. Cuando una
calculadora futura pida «¿en cuántos meses?» o «¿a qué tasa?», la respuesta correcta no es
añadir una función al lenguaje —es un solucionador y un solucionador es un programa—: es
diseñar la calculadora en la dirección que sí se puede evaluar y decirlo en la etiqueta.
