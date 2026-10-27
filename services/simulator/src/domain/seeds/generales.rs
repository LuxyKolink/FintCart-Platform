//! Las seis semillas sin acento local: `ahorro`, `credito`, `presupuesto`, `inversion`,
//! `fondo_emergencia` y `meta_ahorro` (T093; FR-019; research D-16).
//!
//! Las cuatro primeras traducen a fórmulas lo que hoy hacen `crate::calculators::{ahorro,
//! credito, presupuesto, inversion}`. La regla que gobierna la traducción está en la nota del
//! módulo padre: **la misma función y el mismo orden de operaciones** que el código nativo,
//! porque en decimal reagrupar mueve el último dígito y un resultado plausible es
//! indistinguible de uno correcto.
//!
//! Las dos últimas —`fondo_emergencia` y `meta_ahorro`— NO traducen nada: son diseño nuevo
//! (`docs/calculadoras-fundamentos.md` §4.1 y §4.2). No tienen oráculo nativo, así que lo que
//! las fija es el ejemplo trabajado del diseño en `tests/seed_regression.rs`. Y la regla de
//! estilo sigue siendo la misma: la sub-expresión compartida se escribe una vez, como macro.
//!
//! ## Lo que las fórmulas NO repiten del código nativo
//!
//! Los topes y las guardas de dominio no se escriben dentro de las expresiones. Los topes son
//! **rangos declarados** del campo (FR-044) y las guardas son **reglas con mensaje del autor**
//! —`validations`—, que es lo que hace que el usuario lea «el ingreso mensual debe ser mayor
//! que cero» en lugar de una división por cero. Es el mecanismo que D-15 describe y la razón
//! de que estas definiciones se lean casi como el código que sustituyen.
//!
//! ## Sobre los paréntesis
//!
//! Toda sub-expresión compartida se escribe **ya entre paréntesis**, aunque el lenguaje
//! respete la precedencia habitual. No es desconfianza del analizador: componer con `concat!`
//! produce texto, y el texto se vuelve a analizar. Una sub-expresión como `a * b + c`
//! insertada a la izquierda de un `-` da `a * b + c - d`, que por asociatividad es
//! `((a*b) + c) - d` —correcto por casualidad—, pero la misma sub-expresión a la derecha de
//! un `/` daría un resultado distinto del que calcula el código nativo. Con los paréntesis
//! puestos donde se define la sub-expresión, componer no puede cambiar el significado.

use uuid::Uuid;

use super::{
    entero, monto, monto_opcional, regla, salida, salida_condicional, tasa, tasa_opcional,
    tasa_opcional_cero, Seed,
};
use crate::domain::definition::Draft;
use crate::domain::inputs::MAX_PERIODS;

/// Escala de una tasa: la de `NUMERIC(9,6)`.
const ESCALA_TASA: u32 = 6;

/// Escala de un importe monetario: la de `NUMERIC(19,2)`.
const ESCALA_MONETARIA: u32 = 2;

/// Tope de la cobertura de un fondo de emergencia, en meses.
///
/// No es una regla de negocio: es la misma barrera de representabilidad que [`MAX_PERIODS`],
/// porque cinco años de gastos ya es una cobertura extrema y un tope más alto solo invita a
/// teclear un cero de más.
const MESES_COBERTURA_MAX: u32 = 60;

/// Tope del plazo de una meta de ahorro, en meses: treinta años.
///
/// Es más estrecho que [`MAX_PERIODS`] —ciento veinte años, la barrera del exponente de
/// `pot`— porque una meta de ahorro personal no vive más allá de una vida laboral: admitir
/// mil doscientos meses solo invita a teclear un cero de más y produce una cifra que nadie va
/// a mirar. La barrera del motor sigue estando detrás, así que el tope no lo sustituye.
const MESES_META_MAX: u32 = 360;

/// Proyección de ahorro con aportes al final de cada mes.
///
/// Reproduce `calculators::ahorro::compute`. Los dos montos son opcionales por separado pero
/// no a la vez: sin ninguno no hay nada que capitalizar, y devolver ceros sería un resultado
/// indistinguible de un cálculo legítimo.
#[must_use]
pub fn ahorro(id: Uuid) -> Seed {
    // El factor de capitalización y la serie de aportes aparecen DOS veces cada uno (en el
    // saldo y en el interés, que se deriva de él). Se escriben como macros para que las dos
    // apariciones sean literalmente el mismo texto: dos copias que se separaran darían un
    // interés que no cuadra con el saldo sin que nada fallara.
    macro_rules! factor {
        () => {
            "pot(1 + tasa_periodica(tasa_anual, 12), meses)"
        };
    }
    macro_rules! serie {
        () => {
            "vf_serie(aporte_mensual, tasa_periodica(tasa_anual, 12), meses)"
        };
    }
    // El saldo SIN redondear. El nativo calcula a precisión plena y redondea una sola vez al
    // final (D-14); redondear aquí y seguir operando desviaría el interés.
    macro_rules! saldo {
        () => {
            concat!("(deposito_inicial * ", factor!(), " + ", serie!(), ")")
        };
    }
    macro_rules! aportado {
        () => {
            "(deposito_inicial + aporte_mensual * meses)"
        };
    }

    Seed {
        id,
        name: "ahorro",
        description: "Cuánto tendrás si guardas un aporte cada mes.",
        draft: Draft {
            inputs: vec![
                monto_opcional("deposito_inicial", "Depósito inicial"),
                monto_opcional("aporte_mensual", "Aporte mensual"),
                tasa("tasa_anual", "Tasa anual"),
                entero("meses", "Plazo", "meses", MAX_PERIODS),
            ],
            validations: vec![
                // El nativo comprueba `initial.is_zero() && monthly.is_zero()`, que es esta
                // misma condición por De Morgan. NO se añade «y ninguno negativo»: el código
                // vigente acepta montos negativos, y corregirlo aquí cambiaría el resultado
                // de una simulación que hoy se guarda — eso es una decisión de alcance y no
                // una traducción (FR-049).
                regla(
                    "deposito_inicial != 0 o aporte_mensual != 0",
                    "se necesita un depósito inicial o un aporte mensual: sin ninguno de los \
                     dos no hay ahorro que proyectar",
                ),
                regla("tasa_anual >= 0", "la tasa de ahorro no puede ser negativa"),
            ],
            outputs: vec![
                salida("monto_final", "Monto final", saldo!(), ESCALA_MONETARIA),
                salida(
                    "total_aportado",
                    "Total aportado",
                    aportado!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "interes_ganado",
                    "Interés ganado",
                    concat!(saldo!(), " - ", aportado!()),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "tasa_mensual",
                    "Tasa mensual",
                    "tasa_periodica(tasa_anual, 12)",
                    ESCALA_TASA,
                ),
            ],
        },
    }
}

/// Amortización francesa: cuota constante sobre un capital.
///
/// Reproduce `calculators::credito::compute`. El total pagado **no** es `cuota_redondeada ×
/// meses`: la cuota exacta casi nunca tiene dos decimales, y multiplicar la redondeada daría
/// un total que no cuadra con el interés. Las tres salidas se calculan a precisión plena y se
/// redondean una sola vez, de modo que `interes_total = total_pagado − monto` exactamente.
#[must_use]
pub fn credito(id: Uuid) -> Seed {
    // Cuota SIN redondear, compartida por las tres salidas que la usan.
    macro_rules! cuota {
        () => {
            "cuota(monto, tasa_periodica(tasa_anual, 12), meses)"
        };
    }
    macro_rules! pagado {
        () => {
            concat!("(", cuota!(), " * meses)")
        };
    }

    Seed {
        id,
        name: "credito",
        description: "Cuota mensual y costo total de un crédito con amortización francesa.",
        draft: Draft {
            inputs: vec![
                monto("monto", "Monto del crédito"),
                tasa("tasa_anual", "Tasa anual"),
                entero("meses", "Número de cuotas", "meses", MAX_PERIODS),
            ],
            validations: vec![
                regla("monto > 0", "el monto del crédito debe ser mayor que cero"),
                regla(
                    "tasa_anual >= 0",
                    "la tasa del crédito no puede ser negativa",
                ),
            ],
            outputs: vec![
                salida("cuota_mensual", "Cuota mensual", cuota!(), ESCALA_MONETARIA),
                salida("total_pagado", "Total pagado", pagado!(), ESCALA_MONETARIA),
                salida(
                    "interes_total",
                    "Interés total",
                    concat!(pagado!(), " - monto"),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "tasa_mensual",
                    "Tasa mensual",
                    "tasa_periodica(tasa_anual, 12)",
                    ESCALA_TASA,
                ),
            ],
        },
    }
}

/// Balance mensual de ingresos y gastos.
///
/// Reproduce `calculators::presupuesto::compute`. Es el único resultado que puede ser
/// NEGATIVO como respuesta legítima: un presupuesto en déficit es exactamente lo que el
/// usuario necesita ver, así que no se recorta a cero.
#[must_use]
pub fn presupuesto(id: Uuid) -> Seed {
    macro_rules! gasto {
        () => {
            "(gastos_fijos + gastos_variables)"
        };
    }
    macro_rules! balance {
        () => {
            concat!("(ingreso_mensual - ", gasto!(), ")")
        };
    }

    Seed {
        id,
        name: "presupuesto",
        description: "Cuánto te queda del ingreso del mes después de los gastos.",
        draft: Draft {
            inputs: vec![
                monto("ingreso_mensual", "Ingreso mensual"),
                monto_opcional("gastos_fijos", "Gastos fijos"),
                monto_opcional("gastos_variables", "Gastos variables"),
            ],
            validations: vec![
                // Con ingreso cero la tasa de ahorro sería una división por cero. Se rechaza
                // nombrando el parámetro en vez de devolver un resultado al que le falta
                // justo la cifra que se buscaba.
                regla(
                    "ingreso_mensual > 0",
                    "el ingreso mensual debe ser mayor que cero",
                ),
                regla("gastos_fijos >= 0", "los gastos no pueden ser negativos"),
                regla(
                    "gastos_variables >= 0",
                    "los gastos no pueden ser negativos",
                ),
            ],
            outputs: vec![
                salida("gasto_total", "Gasto total", gasto!(), ESCALA_MONETARIA),
                salida("balance", "Balance", balance!(), ESCALA_MONETARIA),
                // La división se hace a precisión plena y se redondea una sola vez:
                // `balance / ingreso` casi nunca es finita, y truncarla antes desplazaría el
                // porcentaje mostrado.
                salida(
                    "tasa_ahorro",
                    "Tasa de ahorro",
                    concat!(balance!(), " / ingreso_mensual"),
                    ESCALA_TASA,
                ),
            ],
        },
    }
}

/// Valor futuro de una inversión con capitalización ANUAL.
///
/// Reproduce `calculators::inversion::compute`. Se distingue de `ahorro` en que el horizonte
/// se mide en años y el aporte es anual: son dos preguntas distintas del usuario, y una sola
/// calculadora «universal» obligaría a explicarle qué es un periodo antes de responderle.
#[must_use]
pub fn inversion(id: Uuid) -> Seed {
    // El valor futuro SIN redondear, compartido por las dos salidas que lo usan. Y tiene que
    // ser el MISMO número: `valor_futuro_real` descuenta el importe que `valor_futuro`
    // redondea (así lo hace `inversion.rs:78`), de modo que las dos cifras que ve el usuario
    // guarden entre sí exactamente la relación anunciada. Dos copias que se separaran darían
    // un valor real calculado sobre una base distinta, y nada fallaría.
    macro_rules! valor_futuro {
        () => {
            "(capital * pot(1 + tasa_anual, anios) + vf_serie(aporte_anual, tasa_anual, anios))"
        };
    }
    macro_rules! invertido {
        () => {
            "(capital + aporte_anual * anios)"
        };
    }

    Seed {
        id,
        name: "inversion",
        description: "Cuánto valdrá tu inversión en un horizonte de años.",
        draft: Draft {
            inputs: vec![
                monto("capital", "Capital invertido"),
                tasa("tasa_anual", "Rendimiento anual"),
                entero("anios", "Horizonte", "años", MAX_PERIODS),
                monto_opcional("aporte_anual", "Aporte anual"),
                tasa_opcional("inflacion_anual", "Inflación anual"),
            ],
            validations: vec![
                regla(
                    "capital > 0",
                    "el capital invertido debe ser mayor que cero",
                ),
                // A diferencia del ahorro, una tasa NEGATIVA sí se admite: una inversión que
                // pierde valor es un escenario real y verlo proyectado es parte de entender
                // el riesgo. Lo que se acota es que no destruya más que el capital.
                regla(
                    "tasa_anual > -1",
                    "una pérdida del 100 % o más anual no deja nada que proyectar",
                ),
                // La guarda de la inflación solo aplica cuando se envió: `inversion.rs:97`
                // devuelve `None` sin mirarla si la clave no está.
                regla(
                    "no presente(inflacion_anual) o inflacion_anual > -1",
                    "la inflación anual no puede ser -100 % o menos",
                ),
            ],
            outputs: vec![
                salida(
                    "valor_futuro",
                    "Valor futuro",
                    valor_futuro!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "capital_invertido",
                    "Capital invertido",
                    invertido!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "rendimiento",
                    "Rendimiento",
                    concat!(valor_futuro!(), " - ", invertido!()),
                    ESCALA_MONETARIA,
                ),
                // Se descuenta dividiendo por `(1+π)^n` y no aplicando la tasa de Fisher al
                // capital: son equivalentes, pero descontar al final permite usar el mismo
                // valor futuro que ya se devolvió, que es lo que hace que las dos cifras
                // cuadren entre sí.
                salida_condicional(
                    "valor_futuro_real",
                    "Valor futuro real",
                    concat!(valor_futuro!(), " / pot(1 + inflacion_anual, anios)"),
                    ESCALA_MONETARIA,
                    "presente(inflacion_anual)",
                ),
            ],
        },
    }
}

/// Fondo de emergencia: cuánto hace falta para dejar de depender de un sueldo.
///
/// Diseño nuevo (D-31, `docs/calculadoras-fundamentos.md` §4.1), sin código nativo que
/// reproducir. La pregunta que responde no es «cuánto ahorro» sino **«cuánto me falta»**, que es
/// la única que cambia una decisión — de ahí que tres de sus seis salidas sean una distancia al
/// objetivo y no un saldo.
///
/// ## Por qué no lleva `si`
///
/// El caso `tasa_anual = 0` no rompe nada: `vf_serie` lo resuelve DENTRO de la primitiva como
/// `A · n` (`annuity.rs:94-101`) y `pot` ni siquiera se usa. Un `si` aquí duplicaría una guarda
/// que ya vive en el módulo que sabe hacerla, y una guarda duplicada es una que se puede
/// desincronizar.
///
/// ## Por qué `max(…, 0)` y no `si`
///
/// Un faltante negativo no es información útil —«me sobran 300 000» ya lo dice
/// `proyeccion_12_meses`— y devolverlo restado de un tope sería peor que recortarlo a cero. No
/// todos los `si` son la guarda del cero: poner uno donde `max` basta oscurece la fórmula.
#[must_use]
pub fn fondo_emergencia(id: Uuid) -> Seed {
    // El objetivo aparece en tres salidas y la proyección en dos: se escriben como macros para
    // que las apariciones sean literalmente el mismo texto. Dos copias que se separaran darían
    // una brecha que no cuadra con el objetivo sin que nada fallara.
    macro_rules! objetivo {
        () => {
            "(gasto_mensual * meses_cobertura)"
        };
    }
    // El valor futuro de los doce aportes del año. Doce periodos son DOCE, y no un año: la
    // proyección es mensual porque el aporte lo es.
    macro_rules! serie_12 {
        () => {
            "vf_serie(aporte_mensual, tasa_periodica(tasa_anual, 12), 12)"
        };
    }
    // El saldo a doce meses SIN redondear: el redondeo ocurre una sola vez, en la salida.
    macro_rules! proyeccion {
        () => {
            concat!("(ahorro_inicial + ", serie_12!(), ")")
        };
    }

    Seed {
        id,
        name: "fondo_emergencia",
        description: "Cuánto necesitas tener guardado para cubrir tus gastos sin un sueldo.",
        draft: Draft {
            inputs: vec![
                monto("gasto_mensual", "Gasto mensual"),
                entero(
                    "meses_cobertura",
                    "Meses de cobertura",
                    "meses",
                    MESES_COBERTURA_MAX,
                ),
                monto_opcional("ahorro_inicial", "Ahorro disponible hoy"),
                monto_opcional("aporte_mensual", "Aporte mensual previsto"),
                tasa_opcional_cero("tasa_anual", "Rendimiento anual de la cuenta"),
            ],
            validations: vec![
                regla(
                    "gasto_mensual > 0",
                    "el gasto mensual debe ser mayor que cero",
                ),
                regla(
                    "ahorro_inicial >= 0",
                    "el ahorro disponible no puede ser negativo",
                ),
                regla(
                    "aporte_mensual >= 0",
                    "el aporte mensual no puede ser negativo",
                ),
                // Una cuenta de ahorro no da rendimiento negativo, y admitirlo aquí restaría
                // al saldo proyectado sin que el usuario hubiera pedido un escenario de pérdida.
                regla(
                    "tasa_anual >= 0",
                    "el rendimiento de una cuenta de ahorro no puede ser negativo",
                ),
            ],
            outputs: vec![
                salida(
                    "fondo_objetivo",
                    "Fondo objetivo",
                    objetivo!(),
                    ESCALA_MONETARIA,
                ),
                // La escala es la de un importe aunque la cifra sean MESES de cobertura: dos
                // decimales son los que el usuario lee, y el diseño los fija así.
                salida(
                    "cobertura_actual",
                    "Cobertura actual",
                    "ahorro_inicial / gasto_mensual",
                    ESCALA_MONETARIA,
                ),
                salida(
                    "faltante_inicial",
                    "Falta hoy",
                    concat!("max(", objetivo!(), " - ahorro_inicial, 0)"),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "proyeccion_12_meses",
                    "Saldo en 12 meses",
                    proyeccion!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "brecha_12_meses",
                    "Falta en 12 meses",
                    concat!("max(", objetivo!(), " - ", proyeccion!(), ", 0)"),
                    ESCALA_MONETARIA,
                ),
                // El rendimiento es lo que rinde la SERIE, no el saldo: el ahorro inicial no
                // genera estos intereses en el diseño, y sumárselos prometería una cifra que la
                // proyección no respalda.
                salida(
                    "rendimiento_12_meses",
                    "Rendimiento en 12 meses",
                    concat!(serie_12!(), " - aporte_mensual * 12"),
                    ESCALA_MONETARIA,
                ),
            ],
        },
    }
}

/// Meta de ahorro: cuánto hay que apartar cada mes para llegar.
///
/// Diseño nuevo (D-31, `docs/calculadoras-fundamentos.md` §4.2), sin código nativo que
/// reproducir. Es la INVERSA de `ahorro`: dado un objetivo y un plazo, el aporte necesario. La
/// pregunta que de verdad se hace el usuario («¿cuánto tengo que guardar?») y no la que suele
/// responder una calculadora de ahorro.
///
/// ## El único `si` imprescindible de las tres semillas nuevas
///
/// `vf_serie` resuelve `i = 0` dentro de la primitiva, pero **no existe la primitiva inversa**:
/// el despeje del fondo de amortización se escribe a mano y se topa con el mismo cero. Con
/// `tasa_anual = 0` el denominador `pot(1 + i, meses) - 1` es exactamente cero, y «ahorro sin
/// rendimiento» no es un caso raro —es quien guarda en efectivo—. El `si` funciona porque es
/// PEREZOSO: `eval.rs` solo evalúa la rama elegida, así que la que divide por cero no llega a
/// ejecutarse.
#[must_use]
pub fn meta_ahorro(id: Uuid) -> Seed {
    // Lo que falta por acumular: el numerador de las dos ramas y el minuendo del rendimiento.
    macro_rules! pendiente {
        () => {
            "(meta - ahorro_inicial)"
        };
    }
    // La tasa periódica mensual NOMINAL —la que el usuario declara—, que aparece cuatro veces
    // dentro de la expresión. Escribirla a mano en cada sitio es la forma de que una se quede
    // atrás y el despeje deje de despejar.
    macro_rules! periodo {
        () => {
            "tasa_periodica(tasa_anual, 12)"
        };
    }
    // El fondo de amortización: A = VP·i / ((1+i)^n − 1), con el caso i = 0 resuelto aparte.
    //
    // `pot` y no `potd` porque el exponente es `meses`, que es un campo ENTERO: elevar a un
    // entero es multiplicación repetida y exacta, y es lo que el analizador exige de `pot`.
    macro_rules! aporte {
        () => {
            concat!(
                "si(",
                periodo!(),
                " == 0, ",
                pendiente!(),
                " / meses, ",
                pendiente!(),
                " * ",
                periodo!(),
                " / (pot(1 + ",
                periodo!(),
                ", meses) - 1))"
            )
        };
    }
    // Lo aportado por el usuario en todo el plazo, sin redondear.
    macro_rules! total {
        () => {
            concat!("(", aporte!(), " * meses)")
        };
    }

    Seed {
        id,
        name: "meta_ahorro",
        description: "Cuánto tienes que apartar cada mes para llegar a tu meta.",
        draft: Draft {
            inputs: vec![
                monto("meta", "Meta de ahorro"),
                monto_opcional("ahorro_inicial", "Ahorro ya disponible"),
                entero("meses", "Plazo en meses", "meses", MESES_META_MAX),
                tasa_opcional_cero("tasa_anual", "Rendimiento anual esperado"),
            ],
            validations: vec![
                regla("meta > 0", "la meta de ahorro debe ser mayor que cero"),
                regla(
                    "ahorro_inicial >= 0",
                    "el ahorro disponible no puede ser negativo",
                ),
                // No es cosmética: garantiza `meta - ahorro_inicial > 0`. Sin ella, la rama de
                // tasa cero dividiría entre `meses` un importe nulo o negativo y devolvería un
                // aporte de signo contrario al pedido, presentado como si fuera válido.
                regla(
                    "ahorro_inicial < meta",
                    "el ahorro disponible ya cubre la meta: no hay nada que aportar",
                ),
                regla("tasa_anual >= 0", "el rendimiento no puede ser negativo"),
            ],
            outputs: vec![
                salida(
                    "monto_pendiente",
                    "Falta por acumular",
                    pendiente!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "aporte_mensual_requerido",
                    "Aporte mensual necesario",
                    aporte!(),
                    ESCALA_MONETARIA,
                ),
                // Sin rendimiento es el reparto lineal, y se calcula aparte en vez de restarle
                // la parte del rendimiento: es la cifra que el usuario puede comprobar de
                // cabeza, y derivarla la haría depender de dos redondeos.
                salida(
                    "aporte_mensual_sin_rendimiento",
                    "Aporte sin rendimiento",
                    concat!(pendiente!(), " / meses"),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "total_aportado",
                    "Total aportado",
                    total!(),
                    ESCALA_MONETARIA,
                ),
                // Lo que pone el rendimiento y no el bolsillo. Es la cifra que hace visible por
                // qué el plazo importa más que el esfuerzo.
                salida(
                    "aportado_por_el_rendimiento",
                    "Lo que aporta el rendimiento",
                    concat!(pendiente!(), " - ", total!()),
                    ESCALA_MONETARIA,
                ),
            ],
        },
    }
}
