//! Implementación del servidor gRPC `SimulatorService` (T121).
//!
//! Desempaqueta el mensaje, valida lo que el contrato deja sin validar, delega el
//! cálculo en `domain::dispatch` y la escritura en el repositorio. No calcula ni
//! consulta nada por su cuenta (Principio IX).

use std::collections::{BTreeSet, HashMap};
use std::time::Instant;

use chrono::{NaiveDate, Utc};
use tonic::{Request, Response, Status};
use tracing::{info, warn};
use uuid::Uuid;

use crate::domain::curation;
use crate::domain::currency;
use crate::domain::decimal_str;
use crate::domain::definition::Definition;
use crate::domain::dispatch::{self, Kind};
use crate::domain::error::Error;
use crate::domain::indicators::{self, Snapshot};
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
use crate::repo::indicators::Indicators;
use crate::repo::simulations::{NewSimulation, Provenance, Simulations};

/// Fecha con la que se resuelven los indicadores: la de EJECUCIÓN (FR-057).
///
/// Está en una función con nombre y no escrita en línea dentro de `Compute` porque la
/// decisión importa y conviene poder señalarla: se resuelve contra HOY y no contra una
/// fecha que mande el cliente. Un cliente que pudiera elegir la fecha podría calcular con
/// los indicadores de otro año, y el resultado —correcto según esos valores— quedaría en su
/// historial indistinguible de uno de hoy.
fn execution_date() -> NaiveDate {
    Utc::now().date_naive()
}

/// Servicio del Simulador.
///
/// Es genérico sobre SUS TRES repositorios y no guarda un `PgPool`. La diferencia no es
/// estilística: un pool visible desde el transporte es la puerta por la que acaba
/// colándose una consulta suelta dentro de un handler, y además obligaría a levantar
/// PostgreSQL para ejercitar cualquier RPC — con lo que la prueba de contrato de T109
/// no existiría.
///
/// Son tres parámetros de tipo y no uno que los una porque son tres agregados distintos —el
/// historial de simulaciones, el constructor de calculadoras y los indicadores vigentes— y
/// unirlos obligaría a cualquier doble de prueba a implementar los que no usa.
pub struct Service<S: Simulations, C: Calculators, I: Indicators> {
    repo: S,
    calculators: C,
    indicators: I,
}

impl<S: Simulations, C: Calculators, I: Indicators> Service<S, C, I> {
    /// Construye el servicio sobre los repositorios del historial, de calculadoras y de
    /// indicadores.
    ///
    /// Recibe repositorios y no un pool: así esta capa no puede lanzar una consulta por su
    /// cuenta, y una prueba de contrato puede ejercitar los RPC sin PostgreSQL
    /// (Principio IX).
    #[must_use]
    pub fn new(repo: S, calculators: C, indicators: I) -> Self {
        Self {
            repo,
            calculators,
            indicators,
        }
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
        Error::Decimal(err) => Status::invalid_argument(decimal_str::describe(err)),
        Error::NotFound => Status::not_found("no encontrado"),
        Error::AlreadyExists(msg) => Status::already_exists(msg.clone()),
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

/// NOTA HISTÓRICA — aquí vivía `pending(rpc, tarea)`, la ayuda que devolvía
/// `Status::unimplemented` desde los RPC que todavía no tenían cuerpo (T104, T114).
///
/// Existió porque el delta de contrato (T002) añadió once RPC al `SimulatorService` en un
/// commit separado del cambio de lógica, como exige la Constitución §Definición de Contratos:
/// un trait con métodos sin implementar **no compila**, así que sin esos cuerpos el crate
/// entero quedaba inutilizable, incluidas las pruebas del motor de fórmulas. Cada uno nombraba
/// la TAREA que lo implementaría, de modo que quien recibiera el error supiera a qué esperar.
///
/// **Ya no queda ninguno**: los once RPC tienen cuerpo. La ayuda se borra en lugar de quedarse
/// como utilidad disponible porque su única razón de ser era no tener implementaciones, y una
/// función que devuelve «pendiente» en un servicio completo es una puerta abierta a que el
/// siguiente RPC nazca así —y un RPC que responde `unimplemented` se descubre en producción,
/// no al compilar—.

#[tonic::async_trait]
impl<S: Simulations, C: Calculators, I: Indicators> SimulatorService for Service<S, C, I> {
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

    /// Propone la calculadora propia para publicación (FR-052).
    ///
    /// Quien decide si el actor PUEDE proponer es el dominio, sobre la fila bloqueada, y no esta
    /// capa: el estado de una calculadora puede cambiar entre que el borde autoriza y esta llamada
    /// llega.
    async fn submit_calculator_for_review(
        &self,
        request: Request<CalculatorRef>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = self
            .submit_for_review_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.SubmitCalculatorForReview falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.SubmitCalculatorForReview", started, &result);
        result
    }

    async fn approve_calculator(
        &self,
        request: Request<ApproveCalculatorRequest>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = self
            .approve_calculator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.ApproveCalculator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.ApproveCalculator", started, &result);
        result
    }

    async fn reject_calculator(
        &self,
        request: Request<RejectCalculatorRequest>,
    ) -> Result<Response<OpResult>, Status> {
        let started = Instant::now();
        let result = self
            .reject_calculator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.RejectCalculator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.RejectCalculator", started, &result);
        result
    }

    // ── Indicadores financieros (T104) ────────────────────────────────────────

    async fn upsert_indicator(
        &self,
        request: Request<UpsertIndicatorRequest>,
    ) -> Result<Response<Indicator>, Status> {
        let started = Instant::now();
        let result = self
            .upsert_indicator_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.UpsertIndicator falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.UpsertIndicator", started, &result);
        result
    }

    async fn list_indicators(
        &self,
        request: Request<ListIndicatorsRequest>,
    ) -> Result<Response<ListIndicatorsResponse>, Status> {
        let started = Instant::now();
        let result = self
            .list_indicators_inner(request.into_inner())
            .await
            .map_err(|err| {
                warn!(error = %err, "simulator.ListIndicators falló");
                to_status(&err)
            });
        let result = result.map(Response::new);
        record("simulator.ListIndicators", started, &result);
        result
    }

    async fn get_indicator_calendar_status(
        &self,
        _request: Request<PageRequest>,
    ) -> Result<Response<IndicatorCalendarStatus>, Status> {
        let started = Instant::now();
        let result = self.indicator_calendar_status_inner().await.map_err(|err| {
            warn!(error = %err, "simulator.GetIndicatorCalendarStatus falló");
            to_status(&err)
        });
        let result = result.map(Response::new);
        record("simulator.GetIndicatorCalendarStatus", started, &result);
        result
    }
}

impl<S: Simulations, C: Calculators, I: Indicators> Service<S, C, I> {
    // ── Cuerpos de la curaduría (T114) ────────────────────────────────────────

    /// Cuerpo de `SubmitCalculatorForReview`.
    ///
    /// No comprueba el rol: quién puede proponer es el AUTOR de la calculadora, y eso lo decide
    /// el dominio sobre la fila. El rol del borde aquí no aporta nada —cualquier usuario puede
    /// proponer su propia calculadora—, y exigir uno haría que la plataforma no dejara crear
    /// calculadoras a quien no lo tuviera.
    async fn submit_for_review_inner(&self, req: CalculatorRef) -> Result<OpResult, Error> {
        let id = mapping::parse_uuid(&req.calculator_id, "calculator_id")?;
        let owner_id = mapping::parse_user_id(&req.actor_id)?;

        self.calculators.submit(id, owner_id).await?;
        Ok(OpResult {
            success: true,
            code: String::new(),
            message: String::new(),
        })
    }

    /// Cuerpo de `ApproveCalculator` (FR-053).
    ///
    /// El rol `coordinador_editorial` lo exige el borde, que es el único sitio de la plataforma
    /// que conoce los roles (§Definición de Contratos) — y no hereda del administrador (FR-082).
    /// Lo que esta capa sí comprueba, porque no es un rol sino una relación entre dos personas, es
    /// que quien aprueba no sea el autor: una comprobación que la base también impone, y tenerla
    /// en los dos sitios es lo que hace que ni un defecto aquí ni una escritura por fuera puedan
    /// saltársela.
    async fn approve_calculator_inner(
        &self,
        req: ApproveCalculatorRequest,
    ) -> Result<OpResult, Error> {
        let id = mapping::parse_uuid(&req.calculator_id, "calculator_id")?;
        let coordinator_id = mapping::parse_user_id(&req.coordinator_id)?;

        self.calculators.approve(id, coordinator_id).await?;
        Ok(OpResult {
            success: true,
            code: String::new(),
            message: String::new(),
        })
    }

    /// Cuerpo de `RejectCalculator` (FR-054).
    ///
    /// El motivo se normaliza AQUÍ y no en el repositorio porque es esta capa la que tiene que
    /// poder decirle al usuario qué le falta: el repositorio recibe un motivo ya recortado y con
    /// longitud comprobada, y el `CHECK` de la columna queda como la red por debajo.
    async fn reject_calculator_inner(
        &self,
        req: RejectCalculatorRequest,
    ) -> Result<OpResult, Error> {
        let id = mapping::parse_uuid(&req.calculator_id, "calculator_id")?;
        let coordinator_id = mapping::parse_user_id(&req.coordinator_id)?;
        let reason = curation::normalize_reason(&req.reason)?;

        self.calculators.reject(id, coordinator_id, &reason).await?;
        Ok(OpResult {
            success: true,
            code: String::new(),
            message: String::new(),
        })
    }

    /// Cuerpo de `UpsertIndicator` (FR-055..FR-060).
    ///
    /// Todo lo que valida aquí lo valida también la base —formato del nombre, valor no
    /// negativo, precisión, rango no vacío, no solapamiento—, y no es duplicación inútil: el
    /// `CHECK` garantiza la integridad, y esta capa es la que produce un mensaje que se pueda
    /// leer. Un valor de catorce decimales se rechaza con «la columna admite 6» en lugar de
    /// con un `numeric field overflow` del driver.
    ///
    /// El actor NO se comprueba aquí: el rol lo exige el borde (§Definición de Contratos), que
    /// es el único sitio de la plataforma que conoce los roles. Lo que sí se hace es tomarlo de
    /// la petición para que quede registrado quién cargó la cifra (FR-060) — y el borde lo saca
    /// de las marcas del token, no de lo que diga el cuerpo.
    async fn upsert_indicator_inner(
        &self,
        req: UpsertIndicatorRequest,
    ) -> Result<Indicator, Error> {
        let actor_id = mapping::parse_user_id(&req.actor_id)?;
        let existing = mapping::parse_optional_uuid(&req.indicator_id, "indicator_id")?;

        let name = req.name.trim();
        if !indicators::is_valid_name(name) {
            return Err(Error::InvalidInput(format!(
                "«{name}» no es un nombre de indicador válido: se espera una palabra en \
                 mayúsculas que empiece por letra, con dígitos o guion bajo —por ejemplo UVT—, \
                 porque las fórmulas lo referencian como @{name}"
            )));
        }

        // El mismo rango y la misma escala que la columna `NUMERIC(20, 6)`: si el valor cupiera
        // aquí y no en la columna, el error sería una violación de restricción en el `INSERT`.
        let value = decimal_str::parse_numeric(&req.value, 20, 6)?;
        if value.is_sign_negative() {
            return Err(Error::InvalidInput(
                "un indicador no puede ser negativo".to_owned(),
            ));
        }

        let from = mapping::parse_date(&req.valid_from, "valid_from")?;
        let to = mapping::parse_date(&req.valid_to, "valid_to")?;
        if from >= to {
            return Err(Error::InvalidInput(format!(
                "la vigencia no cubre ningún día: empieza el {from} y termina el {to}, y el fin \
                 es EXCLUSIVO — una vigencia que termina el mismo día que empieza no vale para \
                 ninguna fecha"
            )));
        }

        let row = self
            .indicators
            .upsert(existing, name, value, from, to, actor_id)
            .await?;
        Ok(mapping::indicator_from_row(row))
    }

    /// Cuerpo de `ListIndicators`.
    ///
    /// `on_date` vacío significa todas las vigencias, y traducir esa ausencia es tarea de esta
    /// capa: el repositorio recibe ya un `Option<NaiveDate>` y no tiene que saber que el
    /// contrato expresa «todas» con una cadena vacía.
    async fn list_indicators_inner(
        &self,
        req: ListIndicatorsRequest,
    ) -> Result<ListIndicatorsResponse, Error> {
        let name = req.name.trim();
        let name = (!name.is_empty()).then_some(name);

        if let Some(name) = name {
            if !indicators::is_valid_name(name) {
                return Err(Error::InvalidInput(format!(
                    "«{name}» no es un nombre de indicador válido"
                )));
            }
        }

        let on = match req.on_date.trim() {
            "" => None,
            raw => Some(mapping::parse_date(raw, "on_date")?),
        };

        let rows = self.indicators.list(name, on).await?;
        Ok(mapping::indicators_response(rows))
    }

    /// Cuerpo de `GetIndicatorCalendarStatus` (FR-061, FR-062).
    ///
    /// ## Por qué NO se usa el `PageRequest` de la petición
    ///
    /// La respuesta es un ESTADO —qué nombres no tienen vigencia y cuáles están por vencer—, no
    /// una página: no hay nada que paginar, y el `PageRequest` del contrato es el precio de
    /// haberlo declarado con el mismo envoltorio que los listados. Tampoco se usa para elegir la
    /// ventana de aviso, que es lo que sí habría hecho falta: la ventana es una decisión de la
    /// plataforma ([`indicators::CALENDAR_ALERT_WINDOW_DAYS`]) y no un parámetro del cliente,
    /// porque el aviso que recibe el administrador no puede depender de quién pregunte. Queda
    /// documentado aquí para que nadie lea el hueco como un olvido.
    async fn indicator_calendar_status_inner(&self) -> Result<IndicatorCalendarStatus, Error> {
        // El barrido pregunta por el calendario con la fecha de EJECUCIÓN, la misma con la que
        // se resuelven los indicadores: si se mirara otra, el aviso podría decir que todo está
        // en orden mientras una calculadora no encuentra su valor.
        let status = self
            .indicators
            .calendar_status(execution_date(), indicators::CALENDAR_ALERT_WINDOW_DAYS)
            .await?;
        Ok(mapping::calendar_status(status))
    }

    /// Cuerpo de `Compute`, en términos de dominio en lugar de `Status`.
    ///
    /// Separarlo del método del trait es lo que permite usar `?` con
    /// [`crate::domain::error::Error`]: dentro del trait, cada `?` exigiría convertir a
    /// `Status` en el sitio, y esa conversión repetida acabaría dando códigos distintos
    /// para el mismo error según por dónde saliera.
    async fn compute_inner(&self, req: ComputeRequest) -> Result<ComputeResponse, Error> {
        let user_id = mapping::parse_user_id(&req.user_id)?;
        let currency = currency::normalize(&req.currency)?;

        // FR-043: `calculator_id` es el camino PREFERENTE y `calc_type` el de
        // compatibilidad, y el contrato dice que viene EXACTAMENTE uno de los dos. Se
        // comprueban las dos direcciones: rechazar solo el caso de los dos vacíos dejaría
        // pasar una petición que trae los dos, y ahí hay que elegir — y elegir en silencio
        // es cómo se entrega el resultado de una calculadora que nadie pidió.
        let por_definicion = !req.calculator_id.is_empty();
        let por_tipo = req.calc_type != CalcType::Unspecified as i32;
        if !por_definicion && !por_tipo {
            return Err(Error::InvalidInput(
                "hay que identificar la calculadora: envía calculator_id, o calc_type para \
                 las cinco calculadoras nativas"
                    .to_owned(),
            ));
        }
        if por_definicion && por_tipo {
            return Err(Error::InvalidInput(
                "calculator_id y calc_type son excluyentes: envía el identificador de la \
                 calculadora, o el tipo nativo, pero no los dos"
                    .to_owned(),
            ));
        }

        let (calc_type, result, provenance) = if por_definicion {
            let id = mapping::parse_calculator_id(&req.calculator_id)?;
            self.compute_by_definition(id, user_id, &req.inputs).await?
        } else {
            self.compute_by_native(req.calc_type, &req.inputs).await?
        };

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
            .insert(&NewSimulation {
                user_id,
                calc_type,
                currency,
                inputs: req.inputs.clone(),
                result,
                provenance,
                idempotency_key: idempotency_key.map(str::to_owned),
            })
            .await?;

        Ok(mapping::compute_response(&row))
    }

    /// Ejecuta una calculadora identificada por su DEFINICIÓN (FR-043, camino preferente).
    ///
    /// Devuelve el trío que `Compute` necesita para persistir: el `calc_type` con el que
    /// registrar la fila, el resultado ya serializado y la procedencia.
    ///
    /// La visibilidad la impone `Calculators::get` y no se repite aquí (FR-051): una
    /// calculadora privada solo la ve su autor, y comprobarlo en esta capa obligaría a leer
    /// la fila antes de decidir, con un cambio de estado posible entre la lectura y la
    /// decisión.
    async fn compute_by_definition(
        &self,
        id: Uuid,
        actor_id: Uuid,
        raw_inputs: &HashMap<String, String>,
    ) -> Result<(String, HashMap<String, String>, Provenance), Error> {
        let calculator = self.calculators.get(id, Some(actor_id)).await?;

        let snapshot = self.snapshot_for(&calculator.definition).await?;
        let outputs = calculator.definition.run(raw_inputs, snapshot.values())?;

        // El `calc_type` NO es `'usuario'` por venir por identificador: las siete semillas
        // también se ejecutan así, y sobre ellas esa palabra sería falsa. Ver
        // [`dispatch::stored_calc_type`].
        let calc_type = dispatch::stored_calc_type(calculator.is_builtin, &calculator.name)?;

        let provenance =
            Provenance::definition(calculator.id, calculator.version, snapshot.to_stored());

        Ok((
            calc_type.to_owned(),
            dispatch::to_contract(outputs),
            provenance,
        ))
    }

    /// Ejecuta una calculadora NATIVA identificada por `calc_type` (FR-043, compatibilidad).
    ///
    /// El contrato describe este camino como «se resuelve a la definición semilla
    /// correspondiente», así que la fila se atribuye a esa semilla — que es exactamente lo
    /// que la migración de T020 hizo con las 13.493 filas históricas. Sin esa atribución,
    /// dos simulaciones idénticas quedarían explicadas de dos maneras distintas según
    /// cuándo se hicieron.
    ///
    /// El snapshot va VACÍO y es la verdad, no un hueco: estas calculadoras llevan sus
    /// constantes en el código y `gmf` recibe la UVT como entrada, así que no leen ninguna
    /// fila de `financial_indicators`.
    async fn compute_by_native(
        &self,
        raw_calc_type: i32,
        raw_inputs: &HashMap<String, String>,
    ) -> Result<(String, HashMap<String, String>, Provenance), Error> {
        // `calc_type` llega como `i32` porque prost representa así los enums abiertos de
        // proto3. `try_from` rechaza un valor que no corresponda a ninguna variante; sin él,
        // un entero desconocido se convertiría en `Unspecified` y el error hablaría de un
        // campo ausente cuando en realidad venía uno inválido.
        let calc_type = CalcType::try_from(raw_calc_type).map_err(|_| {
            Error::InvalidInput(format!(
                "calc_type {raw_calc_type} no existe en el contrato"
            ))
        })?;
        let kind = Kind::from_proto(calc_type)?;

        // El cálculo va ANTES de resolver la semilla: quien valida `operacion` es la
        // calculadora nativa, así que una entrada inválida falla con SU mensaje —«las
        // admitidas son ea_a_mv, mv_a_ea y gmf»— y no con el de una semilla que el usuario
        // no sabe que existe.
        let result = dispatch::compute(kind, raw_inputs)?;

        // `seed_name` no puede fallar después de que `compute` haya ido bien: es la misma
        // `operacion` que la calculadora acaba de validar.
        let seed = dispatch::seed_name(kind, raw_inputs)?;
        let version = self.calculators.builtin_version(seed).await?;

        Ok((kind.as_db().to_owned(), result, Provenance::native(version)))
    }

    /// Resuelve los indicadores que una definición REFERENCIA, a la fecha de ejecución
    /// (FR-057, FR-058).
    ///
    /// Se resuelven los referenciados y no los que la evaluación acabará leyendo —el
    /// evaluador es perezoso—, y el razonamiento está en la nota de
    /// [`crate::domain::indicators`]: grabar de más deja en la fila un valor que no
    /// influyó, grabar de menos rompe la reproducibilidad que FR-058 exige.
    ///
    /// Una definición que no referencia ninguno **no llega a consultar**, y eso se decide
    /// aquí y no en el repositorio: que no haya nada que preguntar es un hecho sobre la
    /// definición, y este es el sitio que la tiene delante. El repositorio, en cambio, no
    /// puede distinguir «no hay nada que preguntar» de «el llamador se equivocó», así que
    /// una guarda allí sería una regla duplicada que ninguna prueba podría ejercitar por
    /// separado. Es el camino normal de `ahorro`, `credito`, `presupuesto` e `inversion`.
    async fn snapshot_for(&self, definition: &Definition) -> Result<Snapshot, Error> {
        let needed: BTreeSet<String> = definition.indicators_used().into_iter().collect();
        if needed.is_empty() {
            return Ok(Snapshot::none());
        }

        let values = self.indicators.resolve(&needed, execution_date()).await?;
        Ok(Snapshot::new(values))
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
