//! Lectura tipada del mapa de parámetros de una simulación.
//!
//! El contrato entrega `map<string, string>`: las claves y los valores son texto, y
//! ninguna calculadora debería repetir la misma comprobación de «existe, es decimal
//! canónico, cabe en su columna». Este módulo es esa comprobación, escrita una vez.
//!
//! Por qué importa que esté centralizada: el Principio VIII se cumple o se rompe en
//! el punto donde una cadena se convierte en número. Con cinco calculadoras
//! haciéndolo cada una a su manera, bastaría un `parse::<f64>()` en una de ellas para
//! perder centavos sin que ninguna prueba de las otras cuatro lo notara.

use std::collections::HashMap;

use rust_decimal::Decimal;

use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};

/// Vista de solo lectura sobre los parámetros de una simulación.
///
/// Presta el mapa en vez de copiarlo: las calculadoras solo leen, y clonar el mapa en
/// cada llamada sería trabajo por nada.
pub struct Inputs<'a> {
    raw: &'a HashMap<String, String>,
}

impl<'a> Inputs<'a> {
    /// Envuelve el mapa recibido por gRPC.
    #[must_use]
    pub fn new(raw: &'a HashMap<String, String>) -> Self {
        Self { raw }
    }

    /// Lee un MONTO obligatorio, validado contra `NUMERIC(19,2)`.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta la clave; [`Error::Decimal`] si el valor no es
    /// una decimal canónica o no cabe en la columna.
    pub fn money(&self, key: &str) -> Result<Decimal> {
        Ok(decimal_str::parse_money(self.required(key)?)?)
    }

    /// Lee un monto OPCIONAL; ausente equivale a cero.
    ///
    /// Cero y ausente se tratan igual a propósito: para un aporte periódico, «no
    /// aporto nada» y «no mandé el campo» describen el mismo escenario, y obligar a
    /// enviar `"0"` solo añadiría una forma de equivocarse.
    ///
    /// # Errores
    ///
    /// [`Error::Decimal`] si el valor está presente pero no es válido.
    pub fn money_or_zero(&self, key: &str) -> Result<Decimal> {
        match self.raw.get(key) {
            None => Ok(Decimal::ZERO),
            Some(value) => Ok(decimal_str::parse_money(value)?),
        }
    }

    /// Lee una TASA obligatoria, validada contra `NUMERIC(9,6)`.
    ///
    /// La tasa se expresa como FRACCIÓN, no como porcentaje: el 12 % anual es
    /// `"0.12"`. Aceptar las dos formas obligaría a adivinar cuál quiso decir quien
    /// envía `"12"` —¿doce por ciento o mil doscientos?—, y la respuesta equivocada no
    /// se nota hasta que alguien compara su cuota con la del banco.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta la clave; [`Error::Decimal`] si el valor no es
    /// válido.
    pub fn rate(&self, key: &str) -> Result<Decimal> {
        Ok(decimal_str::parse_rate(self.required(key)?)?)
    }

    /// Lee un número de PERIODOS (meses, años) como entero positivo.
    ///
    /// Devuelve `u32` y no `Decimal` porque un plazo fraccionario no significa nada en
    /// una amortización mensual, y porque el exponente de las fórmulas necesita un
    /// entero: dejarlo decimal obligaría a elevar con logaritmos y a perder exactitud
    /// donde no hace ninguna falta.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta, no es un entero, es cero o excede
    /// [`MAX_PERIODS`].
    pub fn periods(&self, key: &str) -> Result<u32> {
        let raw = self.required(key)?;
        let parsed: u32 = raw.parse().map_err(|_| {
            Error::InvalidInput(format!("{key} debe ser un entero positivo: {raw:?}"))
        })?;
        if parsed == 0 {
            return Err(Error::InvalidInput(format!(
                "{key} debe ser mayor que cero"
            )));
        }
        if parsed > MAX_PERIODS {
            // Un plazo irrazonable no es un error del usuario que convenga «calcular
            // igual»: elevar (1+i) a cien mil daría un desbordamiento del Decimal y el
            // fallo aparecería como un error interno en vez de como el parámetro que
            // está mal (Edge Cases: rangos irrazonables).
            return Err(Error::InvalidInput(format!(
                "{key} = {parsed} excede el máximo admitido de {MAX_PERIODS} periodos"
            )));
        }
        Ok(parsed)
    }

    /// Lee una tasa OPCIONAL: `None` si la clave no está.
    ///
    /// Se distingue de [`Self::money_or_zero`] a propósito. Para un aporte, ausente y
    /// cero significan lo mismo; para una tasa no: una inflación del 0 % es una
    /// afirmación sobre el escenario, y ausente significa que no se pidió descontarla.
    /// Colapsarlas haría aparecer un «valor real» idéntico al nominal, sugiriendo que
    /// se descontó algo cuando no se descontó nada.
    ///
    /// # Errores
    ///
    /// [`Error::Decimal`] si el valor está presente pero no es válido.
    pub fn raw_rate(&self, key: &str) -> Result<Option<Decimal>> {
        match self.raw.get(key) {
            None => Ok(None),
            Some(value) => Ok(Some(decimal_str::parse_rate(value)?)),
        }
    }

    /// Lee un parámetro de texto obligatorio (p. ej. la operación de una calculadora
    /// con varios modos).
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta la clave.
    pub fn text(&self, key: &str) -> Result<&'a str> {
        self.required(key)
    }

    fn required(&self, key: &str) -> Result<&'a str> {
        self.raw
            .get(key)
            .map(String::as_str)
            .ok_or_else(|| Error::InvalidInput(format!("falta el parámetro {key:?}")))
    }
}

/// Tope de periodos de una simulación: 1200 meses, es decir cien años.
///
/// No es una restricción de negocio sino una barrera de representabilidad. Con una
/// tasa mensual del 2 %, `(1.02)^1200` ya ronda los 10^10; unos pocos miles de
/// periodos más desbordan la mantisa de 96 bits de `Decimal`. Rechazar aquí convierte
/// un desbordamiento interno en un mensaje que nombra el parámetro culpable.
pub const MAX_PERIODS: u32 = 1200;
