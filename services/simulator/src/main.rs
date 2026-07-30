//! Entrypoint del Simulador.
//!
//! MARCADOR DE POSICIÓN (T018): el wiring real —leer configuración del entorno,
//! abrir el pool de PostgreSQL, ensamblar `repo → grpc` y servir con apagado
//! ordenado— lo implementa **T037**, que reemplaza este archivo. No añadir
//! lógica aquí: el dominio va en la librería (`src/lib.rs`), no en el binario.

// Principio VIII (NON-NEGOTIABLE): prohibido el punto flotante binario para
// dinero y tasas. `clippy.toml` declara los tipos vetados; la severidad va en la
// raíz del crate, y el binario es un crate distinto de la librería.
#![deny(clippy::disallowed_types)]

fn main() {}
