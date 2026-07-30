//! Genera los stubs gRPC del Simulador desde `contracts/proto`.
//!
//! A diferencia de los servicios Go y TypeScript —que usan `buf` vía
//! `contracts/generate.sh`— el Simulador genera con `tonic-build` en cada
//! `cargo build`. El resultado va a `OUT_DIR` y se re-exporta desde `src/pb`,
//! de modo que compilar el crate no exige tener `buf` ni `protoc` instalados
//! más allá de lo que `tonic-build` ya incluye.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let contracts = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts/proto")
        .canonicalize()
        .expect("no se encontró contracts/proto — ¿se movió el directorio de contratos?");

    // Rutas canónicas de buf: `<raíz>/fintcart/<servicio>/v1/<servicio>.proto`,
    // que es la disposición que exigen las reglas STANDARD de lint
    // (el paquete debe coincidir con el directorio).
    let protos = [
        contracts.join("fintcart/common/v1/common.proto"),
        contracts.join("fintcart/simulator/v1/simulator.proto"),
    ];

    tonic_build::configure()
        .build_server(true)
        // El Simulador no consume otros servicios por gRPC: no necesita clientes.
        .build_client(false)
        .compile_protos(&protos, &[contracts.clone()])?;

    // Recompilar si cambia cualquier contrato consumido.
    for proto in &protos {
        println!("cargo:rerun-if-changed={}", proto.display());
    }

    Ok(())
}
