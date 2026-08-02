//! Capa de persistencia del Simulador (Principio IX: la capa de abajo).
//!
//! Traduce llamadas de función en SQL contra `simulator_db` y nada más: sin reglas de
//! negocio, sin tipos proto y sin decidir el alcance de una transacción fuera de
//! [`tx::exec_tx`].
//!
//! La anonimización (FR-030) NO tiene módulo propio: vive junto al resto de las
//! operaciones sobre `simulations`, porque es un `UPDATE` sobre esa misma tabla.
//! Separarla sugeriría que toca otro almacén.

pub mod simulations;
pub mod tx;
