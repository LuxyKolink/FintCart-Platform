//! Lo que queda del código nativo (FR-019) después de T098.
//!
//! ## Aquí solo vive `colombia`
//!
//! Las otras cuatro —`ahorro`, `credito`, `inversion` y `presupuesto`— se retiraron con T098: el
//! camino de compatibilidad por `calc_type` ya no las ejecuta, resuelve la definición semilla
//! (FR-043), y con eso el servicio pasó a tener UNA sola implementación de cada cálculo en lugar
//! de dos. Habían quedado en `tests/nativo/`, donde la suite que autorizó su retirada las usa
//! como oráculo.
//!
//! `colombia` NO se retiró, y la razón está en D-30: es la única cuyas entradas difieren de las de
//! sus tres semillas —el nativo recibe `valor_uvt` como parámetro y `exento` como el texto
//! `"si"`/`"no"`, mientras que `gmf` lee `@UVT` de `financial_indicators` y toma `exento` como
//! entero—, así que redirigirla hoy significaría que un cliente que manda `valor_uvt` lo viera
//! **ignorado en silencio**. Espera a que el camino por `calc_type` se retire del contrato.
//!
//! Este módulo expone una función `compute(&Inputs) -> Result<Outcome>` y nada más. No conoce
//! gRPC, ni la base de datos, ni el enum del contrato: recibe parámetros ya leídos y devuelve un
//! resultado, que es lo que permite probarla con una tabla de casos y sin levantar nada
//! (Principio IX).
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

pub mod colombia;

/// Resultado de una calculadora: pares `clave → valor decimal`.
///
/// Es un `Vec` de tuplas y no un `HashMap` para conservar el ORDEN en que la
/// calculadora los produjo. El orden es lo que hace legible el resultado —principal,
/// luego intereses, luego total— y un mapa lo perdería, dejando la presentación a
/// merced de la iteración.
pub type Outcome = Vec<(&'static str, Decimal)>;
