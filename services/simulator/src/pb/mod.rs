//! Stubs gRPC generados desde `contracts/proto` — **NO EDITAR A MANO**.
//!
//! Los ficheros `fintcart.*.v1.rs` de este directorio los produce `build.rs` con
//! `tonic-build` y están versionados (§Definición de Contratos), igual que
//! `services/*/gen` en Go y `src/pb` en TypeScript. Para regenerarlos:
//!
//!     FINTCART_REGEN_PROTO=1 cargo build
//!
//! o bien `contracts/generate.sh`, que lo hace para todos los stacks.
//!
//! Este `mod.rs` sí se escribe a mano: `tonic-build` emite un fichero por
//! paquete protobuf, con el nombre completo del paquete como nombre de archivo
//! (`fintcart.simulator.v1.rs`). Esos nombres no son identificadores válidos de
//! módulo, así que la jerarquía se declara aquí y el contenido se trae con
//! `include!`.
//!
//! La ANIDACIÓN NO ES ARBITRARIA: `prost` referencia los tipos de otros paquetes
//! con rutas relativas (`super::super::common::v1::PageRequest` desde
//! `fintcart::simulator::v1`), de modo que los módulos deben reproducir
//! exactamente `fintcart::<servicio>::v1`. Renombrar o aplanar un nivel rompe la
//! compilación de los tipos importados de `common`.
//!
//! Usar `include!` tiene además una ventaja: `rustfmt` no atraviesa los ficheros
//! incluidos de esta forma, así que `cargo fmt --check` no intenta reformatear
//! código generado.

// El código generado no está sujeto al estilo del crate: `clippy --all-targets
// -- -D warnings` (CI) fallaría por lints que no podemos corregir sin editar a
// mano ficheros que se sobrescriben en cada regeneración.
//
// `dead_code` se silencia por una razón distinta y deliberada: este es un crate
// binario, así que todo tipo del contrato que el Simulador no construya cuenta
// como muerto. Los stubs son la superficie COMPLETA del contrato y no se espera
// que el servicio use cada mensaje (p. ej. `common.v1.Money` lo consumen otros
// servicios). Sin este `allow`, añadir un mensaje al `.proto` rompería el build.
#[allow(dead_code)]
#[allow(clippy::all, clippy::pedantic, clippy::nursery)]
pub mod fintcart {
    /// Tipos compartidos por todos los contratos (`fintcart/common/v1`).
    pub mod common {
        pub mod v1 {
            include!("fintcart.common.v1.rs");
        }
    }

    /// Contrato del Simulador (`fintcart/simulator/v1`).
    ///
    /// Solo servidor: el Simulador expone gRPC y no consume otros servicios, así
    /// que `build.rs` desactiva la generación de clientes.
    pub mod simulator {
        pub mod v1 {
            include!("fintcart.simulator.v1.rs");
        }
    }
}
