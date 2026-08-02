//! Implementación del servidor gRPC `SimulatorService` (T121).
//!
//! Desempaqueta el mensaje, valida lo que el contrato deja sin validar, delega el
//! cálculo en `domain::dispatch` y la escritura en el repositorio. No calcula ni
//! consulta nada por su cuenta (Principio IX).

use std::time::Instant;

use tonic::{Request, Response, Status};
use tracing::{info, warn};

use crate::domain::currency;
use crate::domain::dispatch::{self, Kind};
use crate::domain::error::Error;
use crate::grpc::mapping;
use crate::observability;
use crate::pb::fintcart::common::v1::OpResult;
use crate::pb::fintcart::simulator::v1::simulator_service_server::{
    SimulatorService, SimulatorServiceServer,
};
use crate::pb::fintcart::simulator::v1::{
    CalcType, ComputeRequest, ComputeResponse, ListHistoryRequest, ListHistoryResponse, UserRef,
};
use crate::repo::simulations::Simulations;

/// Servicio del Simulador.
///
/// Es genérico sobre el repositorio y no guarda un `PgPool`. La diferencia no es
/// estilística: un pool visible desde el transporte es la puerta por la que acaba
/// colándose una consulta suelta dentro de un handler, y además obligaría a levantar
/// PostgreSQL para ejercitar cualquier RPC — con lo que la prueba de contrato de T109
/// no existiría.
pub struct Service<R: Simulations> {
    repo: R,
}

impl<R: Simulations> Service<R> {
    /// Construye el servicio sobre el repositorio del historial.
    ///
    /// Recibe el repositorio y no un pool: así esta capa no puede lanzar una consulta
    /// por su cuenta, y una prueba de contrato puede ejercitar los tres RPC sin
    /// PostgreSQL (Principio IX).
    #[must_use]
    pub fn new(repo: R) -> Self {
        Self { repo }
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
impl<R: Simulations> SimulatorService for Service<R> {
    /// Ejecuta una simulación y persiste el historial (FR-019..FR-022).
    ///
    /// El cálculo va ANTES de abrir la transacción. Es deliberado: elevar a la
    /// potencia del plazo y redondear no necesita la base, y hacerlo dentro
    /// mantendría una conexión del pool ocupada durante todo el cómputo. Además, una
    /// entrada inválida se rechaza sin haber tocado PostgreSQL.
    async fn compute(
        &self,
        request: Request<ComputeRequest>,
    ) -> Result<Response<ComputeResponse>, Status> {
        let started = Instant::now();
        let result = self
            .compute_inner(request.into_inner())
            .await
            .map_err(|err| {
                // La causa completa va al log; al cliente solo el mensaje saneado.
                warn!(error = %err, "simulator.Compute falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.Compute", started, &result);
        result
    }

    /// Historial de simulaciones por usuario (FR-022).
    async fn list_history(
        &self,
        request: Request<ListHistoryRequest>,
    ) -> Result<Response<ListHistoryResponse>, Status> {
        let started = Instant::now();
        let result = self
            .list_history_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.ListHistory falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.ListHistory", started, &result);
        result
    }

    /// Saga de anonimización (FR-030): disocia la PII del historial.
    async fn anonymize_history(
        &self,
        request: Request<UserRef>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = self
            .anonymize_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.AnonymizeHistory falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.AnonymizeHistory", started, &result);
        result
    }
}

impl<R: Simulations> Service<R> {
    /// Cuerpo de `Compute`, en términos de dominio en lugar de `Status`.
    ///
    /// Separarlo del método del trait es lo que permite usar `?` con
    /// [`crate::domain::error::Error`]: dentro del trait, cada `?` exigiría convertir a
    /// `Status` en el sitio, y esa conversión repetida acabaría dando códigos distintos
    /// para el mismo error según por dónde saliera.
    async fn compute_inner(&self, req: ComputeRequest) -> Result<ComputeResponse, Error> {
        let user_id = mapping::parse_user_id(&req.user_id)?;
        // `calc_type` llega como `i32` porque prost representa así los enums abiertos
        // de proto3. `try_from` rechaza un valor que no corresponda a ninguna variante;
        // sin él, un entero desconocido se convertiría en `Unspecified` y el error
        // hablaría de un campo ausente cuando en realidad venía uno inválido.
        let calc_type = CalcType::try_from(req.calc_type).map_err(|_| {
            Error::InvalidInput(format!(
                "calc_type {} no existe en el contrato",
                req.calc_type
            ))
        })?;
        let kind = Kind::from_proto(calc_type)?;
        let currency = currency::normalize(&req.currency)?;

        let result = dispatch::compute(kind, &req.inputs)?;

        // Los parámetros se guardan TAL COMO LLEGARON, sin normalizar. Es lo que hace
        // reproducible el historial: si se guardara la versión canonicalizada, el
        // usuario vería en su historial una cifra distinta de la que escribió y no
        // podría contrastarla con lo que recordaba haber pedido.
        let row = self
            .repo
            .insert(user_id, kind.as_db(), &currency, &req.inputs, &result)
            .await?;

        Ok(mapping::compute_response(&row))
    }

    /// Cuerpo de `ListHistory`.
    async fn list_history_inner(
        &self,
        req: ListHistoryRequest,
    ) -> Result<ListHistoryResponse, Error> {
        let user_id = mapping::parse_user_id(&req.user_id)?;
        let (page_size, page_token) = req
            .page
            .map_or((0, String::new()), |page| (page.page_size, page.page_token));

        let page = self
            .repo
            .list_by_user(user_id, page_size, &page_token)
            .await?;
        mapping::history_response(page)
    }

    /// Cuerpo de `AnonymizeHistory`.
    ///
    /// El reemplazo se genera aquí y no en el SQL para que la operación siga siendo un
    /// solo `UPDATE`: un `gen_random_uuid()` en la consulta daría un identificador
    /// DISTINTO por fila, y el historial de una persona quedaría troceado en tantos
    /// titulares anónimos como simulaciones tuviera — inservible incluso para
    /// estadística agregada.
    async fn anonymize_inner(&self, req: UserRef) -> Result<OpResult, Error> {
        let user_id = mapping::parse_user_id(&req.user_id)?;
        let replacement = uuid::Uuid::new_v4();

        let affected = self.repo.anonymize(user_id, replacement).await?;

        info!(
            rows = affected,
            "historial de simulaciones disociado (FR-030)"
        );
        // Éxito aunque no hubiera filas: un usuario sin simulaciones ya cumple el
        // estado buscado, y devolver un error haría fallar la saga de anonimización
        // por no tener nada que anonimizar.
        Ok(OpResult {
            success: true,
            code: String::new(),
            message: String::new(),
        })
    }
}
