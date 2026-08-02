//! Conversión auxiliar de moneda (FR-020, research D-14).
//!
//! Alcance deliberadamente pequeño. COP es la moneda base de los simuladores y el
//! soporte multimoneda se limita a convertir con una tasa **provista como parámetro**:
//! el MVP no integra ningún proveedor externo de tipos de cambio (D-14).
//!
//! Que la tasa sea un parámetro no es una carencia que haya que tapar más adelante,
//! es lo que hace reproducible el historial. Una simulación guardada con la tasa del
//! día que se ejecutó se puede volver a calcular y da lo mismo; una que consultara un
//! proveedor al vuelo daría un resultado distinto cada vez que se revisara, y el
//! usuario no podría contrastar lo que vio en pantalla con lo que quedó guardado.

use rust_decimal::Decimal;

use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};

/// Escala a la que se redondea todo importe monetario: dos decimales, la de
/// `NUMERIC(19,2)`.
pub const MONEY_SCALE: u32 = 2;

/// Convierte un importe aplicando una tasa de cambio dada.
///
/// El redondeo es **half-even** y explícito (D-14). No es una preferencia estética: el
/// redondeo comercial (half-up) sesga hacia arriba, y sobre un volumen de operaciones
/// ese sesgo se acumula siempre en la misma dirección. Half-even reparte los empates
/// y es el que usan las normas contables para importes monetarios.
///
/// El redondeo ocurre AQUÍ y solo aquí, después de multiplicar en precisión completa.
/// Redondear los operandos antes y multiplicar después daría un resultado distinto, y
/// la diferencia crece con el importe.
///
/// # Errores
///
/// [`Error::InvalidInput`] si la tasa no es positiva: una tasa de cero anularía el
/// importe y una negativa lo invertiría de signo, y ninguno de los dos es una
/// conversión que alguien haya querido pedir.
pub fn convert(amount: Decimal, rate: Decimal) -> Result<Decimal> {
    if rate <= Decimal::ZERO {
        return Err(Error::InvalidInput(format!(
            "la tasa de cambio debe ser mayor que cero, no {}",
            decimal_str::format(rate)
        )));
    }
    Ok(decimal_str::round_half_even(amount * rate, MONEY_SCALE))
}

/// Redondea un importe a la escala monetaria con half-even.
///
/// Existe como función con nombre para que ningún cálculo tenga que recordar la escala
/// ni la estrategia: un `round_dp(2)` suelto en una calculadora usaría half-up por
/// defecto de `rust_decimal`, que es justo lo que D-14 descarta.
#[must_use]
pub fn round_money(amount: Decimal) -> Decimal {
    decimal_str::round_half_even(amount, MONEY_SCALE)
}

/// Código ISO-4217 por defecto (FR-020).
pub const DEFAULT_CURRENCY: &str = "COP";

/// Normaliza y valida un código de moneda.
///
/// Vacío significa «la de por defecto», porque el campo es opcional en el contrato y
/// un proto3 sin valor entrega la cadena vacía, no `None`. Tratarla como código
/// inválido rechazaría la petición más común: la que no menciona la moneda porque es
/// COP.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el código no son tres letras: es lo que exige el CHECK
/// `simulations_currency_iso4217`, y dejarlo pasar convertiría un dato mal formado en
/// un fallo de la base con el contexto de la petición ya perdido.
pub fn normalize(code: &str) -> Result<String> {
    let trimmed = code.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_CURRENCY.to_owned());
    }
    let upper = trimmed.to_ascii_uppercase();
    if upper.len() != 3 || !upper.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(Error::InvalidInput(format!(
            "moneda {code:?} no es un código ISO-4217 de tres letras"
        )));
    }
    Ok(upper)
}
