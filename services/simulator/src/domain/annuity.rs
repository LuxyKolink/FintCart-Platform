//! Aritmética de anualidades del motor de fórmulas (T098; D-27).
//!
//! Las calculadoras de ahorro, crédito e inversión se apoyan en la misma pieza —el factor
//! de capitalización `(1 + i)^n`— y en el mismo caso especial: la tasa CERO. Escribirla una
//! vez no es solo evitar repetición; el caso `i = 0` es una división por cero en las
//! fórmulas cerradas de anualidad, y varias implementaciones separadas serían otras tantas
//! ocasiones de olvidarlo.
//!
//! ## Por qué vive en `domain` y no en `calculators`
//!
//! Porque **el motor de fórmulas lo usa**. `cuota`, `vf_serie` y `tasa_periodica` son
//! funciones del lenguaje (research D-15) y se evaluaban importando `crate::calculators`,
//! de modo que la capa de dominio dependía del código nativo que este feature viene a
//! retirar. Mientras el módulo viviera allí, borrar `src/calculators/` habría dejado al
//! motor sin sus funciones aritméticas.
//!
//! ## Por qué NINGUNA operación usa un operador que pueda entrar en pánico
//!
//! D-27. Los operadores `+`, `-` y `*` de [`Decimal`] **entran en pánico al desbordar**,
//! a diferencia de las variantes `checked_*`, que devuelven `None`. El desbordamiento aquí
//! no es un fallo del programa: es un resultado que el usuario provocó con sus datos —un
//! plazo de cien años con una tasa alta—, y un pánico en el hilo del RPC se convierte en un
//! fallo interno del servicio. El usuario que escribió un plazo irrazonable veía «error del
//! servidor» en lugar del parámetro que envió mal.
//!
//! Estaba escrito como pendiente en D-27 y esta mudanza es donde se corrige. La prueba de
//! regresión de las semillas lo tenía acotado y no ignorado: contaba los casos en los que
//! las dos implementaciones abortaban, precisamente para que el conjunto incomparable no
//! creciera en silencio. Con esto esa cuenta baja a cero.

use rust_decimal::{Decimal, MathematicalOps};

use crate::domain::error::{Error, Result};

/// Calcula `(1 + i)^n` con exponente entero.
///
/// Se usa `checked_powu` y no la exponenciación por logaritmos: elevar a un entero es
/// una multiplicación repetida EXACTA en decimal, mientras que `exp(n · ln(1+i))`
/// introduce el error de dos funciones trascendentes en un valor que después
/// multiplica a un capital. Para un plazo de 240 meses esa diferencia llega a los
/// pesos.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el resultado desborda [`Decimal`]. Sucede con
/// combinaciones irrazonables de tasa y plazo, y decirlo así apunta al parámetro; un
/// pánico o un `unwrap` lo presentarían como un fallo del servicio (Edge Cases).
pub fn growth_factor(rate: Decimal, periods: u32) -> Result<Decimal> {
    let base = Decimal::ONE + rate;
    base.checked_powu(u64::from(periods)).ok_or_else(|| {
        Error::InvalidInput(format!(
            "la combinación de tasa y plazo desborda la precisión disponible: (1+{rate})^{periods}"
        ))
    })
}

/// Divide una tasa anual entre los periodos del año.
///
/// La división es NOMINAL —anual entre doce— y no la conversión efectiva
/// `(1+EA)^(1/12) - 1`. Las dos existen en el mercado colombiano y NO son
/// intercambiables: para una tasa del 12 %, la nominal da 1 % mensual y la efectiva
/// 0,9489 %. Aquí se usa la nominal porque es la que corresponde a una tasa declarada
/// «anual» sin más apellido; quien tenga una efectiva la convierte primero con
/// `calculators::colombia`, que existe justamente para eso.
///
/// El resultado NO se redondea: hacerlo aquí perdería precisión en cada periodo del
/// plazo, y el error se acumularía a lo largo de la amortización. `1/12` no tiene
/// representación decimal finita, así que la división se deja a la escala máxima de
/// `Decimal` y el redondeo ocurre una sola vez, sobre el resultado final.
///
/// # Errores
///
/// [`Error::InvalidInput`] si `periods_per_year` es cero.
pub fn periodic_rate(annual: Decimal, periods_per_year: u32) -> Result<Decimal> {
    if periods_per_year == 0 {
        return Err(Error::InvalidInput(
            "los periodos por año deben ser mayor que cero".to_owned(),
        ));
    }
    annual
        .checked_div(Decimal::from(periods_per_year))
        .ok_or_else(|| Error::InvalidInput("la tasa periódica no es representable".to_owned()))
}

/// Valor futuro de una serie de aportes iguales al final de cada periodo.
///
/// `A · ((1+i)^n − 1) / i`, con el caso `i = 0` resuelto aparte como `A · n`. Ese caso
/// no es una curiosidad: una simulación de ahorro «bajo el colchón» —tasa cero— es
/// perfectamente razonable, y la fórmula cerrada dividiría por cero.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el cálculo desborda.
pub fn future_value_of_series(payment: Decimal, rate: Decimal, periods: u32) -> Result<Decimal> {
    if rate.is_zero() {
        // `checked_mul` y no `*`: con un aporte y un plazo grandes, `A · n` desborda la
        // mantisa de 96 bits, y el operador `*` aborta en vez de devolver un error.
        return payment
            .checked_mul(Decimal::from(periods))
            .ok_or_else(|| overflow("el valor futuro de la serie"));
    }

    let factor = growth_factor(rate, periods)?;
    let series = factor
        .checked_sub(Decimal::ONE)
        .and_then(|diff| diff.checked_div(rate))
        .ok_or_else(|| overflow("el valor futuro de la serie"))?;

    payment
        .checked_mul(series)
        .ok_or_else(|| overflow("el valor futuro de la serie"))
}

/// Cuota constante de un crédito con amortización francesa.
///
/// `P · i / (1 − (1+i)^−n)`, con el caso `i = 0` como `P / n`.
///
/// La expresión se evalúa como `P · i · (1+i)^n / ((1+i)^n − 1)`, que es
/// algebraicamente la misma pero evita calcular `(1+i)^−n`: la potencia negativa
/// obliga a una división intermedia con resto —y por tanto a truncar— antes de que el
/// numerador entre en juego.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el cálculo desborda.
pub fn level_payment(principal: Decimal, rate: Decimal, periods: u32) -> Result<Decimal> {
    if rate.is_zero() {
        return principal
            .checked_div(Decimal::from(periods))
            .ok_or_else(|| Error::InvalidInput("la cuota no es representable".to_owned()));
    }

    let factor = growth_factor(rate, periods)?;
    let numerator = principal
        .checked_mul(rate)
        .and_then(|value| value.checked_mul(factor))
        .ok_or_else(|| overflow("la cuota"))?;

    // El denominador se calcula aparte y NO con un `unwrap_or_default()`: caer a cero
    // convertiría un desbordamiento en una división por cero, y el error que vería el
    // usuario hablaría de lo segundo cuando pasó lo primero.
    let denominator = factor
        .checked_sub(Decimal::ONE)
        .ok_or_else(|| overflow("la cuota"))?;

    numerator
        .checked_div(denominator)
        .ok_or_else(|| overflow("la cuota"))
}

/// El error de un cálculo que no cabe en la precisión decimal disponible.
///
/// Una función y no un literal repetido: el mensaje dice QUÉ se estaba calculando, que es
/// lo único que el usuario necesita para saber qué parámetro reducir, y tenerlo en un solo
/// sitio impide que las cuatro ramas de desbordamiento se desincronicen al redactarlo.
fn overflow(que: &str) -> Error {
    Error::InvalidInput(format!(
        "{que} desborda la precisión decimal disponible: reduce el plazo o la tasa"
    ))
}
