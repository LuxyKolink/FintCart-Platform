//! Las cuatro calculadoras nativas RETIRADAS del servicio (T098), conservadas como oráculo.
//!
//! ## Qué son estos archivos
//!
//! Hasta T098 eran `services/simulator/src/calculators/{ahorro,credito,inversion,presupuesto}.rs`
//! y el camino de compatibilidad por `calc_type` las ejecutaba. Desde T098 ese camino resuelve la
//! **definición semilla** correspondiente —igual que el camino preferente por `calculator_id`
//! (FR-043)—, así que el servicio ya no compila estas cuatro: viven aquí, en el árbol de PRUEBAS.
//!
//! ## Por qué no se borraron
//!
//! Porque son el **oráculo** de [`super::seed_regression`], la suite que autoriza su propia
//! retirada (FR-049): afirma que cada semilla —una fórmula analizada y evaluada por el motor—
//! produce, para todo el espacio de entradas, exactamente los mismos números que el código nativo
//! producía. Sin esta referencia, esa afirmación habría que cambiarla por una tabla de valores
//! congelados, y una tabla congelada ya no verifica la traducción: verifica que los números no
//! cambien. La diferencia importa: el oráculo sigue calculando, los valores congelados solo
//! recuerdan.
//!
//! ## La regla que los gobierna
//!
//! **Están congelados.** Son una referencia histórica, no una implementación: no se corrigen, no
//! se mejoran, no se les añade una calculadora. Un cambio aquí —aunque sea un arreglo— invalida
//! el oráculo en silencio, porque la suite pasaría a comparar el motor contra un código que ya no
//! es el que sirvió tráfico. Si alguna vez hay que tocar uno, se toca la semilla y se deja claro
//! en el mensaje del commit que la prueba dejó de ser una comparación con la historia.
//!
//! ## Cómo se compilan sin el servicio
//!
//! Las cuatro dicen `use crate::calculators::Outcome` y `use crate::domain::{…}`. En una prueba de
//! integración `crate::` es la raíz del crate de PRUEBA, así que esos caminos los resuelve el
//! pequeño conjunto de reexportaciones que hay al principio de `seed_regression.rs` —cada una
//! apuntando al tipo real de la biblioteca, para que el oráculo use el MISMO `Inputs`, el MISMO
//! redondeo y el MISMO tipo de error que usaba cuando vivía dentro—. Ninguna de esas
//! reexportaciones es una copia.

pub mod ahorro;
pub mod credito;
pub mod inversion;
pub mod presupuesto;
