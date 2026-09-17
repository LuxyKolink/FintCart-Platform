//! Pruebas de CONTRATO de `SimulatorService` (T109): productor ↔ consumidor.
//!
//! Atraviesan la pila real de transporte —un servidor `tonic` de verdad sobre un canal
//! en memoria, con el cliente GENERADO desde `contracts/proto`— y sustituyen
//! únicamente la persistencia. Comprueban lo que una prueba de unidad no puede: que los
//! campos del `.proto` llegan donde deben, que los errores de dominio salen con el
//! código de estado correcto y que un cambio en `contracts/` rompe aquí en lugar de en
//! producción.
//!
//! El canal es un `duplex` en memoria, el equivalente del `bufconn` que usan los
//! servicios Go: sin puertos que reservar ni carreras entre pruebas.
//!
//! Sin PostgreSQL: el repositorio es un doble que guarda las filas en un `Mutex`. Lo
//! que se verifica aquí es el CONTRATO, no el SQL —de eso se ocupa `dev/migrate` y la
//! prueba de integración de la saga—, y atarlo a una base levantada haría que la suite
//! solo corriera en las máquinas donde alguien recordó arrancarla.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use fintcart_simulator::domain::definition::{Definition, Draft, DraftOutput, InputField};
use fintcart_simulator::domain::dispatch::CALC_TYPE_USUARIO;
use fintcart_simulator::domain::error::{Error, Result};
use fintcart_simulator::domain::formula::ast::InputKind;
use fintcart_simulator::domain::seeds;
use fintcart_simulator::grpc::service::Service;
use fintcart_simulator::pb::fintcart::common::v1::PageRequest;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_client::SimulatorServiceClient;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_server::SimulatorServiceServer;
use fintcart_simulator::pb::fintcart::simulator::v1::{
    CalcType, ComputeRequest, ListHistoryRequest, UserRef,
};
use fintcart_simulator::repo::calculators::{
    CalculatorPage, CalculatorRow, Calculators, State, VersionRef,
};
use fintcart_simulator::repo::indicators::{CalendarStatus, IndicatorRow, Indicators};
use fintcart_simulator::repo::simulations::{
    HistoryPage, NewSimulation, SimulationRow, Simulations,
};
use rust_decimal::Decimal;
use tonic::transport::{Endpoint, Server, Uri};
use tonic::Code;
use uuid::Uuid;

const USER: &str = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c";

// ── doble de persistencia ───────────────────────────────────────────────────

/// Repositorio en memoria.
///
/// Guarda de verdad y devuelve de verdad: un doble que se limitara a responder `Ok`
/// dejaría pasar un `Compute` que no persiste nada, y el historial vacío solo se
/// notaría en producción.
#[derive(Default, Clone)]
struct FakeRepo {
    rows: Arc<Mutex<Vec<SimulationRow>>>,
    /// `idempotency_key` → `id` de la fila que lo reclamó primero (T176).
    keys: Arc<Mutex<HashMap<String, Uuid>>>,
    /// Fabrica el error con el que falla toda operación, si se configuró.
    ///
    /// Es una FÁBRICA y no un error guardado porque [`Error`] no es `Clone` —envuelve
    /// un `sqlx::Error`— y cada llamada necesita el suyo. Construirlo de nuevo cada vez
    /// también evita la tentación de sustituirlo por una variante «equivalente» más
    /// cómoda, que es justo lo que haría la prueba dejar de comprobar el mapeo real.
    fail: Option<Arc<dyn Fn() -> Error + Send + Sync>>,
}

impl FakeRepo {
    fn failing(make: impl Fn() -> Error + Send + Sync + 'static) -> Self {
        Self {
            rows: Arc::default(),
            keys: Arc::default(),
            fail: Some(Arc::new(make)),
        }
    }

    fn check(&self) -> Result<()> {
        match &self.fail {
            Some(make) => Err(make()),
            None => Ok(()),
        }
    }
}

#[tonic::async_trait]
impl Simulations for FakeRepo {
    async fn insert(&self, new: &NewSimulation) -> Result<SimulationRow> {
        self.check()?;

        // Espejo en memoria del `ON CONFLICT (idempotency_key) DO NOTHING` real
        // (T176): con clave repetida, devuelve la fila ya guardada en vez de crear
        // una segunda.
        if let Some(key) = &new.idempotency_key {
            if let Some(existing) = self.keys.lock().unwrap().get(key).and_then(|id| {
                self.rows
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|r| r.id == *id)
                    .cloned()
            }) {
                return Ok(existing);
            }
        }

        let row = SimulationRow {
            id: Uuid::new_v4(),
            user_id: new.user_id,
            calc_type: new.calc_type.clone(),
            currency: new.currency.clone(),
            inputs: new.inputs.clone(),
            result: new.result.clone(),
            calculator_id: new.provenance.calculator_id,
            calculator_version: new.provenance.calculator_version,
            indicators_snapshot: new.provenance.indicators.clone(),
            created_at: Utc::now(),
        };
        self.rows.lock().unwrap().push(row.clone());
        if let Some(key) = &new.idempotency_key {
            self.keys.lock().unwrap().insert(key.clone(), row.id);
        }
        Ok(row)
    }

    async fn list_by_user(
        &self,
        user_id: Uuid,
        page_size: i32,
        _page_token: &str,
    ) -> Result<HistoryPage> {
        self.check()?;
        let all: Vec<_> = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|row| row.user_id == user_id)
            .cloned()
            .collect();
        let total = i64::try_from(all.len()).unwrap_or(i64::MAX);
        let limit = if page_size <= 0 { 20 } else { page_size } as usize;

        Ok(HistoryPage {
            items: all.into_iter().take(limit).collect(),
            next_page_token: String::new(),
            total,
        })
    }

    async fn anonymize(&self, user_id: Uuid, replacement: Uuid) -> Result<u64> {
        self.check()?;
        let mut rows = self.rows.lock().unwrap();
        let mut affected = 0;
        for row in rows.iter_mut().filter(|row| row.user_id == user_id) {
            row.user_id = replacement;
            affected += 1;
        }
        Ok(affected)
    }
}

// ── arranque de la pila real ────────────────────────────────────────────────

/// Doble del repositorio de calculadoras que NO se puede usar.
///
/// Este archivo ejercita los tres RPC de simulación —`Compute`, `ListHistory` y
/// `AnonymizeHistory`— y ninguno del constructor. En lugar de un doble funcional que
/// devolviera listas vacías —con el que un `Compute` que consultara la tabla sin querer
/// pasaría inadvertido—, todas sus operaciones fallan. Así, el día que uno de estos métodos
/// se llame desde aquí, la prueba lo dice en vez de dar por bueno un resultado vacío.
struct NoCalculators;

#[tonic::async_trait]
impl Calculators for NoCalculators {
    async fn upsert(
        &self,
        _existing: Option<Uuid>,
        _owner_id: Uuid,
        _name: &str,
        _description: &str,
        _definition: &Definition,
    ) -> Result<CalculatorRow> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor de calculadoras".to_owned(),
        ))
    }

    async fn get(&self, _id: Uuid, _actor_id: Option<Uuid>) -> Result<CalculatorRow> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor de calculadoras".to_owned(),
        ))
    }

    async fn list(
        &self,
        _owner_id: Option<Uuid>,
        _only_published: bool,
        _state: Option<State>,
        _page_size: i32,
        _page_token: &str,
    ) -> Result<CalculatorPage> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor de calculadoras".to_owned(),
        ))
    }

    async fn delete(&self, _id: Uuid, _actor_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor de calculadoras".to_owned(),
        ))
    }

    async fn submit(&self, _id: Uuid, _owner_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no usan la curaduría".to_owned(),
        ))
    }

    async fn approve(&self, _id: Uuid, _coordinator_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no usan la curaduría".to_owned(),
        ))
    }

    async fn reject(&self, _id: Uuid, _coordinator_id: Uuid, _reason: &str) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no usan la curaduría".to_owned(),
        ))
    }

    async fn known_indicators(&self) -> Result<BTreeSet<String>> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor de calculadoras".to_owned(),
        ))
    }

    /// Este doble NO tiene semillas, y decirlo es más útil que fallar.
    ///
    /// `builtin_version` sí se llama desde `Compute` por el camino de compatibilidad, así
    /// que devolver un error aquí rompería todas las pruebas de `Compute`. `Ok(None)` es
    /// además una respuesta REAL —una base migrada y todavía sin sembrar—, y ejercita el
    /// camino en el que la fila se guarda sin procedencia. Que ese camino exista y esté
    /// probado importa: es el estado en el que queda una base recién migrada.
    async fn builtin_version(&self, _name: &str) -> Result<Option<VersionRef>> {
        Ok(None)
    }

    /// Y por eso mismo tampoco hay definición que ejecutar (T098).
    ///
    /// Es la misma respuesta y por la misma razón; lo que cambia es la consecuencia: sin
    /// definición, una ejecución por `calc_type` de las cuatro redirigidas **no puede
    /// calcular**, y el servicio responde que le falta la semilla. Es el escenario que D-30
    /// exige que exista y duela —antes de T098 calculaba por el código nativo y nadie se
    /// enteraba de que la base no estaba sembrada—.
    async fn builtin_by_name(&self, _name: &str) -> Result<Option<CalculatorRow>> {
        Ok(None)
    }
}

/// Doble del repositorio de indicadores que NO se puede usar.
///
/// Falla en todo a propósito: por el camino de compatibilidad —`calc_type`— no se resuelve
/// ningún indicador, porque las calculadoras nativas llevan sus constantes en el código. Si
/// `Compute` consultara indicadores por ahí, esta prueba lo diría en lugar de dejar pasar
/// una consulta que en producción costaría una ida y vuelta por simulación.
struct NoIndicators;

#[tonic::async_trait]
impl Indicators for NoIndicators {
    async fn resolve(
        &self,
        _names: &BTreeSet<String>,
        _on: chrono::NaiveDate,
    ) -> Result<HashMap<String, rust_decimal::Decimal>> {
        Err(Error::NotImplemented(
            "el camino de compatibilidad no resuelve indicadores".to_owned(),
        ))
    }

    // Mismo criterio con las tres operaciones de T104: estas pruebas no tocan indicadores, y
    // fallar hace que una llamada colada se note en vez de pasar desapercibida.
    async fn upsert(
        &self,
        _existing: Option<Uuid>,
        _name: &str,
        _value: Decimal,
        _from: chrono::NaiveDate,
        _to: chrono::NaiveDate,
        _actor_id: Uuid,
    ) -> Result<IndicatorRow> {
        Err(Error::NotImplemented(
            "el camino de compatibilidad no carga indicadores".to_owned(),
        ))
    }

    async fn list(
        &self,
        _name: Option<&str>,
        _on: Option<chrono::NaiveDate>,
    ) -> Result<Vec<IndicatorRow>> {
        Err(Error::NotImplemented(
            "el camino de compatibilidad no lista indicadores".to_owned(),
        ))
    }

    async fn calendar_status(
        &self,
        _today: chrono::NaiveDate,
        _window_days: i64,
    ) -> Result<CalendarStatus> {
        Err(Error::NotImplemented(
            "el camino de compatibilidad no consulta el calendario".to_owned(),
        ))
    }
}

// ── dobles del constructor y de los indicadores ─────────────────────────────
//
// Estos dos SÍ son funcionales, al contrario que los de arriba, porque la ejecución por
// `calculator_id` los usa de verdad: resuelve la definición en el constructor y los valores
// vigentes en el de indicadores. Un doble que fallara convertiría el camino que se quiere
// probar en un error.

/// Constructor en memoria, con las calculadoras que la prueba declare.
#[derive(Default, Clone)]
struct FakeCalculators {
    filas: Arc<Mutex<Vec<CalculatorRow>>>,
}

impl FakeCalculators {
    fn con(filas: Vec<CalculatorRow>) -> Self {
        Self {
            filas: Arc::new(Mutex::new(filas)),
        }
    }

    /// Un doble con las siete semillas reales dentro (T098).
    fn sembradas() -> Self {
        Self::con(semillas_sembradas())
    }
}

#[tonic::async_trait]
impl Calculators for FakeCalculators {
    async fn upsert(
        &self,
        _existing: Option<Uuid>,
        _owner_id: Uuid,
        _name: &str,
        _description: &str,
        _definition: &Definition,
    ) -> Result<CalculatorRow> {
        Err(Error::NotImplemented(
            "estas pruebas no editan calculadoras".to_owned(),
        ))
    }

    /// Lectura con la visibilidad de FR-051, igual que el repositorio real: una privada
    /// solo la ve su autor. Es lo que hace que la prueba de «no puedo ejecutar la privada
    /// de otro» compruebe algo.
    async fn get(&self, id: Uuid, actor_id: Option<Uuid>) -> Result<CalculatorRow> {
        self.filas
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.id == id && (row.state == State::Publicada || row.owner_id == actor_id))
            .cloned()
            .ok_or(Error::NotFound)
    }

    async fn list(
        &self,
        _owner_id: Option<Uuid>,
        _only_published: bool,
        _state: Option<State>,
        _page_size: i32,
        _page_token: &str,
    ) -> Result<CalculatorPage> {
        Err(Error::NotImplemented(
            "estas pruebas no listan calculadoras".to_owned(),
        ))
    }

    async fn delete(&self, _id: Uuid, _actor_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no borran calculadoras".to_owned(),
        ))
    }

    async fn submit(&self, _id: Uuid, _owner_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no proponen calculadoras".to_owned(),
        ))
    }

    async fn approve(&self, _id: Uuid, _coordinator_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no aprueban calculadoras".to_owned(),
        ))
    }

    async fn reject(&self, _id: Uuid, _coordinator_id: Uuid, _reason: &str) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no rechazan calculadoras".to_owned(),
        ))
    }

    async fn known_indicators(&self) -> Result<BTreeSet<String>> {
        Ok(BTreeSet::new())
    }

    async fn builtin_version(&self, name: &str) -> Result<Option<VersionRef>> {
        Ok(self.builtin(name).map(|row| VersionRef {
            id: row.id,
            version: row.version,
        }))
    }

    /// La semilla entera, que es lo que el camino de compatibilidad ejecuta desde T098.
    async fn builtin_by_name(&self, name: &str) -> Result<Option<CalculatorRow>> {
        Ok(self.builtin(name))
    }
}

impl FakeCalculators {
    /// La fila de una semilla, por nombre.
    fn builtin(&self, name: &str) -> Option<CalculatorRow> {
        self.filas
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.is_builtin && row.name == name)
            .cloned()
    }
}

/// Indicadores vigentes en memoria, con registro de lo que se le pidió.
///
/// Guarda las consultas porque hay una afirmación que solo se puede hacer mirándolas: que el
/// camino de compatibilidad NO consulta indicadores. Un doble que solo devolviera valores
/// dejaría pasar una consulta de más, y el coste de esa consulta —una ida y vuelta por
/// simulación— no se notaría hasta producción.
#[derive(Default, Clone)]
struct FakeIndicators {
    vigentes: Arc<HashMap<String, Decimal>>,
    consultas: Arc<Mutex<Vec<BTreeSet<String>>>>,
    /// Filas que devuelve `list`, y donde `upsert` apunta lo que le llegó.
    filas: Arc<Mutex<Vec<IndicatorRow>>>,
    /// Estado que devuelve `calendar_status`.
    ///
    /// Es un valor DECLARADO por la prueba y no algo que el doble calcule a partir de las
    /// filas: el cálculo —qué está sin vigencia y qué está por vencer, con la consulta de
    /// sucesor y el upper infinito— es SQL, y vive en `tests/indicators_db.rs` contra
    /// PostgreSQL. Reimplementarlo aquí probaría el doble, no el sistema.
    calendario: Arc<Mutex<CalendarStatus>>,
    /// Fuerza que `upsert` falle como si hubiera solapamiento (FR-059).
    solapa: Arc<Mutex<bool>>,
}

impl FakeIndicators {
    fn con(pares: &[(&str, &str)]) -> Self {
        Self {
            vigentes: Arc::new(
                pares
                    .iter()
                    .map(|(name, value)| {
                        (
                            (*name).to_owned(),
                            value.parse::<Decimal>().expect("valor de indicador"),
                        )
                    })
                    .collect(),
            ),
            consultas: Arc::default(),
            filas: Arc::default(),
            calendario: Arc::default(),
            solapa: Arc::default(),
        }
    }
}

#[tonic::async_trait]
impl Indicators for FakeIndicators {
    async fn resolve(
        &self,
        names: &BTreeSet<String>,
        _on: chrono::NaiveDate,
    ) -> Result<HashMap<String, Decimal>> {
        self.consultas.lock().unwrap().push(names.clone());

        // Solo los que tienen valor, como el repositorio real: un nombre sin vigencia
        // simplemente no aparece, y quien lo use se entera al evaluarlo.
        Ok(names
            .iter()
            .filter_map(|name| self.vigentes.get(name).map(|value| (name.clone(), *value)))
            .collect())
    }

    async fn upsert(
        &self,
        existing: Option<Uuid>,
        name: &str,
        value: Decimal,
        from: chrono::NaiveDate,
        to: chrono::NaiveDate,
        actor_id: Uuid,
    ) -> Result<IndicatorRow> {
        if *self.solapa.lock().unwrap() {
            return Err(Error::AlreadyExists(format!(
                "{name} ya tiene una vigencia que se solapa"
            )));
        }

        let row = IndicatorRow {
            // Una fila nueva recibe identificador, como en la base (`DEFAULT
            // gen_random_uuid()`); una edición conserva el que tenía.
            id: existing.unwrap_or_else(Uuid::new_v4),
            name: name.to_owned(),
            value,
            valid_from: from,
            valid_to: Some(to),
            registered_by: actor_id,
        };
        self.filas.lock().unwrap().push(row.clone());
        Ok(row)
    }

    async fn list(
        &self,
        name: Option<&str>,
        _on: Option<chrono::NaiveDate>,
    ) -> Result<Vec<IndicatorRow>> {
        let filas = self.filas.lock().unwrap();
        Ok(filas
            .iter()
            .filter(|row| name.is_none_or(|name| row.name == name))
            .cloned()
            .collect())
    }

    async fn calendar_status(
        &self,
        _today: chrono::NaiveDate,
        _window_days: i64,
    ) -> Result<CalendarStatus> {
        Ok(self.calendario.lock().unwrap().clone())
    }
}

/// Construye una definición analizada con una entrada `monto` y una salida `salida`.
///
/// Se analiza con [`Draft::parse`] y no se arma el AST a mano para que las pruebas
/// ejerciten el mismo camino que el constructor: una definición construida a mano podría
/// tener una forma que `parse` nunca produce, y la prueba estaría midiendo algo que no
/// existe.
fn definicion(expression: &str, indicadores: &[&str]) -> Definition {
    let catalogo: BTreeSet<String> = indicadores.iter().map(|name| (*name).to_owned()).collect();

    Draft {
        inputs: vec![InputField {
            key: "monto".to_owned(),
            label: "Monto".to_owned(),
            kind: InputKind::Monto,
            unit: "COP".to_owned(),
            min: None,
            max: None,
            default: None,
            required: true,
        }],
        validations: Vec::new(),
        outputs: vec![DraftOutput {
            key: "salida".to_owned(),
            label: "Salida".to_owned(),
            expression: expression.to_owned(),
            scale: 2,
            when: None,
        }],
    }
    .parse(&catalogo)
    .expect("la definición de la prueba tiene que analizar")
}

/// Una fila de calculadora, con los valores que la prueba no fija en su caso.
fn calculadora(
    owner_id: Option<Uuid>,
    name: &str,
    is_builtin: bool,
    state: State,
    version: i32,
    definition: Definition,
) -> CalculatorRow {
    CalculatorRow {
        id: Uuid::new_v4(),
        owner_id,
        name: name.to_owned(),
        description: String::new(),
        is_builtin,
        state,
        approved_by: None,
        rejection_reason: None,
        // La versión publicada acompaña al estado: una fila `publicada` de verdad tiene una
        // (lo impone `calculators_published_has_version`), y una privada no. Dejar el campo en
        // `None` para una publicada sería un doble que no se parece a la base, y la prueba de
        // visibilidad pasaría por el motivo equivocado.
        published_version: (state == State::Publicada).then_some(version),
        version,
        definition,
    }
}

/// Última fila persistida, que es la que el RPC acaba de escribir.
fn ultima(repo: &FakeRepo) -> SimulationRow {
    repo.rows
        .lock()
        .unwrap()
        .last()
        .cloned()
        .expect("Compute tiene que haber persistido una fila")
}

/// Levanta el servidor sobre un canal en memoria y devuelve el cliente GENERADO.
///
/// Se usa el cliente generado y no una llamada directa al servicio porque solo así se
/// ejercita la serialización protobuf: un campo renombrado en el `.proto` rompe aquí,
/// que es exactamente el fallo que estas pruebas existen para atrapar.
///
/// ## Por qué este `start` siembra desde T098
///
/// Antes servía un doble que fallaba en todo (`NoCalculators`), y bastaba: el camino de
/// compatibilidad por `calc_type` calculaba con el código nativo y de la base solo pedía una
/// versión para atribuir la fila. Desde T098 ese camino **ejecuta la definición semilla**, así
/// que un doble sin semillas no puede calcular —devuelve que le falta, que es lo correcto y lo
/// prueba [`compute_por_calc_type_sin_sembrar_dice_que_falta_la_semilla`]—.
///
/// Estas pruebas necesitan por tanto el estado NORMAL de un despliegue: las siete semillas
/// sembradas. Y son las de verdad —`seeds::compile()`, el mismo analizador que usa `dev/seed`—,
/// no una imitación con dos campos: una semilla que dejara de analizar tiene que romper aquí
/// igual que rompería en producción.
async fn start(repo: FakeRepo) -> SimulatorServiceClient<tonic::transport::Channel> {
    start_with(repo, FakeCalculators::sembradas(), NoIndicators).await
}

/// Las siete semillas, en la forma en que el repositorio las devuelve.
///
/// La versión es 1 y está publicada porque es lo que hace `dev/seed`: una semilla nace con su
/// primera versión y `calculators_published_has_version` exige que una fila publicada tenga una.
fn semillas_sembradas() -> Vec<CalculatorRow> {
    seeds::compile()
        .expect("las siete semillas tienen que analizar")
        .into_iter()
        .map(|seed| calculadora(None, seed.name, true, State::Publicada, 1, seed.definition))
        .collect()
}

/// Levanta el servidor con los TRES dobles elegidos por quien llama.
///
/// Existe además de [`start`] porque la ejecución por `calculator_id` —el camino
/// preferente de FR-043— necesita un doble de calculadoras que devuelva definiciones y uno
/// de indicadores que devuelva valores, mientras que los tres RPC de historial solo
/// necesitan que el resto FALLE. Un único `start` con dobles funcionales para todo haría
/// que una consulta de más pasara inadvertida en las pruebas que no van de eso.
async fn start_with<C, I>(
    repo: FakeRepo,
    calculators: C,
    indicators: I,
) -> SimulatorServiceClient<tonic::transport::Channel>
where
    C: Calculators,
    I: Indicators,
{
    let (client_io, server_io) = tokio::io::duplex(64 * 1024);

    tokio::spawn(async move {
        let _ = Server::builder()
            .add_service(SimulatorServiceServer::new(Service::new(
                repo,
                calculators,
                indicators,
            )))
            .serve_with_incoming(tokio_stream::once(Ok::<_, std::io::Error>(server_io)))
            .await;
    });

    // La URI es un marcador: el conector devuelve el extremo en memoria y nunca se
    // resuelve nada por red.
    let mut io = Some(client_io);
    let channel = Endpoint::try_from("http://[::]:50051")
        .unwrap()
        .connect_with_connector(tower::service_fn(move |_: Uri| {
            let io = io.take().expect("el canal solo se conecta una vez");
            async move { Ok::<_, std::io::Error>(hyper_util::rt::TokioIo::new(io)) }
        }))
        .await
        .expect("el canal en memoria debía conectar");

    SimulatorServiceClient::new(channel)
}

fn credit_request() -> ComputeRequest {
    ComputeRequest {
        user_id: USER.to_owned(),
        calc_type: CalcType::Credito as i32,
        currency: "COP".to_owned(),
        inputs: [
            ("monto", "12000000.00"),
            ("tasa_anual", "0.24"),
            ("meses", "24"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect(),
        idempotency_key: String::new(),
        // Vacío a propósito: esta prueba ejercita el camino de COMPATIBILIDAD por
        // `calc_type` (FR-043), que sigue vigente mientras las siete definiciones semilla
        // no estén sembradas. Cuando T091 implemente la ejecución por `calculator_id`,
        // convendrá una prueba hermana que use ese camino, no cambiar esta.
        calculator_id: String::new(),
    }
}

// ── Compute ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn compute_devuelve_resultados_como_decimales_canonicas() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    let resp = client.compute(credit_request()).await.unwrap().into_inner();

    assert!(Uuid::parse_str(&resp.simulation_id).is_ok());
    assert!(!resp.computed_at.is_empty());

    // Cada valor del mapa es una decimal canónica: ni notación científica, ni comas,
    // ni un número JSON disfrazado. Es la garantía del Principio VIII en la frontera.
    for (key, value) in &resp.result {
        assert!(
            fintcart_simulator::domain::decimal_str::parse(value).is_ok(),
            "{key} = {value:?} no es una decimal canónica"
        );
    }
    assert!(resp.result.contains_key("cuota_mensual"));

    // Y persistió: un `Compute` que calcula pero no guarda dejaría el historial vacío
    // sin que ninguna respuesta lo delatara (FR-022).
    assert_eq!(repo.rows.lock().unwrap().len(), 1);
}

/// Los PARÁMETROS se guardan tal como llegaron, no la versión canonicalizada.
///
/// Es lo que hace reproducible el historial: el usuario tiene que poder contrastar lo
/// que ve guardado con lo que recuerda haber escrito.
#[tokio::test]
async fn compute_persiste_los_parametros_recibidos() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    client.compute(credit_request()).await.unwrap();

    let rows = repo.rows.lock().unwrap();
    let row = rows.first().unwrap();
    assert_eq!(row.calc_type, "credito");
    assert_eq!(row.currency, "COP");
    assert_eq!(row.inputs.get("monto").unwrap(), "12000000.00");
}

/// La moneda vacía cae a COP (FR-020), porque proto3 no distingue «ausente» de «vacía».
#[tokio::test]
async fn compute_usa_cop_cuando_no_se_indica_moneda() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    let mut req = credit_request();
    req.currency = String::new();
    client.compute(req).await.unwrap();

    assert_eq!(repo.rows.lock().unwrap().first().unwrap().currency, "COP");
}

/// `CALC_TYPE_UNSPECIFIED` es el valor por defecto de proto3, así que un cliente que
/// OLVIDA el campo llega indistinguible de uno que lo puso a cero. Elegir una
/// calculadora por defecto ejecutaría un cálculo que nadie pidió y lo guardaría en el
/// historial del usuario.
#[tokio::test]
async fn compute_rechaza_un_calc_type_sin_especificar() {
    let mut client = start(FakeRepo::default()).await;

    let mut req = credit_request();
    req.calc_type = CalcType::Unspecified as i32;

    let status = client.compute(req).await.unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);
}

/// `CALC_TYPE_USUARIO` describe lo que YA PASÓ, así que en una PETICIÓN se rechaza (D-26).
///
/// No identifica ninguna calculadora: de las definidas por usuarios puede haber muchas, y la
/// única forma de decir CUÁL se quiere es `calculator_id`. Aceptarlo y resolverlo a algo
/// —a la primera, a una por defecto— ejecutaría un cálculo que nadie pidió y lo guardaría en
/// el historial del usuario, que es el mismo fallo que `CALC_TYPE_UNSPECIFIED` existe para
/// evitar.
///
/// El valor es legítimo en la RESPUESTA: ver
/// [`list_history_lee_una_simulacion_de_calculadora_de_usuario`].
#[tokio::test]
async fn compute_rechaza_un_calc_type_de_usuario() {
    let mut client = start(FakeRepo::default()).await;

    let mut req = credit_request();
    req.calc_type = CalcType::Usuario as i32;

    let status = client.compute(req).await.unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);
}

/// Una forma de romper la petición, para la tabla de casos de abajo.
type Romper = Box<dyn Fn(&mut ComputeRequest)>;

#[tokio::test]
async fn compute_rechaza_entradas_invalidas_con_invalid_argument() {
    let casos: [(&str, Romper); 4] = [
        (
            "user_id que no es UUID",
            Box::new(|req| req.user_id = "no-es-uuid".to_owned()),
        ),
        (
            "falta un parámetro obligatorio",
            Box::new(|req| {
                req.inputs.remove("monto");
            }),
        ),
        (
            "monto no canónico",
            Box::new(|req| {
                req.inputs
                    .insert("monto".to_owned(), "12.000,00".to_owned());
            }),
        ),
        (
            "moneda que no es ISO-4217",
            Box::new(|req| req.currency = "PESOS".to_owned()),
        ),
    ];

    for (nombre, romper) in casos {
        let mut client = start(FakeRepo::default()).await;
        let mut req = credit_request();
        romper(&mut req);

        let status = client.compute(req).await.unwrap_err();
        assert_eq!(
            status.code(),
            Code::InvalidArgument,
            "{nombre} debía salir como InvalidArgument"
        );
    }
}

/// Un fallo de persistencia NO revela el detalle del driver al cliente.
///
/// El mensaje saneado es parte del contrato: un error de `sqlx` lleva dentro nombres de
/// tabla y fragmentos de SQL, y devolverlos convertiría cada fallo en información sobre
/// el esquema.
///
/// El error se construye como [`Error::Storage`] con un mensaje que SÍ delataría el
/// esquema si se propagara. La distinción con [`Error::InvalidInput`] es el punto de la
/// prueba: el mensaje de un argumento inválido sí viaja al cliente —lo necesita para
/// corregirlo— y el de un fallo interno no.
#[tokio::test]
async fn compute_no_filtra_el_detalle_de_un_fallo_de_persistencia() {
    let mut client = start(FakeRepo::failing(|| {
        Error::Storage(sqlx::Error::Protocol(
            "relation \"simulations\" does not exist".to_owned(),
        ))
    }))
    .await;

    let status = client.compute(credit_request()).await.unwrap_err();
    assert_eq!(status.code(), Code::Internal);
    assert!(
        !status.message().contains("simulations"),
        "el nombre de la tabla no puede salir al cliente: {:?}",
        status.message()
    );
}

/// Y el contraste: el mensaje de una entrada inválida SÍ llega, porque sin él el
/// cliente no sabría qué corregir y solo vería «argumento inválido».
#[tokio::test]
async fn compute_si_explica_que_parametro_esta_mal() {
    let mut client = start(FakeRepo::default()).await;

    let mut req = credit_request();
    req.inputs.remove("tasa_anual");

    let status = client.compute(req).await.unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("tasa_anual"),
        "el error debe nombrar el parámetro: {:?}",
        status.message()
    );
}

/// T176 (SC-008): reproduce el reintento del motor de sagas del Orquestador —el
/// paso `simulator.compute` tuvo éxito, pero el avance no se confirmó, así que
/// `Do` se vuelve a llamar con la MISMA `idempotency_key`. Sin la clave, esto
/// habría dejado dos filas por una sola acción del usuario.
#[tokio::test]
async fn compute_con_la_misma_clave_no_duplica_el_historial() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    let mut req = credit_request();
    req.idempotency_key = "saga-77".to_owned();

    let first = client.compute(req.clone()).await.unwrap().into_inner();
    let second = client.compute(req).await.unwrap().into_inner();

    assert_eq!(
        first.simulation_id, second.simulation_id,
        "la segunda llamada debe devolver la MISMA fila, no crear otra"
    );
    assert_eq!(
        repo.rows.lock().unwrap().len(),
        1,
        "una sola fila en el historial pese a las dos llamadas"
    );
}

/// Y el contraste: sin clave, dos llamadas siguen siendo dos simulaciones — el
/// comportamiento de antes de T176 para quien no reintenta una saga.
#[tokio::test]
async fn compute_sin_clave_sigue_insertando_una_fila_por_llamada() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    client.compute(credit_request()).await.unwrap();
    client.compute(credit_request()).await.unwrap();

    assert_eq!(repo.rows.lock().unwrap().len(), 2);
}

// ── ListHistory ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn list_history_devuelve_lo_que_compute_guardo() {
    let repo = FakeRepo::default();
    let mut client = start(repo).await;

    client.compute(credit_request()).await.unwrap();

    let resp = client
        .list_history(ListHistoryRequest {
            user_id: USER.to_owned(),
            page: Some(PageRequest {
                page_size: 10,
                page_token: String::new(),
            }),
        })
        .await
        .unwrap()
        .into_inner();

    assert_eq!(resp.items.len(), 1);
    let entry = &resp.items[0];
    // El enum vuelve como enum, no como el texto de la base: es la traducción que
    // `Kind::from_db` existe para hacer.
    assert_eq!(entry.calc_type, CalcType::Credito as i32);
    assert_eq!(entry.inputs.get("monto").unwrap(), "12000000.00");
    assert!(entry.result.contains_key("cuota_mensual"));
    assert_eq!(resp.page.unwrap().total_size, 1);
}

/// El historial sabe leer una simulación de calculadora de USUARIO (D-26).
///
/// Es la mitad «respuesta» de la decisión, y la que justifica que el valor exista: `calc_type`
/// es NOT NULL, así que una fila de una calculadora de usuario TIENE que llevar algo, y lo que
/// lleva es la verdad —la definición la escribió un usuario— en vez de un nulo o de un valor
/// de los cinco tipos nativos, que serían falsos.
#[tokio::test]
async fn list_history_lee_una_simulacion_de_calculadora_de_usuario() {
    let repo = FakeRepo::default();
    repo.rows.lock().unwrap().push(SimulationRow {
        id: Uuid::new_v4(),
        user_id: Uuid::parse_str(USER).unwrap(),
        calc_type: CALC_TYPE_USUARIO.to_owned(),
        currency: "COP".to_owned(),
        inputs: HashMap::new(),
        result: HashMap::new(),
        // La fila cita su definición, que es lo que la hace explicable (FR-050).
        calculator_id: Some(Uuid::new_v4()),
        calculator_version: Some(3),
        indicators_snapshot: HashMap::from([("UVT".to_owned(), "50000".to_owned())]),
        created_at: Utc::now(),
    });
    let mut client = start(repo).await;

    let resp = client
        .list_history(ListHistoryRequest {
            user_id: USER.to_owned(),
            page: None,
        })
        .await
        .unwrap()
        .into_inner();

    assert_eq!(resp.items.len(), 1);
    assert_eq!(resp.items[0].calc_type, CalcType::Usuario as i32);
}

/// La entrada del historial se explica por sí sola (FR-058, SC-019).
///
/// Los tres campos de procedencia salen de la FILA y no de la definición vigente hoy: una
/// simulación de hace un año sigue diciendo con qué versión y con qué indicadores se
/// calculó aunque los dos hayan cambiado desde entonces. Es lo que hace auditable el
/// historial y lo que SC-019 comprueba.
#[tokio::test]
async fn el_historial_devuelve_la_procedencia_de_cada_simulacion() {
    let repo = FakeRepo::default();
    let calculator_id = Uuid::new_v4();
    repo.rows.lock().unwrap().push(SimulationRow {
        id: Uuid::new_v4(),
        user_id: Uuid::parse_str(USER).unwrap(),
        calc_type: "credito".to_owned(),
        currency: "COP".to_owned(),
        inputs: HashMap::new(),
        result: HashMap::new(),
        calculator_id: Some(calculator_id),
        calculator_version: Some(2),
        indicators_snapshot: HashMap::from([
            ("UVT".to_owned(), "50000".to_owned()),
            ("IPC".to_owned(), "0.05".to_owned()),
        ]),
        created_at: Utc::now(),
    });
    let mut client = start(repo).await;

    let resp = client
        .list_history(ListHistoryRequest {
            user_id: USER.to_owned(),
            page: None,
        })
        .await
        .unwrap()
        .into_inner();

    let entry = &resp.items[0];
    assert_eq!(entry.calculator_id, calculator_id.to_string());
    assert_eq!(entry.calculator_version, 2);
    assert_eq!(
        entry.indicators_used.get("UVT").map(String::as_str),
        Some("50000")
    );
    assert_eq!(
        entry.indicators_used.get("IPC").map(String::as_str),
        Some("0.05")
    );
}

/// Sin `page` el RPC no falla: el campo es opcional en el contrato y su ausencia
/// significa «la primera página con el tamaño por defecto».
#[tokio::test]
async fn list_history_admite_una_peticion_sin_paginacion() {
    let mut client = start(FakeRepo::default()).await;

    let resp = client
        .list_history(ListHistoryRequest {
            user_id: USER.to_owned(),
            page: None,
        })
        .await
        .unwrap()
        .into_inner();

    assert!(resp.items.is_empty());
    assert_eq!(resp.page.unwrap().total_size, 0);
}

#[tokio::test]
async fn list_history_rechaza_un_user_id_invalido() {
    let mut client = start(FakeRepo::default()).await;

    let status = client
        .list_history(ListHistoryRequest {
            user_id: "no-es-uuid".to_owned(),
            page: None,
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::InvalidArgument);
}

// ── AnonymizeHistory ────────────────────────────────────────────────────────

/// FR-030: el historial deja de estar ligado a su titular, pero NO se borra.
///
/// Los parámetros y resultados de una simulación no identifican a nadie por sí solos, y
/// conservarlos mantiene utilizable la estadística agregada.
#[tokio::test]
async fn anonymize_history_disocia_sin_borrar() {
    let repo = FakeRepo::default();
    let mut client = start(repo.clone()).await;

    client.compute(credit_request()).await.unwrap();

    let resp = client
        .anonymize_history(UserRef {
            user_id: USER.to_owned(),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(resp.success);

    let rows = repo.rows.lock().unwrap();
    assert_eq!(rows.len(), 1, "la fila sigue ahí");
    assert_ne!(
        rows[0].user_id.to_string(),
        USER,
        "el titular debe haber cambiado"
    );
    assert_eq!(rows[0].inputs.get("monto").unwrap(), "12000000.00");
}

/// Anonimizar a quien no tiene simulaciones es un ÉXITO, no un error.
///
/// Es lo que hace reintentable el paso de la saga de anonimización: un `NotFound` haría
/// fallar la saga por no tener nada que anonimizar, y la compensación desharía una
/// supresión que el usuario pidió.
#[tokio::test]
async fn anonymize_history_es_exitosa_sin_filas() {
    let mut client = start(FakeRepo::default()).await;

    let resp = client
        .anonymize_history(UserRef {
            user_id: USER.to_owned(),
        })
        .await
        .unwrap()
        .into_inner();

    assert!(resp.success);
}

// ── Compute por `calculator_id`: el camino preferente (T091) ────────────────

/// Ejecutar por definición calcula CON la definición y guarda su procedencia.
///
/// Es la comprobación central de T091: hasta ahora `calculator_id` se rechazaba, y el
/// cliente que pedía una calculadora concreta no podía obtenerla. Aquí se fija además que
/// la fila queda explicable (FR-050): con qué versión se calculó y qué indicadores usó.
#[tokio::test]
async fn compute_por_calculator_id_ejecuta_la_definicion_y_guarda_la_procedencia() {
    let repo = FakeRepo::default();
    let dueno = Uuid::parse_str(USER).unwrap();
    let calc = calculadora(
        Some(dueno),
        "mi-calculadora",
        false,
        State::Privada,
        4,
        definicion("monto * 2", &[]),
    );
    let calc_id = calc.id;
    let calculators = FakeCalculators::con(vec![calc]);
    let indicators = FakeIndicators::default();

    let mut client = start_with(repo.clone(), calculators, indicators.clone()).await;

    let resp = client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Unspecified as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "1500.00".to_owned())]),
            idempotency_key: String::new(),
            calculator_id: calc_id.to_string(),
        })
        .await
        .unwrap()
        .into_inner();

    // `3000` y no `3000.00`: la escala de la salida decide el REDONDEO, y la
    // serialización canónica recorta los ceros que no aportan precisión. Es la misma
    // convención que siguen las calculadoras nativas.
    assert_eq!(resp.result.get("salida").map(String::as_str), Some("3000"));
    assert_eq!(
        resp.calculator_version, 4,
        "la versión viaja en la respuesta"
    );

    let fila = ultima(&repo);
    assert_eq!(fila.calculator_id, Some(calc_id));
    assert_eq!(fila.calculator_version, Some(4));
    assert_eq!(
        fila.calc_type, CALC_TYPE_USUARIO,
        "una definición de un usuario se registra como 'usuario' (D-26)"
    );
    assert!(
        fila.indicators_snapshot.is_empty(),
        "una definición que no referencia indicadores no graba ninguno"
    );
    assert!(
        indicators.consultas.lock().unwrap().is_empty(),
        "sin indicadores que resolver no se consulta la tabla"
    );
}

/// Los indicadores se resuelven a la fecha de ejecución y quedan en el snapshot (FR-058).
///
/// Es la mitad del backend de SC-019: el resultado se explica por el VALOR que regía, no
/// por el nombre del indicador. Sin el snapshot, reabrir esta simulación cuando la UVT
/// cambie mostraría una cifra que ya no se puede reconstruir.
#[tokio::test]
async fn compute_por_calculator_id_resuelve_y_guarda_los_indicadores() {
    let repo = FakeRepo::default();
    let dueno = Uuid::parse_str(USER).unwrap();
    let calc = calculadora(
        Some(dueno),
        "con-uvt",
        false,
        State::Privada,
        1,
        definicion("monto * @UVT", &["UVT"]),
    );
    let calc_id = calc.id;
    let calculators = FakeCalculators::con(vec![calc]);
    let indicators = FakeIndicators::con(&[("UVT", "50000")]);

    let mut client = start_with(repo.clone(), calculators, indicators.clone()).await;

    let resp = client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Unspecified as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "2.00".to_owned())]),
            idempotency_key: String::new(),
            calculator_id: calc_id.to_string(),
        })
        .await
        .unwrap()
        .into_inner();

    assert_eq!(
        resp.result.get("salida").map(String::as_str),
        Some("100000"),
        "el cálculo usa el valor vigente, no el nombre"
    );
    assert_eq!(
        resp.indicators_used.get("UVT").map(String::as_str),
        Some("50000"),
        "y el valor usado vuelve en la respuesta (FR-058)"
    );

    let fila = ultima(&repo);
    assert_eq!(
        fila.indicators_snapshot.get("UVT").map(String::as_str),
        Some("50000")
    );

    // Se pide EXACTAMENTE lo que la definición referencia, ni más ni menos: consultar el
    // catálogo entero traería valores que la fila guardaría sin que hubieran influido.
    assert_eq!(
        indicators.consultas.lock().unwrap().as_slice(),
        [BTreeSet::from(["UVT".to_owned()])]
    );
}

/// Una semilla ejecutada por identificador NO se registra como `'usuario'` (D-29).
///
/// Es la razón de que D-29 exista: el catálogo público ofrece las siete semillas y el
/// ejecutor las pide por `calculator_id`, así que este es el camino NORMAL de las
/// calculadoras por defecto. Escribir `'usuario'` sobre ellas afirmaría que las definió un
/// usuario cuando las define el repositorio, y dejaría la columna diciendo algo falso sobre
/// siete calculadoras que existían antes que ella.
///
/// `gmf` es el caso interesante de la tabla: es una de las tres semillas que salieron de la
/// única calculadora nativa `colombia_especifica`, así que su tipo nativo no es su nombre.
#[tokio::test]
async fn una_semilla_por_identificador_se_registra_con_su_tipo_nativo() {
    let repo = FakeRepo::default();
    let semilla = calculadora(
        None,
        "gmf",
        true,
        State::Publicada,
        1,
        definicion("monto * 0.004", &[]),
    );
    let semilla_id = semilla.id;
    let calculators = FakeCalculators::con(vec![semilla]);

    let mut client = start_with(repo.clone(), calculators, FakeIndicators::default()).await;

    client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Unspecified as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "1000000.00".to_owned())]),
            idempotency_key: String::new(),
            calculator_id: semilla_id.to_string(),
        })
        .await
        .unwrap();

    let fila = ultima(&repo);
    assert_eq!(
        fila.calc_type, "colombia_especifica",
        "gmf es una de las tres semillas de la antigua calculadora colombiana"
    );
    assert_eq!(fila.calculator_id, Some(semilla_id));
}

/// Una calculadora privada ajena no se puede ejecutar (FR-051).
///
/// La visibilidad la impone el repositorio y no el servicio, y esta prueba fija que la
/// ejecución la hereda: sin ella, `calculator_id` habría sido una puerta trasera al
/// contenido privado de otro autor.
#[tokio::test]
async fn compute_rechaza_una_calculadora_privada_ajena() {
    let repo = FakeRepo::default();
    let otro = Uuid::new_v4();
    let calc = calculadora(
        Some(otro),
        "privada-ajena",
        false,
        State::Privada,
        1,
        definicion("monto", &[]),
    );
    let calc_id = calc.id;

    let mut client = start_with(
        repo.clone(),
        FakeCalculators::con(vec![calc]),
        FakeIndicators::default(),
    )
    .await;

    let status = client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Unspecified as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "1.00".to_owned())]),
            idempotency_key: String::new(),
            calculator_id: calc_id.to_string(),
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::NotFound);
    assert!(
        repo.rows.lock().unwrap().is_empty(),
        "una ejecución rechazada no deja rastro en el historial"
    );
}

// ── Compute por `calc_type`: el camino de compatibilidad ────────────────────

/// El camino de compatibilidad atribuye la fila a la semilla que reproduce (FR-050).
///
/// El contrato lo dice así —«`calc_type` … se resuelve a la definición semilla
/// correspondiente»— y sin la atribución una simulación nueva por `calc_type` quedaría sin
/// procedencia mientras las 13.493 históricas sí la tienen: dos filas idénticas explicadas
/// de dos maneras distintas, y la nueva sería la peor explicada.
///
/// El snapshot va VACÍO y es la verdad, no un hueco: `credito` lleva sus constantes en el
/// código y no lee ninguna fila de `financial_indicators`.
#[tokio::test]
async fn compute_por_calc_type_guarda_la_version_de_la_semilla() {
    let repo = FakeRepo::default();
    let semilla = calculadora(
        None,
        "credito",
        true,
        State::Publicada,
        2,
        definicion("monto", &[]),
    );
    let semilla_id = semilla.id;
    let indicators = FakeIndicators::con(&[("UVT", "50000")]);

    let mut client = start_with(
        repo.clone(),
        FakeCalculators::con(vec![semilla]),
        indicators.clone(),
    )
    .await;

    client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Credito as i32,
            currency: "COP".to_owned(),
            inputs: [
                ("monto", "12000000.00"),
                ("tasa_anual", "0.24"),
                ("meses", "24"),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect(),
            idempotency_key: String::new(),
            calculator_id: String::new(),
        })
        .await
        .unwrap();

    let fila = ultima(&repo);
    assert_eq!(fila.calc_type, "credito");
    assert_eq!(fila.calculator_id, Some(semilla_id));
    assert_eq!(fila.calculator_version, Some(2));
    assert!(
        fila.indicators_snapshot.is_empty(),
        "el cálculo nativo no lee indicadores persistidos"
    );
    assert!(
        indicators.consultas.lock().unwrap().is_empty(),
        "y por eso no se consulta la tabla de indicadores por este camino"
    );
}

/// Sobre una base SIN sembrar, una ejecución por `calc_type` dice que le falta la semilla.
///
/// Es el escenario que D-30 exigió que exista y duela. Antes de T098, en una base migrada y
/// todavía sin sembrar el Simulador calculaba igual —con el código nativo— y **nadie se
/// enteraba** de que el sembrado no había corrido; la primera señal era un catálogo vacío. Desde
/// T098 no hay respaldo: el servicio dice qué semilla le falta, y el nombre va en el mensaje
/// porque es lo único accionable (`deploy/vps/seed` siembra las siete).
///
/// Se comprueba el CÓDIGO y el NOMBRE: un 500 genérico obligaría a abrir el log para saber si el
/// problema es la semilla, la conexión o el driver, y los tres tienen arreglos distintos.
#[tokio::test]
async fn compute_por_calc_type_sin_sembrar_dice_que_falta_la_semilla() {
    let repo = FakeRepo::default();
    let mut client = start_with(repo.clone(), NoCalculators, NoIndicators).await;

    let status = client
        .compute(credit_request())
        .await
        .expect_err("sin la semilla sembrada no hay nada que ejecutar");

    assert_eq!(status.code(), Code::Internal);
    assert!(
        status.message().contains("credito"),
        "el mensaje tiene que nombrar la semilla que falta: {:?}",
        status.message()
    );
    // Y no se guarda NADA: una fila con el resultado de una ejecución que no ocurrió sería
    // historial inventado.
    assert!(
        repo.rows.lock().unwrap().is_empty(),
        "un cálculo que no ocurrió no puede dejar fila en el historial"
    );
}

/// Los dos caminos de identificación son EXCLUYENTES, y decirlo no es una formalidad.
///
/// El contrato dice «exactamente uno de los dos». Aceptar los dos obligaría a elegir uno, y
/// elegir en silencio es cómo se entrega el resultado de una calculadora que nadie pidió —
/// que es exactamente el fallo que T091 vino a corregir.
#[tokio::test]
async fn compute_rechaza_los_dos_caminos_a_la_vez() {
    let mut client = start(FakeRepo::default()).await;

    let status = client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Credito as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::new(),
            idempotency_key: String::new(),
            calculator_id: Uuid::new_v4().to_string(),
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("excluyentes"),
        "el mensaje debe explicar que hay que elegir uno: {}",
        status.message()
    );
}

/// Y tampoco vale no mandar ninguno.
#[tokio::test]
async fn compute_rechaza_una_peticion_sin_calculadora() {
    let mut client = start(FakeRepo::default()).await;

    let status = client
        .compute(ComputeRequest {
            user_id: USER.to_owned(),
            calc_type: CalcType::Unspecified as i32,
            currency: "COP".to_owned(),
            inputs: HashMap::new(),
            idempotency_key: String::new(),
            calculator_id: String::new(),
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("calculator_id"),
        "el mensaje debe decir cuál de los dos campos falta: {}",
        status.message()
    );
}
