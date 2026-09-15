//! Analizador léxico: texto → secuencia de tokens (T080).
//!
//! El lenguaje es deliberadamente pequeño —aritmética, comparación, lógica, un
//! condicional y una tabla de funciones— y este módulo es la parte que lo demuestra:
//! cabe entero en una pantalla y no tiene estados que se puedan quedar a medias.
//!
//! ## Cada token lleva su posición
//!
//! No es un lujo. El autor de una calculadora escribe `si(meses > 0, monto/meses, 0)` y
//! un mensaje que diga «expresión mal formada» le obliga a releerla entera buscando el
//! error. Con la columna, el constructor visual puede señalar el carácter exacto. El
//! coste es un `usize` por token; el beneficio es que el mensaje de error sirva.
//!
//! ## Sobre la forma de los números
//!
//! Se reconocen dígitos con un punto decimal opcional. **No hay signo**: el `-` es un
//! operador unario del analizador sintáctico, igual que en cualquier lenguaje de
//! expresiones. Reconocerlo aquí crearía dos formas de escribir lo mismo —`-5` como
//! literal y `-5` como negación— y con ellas dos árboles distintos para la misma
//! fórmula, que es justo lo que hace irreproducible un resultado histórico.

use rust_decimal::Decimal;

use crate::domain::formula::{ErrorCode, FormulaError, Result};

/// Unidad léxica del lenguaje.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    /// Literal decimal. Nunca lleva signo.
    Number(Decimal),
    /// Identificador: nombre de campo, de función o palabra clave.
    Ident(String),
    /// Indicador `@NOMBRE`, ya sin la arroba.
    Indicator(String),
    /// `+`
    Plus,
    /// `-`
    Minus,
    /// `*`
    Star,
    /// `/`
    Slash,
    /// `<`
    Lt,
    /// `<=`
    Le,
    /// `>`
    Gt,
    /// `>=`
    Ge,
    /// `==`
    Eq,
    /// `!=`
    Ne,
    /// `(`
    LParen,
    /// `)`
    RParen,
    /// `,`
    Comma,
}

impl Token {
    /// Descripción legible del token, para los mensajes de error.
    ///
    /// Se escribe como la escribiría el autor en su fórmula (`<=`, `si`) y no con el
    /// nombre de la variante (`Le`), porque el mensaje lo lee quien redacta la
    /// calculadora y no quien mantiene este módulo.
    #[must_use]
    pub fn describe(&self) -> String {
        match self {
            Self::Number(value) => format!("el número {value}"),
            Self::Ident(name) => format!("«{name}»"),
            Self::Indicator(name) => format!("«@{name}»"),
            Self::Plus => "«+»".to_owned(),
            Self::Minus => "«-»".to_owned(),
            Self::Star => "«*»".to_owned(),
            Self::Slash => "«/»".to_owned(),
            Self::Lt => "«<»".to_owned(),
            Self::Le => "«<=»".to_owned(),
            Self::Gt => "«>»".to_owned(),
            Self::Ge => "«>=»".to_owned(),
            Self::Eq => "«==»".to_owned(),
            Self::Ne => "«!=»".to_owned(),
            Self::LParen => "«(»".to_owned(),
            Self::RParen => "«)»".to_owned(),
            Self::Comma => "«,»".to_owned(),
        }
    }
}

/// Token con la columna donde empieza.
///
/// La columna es el índice de CARÁCTER dentro de la fórmula (base 0), y así se declara
/// porque el constructor visual la usa para posicionar el cursor y contar bytes lo
/// desviaría en cuanto la fórmula tuviera un acento o un `ñ`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spanned {
    /// Unidad léxica.
    pub token: Token,
    /// Índice de carácter donde comienza.
    pub at: usize,
}

/// Convierte una fórmula en su secuencia de tokens.
///
/// # Errores
///
/// [`ErrorCode::ExpresionMalFormada`] para un carácter que no pertenece al lenguaje, un
/// número mal escrito (`1.2.3`), un indicador sin nombre o con un nombre que la base no
/// podría almacenar.
pub fn tokenize(source: &str) -> Result<Vec<Spanned>> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let start = i;
        let current = chars[i];

        if current.is_whitespace() {
            i += 1;
            continue;
        }

        if current.is_ascii_digit() {
            let (token, next) = number(&chars, i)?;
            tokens.push(Spanned { token, at: start });
            i = next;
            continue;
        }

        if current.is_ascii_alphabetic() || current == '_' {
            let (token, next) = identifier(&chars, i);
            tokens.push(Spanned { token, at: start });
            i = next;
            continue;
        }

        if current == '@' {
            let (token, next) = indicator(&chars, i)?;
            tokens.push(Spanned { token, at: start });
            i = next;
            continue;
        }

        // Los operadores de dos caracteres van primero: si se probara `<=` después de
        // `<`, un `<=` se emitiría como `<` seguido de un `=` que no es token válido, y
        // el error hablaría del `=` en vez de reconocer el operador que el autor sí
        // escribió.
        let (token, width) = match (current, chars.get(i + 1)) {
            ('<', Some('=')) => (Token::Le, 2),
            ('>', Some('=')) => (Token::Ge, 2),
            ('=', Some('=')) => (Token::Eq, 2),
            ('!', Some('=')) => (Token::Ne, 2),
            ('+', _) => (Token::Plus, 1),
            ('-', _) => (Token::Minus, 1),
            ('*', _) => (Token::Star, 1),
            ('/', _) => (Token::Slash, 1),
            ('<', _) => (Token::Lt, 1),
            ('>', _) => (Token::Gt, 1),
            ('(', _) => (Token::LParen, 1),
            (')', _) => (Token::RParen, 1),
            (',', _) => (Token::Comma, 1),
            _ => {
                return Err(FormulaError::new(
                    ErrorCode::ExpresionMalFormada,
                    format!("el carácter {current:?} (columna {start}) no pertenece al lenguaje"),
                ))
            }
        };
        tokens.push(Spanned { token, at: start });
        i += width;
    }

    Ok(tokens)
}

/// Lee un número y devuelve hasta dónde llegó.
///
/// Se exige al menos un dígito antes y después del punto, igual que
/// [`crate::domain::decimal_str`]: `.5` y `5.` no son canónicos allí, y aceptarlos aquí
/// crearía una fórmula que se analiza pero cuyo literal no se puede serializar al AST.
fn number(chars: &[char], start: usize) -> Result<(Token, usize)> {
    let mut i = start;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i < chars.len() && chars[i] == '.' {
        i += 1;
        let fraction_start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i == fraction_start {
            return Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "el número que empieza en la columna {start} no tiene dígitos tras el punto"
                ),
            ));
        }
    }

    let text: String = chars[start..i].iter().collect();
    // `from_str_exact` y no `from_str`: el segundo redondea en silencio lo que exceda la
    // escala de `Decimal`, que es exactamente la pérdida que el Principio VIII prohíbe.
    let value = Decimal::from_str_exact(&text).map_err(|_| {
        FormulaError::new(
            ErrorCode::ExpresionMalFormada,
            format!("el número {text:?} no es representable con precisión decimal exacta"),
        )
    })?;
    Ok((Token::Number(value), i))
}

/// Lee un identificador y devuelve hasta dónde llegó.
///
/// Los identificadores son ASCII a propósito. Un campo llamado `año` sería aceptable
/// para el autor, pero obligaría a decidir si `año` y `ano` son el mismo campo, y esa
/// clase de decisión no aporta nada a una fórmula financiera.
fn identifier(chars: &[char], start: usize) -> (Token, usize) {
    let mut i = start;
    while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
        i += 1;
    }
    (Token::Ident(chars[start..i].iter().collect()), i)
}

/// Lee un indicador `@NOMBRE` y devuelve hasta dónde llegó.
///
/// El nombre se exige con la MISMA forma que el CHECK `financial_indicators_name_format`
/// de la base (`^[A-Z][A-Z0-9_]*$`). Comprobarlo aquí y no dejar que falle al resolver
/// tiene una razón concreta: `@uvt` nunca podrá existir en el catálogo, así que
/// reportarlo como «indicador desconocido» haría que el autor buscara un problema de
/// datos cuando el problema es que lo escribió en minúsculas.
fn indicator(chars: &[char], start: usize) -> Result<(Token, usize)> {
    let mut i = start + 1;
    if i >= chars.len() || !chars[i].is_ascii_uppercase() {
        return Err(FormulaError::new(
            ErrorCode::ExpresionMalFormada,
            format!(
                "tras «@» (columna {start}) se espera un nombre de indicador en mayúsculas, \
                 empezando por letra: por ejemplo @UVT"
            ),
        ));
    }
    while i < chars.len()
        && (chars[i].is_ascii_uppercase() || chars[i].is_ascii_digit() || chars[i] == '_')
    {
        i += 1;
    }
    Ok((Token::Indicator(chars[start + 1..i].iter().collect()), i))
}
