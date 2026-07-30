//! Tipo lógico `DecimalString` de los contratos (research D-10): la
//! representación canónica con la que TODO monto, tasa o porcentaje cruza una
//! frontera —gRPC, JSON o el JSONB de `simulations.inputs`/`result`—.
//!
//! Principio VIII (NON-NEGOTIABLE) prohíbe `f32`/`f64` y los números JSON para
//! dinero. El transporte es por tanto `string`, y este módulo es el único lugar
//! del servicio donde esa `string` se convierte a [`Decimal`] y vuelta.
//!
//! El formato canónico es EXACTAMENTE `^-?\d+(\.\d+)?$`:
//!
//! | entrada      | resultado                              |
//! |--------------|----------------------------------------|
//! | `"1500000.00"` | válido                               |
//! | `"-0.5"`     | válido                                 |
//! | `"1.5e3"`    | RECHAZADO — notación científica        |
//! | `"1,500.00"` | RECHAZADO — separador de miles         |
//! | `"+1.5"`     | RECHAZADO — signo positivo explícito   |
//! | `".5"` / `"5."` | RECHAZADO — falta un lado del punto |
//! | `" 1.5"`     | RECHAZADO — espacios                   |
//!
//! Rechazar en lugar de normalizar es deliberado: si dos servicios discrepan en
//! la escala o el formato de un monto, queremos un error en la frontera y no un
//! valor silenciosamente distinto en la base de datos.

use rust_decimal::{Decimal, RoundingStrategy};

/// Límites de las columnas `NUMERIC` de data-model.md §Convenciones.
///
/// Validar contra ellos en la frontera evita que un valor viable en memoria
/// falle recién al hacer INSERT, cuando ya se perdió el contexto de la petición.
pub mod limits {
    /// Montos (COP): `NUMERIC(19,2)`.
    pub const MONEY: (u32, u32) = (19, 2);
    /// Tasas y porcentajes: `NUMERIC(9,6)`.
    pub const RATE: (u32, u32) = (9, 6);
    /// Calificaciones: `NUMERIC(6,2)`.
    pub const SCORE: (u32, u32) = (6, 2);
}

/// Fallos al interpretar o serializar una `DecimalString`.
///
/// Se distingue el formato (dato mal construido por el emisor) del rango (dato
/// bien formado que no cabe en la columna destino): ameritan respuestas
/// distintas en la capa gRPC.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecimalStrError {
    /// Cadena vacía.
    #[error("decimal_str: cadena vacía")]
    Empty,

    /// La cadena no respeta `^-?\d+(\.\d+)?$`.
    #[error("decimal_str: formato no canónico: {0:?}")]
    Syntax(String),

    /// Más decimales significativos de los que admite la columna destino.
    #[error("decimal_str: escala excedida: {value:?} tiene {got} decimales, el máximo es {max}")]
    Scale {
        /// Valor rechazado, tal como llegó.
        value: String,
        /// Decimales significativos encontrados.
        got: u32,
        /// Decimales admitidos.
        max: u32,
    },

    /// La parte entera no cabe en la columna destino.
    #[error("decimal_str: fuera de rango: {value:?} excede NUMERIC({precision},{scale})")]
    Range {
        /// Valor rechazado, tal como llegó.
        value: String,
        /// Precisión de la columna destino.
        precision: u32,
        /// Escala de la columna destino.
        scale: u32,
    },

    /// Sintaxis correcta pero el valor no cabe en un [`Decimal`].
    ///
    /// `rust_decimal` usa una mantisa de 96 bits (~28 dígitos significativos,
    /// escala máxima 28). Todas las columnas del modelo caben de sobra, así que
    /// esto solo aparece con entradas artificiales.
    #[error("decimal_str: valor no representable como Decimal: {0:?}")]
    Unrepresentable(String),
}

/// Convierte una cadena decimal canónica en [`Decimal`].
///
/// No impone límite de precisión: para validar contra una columna concreta usar
/// [`parse_money`], [`parse_rate`], [`parse_score`] o [`parse_numeric`].
///
/// # Errores
///
/// [`DecimalStrError::Empty`] si la cadena está vacía,
/// [`DecimalStrError::Syntax`] si no es canónica y
/// [`DecimalStrError::Unrepresentable`] si excede la capacidad de [`Decimal`].
pub fn parse(s: &str) -> Result<Decimal, DecimalStrError> {
    if s.is_empty() {
        return Err(DecimalStrError::Empty);
    }
    if !is_canonical(s) {
        return Err(DecimalStrError::Syntax(s.to_owned()));
    }
    // `from_str_exact` y no `from_str`: el segundo REDONDEA en silencio cuando la
    // entrada excede la escala máxima de Decimal, que es justo la pérdida de
    // precisión que el Principio VIII prohíbe. Aquí preferimos el error.
    Decimal::from_str_exact(s).map_err(|_| DecimalStrError::Unrepresentable(s.to_owned()))
}

/// Como [`parse`], y además exige que el valor quepa en una columna
/// `NUMERIC(precision, scale)` de PostgreSQL.
///
/// La escala se mide sobre los decimales SIGNIFICATIVOS: `"1.500"` cuenta como
/// escala 1, no 3, porque los ceros a la derecha no aportan precisión y
/// rechazarlos solo castigaría a un emisor que rellena a un ancho fijo.
///
/// # Errores
///
/// Los de [`parse`], más [`DecimalStrError::Scale`] y [`DecimalStrError::Range`].
pub fn parse_numeric(s: &str, precision: u32, scale: u32) -> Result<Decimal, DecimalStrError> {
    let d = parse(s)?;

    let got = significant_scale(s);
    if got > scale {
        return Err(DecimalStrError::Scale {
            value: s.to_owned(),
            got,
            max: scale,
        });
    }

    // Cota exacta de PostgreSQL: |valor| < 10^(precision-scale).
    let max_abs = Decimal::from(10_i64.pow(precision - scale));
    if d.abs() >= max_abs {
        return Err(DecimalStrError::Range {
            value: s.to_owned(),
            precision,
            scale,
        });
    }

    Ok(d)
}

/// Valida un monto contra `NUMERIC(19,2)`.
///
/// # Errores
///
/// Ver [`parse_numeric`].
pub fn parse_money(s: &str) -> Result<Decimal, DecimalStrError> {
    let (p, sc) = limits::MONEY;
    parse_numeric(s, p, sc)
}

/// Valida una tasa o porcentaje contra `NUMERIC(9,6)`.
///
/// # Errores
///
/// Ver [`parse_numeric`].
pub fn parse_rate(s: &str) -> Result<Decimal, DecimalStrError> {
    let (p, sc) = limits::RATE;
    parse_numeric(s, p, sc)
}

/// Valida una calificación contra `NUMERIC(6,2)`.
///
/// # Errores
///
/// Ver [`parse_numeric`].
pub fn parse_score(s: &str) -> Result<Decimal, DecimalStrError> {
    let (p, sc) = limits::SCORE;
    parse_numeric(s, p, sc)
}

/// Serializa un [`Decimal`] a la forma canónica.
///
/// Nunca produce notación científica y no deja ceros significativos a la
/// derecha, de modo que aplicarlo dos veces da el mismo resultado.
#[must_use]
pub fn format(d: Decimal) -> String {
    // `normalize` quita los ceros finales; sin él, un Decimal con escala 3 que
    // vale 1.5 se serializaría "1.500" y el round-trip no sería estable.
    let s = d.normalize().to_string();
    // `normalize` deja "-0" para el cero negativo, que no es canónico.
    if s == "-0" {
        return "0".to_owned();
    }
    s
}

/// Serializa con exactamente `scale` decimales, rellenando con ceros.
///
/// # Errores
///
/// [`DecimalStrError::Scale`] si el valor tiene MÁS decimales significativos que
/// `scale`: redondear en la capa de serialización esconde una pérdida de
/// precisión que el llamador no pidió. Para redondear hay que hacerlo explícito
/// con [`round_half_even`].
pub fn format_fixed(d: Decimal, scale: u32) -> Result<String, DecimalStrError> {
    let canonical = format(d);
    let got = significant_scale(&canonical);
    if got > scale {
        return Err(DecimalStrError::Scale {
            value: canonical,
            got,
            max: scale,
        });
    }
    Ok(format!("{:.*}", scale as usize, d))
}

/// Redondea a `scale` decimales con redondeo bancario (half-even), el único modo
/// permitido para conversiones y cálculos monetarios (research D-14).
///
/// Es explícito a propósito: ninguna otra función de este módulo redondea.
#[must_use]
pub fn round_half_even(d: Decimal, scale: u32) -> Decimal {
    d.round_dp_with_strategy(scale, RoundingStrategy::MidpointNearestEven)
}

/// Comprueba `^-?\d+(\.\d+)?$` sin recurrir a expresiones regulares, que serían
/// una dependencia nueva para una gramática de cinco líneas.
fn is_canonical(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = usize::from(b.first() == Some(&b'-'));

    // Parte entera: al menos un dígito.
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == int_start {
        return false;
    }
    if i == b.len() {
        return true; // entero puro
    }

    // Parte decimal: un punto y al menos un dígito, y nada más después.
    if b[i] != b'.' {
        return false;
    }
    i += 1;
    let frac_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    i == b.len() && i > frac_start
}

/// Cuenta los decimales de una representación canónica ignorando los ceros
/// finales.
///
/// Se calcula sobre la cadena y no sobre [`Decimal::scale`] porque esa escala
/// conserva los ceros de relleno del emisor: `"1.500"` se almacena con escala 3
/// y diría 3 decimales cuando solo hay 1 significativo.
fn significant_scale(s: &str) -> u32 {
    match s.split_once('.') {
        None => 0,
        Some((_, frac)) => frac.trim_end_matches('0').len() as u32,
    }
}
