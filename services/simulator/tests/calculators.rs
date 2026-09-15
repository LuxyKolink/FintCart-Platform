//! Pruebas del constructor de calculadoras (T087, T090): la forma almacenada y los cuatro
//! RPC que lo hacen utilizable.
//!
//! Dos bloques con propósitos distintos:
//!
//! 1. **La forma almacenada** se prueba SIN PostgreSQL, porque es lo único de la capa de
//!    persistencia que se puede verificar sin una base levantada —y donde está el riesgo
//!    real: que un literal del AST acabe guardado como número JSON (Principio VIII)—.
//! 2. **Los RPC** se prueban sobre la pila real de transporte con un doble del repositorio,
//!    igual que `contract.rs`: lo que se verifica es el contrato, no el SQL.
//!
//! Lo que estas pruebas NO cubren, y conviene que se lea aquí: el SQL de
//! `repo/calculators.rs` —la transacción que crea identidad y definición, la subida de
//! versión, la visibilidad de FR-051 y el bloqueo del borrado— solo se puede ejercitar
//! contra una base migrada.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use fintcart_simulator::domain::definition::{Definition, Draft, DraftOutput, InputField};
use fintcart_simulator::domain::error::{Error, Result};
use fintcart_simulator::domain::formula::ast::InputKind;
use fintcart_simulator::grpc::service::Service;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_client::SimulatorServiceClient;
use fintcart_simulator::pb::fintcart::simulator::v1::simulator_service_server::SimulatorServiceServer;
use fintcart_simulator::pb::fintcart::simulator::v1::{
    CalcType, Calculator, CalculatorDefinition, CalculatorInput, CalculatorOutput, CalculatorRef,
    ComputeRequest, InputType, ListCalculatorsRequest, UpsertCalculatorRequest,
    ValidateDefinitionRequest,
};
use fintcart_simulator::repo::calculators::{CalculatorPage, CalculatorRow, Calculators, State};
use fintcart_simulator::repo::simulations::{HistoryPage, SimulationRow, Simulations};
use rust_decimal_macros::dec;
use tonic::transport::{Endpoint, Server, Uri};
use tonic::Code;
use uuid::Uuid;

const USER: &str = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c";
const OTHER: &str = "8a1c2d3e-4f50-4a6b-8c9d-0e1f2a3b4c5d";

// ─────────────────────────────────────────────────────────────────────────────
// Forma almacenada (T087)
// ─────────────────────────────────────────────────────────────────────────────

fn definicion() -> Definition {
    Draft {
        inputs: vec![
            InputField {
                key: "monto".to_owned(),
                label: "Monto del crédito".to_owned(),
                kind: InputKind::Monto,
                unit: "COP".to_owned(),
                min: Some(dec!(1)),
                max: Some(dec!(1000000)),
                default: Some(dec!(5000)),
                required: true,
            },
            InputField {
                key: "tasa".to_owned(),
                label: "Tasa mensual".to_owned(),
                kind: InputKind::Tasa,
                unit: "%".to_owned(),
                min: None,
                max: None,
                default: None,
                required: false,
            },
        ],
        validations: vec![fintcart_simulator::domain::definition::DraftValidation {
            expression: "monto > 0".to_owned(),
            message: "el monto debe ser mayor que cero".to_owned(),
        }],
        outputs: vec![DraftOutput {
            key: "en_uvt".to_owned(),
            label: "Equivalente en UVT (350)".to_owned(),
            expression: "monto / 350 * @UVT".to_owned(),
            scale: 2,
            when: Some("@UVT > 0".to_owned()),
        }],
    }
    .parse(&["UVT".to_owned()].into_iter().collect())
    .expect("la definición de apoyo debe ser válida")
}

/// Una definición guardada y releída tiene que ser LA MISMA, incluido el texto original.
///
/// Si algo se perdiera por el camino, el síntoma sería un autor que reabre su calculadora y
/// encuentra su fórmula cambiada, o un resultado distinto del que calculó ayer.
#[test]
fn la_definicion_sobrevive_al_viaje_por_las_columnas() {
    use fintcart_simulator::repo::calculators::round_trip;

    let original = definicion();
    let releida = round_trip(&original).expect("el viaje por JSONB no debe fallar");

    assert_eq!(original, releida, "la definición debe volver idéntica");
}

/// El texto que se devuelve al constructor es el del AUTOR, no una reconstrucción del árbol.
#[test]
fn el_texto_original_se_conserva_tal_cual() {
    use fintcart_simulator::repo::calculators::round_trip;

    // Un espaciado irregular y unos paréntesis de más: lo que un impresor de AST
    // reformatearía y aquí tiene que sobrevivir intacto.
    let original = Draft {
        inputs: vec![InputField {
            key: "monto".to_owned(),
            label: "Monto".to_owned(),
            kind: InputKind::Monto,
            unit: String::new(),
            min: None,
            max: None,
            default: None,
            required: true,
        }],
        validations: Vec::new(),
        outputs: vec![DraftOutput {
            key: "r".to_owned(),
            label: "R".to_owned(),
            expression: "(monto*2)+  1".to_owned(),
            scale: 2,
            when: None,
        }],
    }
    .parse(&BTreeSet::new())
    .expect("la fórmula es válida");

    let releida = round_trip(&original).expect("el viaje por JSONB no debe fallar");

    assert_eq!(
        releida.outputs[0].source, "(monto*2)+  1",
        "el original del autor se guarda y se devuelve sin tocar"
    );
}

/// **Principio VIII.** Un literal del AST NO puede guardarse como número JSON: `serde_json`
/// redondea a 15-17 dígitos significativos y el AST se relee para calcular, así que la
/// pérdida sería silenciosa y ocurriría en cada ciclo guardar → leer.
///
/// La comprobación es sobre el JSON CRUDO y no sobre el tipo, porque el tipo ya garantiza
/// que hay un `Decimal` a la entrada: lo que hay que demostrar es cómo sale.
///
/// Hay exactamente un sitio donde un número JSON es legítimo —`escala`, que es un recuento de
/// decimales y no una cifra monetaria—, y por eso la prueba no prohíbe los números sin más:
/// exige que TODOS estén ahí. Una regla más laxa dejaría pasar un monto.
#[test]
fn ningun_literal_del_ast_se_guarda_como_numero_json() {
    use fintcart_simulator::repo::calculators::to_stored_json;

    let almacenado = to_stored_json(&definicion()).expect("la serialización no debe fallar");

    let mut numeros = Vec::new();
    for columna in &almacenado {
        rutas_de_numeros(columna, String::new(), &mut numeros);
    }

    assert!(
        !numeros.is_empty(),
        "el recorrido debe encontrar algo que mirar"
    );
    for ruta in &numeros {
        assert!(
            ruta.ends_with("/escala"),
            "hay un número JSON en «{ruta}», y el Principio VIII prohíbe que un monto, una \
             tasa o un literal del AST viajen como número. Solo `escala` puede serlo."
        );
    }

    // Y el contraste que hace útil lo de arriba: el `350` de la fórmula SÍ está, como string.
    let como_texto = serde_json::to_string(&almacenado[2]).unwrap();
    assert!(
        como_texto.contains("\"350\""),
        "el literal 350 debe guardarse como cadena: {como_texto}"
    );
}

/// Recoge las rutas JSON de todos los números de un documento.
fn rutas_de_numeros(valor: &serde_json::Value, prefijo: String, salida: &mut Vec<String>) {
    match valor {
        serde_json::Value::Number(_) => salida.push(prefijo),
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                rutas_de_numeros(item, format!("{prefijo}/{index}"), salida);
            }
        }
        serde_json::Value::Object(campos) => {
            for (clave, campo) in campos {
                rutas_de_numeros(campo, format!("{prefijo}/{clave}"), salida);
            }
        }
        _ => {}
    }
}

/// Una cota ausente se OMITE en vez de guardarse como `null`.
///
/// Las dos formas se leen igual, pero solo una es la que documenta data-model.md, y un
/// `null` obligaría a distinguirlo de «cota nula», que no significa nada.
#[test]
fn una_cota_ausente_se_omite_en_vez_de_guardarse_nula() {
    use fintcart_simulator::repo::calculators::to_stored_json;

    let almacenado = to_stored_json(&definicion()).expect("la serialización no debe fallar");
    let inputs = almacenado[0].as_array().expect("`inputs` es un arreglo");

    let con_cota = &inputs[0];
    assert!(
        con_cota.get("min").is_some(),
        "la cota declarada debe estar"
    );
    assert!(
        con_cota["min"].is_string(),
        "y ser una cadena decimal, no un número"
    );

    let sin_cota = &inputs[1];
    assert!(
        sin_cota.get("min").is_none(),
        "una cota ausente se omite: {sin_cota}"
    );
    assert!(sin_cota.get("default").is_none());
}

// ─────────────────────────────────────────────────────────────────────────────
// Los RPC (T090)
// ─────────────────────────────────────────────────────────────────────────────

/// Repositorio de calculadoras en memoria.
///
/// Guarda de verdad y sube la versión de verdad: un doble que se limitara a responder `Ok`
/// dejaría pasar un `UpsertCalculator` que no persiste nada, y el catálogo vacío solo se
/// notaría en producción.
#[derive(Default, Clone)]
struct FakeCalculators {
    rows: Arc<Mutex<Vec<CalculatorRow>>>,
    /// Argumento `existing` de cada llamada a `upsert`, en orden.
    ///
    /// Se registra para poder afirmar que editar PIDE una versión nueva en vez de crear otra
    /// calculadora, y que una definición inválida no llega a escribir nada.
    llamadas: Arc<Mutex<Vec<Option<Uuid>>>>,
    indicadores: Arc<BTreeSet<String>>,
}

impl FakeCalculators {
    fn con_indicadores(names: &[&str]) -> Self {
        Self {
            indicadores: Arc::new(names.iter().map(|name| (*name).to_owned()).collect()),
            ..Self::default()
        }
    }
}

#[tonic::async_trait]
impl Calculators for FakeCalculators {
    async fn upsert(
        &self,
        existing: Option<Uuid>,
        owner_id: Uuid,
        name: &str,
        description: &str,
        definition: &Definition,
    ) -> Result<CalculatorRow> {
        self.llamadas.lock().unwrap().push(existing);

        let mut rows = self.rows.lock().unwrap();
        let row = match existing {
            None => CalculatorRow {
                id: Uuid::new_v4(),
                owner_id: Some(owner_id),
                name: name.to_owned(),
                description: description.to_owned(),
                is_builtin: false,
                state: State::Privada,
                approved_by: None,
                rejection_reason: None,
                version: 1,
                definition: definition.clone(),
            },
            Some(id) => {
                let row = rows
                    .iter_mut()
                    .find(|row| row.id == id && row.owner_id == Some(owner_id))
                    .ok_or(Error::NotFound)?;
                row.name = name.to_owned();
                row.description = description.to_owned();
                // El repositorio real NO actualiza la definición: inserta una fila nueva y
                // sube la versión. El doble imita el efecto observable.
                row.definition = definition.clone();
                row.version += 1;
                row.clone()
            }
        };

        if existing.is_none() {
            rows.push(row.clone());
        }
        Ok(row)
    }

    async fn get(&self, id: Uuid, actor_id: Option<Uuid>) -> Result<CalculatorRow> {
        self.rows
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.id == id && (row.state == State::Publicada || row.owner_id == actor_id))
            .cloned()
            .ok_or(Error::NotFound)
    }

    async fn list(
        &self,
        owner_id: Option<Uuid>,
        only_published: bool,
        _page_size: i32,
        _page_token: &str,
    ) -> Result<CalculatorPage> {
        let items: Vec<_> = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|row| {
                (owner_id.is_some() && row.owner_id == owner_id)
                    || (only_published && row.state == State::Publicada)
            })
            .cloned()
            .collect();
        Ok(CalculatorPage {
            total: i64::try_from(items.len()).unwrap_or(i64::MAX),
            items,
            next_page_token: String::new(),
        })
    }

    async fn delete(&self, id: Uuid, actor_id: Uuid) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        let before = rows.len();
        rows.retain(|row| !(row.id == id && row.owner_id == Some(actor_id)));
        if rows.len() == before {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    async fn known_indicators(&self) -> Result<BTreeSet<String>> {
        Ok((*self.indicadores).clone())
    }
}

/// Doble del historial que NO se puede usar: estas pruebas no simulan nada, y fallar en vez
/// de devolver vacío hace que un `Compute` colado aquí se note.
struct NoSimulations;

#[tonic::async_trait]
impl Simulations for NoSimulations {
    async fn insert(
        &self,
        _user_id: Uuid,
        _calc_type: &str,
        _currency: &str,
        _inputs: &HashMap<String, String>,
        _result: &HashMap<String, String>,
        _idempotency_key: Option<&str>,
    ) -> Result<SimulationRow> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el historial".to_owned(),
        ))
    }

    async fn list_by_user(
        &self,
        _user_id: Uuid,
        _page_size: i32,
        _page_token: &str,
    ) -> Result<HistoryPage> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el historial".to_owned(),
        ))
    }

    async fn anonymize(&self, _user_id: Uuid, _replacement: Uuid) -> Result<u64> {
        Err(Error::NotImplemented(
            "estas pruebas no usan el historial".to_owned(),
        ))
    }
}

async fn start(repo: FakeCalculators) -> SimulatorServiceClient<tonic::transport::Channel> {
    let (client_io, server_io) = tokio::io::duplex(64 * 1024);

    tokio::spawn(async move {
        let _ = Server::builder()
            .add_service(SimulatorServiceServer::new(Service::new(
                NoSimulations,
                repo,
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

fn entrada(key: &str, tipo: InputType) -> CalculatorInput {
    CalculatorInput {
        key: key.to_owned(),
        label: key.to_owned(),
        r#type: tipo as i32,
        unit: String::new(),
        min_value: String::new(),
        max_value: String::new(),
        default_value: String::new(),
        required: true,
    }
}

fn salida(key: &str, expression: &str) -> CalculatorOutput {
    CalculatorOutput {
        key: key.to_owned(),
        label: key.to_owned(),
        expression: expression.to_owned(),
        scale: 2,
        when: String::new(),
    }
}

fn definicion_de_cuota() -> CalculatorDefinition {
    CalculatorDefinition {
        inputs: vec![
            entrada("monto", InputType::Monto),
            entrada("meses", InputType::Entero),
        ],
        validations: Vec::new(),
        outputs: vec![salida("por_mes", "monto / meses")],
    }
}

fn peticion(definition: CalculatorDefinition) -> UpsertCalculatorRequest {
    UpsertCalculatorRequest {
        calculator_id: String::new(),
        owner_id: USER.to_owned(),
        name: "Cuota simple".to_owned(),
        description: "Divide el monto entre el plazo".to_owned(),
        definition: Some(definition),
    }
}

fn ref_de(id: &str) -> CalculatorRef {
    CalculatorRef {
        calculator_id: id.to_owned(),
        actor_id: USER.to_owned(),
    }
}

// ── ValidateDefinition ──────────────────────────────────────────────────────

#[tokio::test]
async fn validate_definition_acepta_una_definicion_correcta() {
    let mut client = start(FakeCalculators::default()).await;

    let respuesta = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(definicion_de_cuota()),
        })
        .await
        .unwrap()
        .into_inner();

    assert!(respuesta.valid);
    assert!(respuesta.errors.is_empty());
}

/// Cada error señala DÓNDE está el problema, con su `code`. Sin la ubicación, el constructor
/// visual no puede resaltar el campo, y FR-046 pide señalar el error concreto.
#[tokio::test]
async fn validate_definition_senala_ubicacion_y_codigo() {
    let mut client = start(FakeCalculators::default()).await;

    let respuesta = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(CalculatorDefinition {
                inputs: vec![entrada("monto", InputType::Monto)],
                validations: Vec::new(),
                outputs: vec![
                    salida("bien", "monto * 2"),
                    // Campo que no está declarado.
                    salida("mal", "monto + plazo"),
                ],
            }),
        })
        .await
        .unwrap()
        .into_inner();

    assert!(!respuesta.valid);
    assert_eq!(respuesta.errors.len(), 1, "{:?}", respuesta.errors);
    assert_eq!(respuesta.errors[0].location, "outputs[1].expression");
    assert_eq!(respuesta.errors[0].code, "campo_inexistente");
    assert!(
        respuesta.errors[0].message.contains("plazo"),
        "el mensaje debe nombrar el campo: {}",
        respuesta.errors[0].message
    );
}

/// Los indicadores llegan del catálogo, no de la imaginación del autor.
#[tokio::test]
async fn validate_definition_rechaza_un_indicador_que_no_esta_en_el_catalogo() {
    let mut client = start(FakeCalculators::con_indicadores(&["UVT"])).await;

    let con_uvt = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(CalculatorDefinition {
                inputs: vec![entrada("monto", InputType::Monto)],
                validations: Vec::new(),
                outputs: vec![salida("en_uvt", "monto / @UVT")],
            }),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(con_uvt.valid, "{:?}", con_uvt.errors);

    let con_otro = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(CalculatorDefinition {
                inputs: vec![entrada("monto", InputType::Monto)],
                validations: Vec::new(),
                outputs: vec![salida("en_smmlv", "monto / @SMMLV")],
            }),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(!con_otro.valid);
    assert_eq!(con_otro.errors[0].code, "indicador_desconocido");
}

/// La escala llega como `i32` porque proto3 no tiene enteros sin signo. Convertirla con `as`
/// daría un número gigantesco y el autor leería «redondea a 4294967295 decimales».
#[tokio::test]
async fn una_escala_negativa_se_rechaza_diciendo_lo_que_paso() {
    let mut client = start(FakeCalculators::default()).await;

    let respuesta = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(CalculatorDefinition {
                inputs: vec![entrada("monto", InputType::Monto)],
                validations: Vec::new(),
                outputs: vec![CalculatorOutput {
                    scale: -1,
                    ..salida("r", "monto")
                }],
            }),
        })
        .await
        .unwrap()
        .into_inner();

    assert!(!respuesta.valid);
    assert_eq!(respuesta.errors[0].location, "outputs[0].scale");
    assert!(
        respuesta.errors[0].message.contains("negativa"),
        "{}",
        respuesta.errors[0].message
    );
}

// ── UpsertCalculator ────────────────────────────────────────────────────────

#[tokio::test]
async fn upsert_crea_una_calculadora_privada_y_version_uno() {
    let repo = FakeCalculators::default();
    let mut client = start(repo.clone()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    assert!(Uuid::parse_str(&creada.calculator_id).is_ok());
    assert_eq!(creada.owner_id, USER);
    assert_eq!(creada.version, 1);
    assert_eq!(creada.state, "privada", "FR-051: privada por defecto");
    assert!(!creada.is_builtin);
    assert_eq!(creada.name, "Cuota simple");
    assert_eq!(repo.rows.lock().unwrap().len(), 1);
}

/// La fórmula vuelve como TEXTO y es la que escribió el autor, para poder reeditarla.
#[tokio::test]
async fn upsert_devuelve_la_definicion_con_las_formulas_originales() {
    let mut client = start(FakeCalculators::default()).await;

    let creada = client
        .upsert_calculator(peticion(CalculatorDefinition {
            inputs: vec![entrada("monto", InputType::Monto)],
            validations: Vec::new(),
            outputs: vec![salida("r", "(monto*2)+  1")],
        }))
        .await
        .unwrap()
        .into_inner();

    let definicion = creada.definition.expect("la definición debe volver");
    assert_eq!(definicion.outputs[0].expression, "(monto*2)+  1");
    assert_eq!(definicion.outputs[0].scale, 2);
    assert_eq!(definicion.inputs[0].r#type, InputType::Monto as i32);
}

/// Editar SUBE LA VERSIÓN y pide una versión nueva de la definición; no crea otra
/// calculadora ni sobrescribe la anterior. Es de lo que depende que `simulations` pueda
/// citar la versión exacta con la que calculó (FR-050).
#[tokio::test]
async fn editar_sube_la_version_en_vez_de_crear_otra() {
    let repo = FakeCalculators::default();
    let mut client = start(repo.clone()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    let mut edicion = peticion(definicion_de_cuota());
    edicion.calculator_id = creada.calculator_id.clone();
    edicion.name = "Cuota simple (v2)".to_owned();

    let editada = client
        .upsert_calculator(edicion)
        .await
        .unwrap()
        .into_inner();

    assert_eq!(
        editada.calculator_id, creada.calculator_id,
        "editar no crea otra calculadora"
    );
    assert_eq!(editada.version, 2, "la versión sube");
    assert_eq!(repo.rows.lock().unwrap().len(), 1, "sigue habiendo una");
    assert_eq!(
        *repo.llamadas.lock().unwrap(),
        vec![None, Some(Uuid::parse_str(&creada.calculator_id).unwrap())],
        "la segunda llamada pide editar la existente"
    );
}

/// Una definición inválida se rechaza ANTES de tocar la base.
///
/// Es lo que evita que el catálogo se llene de calculadoras a medio escribir que el autor
/// tendría que borrar a mano.
#[tokio::test]
async fn una_definicion_invalida_no_llega_a_escribirse() {
    let repo = FakeCalculators::default();
    let mut client = start(repo.clone()).await;

    let status = client
        .upsert_calculator(peticion(CalculatorDefinition {
            inputs: vec![entrada("monto", InputType::Monto)],
            validations: Vec::new(),
            outputs: vec![salida("r", "monto +")],
        }))
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status.message().contains("outputs[0].expression"),
        "el mensaje debe decir DÓNDE: {}",
        status.message()
    );
    assert!(
        repo.llamadas.lock().unwrap().is_empty(),
        "no debe haberse llamado al repositorio"
    );
    assert!(repo.rows.lock().unwrap().is_empty());
}

#[tokio::test]
async fn upsert_rechaza_un_nombre_vacio() {
    let mut client = start(FakeCalculators::default()).await;

    let mut peticion = peticion(definicion_de_cuota());
    peticion.name = "   ".to_owned();

    let status = client.upsert_calculator(peticion).await.unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);
}

/// Un tipo de entrada desconocido es un error que se DICE, no un tipo elegido en silencio.
#[tokio::test]
async fn un_tipo_de_entrada_desconocido_se_senala() {
    let mut client = start(FakeCalculators::default()).await;

    let respuesta = client
        .validate_definition(ValidateDefinitionRequest {
            definition: Some(CalculatorDefinition {
                inputs: vec![CalculatorInput {
                    r#type: 99,
                    ..entrada("monto", InputType::Monto)
                }],
                validations: Vec::new(),
                outputs: vec![salida("r", "monto")],
            }),
        })
        .await
        .unwrap()
        .into_inner();

    assert!(!respuesta.valid);
    assert!(
        respuesta
            .errors
            .iter()
            .any(|error| error.location == "inputs[0].type"),
        "{:?}",
        respuesta.errors
    );
}

// ── GetCalculator y ListCalculators ─────────────────────────────────────────

#[tokio::test]
async fn get_devuelve_lo_que_upsert_guardo() {
    let mut client = start(FakeCalculators::default()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    let leida: Calculator = client
        .get_calculator(ref_de(&creada.calculator_id))
        .await
        .unwrap()
        .into_inner();

    assert_eq!(leida.calculator_id, creada.calculator_id);
    assert_eq!(leida.name, "Cuota simple");
    assert_eq!(
        leida.definition.unwrap().outputs[0].expression,
        "monto / meses"
    );
}

/// FR-051: una calculadora privada solo la ve su autor. Se responde `NotFound` y no
/// `PermissionDenied` a propósito: distinguirlos convertiría el RPC en un oráculo que
/// confirma la existencia de las calculadoras privadas de otros.
#[tokio::test]
async fn get_no_muestra_una_privada_ajena() {
    let mut client = start(FakeCalculators::default()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    let status = client
        .get_calculator(CalculatorRef {
            calculator_id: creada.calculator_id,
            actor_id: OTHER.to_owned(),
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::NotFound);
}

/// FR-051: no existe un listado global sin filtrar. Un `ListCalculators` sin ninguno de los
/// dos filtros devolvería las calculadoras privadas de todo el mundo.
#[tokio::test]
async fn list_sin_ningun_filtro_se_rechaza() {
    let mut client = start(FakeCalculators::default()).await;

    let status = client
        .list_calculators(ListCalculatorsRequest {
            owner_id: String::new(),
            only_published: false,
            page: None,
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn list_por_autor_devuelve_las_propias() {
    let mut client = start(FakeCalculators::default()).await;

    client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap();

    let respuesta = client
        .list_calculators(ListCalculatorsRequest {
            owner_id: USER.to_owned(),
            only_published: false,
            page: None,
        })
        .await
        .unwrap()
        .into_inner();

    assert_eq!(respuesta.items.len(), 1);
    assert_eq!(respuesta.page.unwrap().total_size, 1);
}

/// El catálogo público solo trae las PUBLICADAS: mientras nadie apruebe nada, está vacío
/// aunque el autor tenga calculadoras.
#[tokio::test]
async fn el_catalogo_publico_no_trae_las_privadas() {
    let mut client = start(FakeCalculators::default()).await;

    client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap();

    let respuesta = client
        .list_calculators(ListCalculatorsRequest {
            owner_id: String::new(),
            only_published: true,
            page: None,
        })
        .await
        .unwrap()
        .into_inner();

    assert!(respuesta.items.is_empty());
}

// ── DeleteCalculator ────────────────────────────────────────────────────────

#[tokio::test]
async fn delete_elimina_una_calculadora_propia() {
    let repo = FakeCalculators::default();
    let mut client = start(repo.clone()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    let resultado = client
        .delete_calculator(ref_de(&creada.calculator_id))
        .await
        .unwrap()
        .into_inner();

    assert!(resultado.success);
    assert!(repo.rows.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_no_toca_una_calculadora_ajena() {
    let repo = FakeCalculators::default();
    let mut client = start(repo.clone()).await;

    let creada = client
        .upsert_calculator(peticion(definicion_de_cuota()))
        .await
        .unwrap()
        .into_inner();

    let status = client
        .delete_calculator(CalculatorRef {
            calculator_id: creada.calculator_id,
            actor_id: OTHER.to_owned(),
        })
        .await
        .unwrap_err();

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(repo.rows.lock().unwrap().len(), 1, "sigue ahí");
}

// ── Compute: el camino de compatibilidad y el que falta ─────────────────────

/// `Compute` con `calculator_id` NO se resuelve todavía, y se dice.
///
/// Antes de esto el campo se ignoraba en silencio y la simulación se calculaba por
/// `calc_type`: un cliente que pidió una calculadora concreta recibía el resultado de OTRA
/// sin que nada se lo dijera. Un `Unimplemented` que nombra la tarea que lo implementa es
/// mucho mejor que un resultado equivocado.
#[tokio::test]
async fn compute_por_calculator_id_avisa_de_que_aun_no_esta() {
    let mut client = start(FakeCalculators::default()).await;

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

    assert_eq!(status.code(), Code::Unimplemented);
    assert!(
        status.message().contains("T091"),
        "el mensaje debe nombrar la tarea que lo implementa: {}",
        status.message()
    );
}

/// Y el contraste: sin `calculator_id`, el camino de compatibilidad sigue funcionando y NO
/// consulta el repositorio de calculadoras.
///
/// Los dos dobles de esta prueba fallan al ser llamados y cada uno lo dice con su propio
/// mensaje, así que el mensaje que llega identifica **de dónde** vino el fallo. Es lo que
/// convierte esta prueba en algo más que «devuelve un error»: el `calc_type` es válido, la
/// petición llega hasta la persistencia del historial, y el constructor no se toca.
#[tokio::test]
async fn compute_por_calc_type_no_consulta_las_calculadoras() {
    let mut client = start(FakeCalculators::default()).await;

    let status = client
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
        .unwrap_err();

    assert_eq!(status.code(), Code::Unimplemented);
    assert!(
        status.message().contains("historial"),
        "el fallo debe venir del repositorio del historial y no del constructor: {}",
        status.message()
    );
}
