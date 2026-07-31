//! Capa de transporte del Simulador (Principio IX: la capa de arriba).
//!
//! Adapta el contrato gRPC `SimulatorService` al dominio. Aquí NO se calcula nada:
//! las cinco calculadoras viven en `src/calculators/` y el redondeo a moneda en el
//! dominio. Este módulo desempaqueta el mensaje, llama y vuelve a empaquetar.
//!
//! **Principio VIII (NON-NEGOTIABLE)**: los montos y las tasas cruzan esta frontera
//! como `String` decimal canónica, nunca como `f64`. La conversión
//! `String ↔ Decimal` ocurre aquí y solo aquí — un `Decimal` que llegara al proto o
//! un `String` que llegara a una calculadora significaría que la frontera se movió.

pub mod service;
