//! Pruebas de los tres RPC de indicadores (T104; FR-055…FR-062) sobre la pila real de
//! transporte.
//!
//! Atraviesan un servidor `tonic` de verdad sobre un canal en memoria, con el cliente
//! generado desde `contracts/proto`, y sustituyen únicamente la persistencia — igual que
//! `calculators.rs` y `contract.rs`. Lo que se verifica es el CONTRATO: que lo que llega se
//! interprete como debe antes de tocar la base, que lo que sale tenga la forma declarada, y
//! que cada rechazo salga con su código.
//!
//! ## Qué NO cubre este archivo
//!
//! El SQL. El doble de aquí acepta lo que le den, así que no puede delatar un `$1`/`$2`
//! intercambiado, ni que la restricción de exclusión esté puesta, ni que el cálculo de «sin
//! vigencia» y «por vencer» sea el correcto. De eso se ocupa `tests/indicators_db.rs`, que
//! corre contra PostgreSQL y está ignorado por defecto por el motivo que explica su módulo.
//!
//! ## Por qué se prueban los rechazos con tanto detalle
//!
//! Un indicador mal cargado no rompe nada de inmediato: se guarda, y el fallo aparece semanas
//! después como un resultado equivocado o como «falta el UVT» delante de un lector. Las
//! validaciones de esta capa existen para que el error se vea en el momento de cargar el dato,
//! que es cuando alguien puede arreglarlo, así que cada una se comprueba por separado y
//! mirando que el repositorio NO haya recibido nada.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use chrono::NaiveDate;
use fintcart_simulator::domain::error::{Error, Result};
use fintcart_simulator::domain::indicators::CALENDAR_ALERT_WINDOW_DAYS;
use fintcart_simulator::grpc::service::Service;
use fintcart_simulator::pb::fintcart::common::v1::PageRequest;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_client::SimulatorServiceClient;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_server::SimulatorServiceServer;
use fintcart_simulator::pb::fintcart::simulator::v1::{
    ListIndicatorsRequest, UpsertIndicatorRequest,
};
use fintcart_simulator::repo::calculators::{
    CalculatorPage, CalculatorRow, Calculators, State, VersionRef,
};
use fintcart_simulator::repo::indicators::{CalendarStatus, Expiring, IndicatorRow, Indicators};
use fintcart_simulator::repo::simulations::{
    HistoryPage, NewSimulation, SimulationRow, Simulations,
};
use rust_decimal::Decimal;
use tonic::transport::{Endpoint, Server, Uri};
use tonic::Code;
use uuid::Uuid;

/// Un administrador cualquiera: identificador opaco, sin relación con ninguna cuenta real.
const ADMIN: &str = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

// ── dobles ──────────────────────────────────────────────────────────────────

/// Cómo ve la prueba lo que el servicio pasó al repositorio.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Llamada {
    /// Alta o edición que llegó, si llegó.
    alta: Option<IndicatorRow>,
    /// Filtros con los que se pidió el listado.
    filtros: Option<(Option<String>, Option<NaiveDate>)>,
    /// Ventana con la que se pidió el estado del calendario.
    ventana: Option<i64>,
}

/// Repositorio de indicadores en memoria, funcional y con memoria de lo que recibe.
///
/// Es funcional —y no un doble que falla— porque estos RPC tienen que producir una respuesta:
/// con un doble que fallara, lo único que se probaría es que el error se propaga.
#[derive(Default, Clone)]
struct FakeIndicators {
    filas: Arc<Mutex<Vec<IndicatorRow>>>,
    calendario: Arc<Mutex<CalendarStatus>>,
    llamadas: Arc<Mutex<Vec<Llamada>>>,
    /// Fuerza el solapamiento, que es lo que en la realidad decide el `EXCLUDE` de la base.
    solapa: Arc<Mutex<bool>>,
}

impl FakeIndicators {
    fn con_filas(filas: Vec<IndicatorRow>) -> Self {
        Self {
            filas: Arc::new(Mutex::new(filas)),
            ..Self::default()
        }
    }

    fn con_calendario(calendario: CalendarStatus) -> Self {
        Self {
            calendario: Arc::new(Mutex::new(calendario)),
            ..Self::default()
        }
    }

    fn llamadas(&self) -> Vec<Llamada> {
        self.llamadas.lock().unwrap().clone()
    }

    fn filas(&self) -> Vec<IndicatorRow> {
        self.filas.lock().unwrap().clone()
    }
}

#[tonic::async_trait]
impl Indicators for FakeIndicators {
    async fn resolve(
        &self,
        _names: &BTreeSet<String>,
        _on: NaiveDate,
    ) -> Result<HashMap<String, Decimal>> {
        Err(Error::NotImplemented(
            "estas pruebas no ejecutan definiciones".to_owned(),
        ))
    }

    async fn upsert(
        &self,
        existing: Option<Uuid>,
        name: &str,
        value: Decimal,
        from: NaiveDate,
        to: NaiveDate,
        actor_id: Uuid,
    ) -> Result<IndicatorRow> {
        if *self.solapa.lock().unwrap() {
            return Err(Error::AlreadyExists(format!(
                "{name} ya tiene una vigencia que se solapa"
            )));
        }

        let row = IndicatorRow {
            // Una fila nueva recibe identificador, como en la base (`DEFAULT gen_random_uuid()`);
            // una edición conserva el que tenía.
            id: existing.unwrap_or_else(Uuid::new_v4),
            name: name.to_owned(),
            value,
            valid_from: from,
            valid_to: Some(to),
            registered_by: actor_id,
        };

        self.filas.lock().unwrap().push(row.clone());
        self.llamadas.lock().unwrap().push(Llamada {
            alta: Some(row.clone()),
            ..Llamada::default()
        });
        Ok(row)
    }

    async fn list(&self, name: Option<&str>, on: Option<NaiveDate>) -> Result<Vec<IndicatorRow>> {
        self.llamadas.lock().unwrap().push(Llamada {
            filtros: Some((name.map(str::to_owned), on)),
            ..Llamada::default()
        });

        Ok(self
            .filas
            .lock()
            .unwrap()
            .iter()
            .filter(|row| name.is_none_or(|name| row.name == name))
            .cloned()
            .collect())
    }

    async fn calendar_status(&self, _today: NaiveDate, window_days: i64) -> Result<CalendarStatus> {
        self.llamadas.lock().unwrap().push(Llamada {
            ventana: Some(window_days),
            ..Llamada::default()
        });
        Ok(self.calendario.lock().unwrap().clone())
    }
}

/// Historial que NO se puede usar: estos RPC no lo tocan.
struct NoHistorial;

#[tonic::async_trait]
impl Simulations for NoHistorial {
    async fn insert(&self, _new: &NewSimulation) -> Result<SimulationRow> {
        Err(Error::NotImplemented(
            "estas pruebas no simulan nada".to_owned(),
        ))
    }

    async fn list_by_user(&self, _u: Uuid, _p: i32, _t: &str) -> Result<HistoryPage> {
        Err(Error::NotImplemented(
            "estas pruebas no simulan nada".to_owned(),
        ))
    }

    async fn anonymize(&self, _u: Uuid, _r: Uuid) -> Result<u64> {
        Err(Error::NotImplemented(
            "estas pruebas no simulan nada".to_owned(),
        ))
    }
}

/// Constructor que NO se puede usar: estos RPC tampoco lo tocan.
struct NoConstructor;

#[tonic::async_trait]
impl Calculators for NoConstructor {
    async fn upsert(
        &self,
        _existing: Option<Uuid>,
        _owner_id: Uuid,
        _name: &str,
        _description: &str,
        _definition: &fintcart_simulator::domain::definition::Definition,
    ) -> Result<CalculatorRow> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor".to_owned(),
        ))
    }

    async fn get(&self, _id: Uuid, _actor_id: Option<Uuid>) -> Result<CalculatorRow> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor".to_owned(),
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
            "estas pruebas no usan el constructor".to_owned(),
        ))
    }

    async fn delete(&self, _id: Uuid, _actor_id: Uuid) -> Result<()> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor".to_owned(),
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
            "estas pruebas no analizan fórmulas".to_owned(),
        ))
    }

    async fn builtin_version(&self, _name: &str) -> Result<Option<VersionRef>> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el constructor".to_owned(),
        ))
    }
}

async fn start(indicators: FakeIndicators) -> SimulatorServiceClient<tonic::transport::Channel> {
    let (client_io, server_io) = tokio::io::duplex(64 * 1024);

    tokio::spawn(async move {
        let _ = Server::builder()
            .add_service(SimulatorServiceServer::new(Service::new(
                NoHistorial,
                NoConstructor,
                indicators,
            )))
            .serve_with_incoming(tokio_stream::once(Ok::<_, std::io::Error>(server_io)))
            .await;
    });

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

// ── peticiones de apoyo ─────────────────────────────────────────────────────

/// Alta del UVT para 2026, que es el caso que usa casi toda la prueba.
fn alta_del_uvt() -> UpsertIndicatorRequest {
    UpsertIndicatorRequest {
        indicator_id: String::new(),
        name: "UVT".to_owned(),
        value: "50000".to_owned(),
        valid_from: "2026-01-01".to_owned(),
        valid_to: "2027-01-01".to_owned(),
        actor_id: ADMIN.to_owned(),
    }
}

fn vigencia(name: &str, value: &str, from: &str, to: &str) -> IndicatorRow {
    IndicatorRow {
        id: Uuid::new_v4(),
        name: name.to_owned(),
        value: value.parse().expect("valor decimal"),
        valid_from: from.parse().expect("fecha"),
        valid_to: Some(to.parse().expect("fecha")),
        registered_by: Uuid::parse_str(ADMIN).unwrap(),
    }
}

// ── alta ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn el_alta_devuelve_la_vigencia_registrada() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let indicador = cliente
        .upsert_indicator(alta_del_uvt())
        .await
        .expect("el alta debía aceptarse")
        .into_inner();

    assert_eq!(indicador.name, "UVT");
    assert_eq!(indicador.value, "50000");
    assert_eq!(indicador.valid_from, "2026-01-01");
    assert_eq!(indicador.valid_to, "2027-01-01");
    assert_eq!(indicador.registered_by, ADMIN);
    assert!(
        !indicador.indicator_id.is_empty(),
        "el identificador de la fila nueva sale de la base y tiene que venir"
    );
    assert!(
        Uuid::parse_str(&indicador.indicator_id).is_ok(),
        "y tiene que ser un UUID, no cualquier texto"
    );

    // Y lo que llegó al repositorio es el valor YA interpretado, no el texto: si aquí llegara
    // la cadena, la conversión habría ocurrido en el sitio equivocado (o en dos sitios).
    let llamada = fake.llamadas().pop().expect("el alta tenía que llegar");
    let alta = llamada.alta.expect("la llamada era un alta");
    assert_eq!(alta.value, Decimal::new(50000, 0));
    assert_eq!(
        alta.valid_from,
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()
    );
    assert_eq!(
        alta.registered_by,
        Uuid::parse_str(ADMIN).unwrap(),
        "quien carga la cifra queda registrado (FR-060)"
    );
}

#[tokio::test]
async fn el_valor_sale_como_cadena_canonica() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // Los ceros a la derecha son la forma en que `NUMERIC(20,6)` devuelve la cifra, y el valor
    // que viaja es el mismo: lo que se normaliza es la FORMA. Si esto devolviera `50000.000000`
    // el contrato tendría dos representaciones para el mismo número.
    let indicador = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            value: "50000.000000".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect("el alta debía aceptarse")
        .into_inner();

    assert_eq!(indicador.value, "50000");
}

#[tokio::test]
async fn las_tasas_conservan_sus_decimales() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let indicador = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            name: "TASA_USURA".to_owned(),
            value: "0.250000".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect("el alta debía aceptarse")
        .into_inner();

    assert_eq!(indicador.value, "0.25", "sin ceros a la derecha");
}

#[tokio::test]
async fn los_espacios_alrededor_del_nombre_no_lo_invalidan() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // Un espacio de más al pegar desde una hoja de cálculo es lo más común del mundo, y el
    // nombre que se guarda es el mismo: rechazarlo obligaría a adivinar qué carácter sobra.
    let indicador = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            name: "  UVT  ".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect("el alta debía aceptarse")
        .into_inner();

    assert_eq!(indicador.name, "UVT");
}

#[tokio::test]
async fn un_nombre_que_ninguna_formula_podria_referenciar_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    for nombre in ["uvt", "Uvt", "_UVT", "1UVT", "UVT-usura", ""] {
        let status = cliente
            .upsert_indicator(UpsertIndicatorRequest {
                name: nombre.to_owned(),
                ..alta_del_uvt()
            })
            .await
            .expect_err(&format!("{nombre:?} no es un nombre admisible"));

        assert_eq!(status.code(), Code::InvalidArgument, "con {nombre:?}");
        assert!(
            status.message().contains("mayúsculas"),
            "el mensaje tiene que decir qué forma se espera: {}",
            status.message()
        );
    }

    assert!(
        fake.filas().is_empty(),
        "una entrada inválida no debe llegar al repositorio"
    );
}

#[tokio::test]
async fn un_valor_negativo_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // La columna tiene `financial_indicators_value_non_negative`, así que esto lo rechazaría la
    // base; el mensaje es lo que cambia: «un indicador no puede ser negativo» en lugar de una
    // violación de restricción.
    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            value: "-1".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("un valor negativo no es una cifra válida");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(status.message().contains("negativo"));
    assert!(fake.filas().is_empty());
}

#[tokio::test]
async fn un_valor_con_mas_decimales_que_la_columna_se_rechaza_nombrando_la_columna() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            value: "0.1234567".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("siete decimales no caben en NUMERIC(20,6)");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("decimales"),
        "el mensaje tiene que explicar la escala: {}",
        status.message()
    );
}

#[tokio::test]
async fn una_vigencia_que_no_cubre_ningun_dia_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // El fin es EXCLUSIVO, así que empezar y terminar el mismo día deja fuera ese día. Sin esta
    // comprobación, el `CHECK financial_indicators_validity_half_open` lo rechazaría igual pero
    // el mensaje hablaría de un rango vacío y de la convención `[inicio, fin)`.
    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            valid_from: "2026-01-01".to_owned(),
            valid_to: "2026-01-01".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("una vigencia de cero días no es una vigencia");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("EXCLUSIVO"),
        "el mensaje tiene que explicar la convención: {}",
        status.message()
    );
}

#[tokio::test]
async fn una_vigencia_al_reves_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            valid_from: "2027-01-01".to_owned(),
            valid_to: "2026-01-01".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("el fin no puede ir antes que el principio");

    assert_eq!(status.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn una_fecha_mal_formada_se_rechaza_nombrando_el_campo() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    for (campo, valor) in [("valid_from", "01/01/2026"), ("valid_to", "2026-1-1")] {
        let mut peticion = alta_del_uvt();
        if campo == "valid_from" {
            peticion.valid_from = valor.to_owned();
        } else {
            peticion.valid_to = valor.to_owned();
        }

        let status = cliente
            .upsert_indicator(peticion)
            .await
            .expect_err("una fecha que no es ISO-8601 no se interpreta");

        assert_eq!(status.code(), Code::InvalidArgument);
        assert!(
            status.message().contains(campo),
            "el mensaje tiene que decir qué campo venía mal: {}",
            status.message()
        );
    }
}

#[tokio::test]
async fn un_alta_sin_administrador_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // `registered_by` es `NOT NULL` en la tabla, así que sin actor no hay fila que escribir. El
    // borde saca este identificador de las marcas del token (nunca del cuerpo), pero el RPC
    // tiene que rechazarlo por sí mismo: es el único que decide si la fila dice quién cargó la
    // cifra (FR-060).
    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            actor_id: String::new(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("un alta sin actor no es admisible");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(fake.filas().is_empty());
}

#[tokio::test]
async fn un_identificador_mal_formado_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    // `indicator_id` presente significa «corrige esa vigencia». Un identificador que no es un
    // UUID se rechaza aquí y no en el `WHERE id = $1`, donde el error del driver hablaría de
    // tipos de PostgreSQL en lugar del campo que venía mal. Que un identificador BIEN formado
    // pero inexistente devuelva `NOT_FOUND` es cosa del SQL y se comprueba en
    // `indicators_db.rs`: el doble de aquí no distingue alta de edición.
    let status = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            indicator_id: "el-uvt-de-2026".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect_err("eso no es un UUID");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("indicator_id"),
        "{}",
        status.message()
    );
    assert!(fake.filas().is_empty());
}

#[tokio::test]
async fn el_solapamiento_sale_como_ya_existe() {
    let fake = FakeIndicators {
        solapa: Arc::new(Mutex::new(true)),
        ..FakeIndicators::default()
    };
    let mut cliente = start(fake).await;

    // `ALREADY_EXISTS` y no `INVALID_ARGUMENT`: la cifra puede estar perfectamente bien y el
    // problema ser que ese año ya está cargado. Quien atiende el error tiene que poder
    // distinguir «corrige el dato» de «mira lo que ya hay».
    let status = cliente
        .upsert_indicator(alta_del_uvt())
        .await
        .expect_err("dos vigencias del mismo año se pisan");

    assert_eq!(status.code(), Code::AlreadyExists);
    assert!(status.message().contains("solapa"), "{}", status.message());
}

#[tokio::test]
async fn una_edicion_conserva_el_identificador_de_la_fila() {
    let fila = vigencia("UVT", "50000", "2026-01-01", "2027-01-01");
    let fake = FakeIndicators::con_filas(vec![fila.clone()]);
    let mut cliente = start(fake.clone()).await;

    let indicador = cliente
        .upsert_indicator(UpsertIndicatorRequest {
            indicator_id: fila.id.to_string(),
            value: "52000".to_owned(),
            ..alta_del_uvt()
        })
        .await
        .expect("corregir el valor de una vigencia es legítimo")
        .into_inner();

    assert_eq!(
        indicador.indicator_id,
        fila.id.to_string(),
        "editar no crea otra vigencia"
    );
    assert_eq!(indicador.value, "52000");
}

// ── listado ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn listar_sin_filtros_devuelve_todas_las_vigencias() {
    let fake = FakeIndicators::con_filas(vec![
        vigencia("UVT", "50000", "2026-01-01", "2027-01-01"),
        vigencia("UVT", "47065", "2025-01-01", "2026-01-01"),
        vigencia("IPC", "0.05", "2026-01-01", "2027-01-01"),
    ]);
    let mut cliente = start(fake.clone()).await;

    let respuesta = cliente
        .list_indicators(ListIndicatorsRequest {
            name: String::new(),
            on_date: String::new(),
        })
        .await
        .expect("listar no puede fallar")
        .into_inner();

    assert_eq!(respuesta.items.len(), 3);
    // El orden lo fija el repositorio (`ORDER BY name, lower(validity)`) y aquí llega tal cual:
    // un listado que se reordena por el camino haría que la pantalla cambiara de orden según el
    // plan de la consulta.
    assert_eq!(respuesta.items[0].name, "UVT");
    assert_eq!(respuesta.items[0].valid_from, "2026-01-01");

    let filtros = fake.llamadas()[0].filtros.clone().expect("el filtro llegó");
    assert_eq!(
        filtros,
        (None, None),
        "la cadena vacía significa «sin filtro», no un nombre vacío"
    );
}

#[tokio::test]
async fn listar_por_fecha_pide_la_vigencia_de_ese_dia() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    cliente
        .list_indicators(ListIndicatorsRequest {
            name: "UVT".to_owned(),
            on_date: "2026-03-15".to_owned(),
        })
        .await
        .expect("listar no puede fallar");

    let filtros = fake.llamadas()[0].filtros.clone().expect("el filtro llegó");
    assert_eq!(filtros.0.as_deref(), Some("UVT"));
    assert_eq!(
        filtros.1,
        Some(NaiveDate::from_ymd_opt(2026, 3, 15).unwrap()),
        "la fecha viaja interpretada, y el repositorio decide qué vigencia rige ese día"
    );
}

#[tokio::test]
async fn listar_con_un_nombre_imposible_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let status = cliente
        .list_indicators(ListIndicatorsRequest {
            name: "uvt".to_owned(),
            on_date: String::new(),
        })
        .await
        .expect_err("un nombre que no puede existir no se consulta");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(fake.llamadas().is_empty(), "no se llegó a consultar");
}

#[tokio::test]
async fn listar_con_una_fecha_imposible_se_rechaza() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    let status = cliente
        .list_indicators(ListIndicatorsRequest {
            name: String::new(),
            on_date: "el martes".to_owned(),
        })
        .await
        .expect_err("eso no es una fecha");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(status.message().contains("on_date"), "{}", status.message());
}

// ── estado del calendario ───────────────────────────────────────────────────

#[tokio::test]
async fn el_estado_del_calendario_traduce_las_dos_listas() {
    let fake = FakeIndicators::con_calendario(CalendarStatus {
        missing: vec!["SMMLV".to_owned(), "UVT".to_owned()],
        expiring: vec![Expiring {
            name: "IPC".to_owned(),
            valid_to: NaiveDate::from_ymd_opt(2027, 1, 1).unwrap(),
            days_remaining: 12,
        }],
    });
    let mut cliente = start(fake).await;

    let estado = cliente
        .get_indicator_calendar_status(PageRequest::default())
        .await
        .expect("consultar el estado no puede fallar")
        .into_inner();

    assert_eq!(estado.missing_names, vec!["SMMLV", "UVT"]);
    assert_eq!(estado.expiring.len(), 1);
    assert_eq!(estado.expiring[0].name, "IPC");
    assert_eq!(estado.expiring[0].valid_to, "2027-01-01");
    assert_eq!(estado.expiring[0].days_remaining, 12);
}

#[tokio::test]
async fn el_estado_del_calendario_pregunta_con_la_ventana_de_la_plataforma() {
    let fake = FakeIndicators::default();
    let mut cliente = start(fake.clone()).await;

    cliente
        .get_indicator_calendar_status(PageRequest::default())
        .await
        .expect("consultar el estado no puede fallar");

    // La ventana la decide el servidor y no el cliente (`spec.md` §Aclaraciones: 30 días), y se
    // comprueba aquí para que no pueda cambiarse en un solo sitio: si el dominio y la consulta
    // se separaran, el aviso del administrador dejaría de corresponder con lo que dice el
    // resumen, y ninguna de las dos partes fallaría.
    let ventana = fake.llamadas()[0].ventana.expect("la ventana llegó");
    assert_eq!(ventana, CALENDAR_ALERT_WINDOW_DAYS);
    assert_eq!(ventana, 30, "el valor acordado con el stakeholder");
}

#[tokio::test]
async fn un_calendario_sin_nada_que_avisar_viaja_vacio() {
    let fake = FakeIndicators::con_calendario(CalendarStatus::default());
    let mut cliente = start(fake).await;

    let estado = cliente
        .get_indicator_calendar_status(PageRequest::default())
        .await
        .expect("consultar el estado no puede fallar")
        .into_inner();

    assert!(estado.missing_names.is_empty());
    assert!(estado.expiring.is_empty());
}
