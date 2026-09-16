//! Las cuatro semillas sin acento local: `ahorro`, `credito`, `presupuesto` e `inversion`
//! (T093; FR-019; research D-16).
//!
//! Traducen a fórmulas lo que hoy hacen `crate::calculators::{ahorro, credito, presupuesto,
//! inversion}`. La regla que gobierna la traducción está en la nota del módulo padre: **la
//! misma función y el mismo orden de operaciones** que el código nativo, porque en decimal
//! reagrupar mueve el último dígito y un resultado plausible es indistinguible de uno
//! correcto.
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
    entero, monto, monto_opcional, regla, salida, salida_condicional, tasa, tasa_opcional, Seed,
};
use crate::domain::definition::Draft;
use crate::domain::inputs::MAX_PERIODS;

/// Escala de una tasa: la de `NUMERIC(9,6)`.
const ESCALA_TASA: u32 = 6;

/// Escala de un importe monetario: la de `NUMERIC(19,2)`.
const ESCALA_MONETARIA: u32 = 2;

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
