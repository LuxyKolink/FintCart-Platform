//! Siembra de contenido inicial del Simulador (T095; Principio XII).
//!
//! Lo invoca `dev/seed`, que es el único verbo del flujo local que carga datos. Vive en el
//! servicio y no en el script por una razón que no admite alternativa: las definiciones semilla
//! son tres columnas `JSONB` producidas por el analizador de fórmulas, así que escribirlas
//! exige el binario que las compila. Ver la nota de [`fintcart_simulator::repo::seeds`].
//!
//! ## Por qué un binario y no un subcomando del servicio
//!
//! `src/main.rs` es el servidor: arranca, sirve y espera una señal para apagarse. Un
//! subcomando de siembra convertiría el entrypoint en un despachador y obligaría a que el
//! proceso de siembra arrastrase la configuración del servidor —`GRPC_PORT`, `HEALTH_PORT`—
//! que no usa. Separado, este proceso lee UNA variable y termina.
//!
//! ## Es idempotente, y converge
//!
//! Ejecutarlo dos veces no duplica nada, y si una definición cambió en el código desde la
//! última vez, la base recibe una versión nueva en lugar de quedarse con la vieja. Ver la nota
//! del módulo de siembra.
//!
//! Uso: `DB_ADDR=postgres://… seed` (o dentro del contenedor, con el entorno ya puesto).

use std::env;
use std::process::ExitCode;

use sqlx::postgres::PgPoolOptions;

use fintcart_simulator::domain::seeds;
use fintcart_simulator::repo::seeds as siembra;

/// Conexiones del pool de siembra.
///
/// Una y no las del servidor: este proceso escribe siete definiciones y cinco indicadores, en
/// serie, y una sola conexión basta. Pedir más sería reservar recursos para trabajo que no
/// existe.
const CONNECTIONS: u32 = 1;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            // A la salida estándar de errores y sin `tracing`: el script que invoca esto
            // muestra el texto tal cual, y un log en JSON con marca de tiempo haría ilegible
            // el único mensaje que importa cuando la siembra falla.
            eprintln!("error: {err:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> anyhow::Result<()> {
    let db_addr = env::var("DB_ADDR")
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("falta DB_ADDR"))?;

    // `compile()` es la comprobación de que las siete semillas pasan por el MISMO analizador
    // que la definición de un usuario. Un fallo aquí no es una entrada inválida: es un defecto
    // del binario, y por eso se aborta entero en vez de sembrar las que sí compilaron. Una base
    // con seis calculadoras de siete estaría peor que una sin ninguna, porque el catálogo
    // parecería completo.
    let compiled = seeds::compile().map_err(|fallos| {
        let detalle: Vec<String> = fallos
            .iter()
            .map(|fallo| {
                let issues: Vec<String> = fallo
                    .issues
                    .iter()
                    .map(|issue| {
                        format!(
                            "{} [{}] {}",
                            issue.location,
                            issue.code.as_str(),
                            issue.message
                        )
                    })
                    .collect();
                format!("  {}: {}", fallo.seed, issues.join("; "))
            })
            .collect();
        anyhow::anyhow!(
            "las definiciones semilla no analizan ({} con problemas):\n{}",
            fallos.len(),
            detalle.join("\n")
        )
    })?;

    let pool = PgPoolOptions::new()
        .max_connections(CONNECTIONS)
        .connect(&db_addr)
        .await?;

    let resumen = siembra::seed_builtins(&pool, &compiled).await?;
    println!(
        "semillas: {} creadas, {} actualizadas, {} sin cambios ({} en total)",
        resumen.creadas,
        resumen.actualizadas,
        resumen.iguales,
        compiled.len()
    );

    // El año sale del reloj del proceso, que es el del contenedor. Es lo que pide la tarea
    // —«los indicadores del año en curso»— y es correcto porque los valores son de ejemplo.
    let year = chrono::Utc::now().date_naive().format("%Y").to_string();
    let year: i32 = year.parse()?;
    let insertados = siembra::seed_indicators(&pool, year).await?;
    println!("indicadores: {insertados} insertados para {year} (valores de EJEMPLO)");

    let explicadas = siembra::backfill_history(&pool).await?;
    println!("historial: {explicadas} simulaciones anteriores quedaron ligadas a su semilla");

    Ok(())
}
