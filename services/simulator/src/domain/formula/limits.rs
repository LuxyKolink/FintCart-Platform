//! Límites de complejidad de una fórmula (T082, FR-046, D-15).
//!
//! ## Para qué sirven, dicho sin rodeos
//!
//! El motor **no tiene un vigilante de tiempo de ejecución**. Un AST evaluado aquí no
//! puede colgar el servicio, y no porque el evaluador sea rápido, sino porque el árbol
//! que recorre ya está acotado: ≤ 64 nodos y ≤ 16 de profundidad, comprobados antes de
//! persistir. La consecuencia es la que pide D-15 —coste acotado **por construcción**—
//! y es la razón de que estos números se validen al GUARDAR y no se vuelvan a mirar al
//! ejecutar.
//!
//! Un vigilante en tiempo de ejecución sería la alternativa y es peor por dos motivos:
//! convierte cada ejecución en una apuesta, y una fórmula que se acepta al guardar y se
//! rechaza al ejecutar deja al autor sin saber qué corregir.
//!
//! ## Por qué los límites viven aquí y no en la fórmula
//!
//! Son límites de la PLATAFORMA, no del lenguaje: describen cuánto trabajo admite el
//! servicio por ejecución. Tenerlos en un módulo propio permite subirlos algún día sin
//! tocar el analizador ni el evaluador, y deja claro en la revisión que subirlos es una
//! decisión de capacidad y no un detalle de sintaxis.

use crate::domain::formula::ast::Expr;
use crate::domain::formula::{ErrorCode, FormulaError, Result};

/// Máximo de nodos del AST de UNA fórmula (FR-046).
///
/// Cuenta cada nodo, incluidos literales y campos: `meses` es un nodo aunque no parezca
/// una operación. Es lo correcto porque lo que se acota es el trabajo de recorrerlo, y
/// recorrer un campo cuesta un paso igual que recorrer una suma.
pub const MAX_NODES: usize = 64;

/// Máxima profundidad del AST (FR-046).
///
/// Se cuenta como número de nodos en el camino más largo desde la raíz hasta una hoja,
/// de modo que una fórmula de un solo literal tiene profundidad 1 y no 0. La definición
/// se fija porque es la que usa `tests/formula_parser.rs`, y una unidad implícita es la
/// clase de detalle que hace que dos comprobaciones del mismo límite discrepen en uno.
pub const MAX_DEPTH: usize = 16;

/// Máximo de campos de entrada de una definición (FR-046).
pub const MAX_INPUTS: usize = 20;

/// Máximo de salidas de una definición (FR-046).
pub const MAX_OUTPUTS: usize = 10;

/// Mínimo de campos de entrada.
///
/// El máximo lo pide FR-046; el mínimo lo impone el esquema
/// (`CHECK jsonb_array_length(inputs) BETWEEN 1 AND 20`, migración de T018). Se declaran
/// JUNTOS y no uno aquí y otro en el validador porque son las dos mitades de la misma
/// regla: separarlos es como se llega a un validador que comprueba el techo y deja que el
/// suelo lo rechace PostgreSQL, con un mensaje sobre una restricción en vez de uno para el
/// autor.
///
/// Una definición sin entradas no es una calculadora: es una constante disfrazada, y
/// ejecutarla devolvería siempre lo mismo sin que nadie pueda ajustar nada.
pub const MIN_INPUTS: usize = 1;

/// Mínimo de salidas de una definición.
///
/// Por la misma razón que [`MIN_INPUTS`]: una calculadora que no produce ningún resultado
/// no tiene nada que ofrecer, y sin este límite se guardaría y fallaría al ejecutarse,
/// delante del lector en lugar de delante del autor.
pub const MIN_OUTPUTS: usize = 1;

/// Número de nodos y profundidad de un árbol.
///
/// El recorrido es ITERATIVO con una pila explícita, y no recursivo. La razón no es el
/// rendimiento: es que esta función es la que decide si un árbol es aceptable, y una
/// versión recursiva desbordaría la pila **antes** de poder informar de que el árbol es
/// demasiado profundo. El analizador también acota la profundidad mientras construye,
/// así que en la práctica no se llega hasta aquí con un árbol hondo; escribirlo
/// iterativo es lo que garantiza que siga siendo cierto si alguien cambia el analizador.
#[must_use]
pub fn measure(root: &Expr) -> (usize, usize) {
    let mut nodes = 0;
    let mut deepest = 0;
    let mut stack = vec![(root, 1_usize)];

    while let Some((node, depth)) = stack.pop() {
        nodes += 1;
        deepest = deepest.max(depth);
        for child in node.children() {
            stack.push((child, depth + 1));
        }
    }

    (nodes, deepest)
}

/// Comprueba que un árbol respeta los límites de fórmula.
///
/// # Errores
///
/// [`ErrorCode::LimiteExcedido`], nombrando el límite concreto y el valor medido. Decir
/// «demasiado compleja» sin más dejaría al autor sin saber si sobran dos nodos o veinte,
/// y la corrección es muy distinta en cada caso.
pub fn check(root: &Expr) -> Result<()> {
    let (nodes, depth) = measure(root);

    if nodes > MAX_NODES {
        return Err(FormulaError::new(
            ErrorCode::LimiteExcedido,
            format!("la fórmula tiene {nodes} nodos y el máximo es {MAX_NODES}"),
        ));
    }
    if depth > MAX_DEPTH {
        return Err(FormulaError::new(
            ErrorCode::LimiteExcedido,
            format!("la fórmula anida {depth} niveles y el máximo es {MAX_DEPTH}"),
        ));
    }

    Ok(())
}
