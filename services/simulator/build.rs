//! Genera los stubs gRPC del Simulador desde `contracts/proto` hacia `src/pb/`.
//!
//! A diferencia de los servicios Go y TypeScript —que usan `buf` vía
//! `contracts/generate.sh`— el Simulador genera con `tonic-build`. El resultado
//! NO va a `OUT_DIR`: va a `src/pb/`, que está versionado, igual que
//! `services/*/gen` en Go y `src/pb` en TypeScript (§Definición de Contratos).
//!
//! La generación es OPT-IN, no automática en cada `cargo build`:
//!
//!     FINTCART_REGEN_PROTO=1 cargo build      # regenera src/pb/
//!     cargo build                             # usa los stubs versionados
//!
//! El motivo es que `tonic-build` NO trae su propio `protoc`: `prost-build`
//! dejó de empaquetarlo, así que exige el binario en el PATH. Si la generación
//! ocurriera en cada compilación, compilar el Simulador requeriría `protoc`
//! instalado —lo que contradice la garantía de que los stubs versionados
//! permiten compilar cualquier servicio sin herramientas de contrato— y el job
//! de Rust en CI fallaría, porque el workflow no instala `protoc`.
//!
//! `contracts/generate.sh` invoca la regeneración con la variable puesta.

use std::path::PathBuf;

/// Directorio versionado de los stubs, relativo a la raíz del crate.
const PB_DIR: &str = "src/pb";

/// Variable de entorno que habilita la regeneración.
const REGEN_ENV: &str = "FINTCART_REGEN_PROTO";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Cambiar la variable debe volver a disparar el build script; sin esto,
    // ponerla no tendría efecto mientras el fingerprint siguiera fresco.
    println!("cargo:rerun-if-env-changed={REGEN_ENV}");

    if std::env::var_os(REGEN_ENV).is_none() {
        // Camino normal: se compilan los stubs ya versionados en src/pb/.
        return Ok(());
    }

    // Se sube dos niveles con `parent()` en lugar de unir `../..` y canonicalizar.
    // En Windows, `canonicalize()` devuelve una ruta extendida con prefijo `\\?\`,
    // que `protoc` NO acepta como raíz de include: reporta cada import como
    // "File not found" porque no logra hacer coincidir el fichero con el include.
    // `parent()` produce una ruta limpia y sin componentes `..`.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let contracts = manifest
        .parent()
        .and_then(|p| p.parent())
        .expect("CARGO_MANIFEST_DIR debería estar en services/<svc>")
        .join("contracts")
        .join("proto");
    assert!(
        contracts.is_dir(),
        "no se encontró {} — ¿se movió el directorio de contratos?",
        contracts.display()
    );

    // Rutas canónicas de buf: `<raíz>/fintcart/<servicio>/v1/<servicio>.proto`,
    // que es la disposición que exigen las reglas STANDARD de lint
    // (el paquete debe coincidir con el directorio).
    let protos = [
        contracts.join("fintcart/common/v1/common.proto"),
        contracts.join("fintcart/simulator/v1/simulator.proto"),
    ];

    // Recompilar si cambia cualquier contrato consumido.
    for proto in &protos {
        println!("cargo:rerun-if-changed={}", proto.display());
    }

    tonic_build::configure()
        .build_server(true)
        // El Simulador no consume otros servicios por gRPC: no necesita clientes.
        .build_client(false)
        .out_dir(PB_DIR)
        .compile_protos(&protos, std::slice::from_ref(&contracts))?;

    Ok(())
}
