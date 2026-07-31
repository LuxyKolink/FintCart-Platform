//! Observabilidad del Simulador (§Observabilidad, research D-12).
//!
//! Expone en un puerto HTTP propio las tres cosas que la constitución exige de todos
//! los servicios y que aquí faltaban —el log JSON ya lo monta `main.rs`:
//!
//! - `/healthz` — ¿el proceso está vivo? Kubernetes REINICIA el pod si falla.
//! - `/readyz`  — ¿puede trabajar? Kubernetes le QUITA TRÁFICO si falla.
//! - `/metrics` — latencia, tasa de error y throughput en formato Prometheus.
//!
//! La distinción entre las dos sondas evita el peor fallo operativo posible: si
//! `/healthz` comprobara PostgreSQL, una caída de la base reiniciaría TODAS las
//! réplicas a la vez y, al volver, se encontraría con procesos arrancando en frío en
//! lugar de con réplicas listas para atender.
//!
//! Que un servicio gRPC abra un puerto HTTP no contradice el Principio II: no hay
//! superficie REST de negocio, son sondas de infraestructura en un puerto aparte.
//!
//! ## Por qué el servidor HTTP está escrito a mano
//!
//! Un `hyper` completo aquí traería un árbol de dependencias entero para servir tres
//! respuestas de texto sin cabeceras ni negociación de contenido. Lo que hace falta es
//! leer una línea de petición y contestar, y eso cabe en este archivo.
//!
//! ## Por qué las latencias son enteros
//!
//! `f64` está PROHIBIDO en este crate (`clippy::disallowed_types`, Principio VIII). La
//! prohibición apunta a dinero y tasas, pero en lugar de pedir una excepción para los
//! segundos se acumulan MICROSEGUNDOS en `u64` y se formatean al renderizar. El
//! resultado es idéntico para Prometheus y el crate se queda sin una sola excepción a
//! la regla, que es más fácil de defender que una excepción bien argumentada.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use sqlx::PgPool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tracing::{error, info, warn};

/// Nombre del servicio en las métricas.
const SERVICE: &str = "simulator";

/// Puerto de las sondas cuando `HEALTH_PORT` no está.
///
/// Tiene valor por defecto —al contrario que `GRPC_PORT`, que es obligatorio— porque
/// un despliegue que lo olvide debe quedarse sin sondas, no sin arrancar.
pub const DEFAULT_HEALTH_PORT: &str = "8080";

/// Cotas del histograma, en microsegundos, con su etiqueta en segundos.
///
/// Están elegidas alrededor de SC-006 (una simulación responde en menos de 500 ms):
/// sin una cota cerca del umbral que se vigila, el percentil caería siempre dentro del
/// mismo intervalo y la métrica no distinguiría cumplirlo de incumplirlo.
const BUCKETS: &[(u64, &str)] = &[
    (5_000, "0.005"),
    (10_000, "0.01"),
    (25_000, "0.025"),
    (50_000, "0.05"),
    (100_000, "0.1"),
    (250_000, "0.25"),
    (500_000, "0.5"),
    (1_000_000, "1"),
    (2_500_000, "2.5"),
    (5_000_000, "5"),
    (10_000_000, "10"),
];

/// Estado acumulado de las métricas.
#[derive(Default)]
struct Registry {
    /// (operación, código) → número de peticiones.
    ///
    /// Throughput y tasa de error salen de este mismo mapa porque son la misma cuenta
    /// partida por el código: dos contadores independientes podrían discrepar.
    counts: HashMap<(String, String), u64>,
    /// operación → duraciones en microsegundos.
    samples: HashMap<String, Vec<u64>>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

/// Registra el desenlace y la duración de una operación.
pub fn observe(operation: &str, code: &str, elapsed: Duration) {
    let micros = u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX);

    // `unwrap_or_else` sobre el veneno del mutex: si otro hilo entró en pánico
    // sosteniéndolo, seguir contando métricas es preferible a propagar el pánico y
    // tumbar el servicio por su instrumentación.
    let mut reg = registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *reg.counts
        .entry((operation.to_owned(), code.to_owned()))
        .or_insert(0) += 1;
    reg.samples
        .entry(operation.to_owned())
        .or_default()
        .push(micros);
}

/// Serializa el registro en el formato de texto de Prometheus.
fn render() -> String {
    let reg = registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut out = String::new();

    out.push_str("# HELP fintcart_requests_total Peticiones atendidas, por operación y código.\n");
    out.push_str("# TYPE fintcart_requests_total counter\n");
    for ((operation, code), value) in &reg.counts {
        out.push_str(&format!(
            "fintcart_requests_total{{service=\"{SERVICE}\",operation=\"{operation}\",code=\"{code}\"}} {value}\n"
        ));
    }

    out.push_str("# HELP fintcart_request_duration_seconds Latencia de las operaciones.\n");
    out.push_str("# TYPE fintcart_request_duration_seconds histogram\n");
    for (operation, samples) in &reg.samples {
        for (bound_micros, label) in BUCKETS {
            let count = samples.iter().filter(|s| *s <= bound_micros).count();
            out.push_str(&format!(
                "fintcart_request_duration_seconds_bucket{{service=\"{SERVICE}\",operation=\"{operation}\",le=\"{label}\"}} {count}\n"
            ));
        }
        let total: u64 = samples.iter().sum();
        out.push_str(&format!(
            "fintcart_request_duration_seconds_bucket{{service=\"{SERVICE}\",operation=\"{operation}\",le=\"+Inf\"}} {}\n\
             fintcart_request_duration_seconds_sum{{service=\"{SERVICE}\",operation=\"{operation}\"}} {}\n\
             fintcart_request_duration_seconds_count{{service=\"{SERVICE}\",operation=\"{operation}\"}} {}\n",
            samples.len(),
            seconds(total),
            samples.len(),
        ));
    }

    out
}

/// Formatea microsegundos como segundos con seis decimales, sin punto flotante.
fn seconds(micros: u64) -> String {
    format!("{}.{:06}", micros / 1_000_000, micros % 1_000_000)
}

/// Sirve las sondas hasta que `shutdown` resuelva.
///
/// Un fallo al abrir el puerto NO tumba el proceso: sin `/readyz`, Kubernetes deja de
/// mandarle tráfico, que es la degradación deseada. Matar el servicio porque su puerto
/// de DIAGNÓSTICO no arrancó invertiría la relación entre el servicio y lo que lo
/// observa.
pub async fn serve_probes(port: &str, pool: PgPool, shutdown: impl Future<Output = ()> + Send) {
    let addr = format!("0.0.0.0:{port}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(%addr, error = %err, "no se pudieron abrir las sondas de salud");
            return;
        }
    };
    info!(%addr, "sondas de salud escuchando");

    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            () = &mut shutdown => {
                info!("sondas de salud detenidas");
                return;
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let pool = pool.clone();
                        // Una conexión por tarea: una sonda lenta —la de readiness
                        // consulta la base— no puede bloquear a las demás.
                        tokio::spawn(async move { handle(stream, pool).await; });
                    }
                    Err(err) => warn!(error = %err, "conexión de sonda rechazada"),
                }
            }
        }
    }
}

/// Atiende una petición de sonda.
async fn handle(stream: tokio::net::TcpStream, pool: PgPool) {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();

    if reader.read_line(&mut request_line).await.is_err() {
        return;
    }

    // `GET /readyz HTTP/1.1` → `/readyz`. Basta con la ruta: estas sondas no negocian
    // contenido ni leen cabeceras, y pretender lo contrario sería escribir un servidor
    // HTTP de verdad para servir tres cadenas.
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");

    let (status, body) = match path {
        // Vivacidad: NO consulta ninguna dependencia. Ver la cabecera del módulo.
        "/healthz" => ("200 OK", "ok\n".to_owned()),
        "/metrics" => ("200 OK", render()),
        "/readyz" => match ready(&pool).await {
            Ok(()) => ("200 OK", "ready\n".to_owned()),
            Err(err) => {
                warn!(error = %err, "sonda de readiness negativa");
                ("503 Service Unavailable", "not ready\n".to_owned())
            }
        },
        _ => ("404 Not Found", "not found\n".to_owned()),
    };

    // `Connection: close` evita tener que implementar keep-alive: el cliente de estas
    // sondas es kubelet o Prometheus, y ambos abren una conexión por comprobación.
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = reader.get_mut().write_all(response.as_bytes()).await;
    let _ = reader.get_mut().shutdown().await;
}

/// Plazo de la comprobación de readiness.
///
/// Sin plazo, una base que acepta la conexión y no responde dejaría la sonda colgada;
/// kubelet la daría por fallida de todos modos, pero varios segundos más tarde y sin
/// nada en el log que lo explicara.
const READY_TIMEOUT: Duration = Duration::from_secs(3);

/// Comprueba que el servicio puede trabajar.
async fn ready(pool: &PgPool) -> anyhow::Result<()> {
    let probe = sqlx::query("SELECT 1").execute(pool);
    match tokio::time::timeout(READY_TIMEOUT, probe).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(err)) => Err(anyhow::anyhow!("simulator_db no responde: {err}")),
        Err(_) => Err(anyhow::anyhow!(
            "simulator_db no respondió en {READY_TIMEOUT:?}"
        )),
    }
}
