//! Implementación del servidor gRPC `SimulatorService`.
//!
//! Los cuerpos llegan con T130–T133 (`Compute`, `ListHistory`) y T163
//! (`AnonymizeHistory`). Lo que ya está fijado aquí es la ESTRUCTURA: qué recibe el
//! servicio por constructor y cómo se traduce un error de dominio a un `Status`.

use std::time::Instant;

use tonic::{Request, Response, Status};

use crate::domain::error::Error;
use crate::observability;
use crate::pb::fintcart::common::v1::OpResult;
use crate::pb::fintcart::simulator::v1::simulator_service_server::{
    SimulatorService, SimulatorServiceServer,
};
use crate::pb::fintcart::simulator::v1::{
    ComputeRequest, ComputeResponse, ListHistoryRequest, ListHistoryResponse, UserRef,
};

/// Servicio del Simulador.
///
/// Guarda el pool de conexiones y no un repositorio concreto todavía porque
/// `src/repo/simulations.rs` llega con T131. Cuando llegue, este campo pasa a ser el
/// repositorio y el pool deja de cruzar esta capa: un `PgPool` visible desde el
/// transporte es la puerta por la que se acaba colando una consulta suelta en un
/// handler (Principio IX).
pub struct Service {
    pool: sqlx::PgPool,
}

impl Service {
    /// Construye el servicio sobre un pool ya abierto.
    ///
    /// No abre la conexión: eso lo hace `main.rs` (Principio X). Recibirla ya abierta
    /// es lo que permite que una prueba de integración use una base efímera.
    #[must_use]
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }

    /// Envuelve el servicio en el servidor generado, listo para `tonic`.
    ///
    /// Está aquí y no en `main.rs` para que el entrypoint no tenga que nombrar el tipo
    /// generado: `main.rs` construye y arranca, no conoce el contrato.
    #[must_use]
    pub fn into_server(self) -> SimulatorServiceServer<Self> {
        SimulatorServiceServer::new(self)
    }
}

/// Traduce un error de dominio al código de estado del contrato.
///
/// El mensaje que sale al cliente está SANEADO: un `Error::Storage` lleva dentro el
/// error de `sqlx`, que puede contener nombres de tabla, fragmentos de SQL y detalles
/// del driver. La causa completa va al log (`tracing`), nunca en la respuesta.
fn to_status(err: &Error) -> Status {
    match err {
        Error::InvalidInput(msg) => Status::invalid_argument(msg.clone()),
        Error::Decimal(_) => Status::invalid_argument("valor decimal no válido"),
        Error::NotFound => Status::not_found("no encontrado"),
        Error::Storage(_) => Status::internal("error interno"),
        Error::NotImplemented => Status::unimplemented("no implementado"),
    }
}

/// Registra la latencia y el desenlace de un RPC (§Observabilidad, D-12).
///
/// Se llama desde cada método en lugar de instalarse como capa `tower` porque una capa
/// exigiría dos dependencias más (`tower`, `http`) y un `Service` escrito a mano para
/// medir tres RPC. La contrapartida es que un método nuevo puede olvidarse de llamarla:
/// son tres, y la línea va pegada al `return`.
fn record<T>(operation: &str, started: Instant, result: &Result<Response<T>, Status>) {
    let code = match result {
        Ok(_) => "OK".to_owned(),
        Err(status) => format!("{:?}", status.code()),
    };
    observability::observe(operation, &code, started.elapsed());
}

#[tonic::async_trait]
impl SimulatorService for Service {
    /// Ejecuta una simulación y persiste el historial (FR-019..FR-022).
    async fn compute(
        &self,
        _request: Request<ComputeRequest>,
    ) -> Result<Response<ComputeResponse>, Status> {
        let started = Instant::now();
        let _ = &self.pool;
        let result = Err(to_status(&Error::NotImplemented));
        record("simulator.Compute", started, &result);
        result
    }

    /// Historial de simulaciones por usuario (FR-022).
    async fn list_history(
        &self,
        _request: Request<ListHistoryRequest>,
    ) -> Result<Response<ListHistoryResponse>, Status> {
        let started = Instant::now();
        let result = Err(to_status(&Error::NotImplemented));
        record("simulator.ListHistory", started, &result);
        result
    }

    /// Saga de anonimización (FR-030): disocia la PII del historial.
    async fn anonymize_history(
        &self,
        _request: Request<UserRef>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = Err(to_status(&Error::NotImplemented));
        record("simulator.AnonymizeHistory", started, &result);
        result
    }
}
