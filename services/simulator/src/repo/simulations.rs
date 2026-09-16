//! Persistencia del historial de simulaciones (FR-022, research D-10).
//!
//! Una sola tabla y tres operaciones: insertar, listar y anonimizar. No hay reglas de
//! negocio aquí — qué calcula cada calculadora es asunto de `domain` (Principio IX).
//!
//! ## Por qué los mapas viajan como `serde_json::Value` de strings
//!
//! `inputs` y `result` son JSONB, y la migración impone un CHECK que rechaza
//! **cualquier número JSON a cualquier profundidad**. La razón está en el propio SQL:
//! un número dentro de un JSONB se almacena como `numeric` —exacto—, pero al
//! deserializarlo en Rust la mayoría de los caminos pasan por `f64`, que es justo lo
//! que el Principio VIII prohíbe. Guardando cadenas decimales canónicas, el valor que
//! sale es byte a byte el que entró.
//!
//! Este módulo construye ese JSON a partir de `HashMap<String, String>` y nunca de un
//! tipo numérico, de modo que el CHECK no puede dispararse por descuido: si algún día
//! se dispara, es porque alguien cambió esta función.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::domain::error::{Error, Result};
use crate::repo::calculators::VersionRef;
use crate::repo::tx::exec_tx;
use crate::repo::{clamp_page_size, parse_page_token};

/// Una simulación tal como se guarda y se devuelve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimulationRow {
    /// Identificador de la simulación.
    pub id: Uuid,
    /// Titular, como UUID opaco (Principio III).
    pub user_id: Uuid,
    /// Nombre de la calculadora, tal como lo admite el CHECK de la tabla.
    pub calc_type: String,
    /// Código ISO-4217.
    pub currency: String,
    /// Parámetros, con los montos y tasas como cadena decimal canónica.
    pub inputs: HashMap<String, String>,
    /// Resultados, con la misma convención.
    pub result: HashMap<String, String>,
    /// Calculadora cuya definición produjo el resultado (FR-050).
    ///
    /// `None` en el historial anterior a la enmienda que la migración de T020 no pudo
    /// atribuir —una base migrada y todavía sin sembrar, o una fila de
    /// `colombia_especifica` cuya entrada `operacion` no reconocía—. `None` es honesto ahí:
    /// no había definición que citar.
    pub calculator_id: Option<Uuid>,
    /// Versión exacta de esa definición. Nunca viene sin [`Self::calculator_id`]; lo impone
    /// `simulations_calculator_version_requires_id`.
    pub calculator_version: Option<i32>,
    /// Indicadores que la ejecución usó, como cadena decimal canónica (FR-058).
    ///
    /// Vacío cuando no usó ninguno, que es la verdad sobre las cinco calculadoras nativas:
    /// llevan sus constantes en el código y `gmf` recibe la UVT como ENTRADA.
    pub indicators_snapshot: HashMap<String, String>,
    /// Instante de creación.
    pub created_at: DateTime<Utc>,
}

/// De qué definición salió una simulación y qué indicadores usó.
///
/// Los tres campos viajan juntos porque describen UNA cosa —por qué el resultado es el que
/// es— y porque las tres columnas se escriben en el mismo `INSERT`. Separarlos en tres
/// argumentos sueltos invitaría a rellenar dos y olvidar el tercero, y ese olvido no
/// fallaría: `indicators_snapshot` tiene valor por defecto, y `calculator_id` es anulable.
/// La fila quedaría sin procedencia sin que nada lo dijera.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Provenance {
    /// Definición que la produjo, si se pudo determinar.
    pub calculator_id: Option<Uuid>,
    /// Versión exacta de esa definición. Nunca sin [`Self::calculator_id`].
    pub calculator_version: Option<i32>,
    /// Indicadores usados, como cadena decimal canónica (FR-058).
    pub indicators: HashMap<String, String>,
}

impl Provenance {
    /// La de una ejecución del código NATIVO, atribuida a la semilla que lo reproduce.
    ///
    /// Sin indicadores a propósito: las cinco calculadoras nativas llevan sus constantes
    /// cableadas y `gmf` recibe la UVT como entrada, así que no leen ninguna fila de
    /// `financial_indicators`. Un mapa vacío es la verdad sobre ellas, y es lo mismo que la
    /// migración de T020 registró en el historial anterior.
    #[must_use]
    pub fn native(version: Option<VersionRef>) -> Self {
        Self {
            calculator_id: version.map(|v| v.id),
            calculator_version: version.map(|v| v.version),
            indicators: HashMap::new(),
        }
    }

    /// La de una ejecución de una DEFINICIÓN, por `calculator_id`.
    #[must_use]
    pub fn definition(id: Uuid, version: i32, indicators: HashMap<String, String>) -> Self {
        Self {
            calculator_id: Some(id),
            calculator_version: Some(version),
            indicators,
        }
    }
}

/// Una simulación a punto de escribirse.
///
/// Existe porque la fila tiene NUEVE columnas y una función con nueve parámetros no se puede
/// leer: en la llamada, `&inputs` y `&result` son dos mapas del mismo tipo y el compilador no
/// distingue uno de otro, así que intercambiarlos guardaría los parámetros como resultado sin
/// que nada fallara. Con un struct, cada campo se nombra en el sitio donde se rellena.
///
/// No es [`SimulationRow`] con otro nombre: esta es la forma de ENTRADA y no lleva `id` ni
/// `created_at` —los asigna la base con `RETURNING`, y calcularlos en Rust abriría la puerta
/// a que el historial afirme un instante distinto del que quedó indexado—.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSimulation {
    /// Titular, como UUID opaco (Principio III).
    pub user_id: Uuid,
    /// Nombre de la calculadora, tal como lo admite el CHECK de la tabla.
    pub calc_type: String,
    /// Código ISO-4217.
    pub currency: String,
    /// Parámetros, TAL COMO LLEGARON del cliente y sin normalizar.
    ///
    /// Es lo que hace reproducible el historial: canonicalizarlos haría que el usuario viera
    /// en su historial una cifra distinta de la que escribió.
    pub inputs: HashMap<String, String>,
    /// Resultados, con la convención de cadena decimal canónica.
    pub result: HashMap<String, String>,
    /// De qué definición salió y qué indicadores usó (FR-050, FR-058).
    pub provenance: Provenance,
    /// Clave de idempotencia, si la llamada viene de una saga (T176).
    pub idempotency_key: Option<String>,
}

/// Página del historial.
#[derive(Debug, Clone)]
pub struct HistoryPage {
    /// Filas de esta página.
    pub items: Vec<SimulationRow>,
    /// Token de la siguiente página, o vacío si no hay más.
    pub next_page_token: String,
    /// Total de simulaciones del usuario.
    pub total: i64,
}

/// Acceso al historial de simulaciones, visto desde la capa de transporte.
///
/// El puerto se declara aquí, junto a su implementación, y no en `grpc`, por una razón
/// concreta: los tipos que atraviesan la firma ([`SimulationRow`], [`HistoryPage`]) son
/// de este módulo, así que declararlo arriba obligaría a `grpc` a importarlos igual y
/// no ganaría desacoplamiento — solo repartiría la definición en dos sitios.
///
/// Lo que sí aporta es que `grpc::Service` deje de sostener un `PgPool`. Un pool
/// visible desde el transporte es la puerta por la que acaba colándose una consulta
/// suelta dentro de un handler, y además hace imposible ejercitar los RPC sin
/// PostgreSQL: la prueba de contrato de T109 existe gracias a esta interfaz.
#[tonic::async_trait]
pub trait Simulations: Send + Sync + 'static {
    /// Persiste una simulación recién calculada.
    ///
    /// `new.idempotency_key`: `None` inserta siempre una fila nueva (llamada directa, fuera
    /// de una saga). `Some` repite lo que ya se guardó para esa clave en vez de
    /// duplicar, para que un reintento del paso `simulator.compute` del Orquestador
    /// (`saga.go::run`: "de ahí que Do deba ser idempotente") no infle el historial
    /// (T176, SC-008).
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la escritura.
    async fn insert(&self, new: &NewSimulation) -> Result<SimulationRow>;

    /// Devuelve una página del historial del usuario.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si el token de página no es válido; [`Error::Storage`]
    /// si falla la consulta.
    async fn list_by_user(
        &self,
        user_id: Uuid,
        page_size: i32,
        page_token: &str,
    ) -> Result<HistoryPage>;

    /// Disocia el historial de su titular (FR-030).
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la escritura.
    async fn anonymize(&self, user_id: Uuid, replacement: Uuid) -> Result<u64>;
}

/// Implementación sobre PostgreSQL.
///
/// Es la dueña del pool y el único sitio que abre transacciones: por eso `insert` y
/// `anonymize` envuelven su consulta en [`exec_tx`] aquí, y no en el transporte. Con el
/// alcance de la transacción decidido en la capa que conoce el SQL, ninguna de las de
/// arriba puede dejar una escritura a medio confirmar (Principio XI regla 4).
pub struct PgSimulations {
    pool: PgPool,
}

impl PgSimulations {
    /// Envuelve un pool ya abierto (Principio X: la conexión la abre `main.rs`).
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[tonic::async_trait]
impl Simulations for PgSimulations {
    async fn insert(&self, new: &NewSimulation) -> Result<SimulationRow> {
        // La fila se clona para el futuro boxeado de `exec_tx`, que necesita `'static`. Es
        // una copia de tres mapas pequeños frente a una ida y vuelta a PostgreSQL: no es
        // donde está el coste.
        let new = new.clone();

        exec_tx(&self.pool, move |tx| {
            Box::pin(async move { insert(tx, &new).await })
        })
        .await
    }

    async fn list_by_user(
        &self,
        user_id: Uuid,
        page_size: i32,
        page_token: &str,
    ) -> Result<HistoryPage> {
        // Sin transacción: es una lectura, y abrirla solo retendría la conexión más
        // tiempo sin ganar ninguna garantía.
        list_by_user(&self.pool, user_id, page_size, page_token).await
    }

    async fn anonymize(&self, user_id: Uuid, replacement: Uuid) -> Result<u64> {
        exec_tx(&self.pool, move |tx| {
            Box::pin(async move { anonymize(tx, user_id, replacement).await })
        })
        .await
    }
}

/// Inserta una simulación y devuelve la fila completa.
///
/// Devuelve `id` y `created_at` con `RETURNING` en lugar de generarlos en Rust: son
/// los valores que la BASE asignó, y calcularlos aquí abriría la puerta a que el
/// historial afirme un instante distinto del que quedó indexado.
///
/// Con `idempotency_key = Some(_)`, repetir la misma clave no inserta una segunda
/// fila: `ON CONFLICT ... DO NOTHING` no encuentra `RETURNING` que devolver, y en
/// ese caso se relee la fila existente por su clave (T176). Sin clave (`None`), el
/// índice único nunca puede entrar en conflicto —dos `NULL` no son iguales entre
/// sí para un `UNIQUE`— así que el `INSERT` siempre tiene éxito y este es el único
/// camino, igual que antes de esta columna.
///
/// # Errores
///
/// [`Error::Storage`] si falla la escritura, incluido el rechazo de los CHECK del
/// Principio VIII, o si un conflicto de idempotencia no encuentra luego la fila que
/// lo causó (inconsistencia que no debería ocurrir dentro de la misma transacción).
pub async fn insert(
    tx: &mut Transaction<'static, Postgres>,
    new: &NewSimulation,
) -> Result<SimulationRow> {
    let row = sqlx::query(
        r"
        INSERT INTO simulations (
            user_id, calc_type, currency, inputs, result,
            calculator_id, calculator_version, indicators_snapshot,
            idempotency_key
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, created_at",
    )
    .bind(new.user_id)
    .bind(&new.calc_type)
    .bind(&new.currency)
    .bind(to_json(&new.inputs))
    .bind(to_json(&new.result))
    .bind(new.provenance.calculator_id)
    .bind(new.provenance.calculator_version)
    // El snapshot se guarda con la MISMA `to_json` que `inputs` y `result`, y por la misma
    // razón: nunca produce un número JSON, que es lo que hace cierto desde este lado el
    // CHECK `simulations_indicators_snapshot_no_json_numbers`.
    .bind(to_json(&new.provenance.indicators))
    .bind(new.idempotency_key.as_deref())
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    if let Some(row) = row {
        return Ok(SimulationRow {
            id: row.try_get("id").map_err(Error::from_sqlx)?,
            user_id: new.user_id,
            calc_type: new.calc_type.clone(),
            currency: new.currency.clone(),
            inputs: new.inputs.clone(),
            result: new.result.clone(),
            calculator_id: new.provenance.calculator_id,
            calculator_version: new.provenance.calculator_version,
            indicators_snapshot: new.provenance.indicators.clone(),
            created_at: row.try_get("created_at").map_err(Error::from_sqlx)?,
        });
    }

    let key = new
        .idempotency_key
        .as_deref()
        .ok_or_else(|| Error::Storage(sqlx::Error::RowNotFound))?;
    by_idempotency_key(tx, key)
        .await?
        .ok_or_else(|| Error::Storage(sqlx::Error::RowNotFound))
}

/// Relee la fila que causó el conflicto de `ON CONFLICT ... DO NOTHING` de [`insert`].
async fn by_idempotency_key(
    tx: &mut Transaction<'static, Postgres>,
    idempotency_key: &str,
) -> Result<Option<SimulationRow>> {
    let row = sqlx::query(
        r"
        SELECT id, user_id, calc_type, currency, inputs, result,
               calculator_id, calculator_version, indicators_snapshot, created_at
          FROM simulations
         WHERE idempotency_key = $1",
    )
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    row.map(row_from).transpose()
}

/// Convierte una fila en el tipo de dominio, con las nueve columnas.
///
/// Escrito UNA vez porque hay tres consultas que devuelven la misma proyección —la
/// relectura por idempotencia y las dos ramas del listado—: tres listas de columnas
/// copiadas divergen en cuanto alguien añada una, y el síntoma sería un campo que unas
/// consultas rellenan y otras dejan vacío.
fn row_from(row: sqlx::postgres::PgRow) -> Result<SimulationRow> {
    Ok(SimulationRow {
        id: row.try_get("id").map_err(Error::from_sqlx)?,
        user_id: row.try_get("user_id").map_err(Error::from_sqlx)?,
        calc_type: row.try_get("calc_type").map_err(Error::from_sqlx)?,
        currency: row.try_get("currency").map_err(Error::from_sqlx)?,
        inputs: from_json(row.try_get("inputs").map_err(Error::from_sqlx)?)?,
        result: from_json(row.try_get("result").map_err(Error::from_sqlx)?)?,
        calculator_id: row.try_get("calculator_id").map_err(Error::from_sqlx)?,
        calculator_version: row
            .try_get("calculator_version")
            .map_err(Error::from_sqlx)?,
        indicators_snapshot: from_json(
            row.try_get("indicators_snapshot")
                .map_err(Error::from_sqlx)?,
        )?,
        created_at: row.try_get("created_at").map_err(Error::from_sqlx)?,
    })
}

/// Lista el historial de un usuario, más recientes primero (FR-022).
///
/// La paginación es por DESPLAZAMIENTO y el token es el offset. Un cursor por
/// `created_at` sería más robusto frente a inserciones concurrentes, pero aquí el
/// historial solo crece por la punta y el usuario lee sus propias simulaciones: el
/// único desajuste posible es ver repetida una fila si simula mientras pagina, que es
/// preferible a la complejidad de un cursor compuesto.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el token no es un offset válido; [`Error::Storage`] si
/// falla la consulta.
pub async fn list_by_user(
    pool: &PgPool,
    user_id: Uuid,
    page_size: i32,
    page_token: &str,
) -> Result<HistoryPage> {
    let limit = clamp_page_size(page_size);
    let offset = parse_page_token(page_token)?;

    let rows = sqlx::query(
        r"
        SELECT id, user_id, calc_type, currency, inputs, result,
               calculator_id, calculator_version, indicators_snapshot, created_at
          FROM simulations
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(i64::from(limit))
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(Error::from_sqlx)?;

    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM simulations WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(Error::from_sqlx)?;

    let items = rows.into_iter().map(row_from).collect::<Result<Vec<_>>>()?;

    // El token siguiente solo existe si QUEDAN filas. Emitirlo siempre haría que el
    // cliente pidiera una página vacía de más en cada recorrido completo.
    let consumed = offset + i64::try_from(items.len()).unwrap_or(i64::MAX);
    let next_page_token = if consumed < total {
        consumed.to_string()
    } else {
        String::new()
    };

    Ok(HistoryPage {
        items,
        next_page_token,
        total,
    })
}

/// Disocia el historial de su titular (FR-030, saga de anonimización).
///
/// Las filas NO se borran: los parámetros y resultados de una simulación no
/// identifican a nadie por sí solos, y conservarlos mantiene utilizables las
/// estadísticas agregadas. Lo que se sustituye es el `user_id` por uno nuevo y
/// aleatorio, que rompe el vínculo sin dejar la columna nula — `NOT NULL` sigue
/// valiendo y ningún índice se degrada.
///
/// Es IDEMPOTENTE por construcción: al repetirla no encuentra ya ninguna fila del
/// titular original, así que el segundo paso de una saga reintentada no falla.
///
/// # Errores
///
/// [`Error::Storage`] si falla la escritura.
pub async fn anonymize(
    tx: &mut Transaction<'static, Postgres>,
    user_id: Uuid,
    replacement: Uuid,
) -> Result<u64> {
    let done = sqlx::query("UPDATE simulations SET user_id = $2 WHERE user_id = $1")
        .bind(user_id)
        .bind(replacement)
        .execute(&mut **tx)
        .await
        .map_err(Error::from_sqlx)?;
    Ok(done.rows_affected())
}

/// Convierte el mapa a JSON de cadenas.
///
/// Nunca produce un número JSON: cada valor entra como `Value::String`. Es el punto
/// que hace cierto el CHECK `simulations_inputs_no_json_numbers` desde este lado.
fn to_json(map: &HashMap<String, String>) -> Value {
    let mut object = Map::with_capacity(map.len());
    for (key, value) in map {
        object.insert(key.clone(), Value::String(value.clone()));
    }
    Value::Object(object)
}

/// Lee un JSONB de cadenas.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el documento no es un objeto de cadenas. No debería
/// ocurrir —el CHECK lo impide—, pero tratarlo como imposible obligaría a un `unwrap`
/// que convertiría una fila anómala en una caída al listar el historial.
fn from_json(value: Value) -> Result<HashMap<String, String>> {
    let object = value.as_object().ok_or_else(|| {
        Error::InvalidInput("una fila del historial no contiene un objeto JSON".to_owned())
    })?;

    object
        .iter()
        .map(|(key, raw)| {
            raw.as_str()
                .map(|text| (key.clone(), text.to_owned()))
                .ok_or_else(|| {
                    Error::InvalidInput(format!(
                        "el campo {key:?} del historial no es una cadena decimal"
                    ))
                })
        })
        .collect()
}
