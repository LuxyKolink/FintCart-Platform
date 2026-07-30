//! Entrypoint del Simulador.
//!
//! MARCADOR DE POSICIÓN (T018): por ahora solo declara los módulos y las reglas
//! de lint del crate. El wiring real —leer configuración del entorno, abrir el
//! pool de PostgreSQL, ensamblar `repo → grpc` y servir con apagado ordenado—
//! lo implementa **T037**, que reemplaza este archivo. No añadir lógica aquí.
//!
//! Existe ya porque `Cargo.toml` declara `[[bin]] path = "src/main.rs"`: sin él
//! `cargo` falla en la resolución de targets y no llega a ejecutar `build.rs`,
//! de modo que ni los stubs se compilarían ni el job de Rust de CI pasaría.

// Principio VIII (NON-NEGOTIABLE): prohibido el punto flotante binario para
// dinero y tasas. `clippy.toml` declara los tipos vetados (f32, f64) y la
// severidad DEBE fijarse aquí, en la raíz del crate — clippy.toml no puede.
// Sin esta línea el paso de clippy en CI no verifica nada del Principio VIII.
#![deny(clippy::disallowed_types)]

mod pb;

fn main() {}
