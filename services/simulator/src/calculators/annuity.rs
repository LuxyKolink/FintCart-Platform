//! Aritmética de anualidades compartida por ahorro, crédito e inversión.
//!
//! Las tres calculadoras se apoyan en la misma pieza —el factor de capitalización
//! `(1 + i)^n`— y en el mismo caso especial: la tasa CERO. Escribirla una vez no es
//! solo evitar repetición; el caso `i = 0` es una división por cero en las fórmulas
//! cerradas de anualidad, y tres implementaciones separadas serían tres ocasiones de
//! olvidarlo.

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
/// [`crate::calculators::colombia`], que existe justamente para eso.
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
        return Ok(payment * Decimal::from(periods));
    }
    let factor = growth_factor(rate, periods)?;
    (factor - Decimal::ONE)
        .checked_div(rate)
        .map(|series| payment * series)
        .ok_or_else(|| {
            Error::InvalidInput("el valor futuro de la serie no es representable".to_owned())
        })
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
    (principal * rate * factor)
        .checked_div(factor - Decimal::ONE)
        .ok_or_else(|| Error::InvalidInput("la cuota no es representable".to_owned()))
}
