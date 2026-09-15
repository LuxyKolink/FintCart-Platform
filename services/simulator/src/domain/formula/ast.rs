//! Árbol de sintaxis abstracta de una fórmula (T079, T086).
//!
//! El árbol es **cerrado**: hay un número fijo de variantes y ninguna de ellas permite
//! introducir comportamiento nuevo en tiempo de ejecución. Eso es lo que hace que
//! recorrerlo sea seguro, y es también lo que permite afirmar que el lenguaje no tiene
//! bucles, ni recursión, ni funciones definidas por el usuario (D-15).
//!
//! ## El árbol se serializa a `JSONB`, y los números NO son números JSON
//!
//! `calculator_definitions.outputs` guarda el AST como `JSONB`. La forma evidente de
//! serializar un literal sería un número JSON, y está descartada por dos motivos, el
//! segundo grave:
//!
//! 1. Un número JSON obliga a quien lo lea a interpretarlo con un tipo de coma
//!    flotante. El Principio VIII lo prohíbe para dinero, y aquí un literal **es** una
//!    cifra de dinero en potencia (`350` UVT, `0.04` de GMF).
//! 2. `serde_json` no representa más de 15-17 dígitos significativos en un número: lo
//!    que exceda se redondea. El AST se persiste y se vuelve a leer para calcular, así
//!    que esa pérdida sería **silenciosa** y ocurriría en cada ciclo guardar → leer.
//!
//! De ahí [`decimal_as_str`], que serializa todo literal como cadena canónica. Es el
//! mismo formato que usan `simulations.inputs` y `result`, y el único que
//! [`crate::domain::decimal_str`] acepta — el `round-trip` es estable por construcción.

use std::collections::{BTreeMap, BTreeSet};

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Tipo declarado de un campo de entrada.
///
/// **No existe el tipo texto.** La única entrada de texto del sistema era el
/// discriminador `operacion` de la calculadora colombiana, que D-16 elimina al separarla
/// en tres definiciones; sin él, el lenguaje es puramente numérico. Mantener una
/// variante de texto «por si acaso» reabriría la puerta a un valor que no se puede
/// comparar ni elevar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    /// Importe monetario. Se valida contra `NUMERIC(19,2)`.
    Monto,
    /// Tasa o porcentaje como FRACCIÓN. Se valida contra `NUMERIC(9,6)`.
    Tasa,
    /// Número de periodos. Es el único tipo del que se puede demostrar que es entero.
    Entero,
}

/// Función de la tabla de D-15.
///
/// `presente` NO está aquí aunque D-15 lo liste entre las funciones: su argumento es el
/// NOMBRE de un campo y no una expresión, así que no se puede analizar como una llamada
/// normal. Tiene su propia variante, [`Expr::Present`], y el motivo está explicado allí.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Func {
    /// `pot(base, n)` — potencia de exponente ENTERO, exacta.
    Pot,
    /// `potd(base, x)` — potencia de exponente decimal, APROXIMADA.
    Potd,
    /// `redondear(x, escala)` — half-even a la escala indicada.
    Redondear,
    /// `redondear_dinero(x)` — half-even a la escala monetaria del dominio.
    RedondearDinero,
    /// `min(a, b)`.
    Min,
    /// `max(a, b)`.
    Max,
    /// `abs(x)`.
    Abs,
    /// `cuota(capital, i, n)` — cuota nivelada de amortización francesa.
    Cuota,
    /// `vf_serie(aporte, i, n)` — valor futuro de una serie de aportes iguales.
    VfSerie,
    /// `tasa_periodica(anual, m)` — división NOMINAL `anual / m`.
    TasaPeriodica,
}

/// Nodo del árbol.
///
/// Los nombres de las variantes en JSON (`op`) son cortos porque el árbol entero se
/// guarda en una columna `JSONB` y se lee en cada ejecución. Los nombres de los campos
/// (`left`/`right`) se dejan legibles: el AST también lo lee una persona cuando depura
/// por qué una calculadora da una cifra rara, y `{"op":"sub","l":…,"r":…}` obliga a
/// tener el analizador a mano para entenderlo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Expr {
    /// Literal decimal.
    Num {
        /// Valor, serializado como cadena canónica. Ver la nota del módulo.
        #[serde(with = "decimal_as_str")]
        value: Decimal,
    },

    /// Campo de entrada de la propia calculadora, por su clave.
    ///
    /// Espacio de nombres propio y separado del de los indicadores (T085). Es lo que
    /// hace que añadir un indicador llamado `UVT` no pueda cambiar el significado de una
    /// calculadora que ya tenía un campo `UVT`.
    Field {
        /// Clave del campo, tal como se declaró en `inputs`.
        key: String,
    },

    /// Indicador financiero, escrito `@NOMBRE` en la fórmula.
    Indicator {
        /// Nombre del indicador, sin la arroba y en mayúsculas.
        name: String,
    },

    /// Negación aritmética unaria.
    Neg {
        /// Operando.
        operand: Box<Expr>,
    },

    /// Suma.
    Add {
        /// Sumando izquierdo.
        left: Box<Expr>,
        /// Sumando derecho.
        right: Box<Expr>,
    },

    /// Resta.
    Sub {
        /// Minuendo.
        left: Box<Expr>,
        /// Sustraendo.
        right: Box<Expr>,
    },

    /// Multiplicación.
    Mul {
        /// Factor izquierdo.
        left: Box<Expr>,
        /// Factor derecho.
        right: Box<Expr>,
    },

    /// División.
    Div {
        /// Dividendo.
        left: Box<Expr>,
        /// Divisor.
        right: Box<Expr>,
    },

    /// `left < right`.
    Lt {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// `left <= right`.
    Le {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// `left > right`.
    Gt {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// `left >= right`.
    Ge {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// `left == right`.
    Eq {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// `left != right`.
    Ne {
        /// Operando izquierdo.
        left: Box<Expr>,
        /// Operando derecho.
        right: Box<Expr>,
    },

    /// Conjunción `y`.
    And {
        /// Condición izquierda.
        left: Box<Expr>,
        /// Condición derecha.
        right: Box<Expr>,
    },

    /// Disyunción `o`.
    Or {
        /// Condición izquierda.
        left: Box<Expr>,
        /// Condición derecha.
        right: Box<Expr>,
    },

    /// Negación lógica `no`.
    Not {
        /// Condición negada.
        operand: Box<Expr>,
    },

    /// Condicional `si(cond, entonces, si_no)`.
    If {
        /// Condición. Debe ser booleana.
        cond: Box<Expr>,
        /// Rama tomada si la condición se cumple.
        #[serde(rename = "then")]
        then_branch: Box<Expr>,
        /// Rama tomada si no se cumple.
        #[serde(rename = "else")]
        else_branch: Box<Expr>,
    },

    /// Llamada a una función de la tabla.
    Call {
        /// Función invocada.
        func: Func,
        /// Argumentos, en orden.
        args: Vec<Expr>,
    },

    /// `presente(campo)` — verdadero si el campo opcional fue suministrado.
    ///
    /// Tiene variante propia y no es una [`Func`] porque su argumento es un NOMBRE de
    /// campo, no una expresión: `presente(1 + 2)` no significa nada. Como llamada normal
    /// habría que analizar `1 + 2` y luego comprobar que el resultado «parece» un campo,
    /// que es una comprobación que se puede olvidar. Con su propia variante, el
    /// analizador exige un identificador y el árbol no puede representar la forma
    /// inválida.
    Present {
        /// Clave del campo opcional.
        key: String,
    },
}

impl Expr {
    /// Hijos directos del nodo, en orden.
    ///
    /// Existe para que los recorridos —recuento de nodos, profundidad, extracción de
    /// indicadores— compartan UNA definición de la estructura del árbol. La alternativa
    /// era un `match` en cada recorrido, y con tres recorridos eso son tres sitios donde
    /// olvidarse de una variante nueva: el recuento seguiría cuadrando y la extracción
    /// de indicadores se dejaría uno sin avisar, que es exactamente el fallo silencioso
    /// que FR-058 no puede permitirse.
    #[must_use]
    pub fn children(&self) -> Vec<&Self> {
        match self {
            Self::Num { .. }
            | Self::Field { .. }
            | Self::Indicator { .. }
            | Self::Present { .. } => Vec::new(),
            Self::Neg { operand } | Self::Not { operand } => vec![operand],
            Self::Add { left, right }
            | Self::Sub { left, right }
            | Self::Mul { left, right }
            | Self::Div { left, right }
            | Self::Lt { left, right }
            | Self::Le { left, right }
            | Self::Gt { left, right }
            | Self::Ge { left, right }
            | Self::Eq { left, right }
            | Self::Ne { left, right }
            | Self::And { left, right }
            | Self::Or { left, right } => vec![left, right],
            Self::If {
                cond,
                then_branch,
                else_branch,
            } => vec![cond, then_branch, else_branch],
            Self::Call { args, .. } => args.iter().collect(),
        }
    }

    /// Nombres de los indicadores referenciados, ordenados y sin repetir (T086).
    ///
    /// Se extrae al GUARDAR y se persiste en `calculator_definitions.indicators_used`.
    /// La consecuencia práctica es la que pide FR-058: saber qué indicadores necesita
    /// una calculadora sin volver a recorrer su AST, que es lo que permite avisar de una
    /// vigencia por vencer (FR-061) con una consulta y no con un recorrido por cada
    /// calculadora publicada.
    ///
    /// El orden es el de [`BTreeSet`] y no el de aparición: dos definiciones con los
    /// mismos indicadores escritos en distinto orden deben producir la misma lista, o el
    /// `TEXT[]` de la columna diferiría entre versiones idénticas en lo que importa.
    #[must_use]
    pub fn indicators_used(&self) -> Vec<String> {
        let mut found = BTreeSet::new();
        let mut stack = vec![self];
        while let Some(node) = stack.pop() {
            if let Self::Indicator { name } = node {
                found.insert(name.clone());
            }
            stack.extend(node.children());
        }
        found.into_iter().collect()
    }

    /// Claves de los campos referenciados, ordenadas y sin repetir.
    ///
    /// Sirve para comprobar que un campo declarado se usa de verdad, y para que el
    /// constructor pueda avisar de una entrada que no aparece en ninguna salida.
    #[must_use]
    pub fn fields_used(&self) -> Vec<String> {
        let mut found = BTreeSet::new();
        let mut stack = vec![self];
        while let Some(node) = stack.pop() {
            match node {
                Self::Field { key } | Self::Present { key } => {
                    found.insert(key.clone());
                }
                _ => {}
            }
            stack.extend(node.children());
        }
        found.into_iter().collect()
    }
}

/// Contexto contra el que se analiza una fórmula.
///
/// El analizador necesita saber qué campos e indicadores EXISTEN para poder rechazar una
/// fórmula que los invoque mal al guardarla, que es el momento en que el autor está
/// delante (D-15). Eso obliga a pasarle este contexto, y pasarlo tiene una consecuencia
/// de diseño que conviene explicitar: **el analizador no consulta nada.** Recibe los
/// nombres ya resueltos, así que sigue siendo dominio puro y se puede probar sin base de
/// datos (Principio IX). Quien consulta es la capa de aplicación, que es la que tiene el
/// repositorio.
#[derive(Debug, Clone, Default)]
pub struct Schema {
    /// Tipo declarado de cada campo de entrada, por clave.
    ///
    /// [`BTreeMap`] y no `HashMap` porque el orden se filtra a los mensajes de error:
    /// «las entradas son a, b, c» debe leerse igual en dos análisis de la misma fórmula.
    pub fields: BTreeMap<String, InputKind>,
    /// Nombres de indicador que existen hoy en el catálogo.
    pub indicators: BTreeSet<String>,
}

impl Schema {
    /// Construye el contexto a partir de los campos y los indicadores conocidos.
    #[must_use]
    pub fn new(
        fields: impl IntoIterator<Item = (String, InputKind)>,
        indicators: impl IntoIterator<Item = String>,
    ) -> Self {
        Self {
            fields: fields.into_iter().collect(),
            indicators: indicators.into_iter().collect(),
        }
    }
}

/// Serializa un [`Decimal`] como cadena canónica en lugar de como número JSON.
///
/// Escrito a mano en vez de confiar en la característica `serde-with-str` de
/// `rust_decimal`, que ya está activada en `Cargo.toml`: esa característica cambia el
/// comportamiento por DEFECTO de [`Decimal`] en todo el crate, y un día alguien la
/// retire al ajustar dependencias. El resultado sería que los literales del AST
/// empezarían a guardarse como números JSON —precisión perdida de forma silenciosa en
/// cada guardado— sin que nada fallara. Aquí la elección es local y visible desde el
/// propio campo.
mod decimal_as_str {
    use rust_decimal::Decimal;
    use serde::{Deserialize, Deserializer, Serializer};

    use crate::domain::decimal_str;

    /// Escribe el valor en la forma canónica `^-?\d+(\.\d+)?$`.
    pub fn serialize<S: Serializer>(value: &Decimal, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&decimal_str::format(*value))
    }

    /// Lee el valor exigiendo esa misma forma.
    ///
    /// `serde_json` aceptaría además un número JSON, y se rechaza a propósito: si una
    /// fila llega con un literal numérico, viene de algo que no pasó por el analizador,
    /// y leerlo como si fuera equivalente aceptaría en silencio un AST que nunca se
    /// validó.
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Decimal, D::Error> {
        let raw = String::deserialize(deserializer)?;
        decimal_str::parse(&raw).map_err(serde::de::Error::custom)
    }
}
