//! Implementación del servidor gRPC `SimulatorService` (T121).
//!
//! Desempaqueta el mensaje, valida lo que el contrato deja sin validar, delega el
//! cálculo en `domain::dispatch` y la escritura en el repositorio. No calcula ni
//! consulta nada por su cuenta (Principio IX).

use std::time::Instant;

use tonic::{Request, Response, Status};
use tracing::{info, warn};

use crate::domain::currency;
use crate::domain::definition::Definition;
use crate::domain::dispatch::{self, Kind};
use crate::domain::error::Error;
use crate::grpc::mapping;
use crate::observability;
use crate::pb::fintcart::common::v1::{OpResult, PageRequest};
use crate::pb::fintcart::simulator::v1::simulator_service_server::{
    SimulatorService, SimulatorServiceServer,
};
use crate::pb::fintcart::simulator::v1::{
    ApproveCalculatorRequest, CalcType, Calculator, CalculatorDefinition, CalculatorRef,
    ComputeRequest, ComputeResponse, DefinitionError, Indicator, IndicatorCalendarStatus,
    ListCalculatorsRequest, ListCalculatorsResponse, ListHistoryRequest, ListHistoryResponse,
    ListIndicatorsRequest, ListIndicatorsResponse, RejectCalculatorRequest,
    UpsertCalculatorRequest, UpsertIndicatorRequest, UserRef, ValidateDefinitionRequest,
    ValidateDefinitionResponse,
};
use crate::repo::calculators::Calculators;
use crate::repo::simulations::Simulations;

/// Servicio del Simulador.
///
/// Es genérico sobre SUS DOS repositorios y no guarda un `PgPool`. La diferencia no es
/// estilística: un pool visible desde el transporte es la puerta por la que acaba
/// colándose una consulta suelta dentro de un handler, y además obligaría a levantar
/// PostgreSQL para ejercitar cualquier RPC — con lo que la prueba de contrato de T109
/// no existiría.
///
/// Son dos parámetros de tipo y no uno que los una porque son dos agregados distintos —el
/// historial de simulaciones y el constructor de calculadoras— y unirlos obligaría a
/// cualquier doble de prueba a implementar el que no usa.
pub struct Service<S: Simulations, C: Calculators> {
    repo: S,
    calculators: C,
}

impl<S: Simulations, C: Calculators> Service<S, C> {
    /// Construye el servicio sobre los repositorios del historial y de calculadoras.
    ///
    /// Recibe repositorios y no un pool: así esta capa no puede lanzar una consulta por su
    /// cuenta, y una prueba de contrato puede ejercitar los RPC sin PostgreSQL
    /// (Principio IX).
    #[must_use]
    pub fn new(repo: S, calculators: C) -> Self {
        Self { repo, calculators }
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
        Error::NotImplemented(what) => Status::unimplemented(what.clone()),
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

/// Respuesta uniforme de un RPC todavía sin implementar.
///
/// ## Por qué existen estos cuerpos si no implementan nada
///
/// El delta de contrato (T002) añadió once RPC al `SimulatorService` en un commit
/// separado del cambio de lógica, como exige la Constitución §Definición de Contratos. Un
/// trait con métodos sin implementar **no compila**, así que sin estos cuerpos el crate
/// entero queda inutilizable: no se pueden ni ejecutar las pruebas del motor de fórmulas,
/// que no dependen de ninguno de los once. Devolver `unimplemented` es lo que mantiene el
/// árbol compilable y las pruebas corribles mientras llegan sus tareas.
///
/// ## Lo que estos cuerpos NO son
///
/// No son una implementación parcial ni un valor por defecto silencioso:
/// `Status::unimplemented` es un error explícito que un cliente ve como tal. Cada uno
/// nombra la TAREA que lo implementa, así que quien reciba el error en una prueba de
/// integración sabe a qué esperar en vez de averiguar por qué el RPC «no hace nada».
///
/// Van escritos uno a uno y no generados con una macro: `#[tonic::async_trait]` es un
/// atributo, y los atributos se expanden **antes** que las macros declarativas, así que
/// los métodos que produjera una macro llegarían al transformador de `async_trait` ya
/// tarde y sin la lifetime de la firma del trait.
///
/// Devuelve el [`Status`] en lugar del `Result` ya construido por un motivo que el
/// compilador señala: `Status` ocupa 176 bytes, y una función SÍNCRONA que lo devuelva como
/// variante de error dispara `clippy::result_large_err`. Los métodos del trait no lo
/// disparan porque `async_trait` los envuelve en un futuro, pero esta ayuda no. Envolver
/// aquí y devolver el valor se lleva la decisión al sitio que sí puede tomarla.
fn pending(rpc: &str, task: &str, started: Instant) -> Status {
    let status = Status::unimplemented(format!("pendiente de {task}"));
    // `Response<()>` porque `record` solo mira el CÓDIGO de estado; el tipo del cuerpo le
    // da igual y nombrarlo obligaría a esta ayuda a ser genérica otra vez.
    record(rpc, started, &Err::<Response<()>, Status>(status.clone()));
    status
}

#[tonic::async_trait]
impl<S: Simulations, C: Calculators> SimulatorService for Service<S, C> {
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

    // ── Constructor de calculadoras (T090) ────────────────────────────────────

    async fn upsert_calculator(
        &self,
        request: Request<UpsertCalculatorRequest>,
    ) -> Result<Response<Calculator>, Status> {
        let started = Instant::now();
        let result = self
            .upsert_calculator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.UpsertCalculator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.UpsertCalculator", started, &result);
        result
    }

    async fn get_calculator(
        &self,
        request: Request<CalculatorRef>,
    ) -> Result<Response<Calculator>, Status> {
        let started = Instant::now();
        let result = self
            .get_calculator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.GetCalculator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.GetCalculator", started, &result);
        result
    }

    async fn list_calculators(
        &self,
        request: Request<ListCalculatorsRequest>,
    ) -> Result<Response<ListCalculatorsResponse>, Status> {
        let started = Instant::now();
        let result = self
            .list_calculators_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.ListCalculators falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.ListCalculators", started, &result);
        result
    }

    async fn delete_calculator(
        &self,
        request: Request<CalculatorRef>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = self
            .delete_calculator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.DeleteCalculator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.DeleteCalculator", started, &result);
        result
    }

    async fn validate_definition(
        &self,
        request: Request<ValidateDefinitionRequest>,
    ) -> Result<Response<ValidateDefinitionResponse>, Status> {
        let started = Instant::now();
        let result = self
            .validate_definition_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.ValidateDefinition falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.ValidateDefinition", started, &result);
        result
    }

    // ── Curaduría (T114) ──────────────────────────────────────────────────────

    async fn submit_calculator_for_review(
        &self,
        _request: Request<CalculatorRef>,
    ) -> Result<Response<OpResult>, Status> {
        Err(pending(
            "simulator.SubmitCalculatorForReview",
            "T114",
            Instant::now(),
        ))
    }

    async fn approve_calculator(
        &self,
        _request: Request<ApproveCalculatorRequest>,
    ) -> Result<Response<OpResult>, Status> {
        Err(pending(
            "simulator.ApproveCalculator",
            "T114",
            Instant::now(),
        ))
    }

    async fn reject_calculator(
        &self,
        _request: Request<RejectCalculatorRequest>,
    ) -> Result<Response<OpResult>, Status> {
        Err(pending(
            "simulator.RejectCalculator",
            "T114",
            Instant::now(),
        ))
    }

    // ── Indicadores financieros (T104) ────────────────────────────────────────

    async fn upsert_indicator(
        &self,
        _request: Request<UpsertIndicatorRequest>,
    ) -> Result<Response<Indicator>, Status> {
        Err(pending("simulator.UpsertIndicator", "T104", Instant::now()))
    }

    async fn list_indicators(
        &self,
        _request: Request<ListIndicatorsRequest>,
    ) -> Result<Response<ListIndicatorsResponse>, Status> {
        Err(pending("simulator.ListIndicators", "T104", Instant::now()))
    }

    async fn get_indicator_calendar_status(
        &self,
        _request: Request<PageRequest>,
    ) -> Result<Response<IndicatorCalendarStatus>, Status> {
        Err(pending(
            "simulator.GetIndicatorCalendarStatus",
            "T104",
            Instant::now(),
        ))
    }
}

impl<S: Simulations, C: Calculators> Service<S, C> {
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
        // FR-043: `calculator_id` es el camino PREFERENTE y `calc_type` el de
        // compatibilidad, pero el primero todavía no se resuelve —T091 resuelve y ejecuta la
        // definición, y T103 registra su procedencia en el historial—. Se rechaza de forma
        // EXPLÍCITA en vez de continuar por `calc_type`, que es lo que hacía hasta ahora: un
        // cliente que pidió una calculadora concreta recibía el resultado de OTRA sin que
        // nada se lo dijera, y ese silencio es peor que un error.
        if !req.calculator_id.is_empty() {
            return Err(Error::NotImplemented(
                "la ejecución por calculator_id llega con T091; mientras tanto, usa calc_type"
                    .to_owned(),
            ));
        }

        let kind = Kind::from_proto(calc_type)?;
        let currency = currency::normalize(&req.currency)?;

        let result = dispatch::compute(kind, &req.inputs)?;

        // Los parámetros se guardan TAL COMO LLEGARON, sin normalizar. Es lo que hace
        // reproducible el historial: si se guardara la versión canonicalizada, el
        // usuario vería en su historial una cifra distinta de la que escribió y no
        // podría contrastarla con lo que recordaba haber pedido.
        // proto3 no distingue «ausente» de «vacío»: una clave vacía es tratada como
        // «sin clave» (cada llamada inserta), igual que hace `currency::normalize` con
        // la moneda por defecto más arriba.
        let idempotency_key =
            (!req.idempotency_key.is_empty()).then_some(req.idempotency_key.as_str());

        let row = self
            .repo
            .insert(
                user_id,
                kind.as_db(),
                &currency,
                &req.inputs,
                &result,
                idempotency_key,
            )
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

    // ── Cuerpos del constructor de calculadoras (T090) ────────────────────────

    /// Cuerpo de `UpsertCalculator`.
    ///
    /// La definición se analiza ANTES de tocar la base. Es lo que hace que un error de
    /// fórmula no deje rastro: si se insertara primero y se validara después, una
    /// calculadora a medio escribir quedaría en la tabla y el autor tendría que borrarla.
    async fn upsert_calculator_inner(
        &self,
        req: UpsertCalculatorRequest,
    ) -> Result<Calculator, Error> {
        let owner_id = mapping::parse_user_id(&req.owner_id)?;

        // El nombre es lo único que el `CHECK length(btrim(name)) > 0` de la tabla rechaza, y
        // se comprueba aquí para que el error lo lea el autor en vez de aparecer como una
        // violación de restricción del driver.
        let name = req.name.trim();
        if name.is_empty() {
            return Err(Error::InvalidInput(
                "la calculadora necesita un nombre".to_owned(),
            ));
        }

        let existing = mapping::parse_optional_uuid(&req.calculator_id, "calculator_id")?;
        let (definition, errors) = self.analyze(req.definition).await?;
        let Some(definition) = definition else {
            return Err(Error::InvalidInput(describe_definition_errors(&errors)));
        };

        let row = self
            .calculators
            .upsert(existing, owner_id, name, &req.description, &definition)
            .await?;
        Ok(mapping::calculator_from_row(row))
    }

    /// Cuerpo de `GetCalculator`.
    async fn get_calculator_inner(&self, req: CalculatorRef) -> Result<Calculator, Error> {
        let id = mapping::parse_uuid(&req.calculator_id, "calculator_id")?;
        let actor_id = mapping::parse_optional_uuid(&req.actor_id, "actor_id")?;

        let row = self.calculators.get(id, actor_id).await?;
        Ok(mapping::calculator_from_row(row))
    }

    /// Cuerpo de `ListCalculators`.
    ///
    /// FR-051 prohíbe un listado global sin filtrar, y quien lo impide es esta capa: es una
    /// regla de la PETICIÓN —qué se está preguntando— y no de la tabla, así que no tiene
    /// sitio en el repositorio. Un listado sin filtro devolvería las calculadoras privadas
    /// de todo el mundo.
    async fn list_calculators_inner(
        &self,
        req: ListCalculatorsRequest,
    ) -> Result<ListCalculatorsResponse, Error> {
        let owner_id = mapping::parse_optional_uuid(&req.owner_id, "owner_id")?;
        if owner_id.is_none() && !req.only_published {
            return Err(Error::InvalidInput(
                "hay que indicar owner_id o only_published: no existe un listado sin filtrar"
                    .to_owned(),
            ));
        }

        let (page_size, page_token) = req
            .page
            .map_or((0, String::new()), |page| (page.page_size, page.page_token));

        let page = self
            .calculators
            .list(owner_id, req.only_published, page_size, &page_token)
            .await?;
        Ok(mapping::calculators_response(page))
    }

    /// Cuerpo de `DeleteCalculator`.
    async fn delete_calculator_inner(&self, req: CalculatorRef) -> Result<OpResult, Error> {
        let id = mapping::parse_uuid(&req.calculator_id, "calculator_id")?;
        let actor_id = mapping::parse_user_id(&req.actor_id)?;

        self.calculators.delete(id, actor_id).await?;
        Ok(OpResult {
            success: true,
            code: String::new(),
            message: String::new(),
        })
    }

    /// Cuerpo de `ValidateDefinition`.
    ///
    /// No guarda nada: alimenta el aviso en vivo del constructor mientras el autor escribe.
    async fn validate_definition_inner(
        &self,
        req: ValidateDefinitionRequest,
    ) -> Result<ValidateDefinitionResponse, Error> {
        let (_, errors) = self.analyze(req.definition).await?;
        Ok(ValidateDefinitionResponse {
            valid: errors.is_empty(),
            errors,
        })
    }

    /// Analiza una definición del contrato y devuelve el resultado y TODOS sus problemas.
    ///
    /// Es la ruta compartida por `ValidateDefinition` y `UpsertCalculator`, y compartirla es
    /// el punto: el contrato promete que los dos informan de lo mismo, y dos copias podrían
    /// divergir justo en la comprobación que alguien añadiera después.
    ///
    /// Devuelve `Ok((None, errores))` cuando la definición no es válida. No es un error del
    /// RPC: `ValidateDefinition` tiene que responder `valid: false` con la lista, y tratarlo
    /// como `Err` obligaría a deshacer el `Status` para volver a armar los errores.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta la definición; [`Error::Storage`] si falla la lectura
    /// del catálogo de indicadores.
    async fn analyze(
        &self,
        definition: Option<CalculatorDefinition>,
    ) -> Result<(Option<Definition>, Vec<DefinitionError>), Error> {
        let definition = definition.ok_or_else(|| {
            Error::InvalidInput("falta la definición de la calculadora".to_owned())
        })?;

        // El catálogo de indicadores se lee ANTES de analizar porque el analizador no
        // consulta nada por diseño (Principio IX): recibe los nombres ya resueltos.
        let indicators = self.calculators.known_indicators().await?;

        let (draft, mut errors) = mapping::draft_from_proto(definition);
        let parsed = match draft.parse(&indicators) {
            Ok(parsed) => Some(parsed),
            Err(issues) => {
                errors.extend(mapping::issues_to_proto(issues));
                None
            }
        };

        Ok((parsed, errors))
    }
}

/// Compone un mensaje legible a partir de los problemas de una definición.
///
/// `UpsertCalculator` devuelve un `Calculator`, que no tiene dónde llevar una lista de
/// errores, así que el detalle viaja en el mensaje del `Status`. El 422 con `errors[]`
/// estructurados lo produce la ruta del Gateway llamando antes a `ValidateDefinition`
/// (T096), que sí tiene un mensaje de respuesta donde ponerlos.
fn describe_definition_errors(errors: &[DefinitionError]) -> String {
    let details = errors
        .iter()
        .map(|error| format!("{}: {}", error.location, error.message))
        .collect::<Vec<_>>()
        .join("; ");
    format!("la definición no es válida — {details}")
}
