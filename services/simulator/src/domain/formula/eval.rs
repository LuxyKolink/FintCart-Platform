//! Evaluador del AST (T084) y resolución de variables (T085).
//!
//! ## Por qué esto no puede entrar en pánico
//!
//! Toda operación usa la variante `checked_*` de [`Decimal`]. La alternativa —los
//! operadores `+`, `*`, `/`— entra en pánico al desbordar, y aquí el desbordamiento no
//! es un fallo del programa: es un resultado que el usuario produjo con sus datos. Un
//! pánico en el hilo del RPC se convierte en un fallo interno, y el usuario que escribió
//! un plazo de cien años ve «error del servidor» en lugar del parámetro que envió mal.
//!
//! ## Las ramas se evalúan de forma perezosa, y eso es semántica, no una optimización
//!
//! `si(cond, a, b)` evalúa **solo la rama que se toma**, y `y`/`o` cortocircuitan. La
//! razón es que es la única forma de que un autor pueda protegerse de una operación
//! inválida: `si(meses > 0, monto / meses, 0)` es como se escribe «divide si tiene
//! sentido» en un lenguaje sin sentencias. Evaluando las dos ramas, esa fórmula fallaría
//! con `meses = 0` exactamente en el caso que pretende cubrir.
//!
//! ## Los campos y los indicadores son espacios de nombres SEPARADOS (T085)
//!
//! [`Expr::Field`] se resuelve contra `fields` y [`Expr::Indicator`] contra `indicators`,
//! sin ningún camino de uno a otro. Es lo que garantiza la promesa de D-15: añadir un
//! indicador nuevo nunca puede cambiar el significado de una calculadora existente. Si un
//! indicador llamado `UVT` pudiera satisfacer una referencia al campo `UVT`, cargar el
//! UVT de un año nuevo alteraría en silencio el resultado de cualquier calculadora que
//! tuviera un campo con ese nombre.

use std::collections::{HashMap, HashSet};

use rust_decimal::Decimal;

use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};
use crate::domain::formula::ast::Expr;
use crate::domain::formula::functions;

/// Valores contra los que se evalúa una fórmula.
///
/// ## Qué tiene que haber dentro
///
/// Todos los campos que la fórmula REFERENCIA, no solo los que el usuario envió. Quien
/// construye el ámbito —la capa de aplicación— es responsable de rellenar los opcionales
/// ausentes con su valor por defecto o con cero, que es la semántica que ya tienen las
/// calculadoras nativas (`Inputs::money_or_zero`). La distinción entre «no lo envió» y
/// «lo envió como cero» la conserva `supplied`, que es lo que consulta `presente(…)`.
///
/// Si un campo referenciado no está, la evaluación falla nombrando el campo. Es la red de
/// seguridad contra un ámbito mal construido: la alternativa sería devolver cero, y un
/// resultado con un cero donde debía ir un dato se lee como un cálculo legítimo.
pub struct Scope<'a> {
    fields: &'a HashMap<String, Decimal>,
    indicators: &'a HashMap<String, Decimal>,
    supplied: &'a HashSet<String>,
}

impl<'a> Scope<'a> {
    /// Construye el ámbito.
    ///
    /// No hay un constructor de conveniencia que se salte `supplied` ni `indicators`: los
    /// tres parámetros son obligatorios a propósito. Un atajo que dejara `supplied` vacío
    /// haría que `presente(…)` fuera falso para campos que SÍ están —un resultado
    /// silenciosamente equivocado— y uno que dejara `indicators` vacío convertiría
    /// cualquier `@INDICADOR` en un error de ejecución. Un hueco así se rellena mal una
    /// vez y cuesta un rato encontrarlo.
    #[must_use]
    pub fn new(
        fields: &'a HashMap<String, Decimal>,
        indicators: &'a HashMap<String, Decimal>,
        supplied: &'a HashSet<String>,
    ) -> Self {
        Self {
            fields,
            indicators,
            supplied,
        }
    }
}

/// Valor intermedio de una evaluación.
///
/// El AST está tipado desde el análisis, así que en teoría bastaría con `Decimal`. Se
/// distingue igualmente porque el AST se LEE de `JSONB` y pudo escribirlo otra versión
/// del código: sin esta comprobación, un nodo booleano en una salida se convertiría en
/// un error de tipo confuso o, peor, en un cero silencioso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Value {
    /// Un valor decimal.
    Number(Decimal),
    /// Una condición.
    Flag(bool),
}

/// Evalúa una fórmula y devuelve su resultado decimal.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta un campo o un indicador del ámbito, si una operación
/// no es representable (división por cero, desbordamiento) o si la fórmula produce una
/// condición donde el llamador espera un número.
pub fn evaluate(expr: &Expr, scope: &Scope) -> Result<Decimal> {
    match eval(expr, scope)? {
        Value::Number(value) => Ok(value),
        Value::Flag(_) => Err(Error::InvalidInput(
            "la fórmula produce una condición y aquí se espera un valor".to_owned(),
        )),
    }
}

/// Evalúa una fórmula y devuelve su resultado lógico.
///
/// Se usa para las validaciones de dominio y para el `cuando` de una salida (D-15).
///
/// # Errores
///
/// Las de [`evaluate`], más [`Error::InvalidInput`] si la fórmula produce un número donde
/// el llamador espera una condición.
pub fn evaluate_condition(expr: &Expr, scope: &Scope) -> Result<bool> {
    match eval(expr, scope)? {
        Value::Flag(value) => Ok(value),
        Value::Number(_) => Err(Error::InvalidInput(
            "se esperaba una condición y la fórmula produce un valor".to_owned(),
        )),
    }
}

/// Recorre el árbol produciendo un valor.
fn eval(expr: &Expr, scope: &Scope) -> Result<Value> {
    match expr {
        Expr::Num { value } => Ok(Value::Number(*value)),

        Expr::Field { key } => scope
            .fields
            .get(key)
            .copied()
            .map(Value::Number)
            .ok_or_else(|| {
                Error::InvalidInput(format!(
                    "no hay valor para el campo «{key}»: la calculadora lo usa y el ámbito no \
                     lo trae"
                ))
            }),

        // Sin camino de respaldo hacia `fields`: ver la nota del módulo.
        Expr::Indicator { name } => scope
            .indicators
            .get(name)
            .copied()
            .map(Value::Number)
            .ok_or_else(|| {
                Error::InvalidInput(format!("no hay valor vigente para el indicador @{name}"))
            }),

        Expr::Present { key } => Ok(Value::Flag(scope.supplied.contains(key))),

        Expr::Neg { operand } => {
            // `0 - x` con `checked_sub` y no `-x`. Medido: la mantisa de `Decimal` es de 96
            // bits con signo y su rango es SIMÉTRICO, así que `-x` no desborda hoy y esta
            // comprobación nunca se dispara. Se escribe igualmente porque el evaluador no
            // debe tener ni un operador que pueda entrar en pánico: con todos los caminos
            // usando `checked_*`, no hay que recordar cuáles son seguros y cuáles no, y si
            // el rango dejara de ser simétrico el camino de error ya está escrito.
            let value = number(operand, scope)?;
            Decimal::ZERO
                .checked_sub(value)
                .map(Value::Number)
                .ok_or_else(|| {
                    Error::InvalidInput(format!(
                        "negar {} desborda la precisión disponible",
                        decimal_str::format(value)
                    ))
                })
        }

        Expr::Add { left, right } => binary(left, right, scope, "+", Decimal::checked_add),
        Expr::Sub { left, right } => binary(left, right, scope, "-", Decimal::checked_sub),
        Expr::Mul { left, right } => binary(left, right, scope, "*", Decimal::checked_mul),

        Expr::Div { left, right } => {
            let dividend = number(left, scope)?;
            let divisor = number(right, scope)?;
            // La división por cero se comprueba ANTES de `checked_div`, que devuelve `None`
            // tanto para el cero como para el desbordamiento: sin distinguirlos, el autor
            // que dividió por cero leería un mensaje sobre la precisión disponible.
            if divisor.is_zero() {
                return Err(Error::InvalidInput(
                    "división por cero: revisa el divisor o protégelo con si(…)".to_owned(),
                ));
            }
            dividend
                .checked_div(divisor)
                .map(Value::Number)
                .ok_or_else(|| {
                    Error::InvalidInput(format!(
                        "{} / {} desborda la precisión disponible",
                        decimal_str::format(dividend),
                        decimal_str::format(divisor)
                    ))
                })
        }

        Expr::Lt { left, right } => compare(left, right, scope, |a, b| a < b),
        Expr::Le { left, right } => compare(left, right, scope, |a, b| a <= b),
        Expr::Gt { left, right } => compare(left, right, scope, |a, b| a > b),
        Expr::Ge { left, right } => compare(left, right, scope, |a, b| a >= b),
        Expr::Eq { left, right } => compare(left, right, scope, |a, b| a == b),
        Expr::Ne { left, right } => compare(left, right, scope, |a, b| a != b),

        // Cortocircuito: ver la nota del módulo. `y` no evalúa el lado derecho si el
        // izquierdo ya es falso.
        Expr::And { left, right } => {
            if condition(left, scope)? {
                condition(right, scope).map(Value::Flag)
            } else {
                Ok(Value::Flag(false))
            }
        }
        Expr::Or { left, right } => {
            if condition(left, scope)? {
                Ok(Value::Flag(true))
            } else {
                condition(right, scope).map(Value::Flag)
            }
        }
        Expr::Not { operand } => condition(operand, scope).map(|value| Value::Flag(!value)),

        // Solo se evalúa la rama que se toma: ver la nota del módulo.
        Expr::If {
            cond,
            then_branch,
            else_branch,
        } => {
            if condition(cond, scope)? {
                eval(then_branch, scope)
            } else {
                eval(else_branch, scope)
            }
        }

        Expr::Call { func, args } => {
            let mut evaluated = Vec::with_capacity(args.len());
            for argument in args {
                evaluated.push(number(argument, scope)?);
            }
            functions::apply(*func, &evaluated).map(Value::Number)
        }
    }
}

/// Aplica una operación aritmética binaria, nombrando el operador si falla.
fn binary(
    left: &Expr,
    right: &Expr,
    scope: &Scope,
    symbol: &str,
    operation: fn(Decimal, Decimal) -> Option<Decimal>,
) -> Result<Value> {
    let a = number(left, scope)?;
    let b = number(right, scope)?;
    operation(a, b).map(Value::Number).ok_or_else(|| {
        Error::InvalidInput(format!(
            "{} {symbol} {} desborda la precisión disponible",
            decimal_str::format(a),
            decimal_str::format(b)
        ))
    })
}

/// Aplica una comparación entre dos valores numéricos.
fn compare(
    left: &Expr,
    right: &Expr,
    scope: &Scope,
    predicate: fn(Decimal, Decimal) -> bool,
) -> Result<Value> {
    let a = number(left, scope)?;
    let b = number(right, scope)?;
    Ok(Value::Flag(predicate(a, b)))
}

/// Evalúa exigiendo un número.
fn number(expr: &Expr, scope: &Scope) -> Result<Decimal> {
    match eval(expr, scope)? {
        Value::Number(value) => Ok(value),
        // Alcanzable solo con un AST leído de la base que no pasó por este analizador, o
        // por un error del analizador. Se informa en vez de convertirlo a cero.
        Value::Flag(_) => Err(Error::InvalidInput(
            "se esperaba un número y la expresión produce una condición".to_owned(),
        )),
    }
}

/// Evalúa exigiendo una condición.
fn condition(expr: &Expr, scope: &Scope) -> Result<bool> {
    match eval(expr, scope)? {
        Value::Flag(value) => Ok(value),
        Value::Number(_) => Err(Error::InvalidInput(
            "se esperaba una condición y la expresión produce un valor".to_owned(),
        )),
    }
}
