//! Motor de fórmulas: analizador → AST persistido → evaluador acotado (FR-043…FR-047,
//! research D-15).
//!
//! ## Las tres propiedades que este módulo existe para dar
//!
//! D-15 pide tres cosas a la vez, y la arquitectura es lo que las hace compatibles:
//!
//! 1. **Errores al GUARDAR, no al ejecutar.** Un autor que escribe `pot(x, 2.5)` debe
//!    enterarse mientras edita, no un lector tres semanas después. Por eso el análisis
//!    ocurre al guardar y lo que se persiste es el AST ya validado.
//! 2. **Coste acotado sin vigilante de tiempo de ejecución.** El AST guardado ya pasó
//!    por [`limits`], así que el evaluador no necesita contar nada ni rendirse a mitad:
//!    su coste está acotado **por construcción**. Un vigilante en tiempo de ejecución
//!    sería la alternativa, y convertiría cada ejecución en una apuesta.
//! 3. **Ninguna ejecución de código.** No se analiza texto al ejecutar —solo se recorre
//!    un árbol de nodos cerrado—, y el lenguaje no tiene bucles ni recursión.
//!
//! ## Por qué se persiste el AST y no el texto
//!
//! Es la decisión con la consecuencia menos obvia: si se guardara el texto, una mejora
//! futura del analizador **reinterpretaría en silencio** una fórmula ya publicada. Un
//! cambio de precedencia o de semántica de `pot` alteraría resultados históricos sin
//! tocar una sola fila. Guardando el árbol, lo que se publicó queda congelado y una
//! mejora del analizador solo afecta a lo que se analice después.
//!
//! ## Sobre el Principio VIII
//!
//! Todo el motor trabaja sobre [`rust_decimal::Decimal`]. No es una preferencia: el
//! `clippy.toml` del servicio veta `f32`/`f64` a nivel de tipo y `#![deny(...)]` está
//! en la raíz del crate, así que un flotante aquí no compila. `tests/no_float.rs`
//! (T078) añade la comprobación que el compilador no puede hacer: que el módulo no
//! alcance un flotante **por una ruta indirecta**, como una función de `f64` de la
//! biblioteca estándar.

pub mod ast;
pub mod eval;
pub mod functions;
pub mod lexer;
pub mod limits;
pub mod parser;

/// Código de un error de definición, tal como viaja en `DefinitionError.code`.
///
/// Es un enum cerrado y no una `String` por el mismo motivo que [`super::error::Error`]
/// lo es: la lista de códigos es parte del contrato con el constructor visual del
/// frontend, que decide qué resaltar según el código. Con cadenas sueltas, añadir un
/// caso nuevo no rompería nada y el frontend lo trataría como «otro error» sin que
/// nadie se enterara.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// La fórmula referencia un campo que no está entre las entradas declaradas.
    CampoInexistente,
    /// La fórmula referencia un `@INDICADOR` que no existe en el catálogo.
    IndicadorDesconocido,
    /// La fórmula no es analizable: token inesperado, paréntesis sin cerrar, aridad
    /// incorrecta.
    ExpresionMalFormada,
    /// Una operación recibe un valor del tipo equivocado: una comparación donde va un
    /// número, un número donde va una condición.
    TipoIncompatible,
    /// El AST supera los límites de [`limits`] (FR-046).
    LimiteExcedido,
    /// `pot`, `cuota`, `vf_serie` o `tasa_periodica` reciben un exponente o un número de
    /// periodos que no es un entero demostrable.
    ExponenteNoEntero,
    /// Se invoca una función que no está en la tabla de [`functions`].
    FuncionDesconocida,
    /// El problema está en la DEFINICIÓN y no en una fórmula: dos entradas con la misma
    /// clave, una clave que el lenguaje no puede nombrar, una etiqueta vacía, un mínimo
    /// mayor que su máximo o un valor por defecto fuera de su propio rango.
    ///
    /// Tuvo que ser un código aparte porque ninguno de los siete anteriores lo dice.
    /// Etiquetar «el campo `si` no puede llamarse así» como `expresion_mal_formada`
    /// mandaría al constructor visual a resaltar una expresión que no existe, y
    /// `campo_inexistente` dice lo contrario de lo que pasa: el campo está declarado dos
    /// veces, no ausente.
    DefinicionInvalida,
}

impl ErrorCode {
    /// Forma con la que el código cruza el contrato.
    ///
    /// Coincide exactamente con la lista documentada en `simulator.proto`; que salga de
    /// aquí y no de un literal en el mapeo es lo que impide que el frontend reciba un
    /// código que su `switch` no contempla.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CampoInexistente => "campo_inexistente",
            Self::IndicadorDesconocido => "indicador_desconocido",
            Self::ExpresionMalFormada => "expresion_mal_formada",
            Self::TipoIncompatible => "tipo_incompatible",
            Self::LimiteExcedido => "limite_excedido",
            Self::ExponenteNoEntero => "exponente_no_entero",
            Self::FuncionDesconocida => "funcion_desconocida",
            Self::DefinicionInvalida => "definicion_invalida",
        }
    }
}

/// Error de análisis o validación de una fórmula.
///
/// **No lleva la ubicación.** `location` en `DefinitionError` es de la DEFINICIÓN
/// (`outputs[1].expression`), no de la fórmula: el analizador no sabe si está
/// analizando la tercera salida o la primera validación. Añadirla aquí obligaría a
/// pasarle un contexto que no le corresponde, y el llamador —que sí lo sabe— la compone
/// al mapear. Ver `domain::definition`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}", code = .code.as_str())]
pub struct FormulaError {
    /// Qué clase de problema es, para el `code` del contrato.
    pub code: ErrorCode,
    /// Explicación dirigida al AUTOR de la calculadora, no al operador del servicio.
    ///
    /// Nombra el campo, la función o el token concreto: «el campo `ingreso` no está
    /// declarado» es accionable, «expresión inválida» no lo es.
    pub message: String,
}

impl FormulaError {
    /// Construye un error con su código.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Alias del resultado del motor.
pub type Result<T> = std::result::Result<T, FormulaError>;
