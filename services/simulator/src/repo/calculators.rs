//! Persistencia del constructor de calculadoras (T087, T088; FR-043…FR-054).
//!
//! ## Dos tablas, y por qué la definición NUNCA se actualiza
//!
//! `calculators` es la IDENTIDAD —autoría, estado de curaduría, versión vigente— y
//! `calculator_definitions` es la HISTORIA. Editar una calculadora **inserta una fila
//! nueva** y sube `calculators.version`; no hay ni un `UPDATE` sobre una definición.
//!
//! No es una preferencia de estilo. Es lo que permite que `simulations` cite la versión
//! EXACTA con la que calculó (FR-050): si la definición se sobrescribiera, una simulación
//! de hace un año se explicaría con la fórmula de hoy y el historial diría una cosa
//! distinta de la que dijo. Y es también lo que permite que una calculadora publicada siga
//! sirviendo su versión aprobada mientras su autor edita la siguiente.
//!
//! ## DTO ≠ tipo de dominio ≠ tipo de fila (Principio IX regla 2)
//!
//! Los `struct` de abajo con `clave`/`etiqueta`/`ast` son la forma ALMACENADA que documenta
//! data-model.md §2.2, y no son los tipos de `domain::definition`. La conversión ocurre en
//! [`to_stored`] y [`from_stored`], y solo ahí: si el dominio se anotara con `serde` para
//! esta forma, un cambio en el JSONB de una columna empezaría a propagarse hasta la
//! validación de una fórmula.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::domain::decimal_str::serde_decimal;
use crate::domain::definition::{Definition, InputField, OutputField, ValidationRule};
use crate::domain::error::{Error, Result};
use crate::domain::formula::ast::{Expr, InputKind};
use crate::repo::tx::exec_tx;
use crate::repo::{clamp_page_size, parse_page_token};

/// Estado de curaduría de una calculadora.
///
/// Vive aquí y no en `domain` porque no cruza ninguna frontera como enum: el contrato lo
/// lleva como `string` libre y la base lo restringe con un `CHECK`. Sus valores son, por
/// tanto, el vocabulario de una COLUMNA, y tenerlos en un enum cerrado al lado de la tabla
/// es lo que impide escribir una variante que PostgreSQL rechazaría recién al insertar.
///
/// Es el mismo razonamiento que llevó `Kind` a `domain::dispatch`, con una diferencia que
/// justifica el sitio distinto: `Kind` sí cruza, porque `ListHistory` devuelve el enum del
/// contrato. Este no.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Visible y ejecutable solo por su autor (FR-051).
    Privada,
    /// Propuesta al catálogo, esperando curaduría (FR-052).
    EnRevision,
    /// Aprobada y visible para todos.
    Publicada,
}

impl State {
    /// Nombre con el que el estado se persiste.
    ///
    /// Coincide exactamente con el `CHECK calculators_state_valid`. Que salga de aquí y no
    /// de un literal en la consulta es lo que impide que un `INSERT` escriba una variante
    /// que la base rechaza.
    #[must_use]
    pub const fn as_db(self) -> &'static str {
        match self {
            Self::Privada => "privada",
            Self::EnRevision => "en_revision",
            Self::Publicada => "publicada",
        }
    }

    /// Traduce el estado almacenado.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si la fila trae un estado que ya no existe. Es improbable
    /// —el `CHECK` lo impide— pero no imposible tras una migración, y tratarlo como
    /// `Privada` escondería una calculadora publicada.
    pub fn from_db(value: &str) -> Result<Self> {
        match value {
            "privada" => Ok(Self::Privada),
            "en_revision" => Ok(Self::EnRevision),
            "publicada" => Ok(Self::Publicada),
            other => Err(Error::InvalidInput(format!(
                "estado {other:?} almacenado no corresponde a ninguna calculadora"
            ))),
        }
    }
}

/// Una calculadora con la definición de su versión vigente.
///
/// Los dos conceptos viajan juntos porque siempre se leen juntos: una identidad sin su
/// definición no se puede ejecutar, y una definición sin su identidad no dice de quién es ni
/// si está publicada.
#[derive(Debug, Clone)]
pub struct CalculatorRow {
    /// Identificador de la calculadora.
    pub id: Uuid,
    /// Autor, como UUID opaco (Principio III). `None` en las semillas y en las calculadoras
    /// cuyo autor se anonimizó (FR-077).
    pub owner_id: Option<Uuid>,
    /// Nombre visible.
    pub name: String,
    /// Descripción.
    pub description: String,
    /// Verdadero en las siete semillas de D-16.
    pub is_builtin: bool,
    /// Estado de curaduría.
    pub state: State,
    /// Coordinador que la aprobó (FR-053).
    pub approved_by: Option<Uuid>,
    /// Motivo del último rechazo (FR-054).
    pub rejection_reason: Option<String>,
    /// Versión vigente, que es la que `simulations.calculator_version` cita.
    pub version: i32,
    /// Definición vigente.
    pub definition: Definition,
}

/// Una página del listado.
#[derive(Debug, Clone)]
pub struct CalculatorPage {
    /// Calculadoras de esta página.
    pub items: Vec<CalculatorRow>,
    /// Token de la siguiente página, o vacío si no hay más.
    pub next_page_token: String,
    /// Total de calculadoras que cumplen el filtro.
    pub total: i64,
}

/// Acceso a las calculadoras, visto desde la capa de transporte.
///
/// El puerto se declara aquí, junto a su implementación, por la misma razón que
/// [`crate::repo::simulations::Simulations`]: los tipos que atraviesan la firma son de este
/// módulo, y lo que aporta es que `grpc::Service` no sostenga un `PgPool` — con lo que una
/// prueba de contrato puede ejercitar los cinco RPC sin PostgreSQL.
#[tonic::async_trait]
pub trait Calculators: Send + Sync + 'static {
    /// Crea una calculadora (`existing = None`) o publica una versión nueva.
    ///
    /// `existing = Some(id)` **no** edita la definición: inserta una fila nueva en
    /// `calculator_definitions` con la versión siguiente y sube `calculators.version`. Ver
    /// la nota del módulo.
    ///
    /// `owner_id` es el actor, y se exige que coincida con el autor de la fila: nadie edita
    /// una calculadora ajena, y las semillas —sin autor— no las edita nadie.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si `existing` no existe, no es de `owner_id` o es una semilla.
    /// [`Error::Storage`] si falla la escritura.
    async fn upsert(
        &self,
        existing: Option<Uuid>,
        owner_id: Uuid,
        name: &str,
        description: &str,
        definition: &Definition,
    ) -> Result<CalculatorRow>;

    /// Lee una calculadora.
    ///
    /// `actor_id` es `None` cuando no hay actor identificado. La visibilidad la impone la
    /// consulta y no el llamador, porque es una regla de la fila y no de la petición:
    /// FR-051 dice que una calculadora privada solo la ve su autor, así que una
    /// comprobación en la capa de arriba tendría que leer la fila antes de decidir, y entre
    /// la lectura y la decisión cabría un cambio de estado.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si no existe o no es visible para el actor.
    async fn get(&self, id: Uuid, actor_id: Option<Uuid>) -> Result<CalculatorRow>;

    /// Lista calculadoras propias y/o publicadas.
    ///
    /// Los dos filtros son acumulativos: `owner_id` añade las propias y `only_published` el
    /// catálogo. Que ambos sean opcionales aquí NO significa que lo sean en el contrato —
    /// FR-051 prohíbe un listado global sin filtrar, y quien lo impide es la capa gRPC,
    /// porque es una regla de la petición y no de la tabla.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si el token de página no es válido; [`Error::Storage`] si
    /// falla la consulta.
    async fn list(
        &self,
        owner_id: Option<Uuid>,
        only_published: bool,
        page_size: i32,
        page_token: &str,
    ) -> Result<CalculatorPage>;

    /// Elimina una calculadora propia.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si no existe, no es de `actor_id` o es una semilla.
    /// [`Error::InvalidInput`] si alguna simulación del historial la cita: borrarla dejaría
    /// esas filas sin poder explicarse (FR-050), que es justo lo que la clave foránea
    /// impide. Se comprueba antes para dar un mensaje que el usuario entienda en lugar de
    /// una violación de integridad del driver.
    async fn delete(&self, id: Uuid, actor_id: Uuid) -> Result<()>;

    /// Nombres de indicador que existen hoy en el catálogo.
    ///
    /// Vive en este puerto, y no en uno propio, porque su ÚNICO consumidor es el
    /// constructor: analizar una fórmula exige saber qué `@NOMBRE` existen (FR-046), y el
    /// analizador no consulta nada por diseño. T101 (US4) añadirá la resolución por fecha en
    /// `repo/indicators.rs`, y esta consulta podrá mudarse allí sin cambiar la firma que ve
    /// el transporte.
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la consulta.
    async fn known_indicators(&self) -> Result<BTreeSet<String>>;
}

/// Implementación sobre PostgreSQL.
pub struct PgCalculators {
    pool: PgPool,
}

impl PgCalculators {
    /// Envuelve un pool ya abierto (Principio X: la conexión la abre `main.rs`).
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[tonic::async_trait]
impl Calculators for PgCalculators {
    async fn upsert(
        &self,
        existing: Option<Uuid>,
        owner_id: Uuid,
        name: &str,
        description: &str,
        definition: &Definition,
    ) -> Result<CalculatorRow> {
        // Los argumentos se clonan para el futuro boxeado de `exec_tx`, que necesita
        // `'static`. Es una copia de una definición pequeña frente a una ida y vuelta a
        // PostgreSQL.
        let name = name.to_owned();
        let description = description.to_owned();
        let definition = definition.clone();

        exec_tx(&self.pool, move |tx| {
            Box::pin(async move {
                let (id, version) = match existing {
                    None => create(tx, owner_id, &name, &description).await?,
                    Some(id) => bump(tx, id, owner_id, &name, &description).await?,
                };
                insert_definition(tx, id, version, &definition).await?;
                // `&mut **tx` y no `tx`: una `Transaction` no es un ejecutor, su
                // conexión sí.
                read_one(&mut **tx, id, None).await
            })
        })
        .await
    }

    async fn get(&self, id: Uuid, actor_id: Option<Uuid>) -> Result<CalculatorRow> {
        // Sin transacción: es una lectura, y abrirla solo retendría la conexión más tiempo
        // sin ganar ninguna garantía.
        read_one(&self.pool, id, actor_id).await
    }

    async fn list(
        &self,
        owner_id: Option<Uuid>,
        only_published: bool,
        page_size: i32,
        page_token: &str,
    ) -> Result<CalculatorPage> {
        let limit = clamp_page_size(page_size);
        let offset = parse_page_token(page_token)?;

        let page_sql = format!(
            "{SELECT_CALCULATOR}
              WHERE (c.owner_id = $1) OR ($2 AND c.state = 'publicada')
              ORDER BY c.name, c.id
              LIMIT $3 OFFSET $4"
        );

        let rows = sqlx::query(&page_sql)
            .bind(owner_id)
            .bind(only_published)
            .bind(i64::from(limit))
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(Error::from_sqlx)?;

        let total: i64 = sqlx::query_scalar(
            "SELECT count(*)
               FROM calculators c
               JOIN calculator_definitions d
                 ON d.calculator_id = c.id AND d.version = c.version
              WHERE (c.owner_id = $1) OR ($2 AND c.state = 'publicada')",
        )
        .bind(owner_id)
        .bind(only_published)
        .fetch_one(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        let items = rows.iter().map(row_from).collect::<Result<Vec<_>>>()?;

        // El token siguiente solo existe si QUEDAN filas. Emitirlo siempre haría que el
        // cliente pidiera una página vacía de más en cada recorrido completo.
        let consumed = offset + i64::try_from(items.len()).unwrap_or(i64::MAX);
        let next_page_token = if consumed < total {
            consumed.to_string()
        } else {
            String::new()
        };

        Ok(CalculatorPage {
            items,
            next_page_token,
            total,
        })
    }

    async fn delete(&self, id: Uuid, actor_id: Uuid) -> Result<()> {
        exec_tx(&self.pool, move |tx| {
            Box::pin(async move {
                // `FOR UPDATE` bloquea la fila, y con ella la comprobación de autoría: sin
                // él, dos peticiones simultáneas podrían borrar la misma calculadora y la
                // segunda recibiría un error de fila inexistente en vez del `NotFound` que
                // sí describe lo que pasó.
                let owned = sqlx::query(
                    "SELECT id FROM calculators
                      WHERE id = $1 AND owner_id = $2 AND NOT is_builtin
                        FOR UPDATE",
                )
                .bind(id)
                .bind(actor_id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(Error::from_sqlx)?;

                if owned.is_none() {
                    return Err(Error::NotFound);
                }

                // La clave foránea de `simulations` es `RESTRICT` y ya impediría el borrado;
                // se pregunta antes para que el usuario lea cuántas simulaciones lo impiden
                // en vez de una violación de integridad del driver. Que la base lo imponga
                // además es lo que hace cierta la garantía frente a una carrera.
                let cited: i64 =
                    sqlx::query_scalar("SELECT count(*) FROM simulations WHERE calculator_id = $1")
                        .bind(id)
                        .fetch_one(&mut **tx)
                        .await
                        .map_err(Error::from_sqlx)?;

                if cited > 0 {
                    return Err(Error::InvalidInput(format!(
                        "no se puede eliminar: {cited} simulaciones del historial usan esta \
                         calculadora, y sin ella dejarían de poder explicarse (FR-050)"
                    )));
                }

                sqlx::query("DELETE FROM calculators WHERE id = $1")
                    .bind(id)
                    .execute(&mut **tx)
                    .await
                    .map_err(Error::from_sqlx)?;

                Ok(())
            })
        })
        .await
    }

    async fn known_indicators(&self) -> Result<BTreeSet<String>> {
        let names: Vec<String> =
            sqlx::query_scalar("SELECT DISTINCT name FROM financial_indicators")
                .fetch_all(&self.pool)
                .await
                .map_err(Error::from_sqlx)?;
        Ok(names.into_iter().collect())
    }
}

/// Proyección común de lectura, para que `get` y `list` no puedan divergir en columnas.
///
/// Se escribe una vez y se parametriza con el `WHERE`: dos listas de columnas copiadas es
/// como se llega a que `GetCalculator` devuelva un campo que `ListCalculators` deja vacío.
const SELECT_CALCULATOR: &str = "
    SELECT c.id, c.owner_id, c.name, c.description, c.is_builtin, c.state,
           c.approved_by, c.rejection_reason, c.version,
           d.inputs, d.validations, d.outputs
      FROM calculators c
      JOIN calculator_definitions d
        ON d.calculator_id = c.id AND d.version = c.version";

/// Crea la identidad de una calculadora y devuelve su identificador y su primera versión.
///
/// El estado no se pasa: una calculadora nueva es `privada` por FR-051, y dejar el valor en
/// el `DEFAULT` del esquema hace que esa regla esté en un solo sitio. El `RETURNING` de
/// `version` evita suponer que el `DEFAULT` es 1.
async fn create(
    tx: &mut Transaction<'static, Postgres>,
    owner_id: Uuid,
    name: &str,
    description: &str,
) -> Result<(Uuid, i32)> {
    let row = sqlx::query(
        "INSERT INTO calculators (owner_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, version",
    )
    .bind(owner_id)
    .bind(name)
    .bind(description)
    .fetch_one(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    Ok((
        row.try_get("id").map_err(Error::from_sqlx)?,
        row.try_get("version").map_err(Error::from_sqlx)?,
    ))
}

/// Sube la versión de una calculadora propia y devuelve la nueva.
///
/// La condición `owner_id = $2` está en el `WHERE` y no en una comprobación previa: así la
/// autoría y la escritura son la misma operación, y no hay hueco entre comprobar y escribir.
/// `NOT is_builtin` cierra el caso de las semillas, que no tienen autor y no deben
/// modificarse desde el constructor de nadie.
///
/// El `UPDATE` toma un bloqueo de fila, así que dos ediciones simultáneas se serializan y la
/// segunda ve —y usa— la versión que dejó la primera. La clave primaria compuesta
/// `(calculator_id, version)` es la red que lo garantiza aunque el bloqueo fallara.
///
/// # Errores
///
/// [`Error::NotFound`] si la fila no existe, no es del actor o es una semilla.
async fn bump(
    tx: &mut Transaction<'static, Postgres>,
    id: Uuid,
    owner_id: Uuid,
    name: &str,
    description: &str,
) -> Result<(Uuid, i32)> {
    let row = sqlx::query(
        "UPDATE calculators
            SET name = $3, description = $4, version = version + 1, updated_at = now()
          WHERE id = $1 AND owner_id = $2 AND NOT is_builtin
          RETURNING version",
    )
    .bind(id)
    .bind(owner_id)
    .bind(name)
    .bind(description)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    let version = row
        .ok_or(Error::NotFound)?
        .try_get("version")
        .map_err(Error::from_sqlx)?;
    Ok((id, version))
}

/// Inserta la definición de una versión. Nunca actualiza: ver la nota del módulo.
async fn insert_definition(
    tx: &mut Transaction<'static, Postgres>,
    id: Uuid,
    version: i32,
    definition: &Definition,
) -> Result<()> {
    let stored = to_stored(definition)?;

    sqlx::query(
        "INSERT INTO calculator_definitions
             (calculator_id, version, inputs, validations, outputs, indicators_used)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(version)
    .bind(&stored.inputs)
    .bind(&stored.validations)
    .bind(&stored.outputs)
    .bind(definition.indicators_used())
    .execute(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    Ok(())
}

/// Lee una calculadora aplicando la visibilidad de FR-051.
///
/// Es genérica sobre el ejecutor porque la llaman los dos caminos y cada uno tiene el suyo:
/// `get` lee del pool —una lectura suelta no gana nada con una transacción— y `upsert` lee
/// de la transacción abierta, que es la única forma de ver la definición que acaba de
/// insertar. Escribir dos versiones daría dos listas de columnas que podrían divergir.
///
/// # Errores
///
/// [`Error::NotFound`] si no existe o el actor no puede verla. Se devuelve lo MISMO en los
/// dos casos a propósito: distinguirlos convertiría el RPC en un oráculo que confirma la
/// existencia de las calculadoras privadas de otros.
async fn read_one<'e, E>(executor: E, id: Uuid, actor_id: Option<Uuid>) -> Result<CalculatorRow>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let sql = format!(
        "{SELECT_CALCULATOR}
          WHERE c.id = $1 AND (c.state = 'publicada' OR c.owner_id = $2)"
    );

    let row = sqlx::query(&sql)
        .bind(id)
        .bind(actor_id)
        .fetch_optional(executor)
        .await
        .map_err(Error::from_sqlx)?;

    row.as_ref()
        .map(row_from)
        .transpose()?
        .ok_or(Error::NotFound)
}

/// Convierte una fila de [`SELECT_CALCULATOR`] en [`CalculatorRow`].
fn row_from(row: &sqlx::postgres::PgRow) -> Result<CalculatorRow> {
    Ok(CalculatorRow {
        id: row.try_get("id").map_err(Error::from_sqlx)?,
        owner_id: row.try_get("owner_id").map_err(Error::from_sqlx)?,
        name: row.try_get("name").map_err(Error::from_sqlx)?,
        description: row.try_get("description").map_err(Error::from_sqlx)?,
        is_builtin: row.try_get("is_builtin").map_err(Error::from_sqlx)?,
        state: State::from_db(
            &row.try_get::<String, _>("state")
                .map_err(Error::from_sqlx)?,
        )?,
        approved_by: row.try_get("approved_by").map_err(Error::from_sqlx)?,
        rejection_reason: row.try_get("rejection_reason").map_err(Error::from_sqlx)?,
        version: row.try_get("version").map_err(Error::from_sqlx)?,
        definition: from_stored(
            row.try_get("inputs").map_err(Error::from_sqlx)?,
            row.try_get("validations").map_err(Error::from_sqlx)?,
            row.try_get("outputs").map_err(Error::from_sqlx)?,
        )?,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Forma almacenada (data-model.md §2.2)
// ─────────────────────────────────────────────────────────────────────────────

/// Las tres columnas JSONB de una definición, ya validadas por el analizador.
struct Stored {
    inputs: serde_json::Value,
    validations: serde_json::Value,
    outputs: serde_json::Value,
}

/// Campo de entrada tal como se guarda.
///
/// `min`, `max` y `default` se OMITEN cuando no hay cota, en lugar de guardarse como `null`:
/// el contrato ya dice que una cadena vacía significa «sin cota», y una clave ausente se lee
/// igual desde cualquier cliente mientras que un `null` obliga a distinguirlo de «cota
/// nula», que no existe.
#[derive(Debug, Serialize, Deserialize)]
struct InputJson {
    clave: String,
    etiqueta: String,
    tipo: InputKind,
    unidad: String,
    #[serde(
        default,
        with = "serde_decimal::option",
        skip_serializing_if = "Option::is_none"
    )]
    min: Option<rust_decimal::Decimal>,
    #[serde(
        default,
        with = "serde_decimal::option",
        skip_serializing_if = "Option::is_none"
    )]
    max: Option<rust_decimal::Decimal>,
    #[serde(
        default,
        with = "serde_decimal::option",
        skip_serializing_if = "Option::is_none"
    )]
    default: Option<rust_decimal::Decimal>,
    requerido: bool,
}

/// Regla de validación tal como se guarda.
///
/// `texto` es el original del autor y `ast` el artefacto que se ejecuta. Los dos van juntos
/// y por la misma razón que en [`OutputJson`]: ver la nota de `OutputField::source`.
#[derive(Debug, Serialize, Deserialize)]
struct ValidationJson {
    ast: Expr,
    texto: String,
    mensaje: String,
}

/// Salida tal como se guarda.
///
/// ## `texto` y `ast` no son dos copias de lo mismo
///
/// `ast` es lo que se EVALÚA y `texto` lo que el autor ESCRIBIÓ, y el texto existe para que
/// el constructor pueda reabrir la calculadora con la fórmula original en lugar de con una
/// que hubiéramos reformateado nosotros. No se vuelve a analizar nunca: el camino de
/// ejecución lee `ast` y no mira `texto`.
///
/// Esto añade dos campos a la forma que resume data-model.md §2.2. Se documenta allí también,
/// porque un esquema que solo exista en el código es un esquema que se descubre tarde.
#[derive(Debug, Serialize, Deserialize)]
struct OutputJson {
    clave: String,
    etiqueta: String,
    ast: Expr,
    texto: String,
    escala: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cuando: Option<Expr>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    cuando_texto: String,
}

/// Convierte la definición de dominio en las tres columnas JSONB.
///
/// # Errores
///
/// [`Error::Storage`] si `serde_json` rechaza algo. No puede pasar —los tipos son
/// serializables sin condición—, pero tratarlo como imposible obligaría a un `unwrap` que
/// convertiría un fallo de serialización en una caída del servicio.
fn to_stored(definition: &Definition) -> Result<Stored> {
    let inputs = definition
        .inputs
        .iter()
        .map(|input| InputJson {
            clave: input.key.clone(),
            etiqueta: input.label.clone(),
            tipo: input.kind,
            unidad: input.unit.clone(),
            min: input.min,
            max: input.max,
            default: input.default,
            requerido: input.required,
        })
        .collect::<Vec<_>>();

    let validations = definition
        .validations
        .iter()
        .map(|rule| ValidationJson {
            ast: rule.expr.clone(),
            texto: rule.source.clone(),
            mensaje: rule.message.clone(),
        })
        .collect::<Vec<_>>();

    let outputs = definition
        .outputs
        .iter()
        .map(|output| OutputJson {
            clave: output.key.clone(),
            etiqueta: output.label.clone(),
            ast: output.expr.clone(),
            texto: output.source.clone(),
            escala: output.scale,
            cuando: output.when.clone(),
            cuando_texto: output.when_source.clone(),
        })
        .collect::<Vec<_>>();

    Ok(Stored {
        inputs: serde_json::to_value(inputs).map_err(decode_error)?,
        validations: serde_json::to_value(validations).map_err(decode_error)?,
        outputs: serde_json::to_value(outputs).map_err(decode_error)?,
    })
}

/// Reconstruye la definición de dominio desde las tres columnas JSONB.
///
/// # Errores
///
/// [`Error::Storage`] si una columna no tiene la forma documentada. Se trata como fallo de
/// persistencia, que es lo que es: la fila la escribió este mismo módulo, así que una que no
/// encaje significa que algo la tocó por fuera.
fn from_stored(
    inputs: serde_json::Value,
    validations: serde_json::Value,
    outputs: serde_json::Value,
) -> Result<Definition> {
    let inputs = serde_json::from_value::<Vec<InputJson>>(inputs)
        .map_err(decode_error)?
        .into_iter()
        .map(|stored| InputField {
            key: stored.clave,
            label: stored.etiqueta,
            kind: stored.tipo,
            unit: stored.unidad,
            min: stored.min,
            max: stored.max,
            default: stored.default,
            required: stored.requerido,
        })
        .collect();

    let validations = serde_json::from_value::<Vec<ValidationJson>>(validations)
        .map_err(decode_error)?
        .into_iter()
        .map(|stored| ValidationRule {
            expr: stored.ast,
            message: stored.mensaje,
            source: stored.texto,
        })
        .collect();

    let outputs = serde_json::from_value::<Vec<OutputJson>>(outputs)
        .map_err(decode_error)?
        .into_iter()
        .map(|stored| OutputField {
            key: stored.clave,
            label: stored.etiqueta,
            expr: stored.ast,
            scale: stored.escala,
            when: stored.cuando,
            source: stored.texto,
            when_source: stored.cuando_texto,
        })
        .collect();

    Ok(Definition {
        inputs,
        validations,
        outputs,
    })
}

/// Traduce un fallo de `serde_json` a un fallo de persistencia.
fn decode_error(err: serde_json::Error) -> Error {
    Error::Storage(sqlx::Error::Decode(Box::new(err)))
}

/// Comprueba que la forma almacenada es la que se espera, sin tocar PostgreSQL.
///
/// Expuesta para las pruebas de T087: el `round-trip` de una definición por las tres
/// columnas JSONB es lo único de este módulo que se puede verificar sin una base levantada,
/// y es donde vive el riesgo real —el Principio VIII prohíbe que un literal del AST se
/// guarde como número JSON—.
///
/// # Errores
///
/// Los de [`to_stored`] y [`from_stored`].
pub fn round_trip(definition: &Definition) -> Result<Definition> {
    let stored = to_stored(definition)?;
    from_stored(stored.inputs, stored.validations, stored.outputs)
}

/// Expone las tres columnas JSONB de una definición, para inspeccionarlas en una prueba.
///
/// # Errores
///
/// Los de [`to_stored`].
pub fn to_stored_json(definition: &Definition) -> Result<[serde_json::Value; 3]> {
    let stored = to_stored(definition)?;
    Ok([stored.inputs, stored.validations, stored.outputs])
}
