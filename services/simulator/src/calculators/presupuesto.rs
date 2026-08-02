//! Calculadora de PRESUPUESTO (FR-019).
//!
//! La más simple de las cinco en aritmética y la única que puede devolver un
//! resultado NEGATIVO como respuesta legítima: un presupuesto en déficit es
//! exactamente lo que el usuario necesita ver.
//!
//! ## Parámetros
//!
//! | clave              | tipo  | obligatorio | significado                  |
//! |--------------------|-------|-------------|------------------------------|
//! | `ingreso_mensual`  | monto | sí          | ingreso neto del mes         |
//! | `gastos_fijos`     | monto | no (0)      | arriendo, servicios, cuotas  |
//! | `gastos_variables` | monto | no (0)      | mercado, transporte, ocio    |
//!
//! ## Sobre la tasa de ahorro
//!
//! Se devuelve la FRACCIÓN del ingreso que queda libre, no una recomendación. La
//! tentación de añadir un «ahorro sugerido: 20 %» es fuerte y se descarta a
//! propósito: sería una regla de asesoría financiera incrustada en un simulador, y la
//! plataforma es educativa (`spec.md`). El dato es del usuario; el consejo, si lo hay,
//! pertenece al contenido editorial.

use rust_decimal::Decimal;

use crate::calculators::Outcome;
use crate::domain::currency::round_money;
use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;

/// Decimales de la tasa de ahorro, la escala de `NUMERIC(9,6)`.
const RATE_SCALE: u32 = 6;

/// Calcula el balance mensual y la fracción del ingreso que queda disponible.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta el ingreso o no es positivo; [`Error::Decimal`] si
/// un valor no es decimal canónico.
pub fn compute(inputs: &Inputs) -> Result<Outcome> {
    let income = inputs.money("ingreso_mensual")?;
    let fixed = inputs.money_or_zero("gastos_fijos")?;
    let variable = inputs.money_or_zero("gastos_variables")?;

    if income <= Decimal::ZERO {
        // Con ingreso cero la tasa de ahorro sería una división por cero. Se rechaza
        // aquí, nombrando el parámetro, en lugar de devolver un resultado parcial sin
        // ella: un presupuesto al que le falta justo la cifra que se buscaba es peor
        // que un error claro.
        return Err(Error::InvalidInput(
            "el ingreso mensual debe ser mayor que cero".to_owned(),
        ));
    }
    if fixed < Decimal::ZERO || variable < Decimal::ZERO {
        return Err(Error::InvalidInput(
            "los gastos no pueden ser negativos".to_owned(),
        ));
    }

    let total_expenses = fixed + variable;
    // El balance puede ser negativo, y se devuelve tal cual. Recortarlo a cero
    // ocultaría el déficit, que es la única cifra que de verdad hay que ver.
    let balance = income - total_expenses;

    // La división se hace a precisión plena y se redondea una vez: `balance / income`
    // casi nunca es finita, y truncarla antes desplazaría el porcentaje mostrado.
    let saving_rate = balance
        .checked_div(income)
        .ok_or_else(|| Error::InvalidInput("la tasa de ahorro no es representable".to_owned()))?;

    Ok(vec![
        ("gasto_total", round_money(total_expenses)),
        ("balance", round_money(balance)),
        (
            "tasa_ahorro",
            decimal_str::round_half_even(saving_rate, RATE_SCALE),
        ),
    ])
}
