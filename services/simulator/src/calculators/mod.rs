//! Las cinco calculadoras financieras del alcance (FR-019).
//!
//! Cada módulo expone una función `compute(&Inputs) -> Result<Outcome>` y nada más.
//! No conocen gRPC, ni la base de datos, ni el enum del contrato: reciben parámetros
//! ya leídos y devuelven un resultado, que es lo que permite probarlas con una tabla
//! de casos y sin levantar nada (Principio IX).
//!
//! ## La regla que gobierna todo este árbol
//!
//! Principio VIII (NON-NEGOTIABLE): ningún valor monetario pasa jamás por `f32`/`f64`.
//! `clippy.toml` lo veta a nivel de tipo, pero la prohibición no basta por sí sola —
//! hay dos formas de perder precisión sin nombrar un flotante:
//!
//! 1. **Redondear antes de tiempo.** Todos los cálculos intermedios corren a la
//!    precisión completa de [`rust_decimal::Decimal`] y solo el RESULTADO se redondea,
//!    con half-even (D-14). Redondear la cuota y multiplicarla luego por el plazo da
//!    un total distinto del que devuelve el banco.
//! 2. **Dividir sin decidir la escala.** Una división con resto —`1 / 3`— no tiene
//!    representación decimal finita. `Decimal` la trunca a su escala máxima en
//!    silencio, así que toda división de este árbol va seguida de un redondeo
//!    explícito o se deja a precisión plena hasta el resultado.

use rust_decimal::Decimal;

pub mod ahorro;
pub mod annuity;
pub mod colombia;
pub mod credito;
pub mod inversion;
pub mod presupuesto;

/// Resultado de una calculadora: pares `clave → valor decimal`.
///
/// Es un `Vec` de tuplas y no un `HashMap` para conservar el ORDEN en que la
/// calculadora los produjo. El orden es lo que hace legible el resultado —principal,
/// luego intereses, luego total— y un mapa lo perdería, dejando la presentación a
/// merced de la iteración.
pub type Outcome = Vec<(&'static str, Decimal)>;
