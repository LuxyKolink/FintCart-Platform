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

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use fintcart_simulator::domain::error::{Error, Result};
use fintcart_simulator::grpc::service::Service;
use fintcart_simulator::pb::fintcart::common::v1::PageRequest;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_client::SimulatorServiceClient;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_server::SimulatorServiceServer;
use fintcart_simulator::pb::fintcart::simulator::v1::{
    CalcType, ComputeRequest, ListHistoryRequest, UserRef,
};
use fintcart_simulator::repo::simulations::{HistoryPage, SimulationRow, Simulations};
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
    async fn insert(
        &self,
        user_id: Uuid,
        calc_type: &str,
        currency: &str,
        inputs: &HashMap<String, String>,
        result: &HashMap<String, String>,
    ) -> Result<SimulationRow> {
        self.check()?;
        let row = SimulationRow {
            id: Uuid::new_v4(),
            user_id,
            calc_type: calc_type.to_owned(),
            currency: currency.to_owned(),
            inputs: inputs.clone(),
            result: result.clone(),
            created_at: Utc::now(),
        };
        self.rows.lock().unwrap().push(row.clone());
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

/// Levanta el servidor sobre un canal en memoria y devuelve el cliente GENERADO.
///
/// Se usa el cliente generado y no una llamada directa al servicio porque solo así se
/// ejercita la serialización protobuf: un campo renombrado en el `.proto` rompe aquí,
/// que es exactamente el fallo que estas pruebas existen para atrapar.
async fn start(repo: FakeRepo) -> SimulatorServiceClient<tonic::transport::Channel> {
    let (client_io, server_io) = tokio::io::duplex(64 * 1024);

    tokio::spawn(async move {
        let _ = Server::builder()
            .add_service(SimulatorServiceServer::new(Service::new(repo)))
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
