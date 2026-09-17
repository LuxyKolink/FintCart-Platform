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

/// Descripción de un rechazo en términos de quien lo provocó.
///
/// El `Display` de [`DecimalStrError`] empieza por `decimal_str:`, que es el nombre de un
/// módulo y no algo que quien escribe el valor pueda usar. Este texto sí: sale al cliente a
/// través del estado gRPC (ver `grpc::service::to_status`), y describe el valor RECIBIDO con
/// una acción concreta —qué forma se espera, cuántos decimales admite su tipo—.
///
/// ## Por qué hay UNA función y no una por capa
///
/// Llegó a haber tres copias de esta traducción —una para el constructor de calculadoras, una
/// para el alta de indicadores y el mapeo de errores—, y las tres ya habían empezado a
/// divergir: la de los indicadores no nombraba el valor rechazado. Un mismo error del parser
/// explicado de tres maneras hace que dos pantallas cuenten cosas distintas del mismo dato, y
/// esto es una función pura sobre un `enum` cerrado: no necesita contexto de quien llama.
///
/// Nunca menciona el esquema, el SQL ni el driver: los únicos detalles técnicos que aparecen
/// —cuántos decimales admite un tipo, cuántos dígitos caben— son los que el propio autor
/// declara en su definición o los que documenta el modelo de datos.
#[must_use]
pub fn describe(err: &DecimalStrError) -> String {
    match err {
        DecimalStrError::Empty => "falta un valor".to_owned(),
        DecimalStrError::Syntax(value) => format!(
            "«{value}» no es una cifra decimal: se escriben solo dígitos y un punto, sin \
             separador de miles, sin notación científica y sin espacios"
        ),
        DecimalStrError::Scale {
            value, got, max, ..
        } => format!("«{value}» tiene {got} decimales y su tipo admite {max} como máximo"),
        DecimalStrError::Range {
            value,
            precision,
            scale,
        } => format!(
            "«{value}» no cabe en su tipo (admite hasta {} dígitos, {scale} decimales)",
            precision - scale
        ),
        DecimalStrError::Unrepresentable(value) => {
            format!("«{value}» excede la precisión decimal que admite la plataforma")
        }
    }
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

/// Adaptadores `serde` para que un [`Decimal`] viaje por JSON como cadena canónica.
///
/// ## Por qué esto existe y por qué está aquí
///
/// La forma evidente de serializar un decimal es un número JSON, y está descartada por
/// dos motivos, el segundo grave:
///
/// 1. Un número JSON obliga a quien lo lea a interpretarlo con un tipo de coma flotante,
///    que el Principio VIII prohíbe para dinero.
/// 2. `serde_json` no representa más de 15-17 dígitos significativos en un número: lo que
///    exceda se redondea **en silencio**. Un AST que se persiste y se relee para calcular
///    se degradaría en cada ciclo guardar → leer sin que nada fallara.
///
/// Vive en este módulo y no junto a cada tipo que lo usa porque es la misma regla del
/// formato canónico que el resto del módulo: si hubiera una copia por tipo, la copia que
/// se quedara atrás introduciría la pérdida de precisión justo en el campo que olvidó
/// actualizarse.
///
/// Se escribe a mano en vez de confiar en la característica `serde-with-str` de
/// `rust_decimal`, que ya está activada en `Cargo.toml`: esa característica cambia el
/// comportamiento por DEFECTO de [`Decimal`] en todo el crate, y un día alguien podría
/// retirarla al ajustar dependencias. Aquí la elección es explícita en cada campo.
pub mod serde_decimal {
    use rust_decimal::Decimal;
    use serde::{Deserialize, Deserializer, Serializer};

    use super::{format, parse};

    /// Escribe el valor en la forma canónica `^-?\d+(\.\d+)?$`.
    ///
    /// # Errores
    ///
    /// Del serializador.
    pub fn serialize<S: Serializer>(value: &Decimal, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format(*value))
    }

    /// Lee el valor exigiendo esa misma forma.
    ///
    /// `serde_json` aceptaría además un número JSON, y se rechaza a propósito: si una
    /// fila llega con un literal numérico, viene de algo que no pasó por el analizador, y
    /// leerlo como si fuera equivalente aceptaría en silencio un valor que nunca se
    /// validó.
    ///
    /// # Errores
    ///
    /// Del deserializador, o de [`parse`] si la cadena no es canónica.
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Decimal, D::Error> {
        let raw = String::deserialize(deserializer)?;
        parse(&raw).map_err(serde::de::Error::custom)
    }

    /// Lo mismo para un campo OPCIONAL, donde ausente y `null` significan lo mismo.
    ///
    /// Sin esta variante, un `Option<Decimal>` con `with = "…::serde_decimal"` intentaría
    /// deserializar `null` como `String` y fallaría; y omitir el atributo haría que el
    /// campo volviera a ser un número JSON, que es exactamente lo que se está evitando.
    pub mod option {
        use rust_decimal::Decimal;
        use serde::{Deserialize, Deserializer, Serializer};

        use super::{format, parse};

        /// Escribe el valor canónico, o `null` si no hay.
        ///
        /// # Errores
        ///
        /// Del serializador.
        pub fn serialize<S: Serializer>(
            value: &Option<Decimal>,
            serializer: S,
        ) -> Result<S::Ok, S::Error> {
            match value {
                Some(value) => serializer.serialize_str(&format(*value)),
                None => serializer.serialize_none(),
            }
        }

        /// Lee el valor canónico, o `None` si viene `null`.
        ///
        /// # Errores
        ///
        /// Del deserializador, o de [`parse`] si la cadena no es canónica.
        pub fn deserialize<'de, D: Deserializer<'de>>(
            deserializer: D,
        ) -> Result<Option<Decimal>, D::Error> {
            Option::<String>::deserialize(deserializer)?
                .map(|raw| parse(&raw).map_err(serde::de::Error::custom))
                .transpose()
        }
    }
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
