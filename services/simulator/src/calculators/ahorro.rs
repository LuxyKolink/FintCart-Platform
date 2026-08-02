//! Calculadora de AHORRO (FR-019, FR-021).
//!
//! Responde a «si guardo esto cada mes durante tanto tiempo, ¿cuánto tendré?».
//!
//! ## Parámetros
//!
//! | clave              | tipo   | obligatorio | significado                          |
//! |--------------------|--------|-------------|--------------------------------------|
//! | `deposito_inicial` | monto  | no (0)      | lo que ya hay ahorrado hoy           |
//! | `aporte_mensual`   | monto  | no (0)      | aporte al FINAL de cada mes          |
//! | `tasa_anual`       | tasa   | sí          | nominal anual como fracción (`0.12`) |
//! | `meses`            | entero | sí          | plazo                                |
//!
//! Los dos montos son opcionales por separado pero no a la vez: sin depósito inicial
//! ni aporte no hay nada que capitalizar, y devolver ceros para eso sería un resultado
//! indistinguible de un cálculo legítimo.

use rust_decimal::Decimal;

use crate::calculators::{annuity, Outcome};
use crate::domain::currency::round_money;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;

/// Meses del año, la periodicidad del aporte.
const MONTHS_PER_YEAR: u32 = 12;

/// Calcula la proyección de ahorro.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta un parámetro, si el plazo no es válido o si no hay
/// nada que ahorrar; [`Error::Decimal`] si un valor no es decimal canónico.
pub fn compute(inputs: &Inputs) -> Result<Outcome> {
    let initial = inputs.money_or_zero("deposito_inicial")?;
    let monthly = inputs.money_or_zero("aporte_mensual")?;
    let annual_rate = inputs.rate("tasa_anual")?;
    let months = inputs.periods("meses")?;

    if initial.is_zero() && monthly.is_zero() {
        return Err(Error::InvalidInput(
            "se necesita un depósito inicial o un aporte mensual: sin ninguno de los dos no hay ahorro que proyectar"
                .to_owned(),
        ));
    }
    if annual_rate < Decimal::ZERO {
        // Una tasa de ahorro negativa no es un escenario del producto. Se rechaza en
        // vez de calcularse porque el resultado —un saldo que mengua— se leería como
        // un error del simulador y no como el parámetro que se envió.
        return Err(Error::InvalidInput(
            "la tasa de ahorro no puede ser negativa".to_owned(),
        ));
    }

    let monthly_rate = annuity::periodic_rate(annual_rate, MONTHS_PER_YEAR)?;

    // Todo el cálculo va a precisión plena y solo se redondea al final: redondear el
    // saldo mes a mes desviaría el resultado en varios pesos a lo largo de un plazo
    // largo, siempre en la misma dirección.
    let compounded_initial = initial * annuity::growth_factor(monthly_rate, months)?;
    let compounded_series = annuity::future_value_of_series(monthly, monthly_rate, months)?;
    let final_amount = compounded_initial + compounded_series;

    let contributed = initial + monthly * Decimal::from(months);
    // El interés se deriva de los dos importes SIN redondear y se redondea después. Al
    // revés —restar dos valores ya redondeados— el interés podría diferir en un centavo
    // del que se obtiene restando lo que ve el usuario, y esa incoherencia es la que
    // hace desconfiar de una cifra.
    let interest = final_amount - contributed;

    Ok(vec![
        ("monto_final", round_money(final_amount)),
        ("total_aportado", round_money(contributed)),
        ("interes_ganado", round_money(interest)),
        (
            "tasa_mensual",
            crate::domain::decimal_str::round_half_even(monthly_rate, 6),
        ),
    ])
}
