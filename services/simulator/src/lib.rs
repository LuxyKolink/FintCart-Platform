//! Librería del Servicio Simulador.
//!
//! Contiene todo lo que no es arranque: dominio, cálculo, persistencia y la capa
//! gRPC. `src/main.rs` es una cáscara delgada sobre esta librería (Principio X),
//! y las pruebas de integración de `tests/` la importan como
//! `fintcart_simulator::…`.

// Principio VIII (NON-NEGOTIABLE): prohibido el punto flotante binario para
// dinero y tasas. `clippy.toml` declara los tipos vetados (f32, f64); la
// severidad DEBE fijarse en la raíz de cada crate, y lib y bin son crates
// distintos, así que esta línea aparece también en `main.rs`.
#![deny(clippy::disallowed_types)]

pub mod domain;
pub mod grpc;
pub mod pb;
pub mod repo;
