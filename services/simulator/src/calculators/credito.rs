//! Calculadora de CRÉDITO (FR-019, FR-021).
//!
//! Amortización francesa: cuota constante, con la parte de intereses decreciente y la
//! de abono a capital creciente. Es el sistema con el que se pactan en Colombia los
//! créditos de consumo y de vivienda en pesos.
//!
//! ## Parámetros
//!
//! | clave        | tipo   | obligatorio | significado                          |
//! |--------------|--------|-------------|--------------------------------------|
//! | `monto`      | monto  | sí          | capital prestado                     |
//! | `tasa_anual` | tasa   | sí          | nominal anual como fracción (`0.24`) |
//! | `meses`      | entero | sí          | número de cuotas                     |
//!
//! ## Por qué el total pagado NO es `cuota × meses`
//!
//! Es la sutileza que distingue esta calculadora de una hoja de cálculo hecha a la
//! ligera. La cuota exacta casi nunca tiene dos decimales: multiplicar la cuota
//! REDONDEADA por el plazo da un total que no coincide con la suma de lo que
//! realmente se paga, y en un crédito a 240 meses la diferencia son varios miles de
//! pesos. Aquí el total se calcula a precisión plena y se redondea una sola vez, de
//! modo que `interes_total = total_pagado − monto` cuadra exactamente.
//!
//! La última cuota real de un banco absorbe ese descuadre. Documentarlo importa: el
//! simulador orienta, no liquida, y presentar la cuota como si fuera la definitiva
//! sería prometer una cifra que el desembolso no va a respetar al centavo.

use rust_decimal::Decimal;

use crate::calculators::{annuity, Outcome};
use crate::domain::currency::round_money;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;

/// Meses del año, la periodicidad de la cuota.
const MONTHS_PER_YEAR: u32 = 12;

/// Calcula la cuota y el costo total de un crédito.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta un parámetro, si el monto o la tasa no son válidos
/// o si el plazo está fuera de rango; [`Error::Decimal`] si un valor no es canónico.
pub fn compute(inputs: &Inputs) -> Result<Outcome> {
    let principal = inputs.money("monto")?;
    let annual_rate = inputs.rate("tasa_anual")?;
    let months = inputs.periods("meses")?;

    if principal <= Decimal::ZERO {
        return Err(Error::InvalidInput(
            "el monto del crédito debe ser mayor que cero".to_owned(),
        ));
    }
    if annual_rate < Decimal::ZERO {
        return Err(Error::InvalidInput(
            "la tasa del crédito no puede ser negativa".to_owned(),
        ));
    }

    let monthly_rate = annuity::periodic_rate(annual_rate, MONTHS_PER_YEAR)?;
    let payment = annuity::level_payment(principal, monthly_rate, months)?;

    // A precisión plena, con la cuota SIN redondear: ver la nota del encabezado.
    let total_paid = payment * Decimal::from(months);
    let total_interest = total_paid - principal;

    Ok(vec![
        ("cuota_mensual", round_money(payment)),
        ("total_pagado", round_money(total_paid)),
        ("interes_total", round_money(total_interest)),
        (
            "tasa_mensual",
            crate::domain::decimal_str::round_half_even(monthly_rate, 6),
        ),
    ])
}
