//! Entrypoint del Servicio Simulador (Principio X: «entrypoint delgado»).
//!
//! Lee configuración del entorno, abre el pool de PostgreSQL, ensambla
//! `repo → grpc` y sirve con apagado ordenado. Nada más: el dominio vive en la
//! librería (`fintcart_simulator`), y este binario es una cáscara sobre ella.
//!
//! El Simulador NO es productor de eventos (Principio V, research D-03): no hay
//! `AMQP_ADDR` ni conexión con RabbitMQ. La auditoría de una simulación la emite el
//! Orquestador, que es quien la invoca. Que aquí no exista el cliente de AMQP es
//! parte del diseño, no un olvido.

// Principio VIII (NON-NEGOTIABLE): prohibido el punto flotante binario para
// dinero y tasas. `clippy.toml` declara los tipos vetados; la severidad va en la
// raíz del crate, y el binario es un crate distinto de la librería.
#![deny(clippy::disallowed_types)]

use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use tonic::transport::Server;
use tracing::info;
use tracing_subscriber::EnvFilter;

use fintcart_simulator::grpc::service::Service;

/// Cotas del pool de conexiones.
///
/// El valor por defecto de `sqlx` es generoso y, con varias réplicas, agota
/// `max_connections` de PostgreSQL: el síntoma no es lentitud sino errores de
/// conexión en todo lo que comparta la instancia.
const MAX_DB_CONNECTIONS: u32 = 25;
const DB_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> Result<()> {
    // Log estructurado en JSON (D-12). El nivel sale de `RUST_LOG` —la convención de
    // `tracing_subscriber`— y no de `LOG_LEVEL` como en los servicios Go, porque
    // `EnvFilter` admite además filtros por módulo (`sqlx=warn,fintcart=debug`) que un
    // nivel global no puede expresar. `dev/docker-compose.yaml` ya usa `RUST_LOG`.
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;

    // `connect` verifica la conexión al arrancar en lugar de esperar a la primera
    // consulta: un `DB_ADDR` equivocado debe impedir el arranque, no producir un
    // `Internal` en la primera simulación que alguien pida.
    let pool = PgPoolOptions::new()
        .max_connections(MAX_DB_CONNECTIONS)
        .acquire_timeout(DB_ACQUIRE_TIMEOUT)
        .connect(&config.db_addr)
        .await
        .context("conectar con simulator_db")?;

    let addr: SocketAddr = format!("0.0.0.0:{}", config.grpc_port)
        .parse()
        .with_context(|| format!("interpretar el puerto gRPC {}", config.grpc_port))?;

    info!(port = %config.grpc_port, "simulador escuchando");

    // `serve_with_shutdown` deja terminar los RPC en vuelo cuando llega la señal. Sin
    // él, un SIGTERM del orquestador de contenedores cortaría las llamadas a mitad y
    // el cliente vería un error de transporte en lugar de una respuesta.
    Server::builder()
        .add_service(Service::new(pool).into_server())
        .serve_with_shutdown(addr, shutdown_signal())
        .await
        .context("servir gRPC")?;

    info!("apagado ordenado completado");
    Ok(())
}

/// Espera SIGTERM o Ctrl-C.
///
/// SIGTERM es la señal que manda el orquestador de contenedores al retirar un pod, y
/// atenderla es lo que separa un despliegue sin cortes de uno que trunca las
/// peticiones en vuelo. Ctrl-C está para el desarrollo local.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("instalar el manejador de Ctrl-C");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("instalar el manejador de SIGTERM")
            .recv()
            .await;
    };

    // En Windows no hay SIGTERM. El binario se despliega en Linux, así que esta rama
    // solo existe para que `cargo build` funcione en la máquina de quien desarrolla.
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}

/// Configuración del proceso, 100 % desde variables de entorno (Principio X).
///
/// Sin valores por defecto para las direcciones: un `DB_ADDR` ausente detiene el
/// arranque en lugar de caer en un `localhost` implícito que en producción apuntaría
/// a la nada.
struct Config {
    db_addr: String,
    grpc_port: String,
}

impl Config {
    fn from_env() -> Result<Self> {
        // Se comprueban las dos y se reportan JUNTAS. Fallar en la primera obliga a
        // reiniciar el contenedor una vez por variable ausente.
        let db_addr = env::var("DB_ADDR").ok().filter(|v| !v.is_empty());
        let grpc_port = env::var("GRPC_PORT").ok().filter(|v| !v.is_empty());

        let mut missing = Vec::new();
        if db_addr.is_none() {
            missing.push("DB_ADDR");
        }
        if grpc_port.is_none() {
            missing.push("GRPC_PORT");
        }
        anyhow::ensure!(
            missing.is_empty(),
            "faltan variables de entorno obligatorias: {}",
            missing.join(", ")
        );

        Ok(Self {
            db_addr: db_addr.unwrap_or_default(),
            grpc_port: grpc_port.unwrap_or_default(),
        })
    }
}
