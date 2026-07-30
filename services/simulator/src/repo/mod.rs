//! Capa de persistencia del Simulador (Principio IX: la capa de abajo).
//!
//! Traduce llamadas de función en SQL contra `simulator_db` y nada más: sin reglas de
//! negocio, sin tipos proto y sin decidir el alcance de una transacción fuera de
//! [`tx::exec_tx`].
//!
//! `simulations.rs` (historial) y `anonymize.rs` (FR-030) llegan con T131 y T163;
//! aquí está por ahora el único elemento que el resto de la capa necesita antes de
//! escribir su primera consulta.

pub mod tx;
