//! Calculadora de INVERSIÓN (FR-019, FR-021).
//!
//! Capitalización ANUAL, que es la diferencia con la de ahorro: aquí el horizonte se
//! mide en años y el aporte es anual. Tenerlas separadas y no como una sola con un
//! parámetro de periodicidad es deliberado — son dos preguntas distintas del usuario,
//! y una única calculadora «universal» obligaría a explicarle qué es un periodo antes
//! de poder responderle.
//!
//! ## Parámetros
//!
//! | clave          | tipo   | obligatorio | significado                          |
//! |----------------|--------|-------------|--------------------------------------|
//! | `capital`      | monto  | sí          | inversión inicial                    |
//! | `tasa_anual`   | tasa   | sí          | rendimiento anual como fracción      |
//! | `anios`        | entero | sí          | horizonte                            |
//! | `aporte_anual` | monto  | no (0)      | aporte al FINAL de cada año          |
//! | `inflacion_anual` | tasa | no          | si viene, se añade el valor real     |
//!
//! ## Sobre el valor real
//!
//! Cuando se envía la inflación se devuelve además `valor_futuro_real`, el resultado
//! descontado con la fórmula de Fisher `(1+r)/(1+π) − 1`. Es opcional porque exigirla
//! haría más pesada la pregunta común, pero es el dato que evita la ilusión monetaria:
//! con inflación del 8 % y rendimiento del 10 %, la inversión crece la mitad de lo
//! que dice la cifra nominal, y presentar solo esa cifra en una plataforma de
//! educación financiera enseñaría justo lo contrario de lo que pretende.

use rust_decimal::Decimal;

use crate::calculators::{annuity, Outcome};
use crate::domain::currency::round_money;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;

/// Calcula el valor futuro de una inversión.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta un parámetro, si el capital no es positivo o si el
/// horizonte está fuera de rango; [`Error::Decimal`] si un valor no es canónico.
pub fn compute(inputs: &Inputs) -> Result<Outcome> {
    let capital = inputs.money("capital")?;
    let annual_rate = inputs.rate("tasa_anual")?;
    let years = inputs.periods("anios")?;
    let yearly_contribution = inputs.money_or_zero("aporte_anual")?;

    if capital <= Decimal::ZERO {
        return Err(Error::InvalidInput(
            "el capital invertido debe ser mayor que cero".to_owned(),
        ));
    }
    // A diferencia del ahorro, una tasa NEGATIVA sí se admite: una inversión que
    // pierde valor es un escenario real y verlo proyectado es parte de entender el
    // riesgo. Lo que se acota es que no destruya más que el capital.
    if annual_rate <= Decimal::NEGATIVE_ONE {
        return Err(Error::InvalidInput(
            "una pérdida del 100 % o más anual no deja nada que proyectar".to_owned(),
        ));
    }

    let compounded_capital = capital * annuity::growth_factor(annual_rate, years)?;
    let compounded_series =
        annuity::future_value_of_series(yearly_contribution, annual_rate, years)?;
    let future_value = compounded_capital + compounded_series;

    let invested = capital + yearly_contribution * Decimal::from(years);
    let gain = future_value - invested;

    let mut outcome: Outcome = vec![
        ("valor_futuro", round_money(future_value)),
        ("capital_invertido", round_money(invested)),
        ("rendimiento", round_money(gain)),
    ];

    // El valor real solo aparece si se pidió. Devolverlo siempre, con inflación cero
    // implícita, daría una cifra idéntica a la nominal y sugeriría que se descontó algo
    // cuando no se descontó nada.
    if let Some(real) = real_value(inputs, future_value, years)? {
        outcome.push(("valor_futuro_real", round_money(real)));
    }

    Ok(outcome)
}

/// Descuenta el valor futuro por la inflación, si se envió.
///
/// Se divide por `(1+π)^n` en vez de aplicar la tasa real de Fisher al capital: son
/// equivalentes algebraicamente, pero descontar al final permite usar el mismo valor
/// futuro que ya se devolvió, de modo que las dos cifras que ve el usuario guardan
/// entre sí exactamente la relación anunciada.
///
/// # Errores
///
/// [`Error::InvalidInput`] si la inflación anula el poder adquisitivo por completo o
/// si el cálculo desborda; [`Error::Decimal`] si el valor no es canónico.
fn real_value(inputs: &Inputs, future_value: Decimal, years: u32) -> Result<Option<Decimal>> {
    let inflation = match inputs.raw_rate("inflacion_anual")? {
        None => return Ok(None),
        Some(value) => value,
    };
    if inflation <= Decimal::NEGATIVE_ONE {
        return Err(Error::InvalidInput(
            "la inflación anual no puede ser -100 % o menos".to_owned(),
        ));
    }

    let deflator = annuity::growth_factor(inflation, years)?;
    future_value
        .checked_div(deflator)
        .map(Some)
        .ok_or_else(|| Error::InvalidInput("el valor real no es representable".to_owned()))
}
