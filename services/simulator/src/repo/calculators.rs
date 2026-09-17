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
use sqlx::postgres::PgArguments;
use sqlx::query::Query;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::domain::curation::{self, Situacion};
use crate::domain::decimal_str::serde_decimal;
use crate::domain::definition::{Definition, InputField, OutputField, ValidationRule};
use crate::domain::error::{Error, Result};
use crate::domain::formula::ast::{Expr, InputKind};
use crate::repo::tx::exec_tx;
use crate::repo::{clamp_page_size, parse_page_token};

/// Estado de curaduría, reexportado desde el dominio (T113).
///
/// Vivía en este módulo con el argumento de que «sus valores son el vocabulario de una
/// COLUMNA». Sigue siéndolo, pero las TRANSICIONES entre estados son reglas de negocio —quién
/// puede proponer, quién aprobar, qué pasa al rechazar— y una regla de negocio no puede vivir en
/// la capa de persistencia: la prueba de que ninguna combinación publica una calculadora sin
/// aprobación tiene que poder correr sin PostgreSQL. La reexportación deja a los lectores
/// antiguos compilando y deja claro que el tipo es el mismo.
pub use crate::domain::curation::State;

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
    /// Versión de la definición que se sirvió con esta lectura.
    ///
    /// **No es `calculators.version`**: una calculadora publicada con un borrador encima tiene
    /// dos versiones vivas, y lo que `simulations` cita es la que se EJECUTÓ (FR-050). En la
    /// vista del autor coincide con la vigente; en la pública es la aprobada.
    pub version: i32,
    /// Última versión aprobada, si alguna vez hubo una.
    ///
    /// ## No viaja en el contrato, y es una carencia conocida
    ///
    /// El mensaje `Calculator` del proto no tiene dónde llevarla, así que la interfaz no puede
    /// distinguir «publicada y al día» de «publicada con cambios sin publicar» sin intentar
    /// proponerla y leer el error. Queda anotado en `findings.md` en lugar de añadir un campo al
    /// contrato desde aquí: el contrato se cambia en su tarea, con sus stubs regenerados.
    pub published_version: Option<i32>,
    /// Definición vigente.
    pub definition: Definition,
}

/// Identificador y versión vigente de una calculadora, sin su definición.
///
/// Es lo que `simulations` cita, y los dos campos viajan juntos porque una versión sin su
/// calculadora no se puede interpretar — la misma restricción que impone
/// `simulations_calculator_version_requires_id` en la base.
///
/// Existe en lugar de devolver la [`CalculatorRow`] entera porque la ejecución por
/// `calc_type` solo necesita la PROCEDENCIA que anotar: cargar la definición para
/// descartarla costaría tres columnas `JSONB` por simulación.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VersionRef {
    /// Calculadora.
    pub id: Uuid,
    /// Versión vigente, que es la que la simulación cita.
    pub version: i32,
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

    /// Propone una calculadora propia para publicación (FR-052).
    ///
    /// Pasa el estado a `en_revision` y **retira el motivo del rechazo anterior**, si lo había:
    /// el autor acaba de corregir lo que se le dijo, y dejar el motivo viejo en la ficha haría
    /// que el coordinador leyera, al abrirla, la queja de una versión que ya no existe.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si no existe o no es de `owner_id` —lo mismo que devuelve `get`, para
    /// no confirmar la existencia de calculadoras ajenas—. [`Error::InvalidInput`] si ya está en
    /// revisión, si es una semilla o si no hay nada que proponer porque lo vigente es lo
    /// aprobado.
    async fn submit(&self, id: Uuid, owner_id: Uuid) -> Result<()>;

    /// Aprueba una calculadora propuesta y publica **su versión vigente** (FR-053).
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si no está en revisión, si es una semilla o si `coordinator_id`
    /// es su autor. La base impone la separación de autoría por su cuenta
    /// (`calculators_approver_differs_from_owner`), así que un defecto aquí no basta para
    /// publicar algo propio.
    /// [`Error::NotFound`] si no existe.
    async fn approve(&self, id: Uuid, coordinator_id: Uuid) -> Result<()>;

    /// Rechaza una calculadora propuesta, con un motivo (FR-054).
    ///
    /// El motivo llega **ya normalizado** ([`crate::domain::curation::normalize_reason`]): quien
    /// tiene que poder decírselo al usuario es la capa de transporte, y normalizarlo aquí también
    /// daría dos mensajes distintos para el mismo error.
    ///
    /// # Errores
    ///
    /// Los mismos que [`Calculators::approve`], más [`Error::Storage`] si el `CHECK` de la
    /// columna rechaza el motivo —que no puede pasar si viene normalizado, y que es la red por
    /// debajo—.
    async fn reject(&self, id: Uuid, coordinator_id: Uuid, reason: &str) -> Result<()>;

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

    /// Versión vigente de una definición SEMILLA, por nombre.
    ///
    /// La necesita el camino de compatibilidad por `calc_type`: el contrato dice que
    /// `calc_type` «se resuelve a la definición semilla correspondiente» (FR-043), y
    /// `simulations` cita la versión EXACTA con la que calculó (FR-050). Sin esta consulta,
    /// una simulación nueva por `calc_type` quedaría sin procedencia mientras las 13.493
    /// históricas sí la tienen — dos filas idénticas explicadas de dos maneras distintas, y
    /// la nueva sería la peor explicada.
    ///
    /// Que la atribución sea legítima lo sostiene T092: las semillas reproducen el código
    /// nativo, así que citar la semilla es una cuenta exacta de lo que el nativo calculó.
    /// Es el mismo permiso con el que la migración de T020 rellenó el historial anterior.
    ///
    /// Devuelve `None` si no hay ninguna semilla con ese nombre, y NO es un error: sobre una
    /// base migrada y todavía sin sembrar no hay definición que citar, y la fila se guarda
    /// sin procedencia — que es la verdad.
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la consulta.
    async fn builtin_version(&self, name: &str) -> Result<Option<VersionRef>>;
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

    /// Ejecuta una transición de curaduría: bloquea la fila, decide en el dominio, escribe.
    ///
    /// Las tres transiciones —proponer, aprobar, rechazar— comparten esta forma, y compartirla es
    /// el punto: la DECISIÓN se toma siempre sobre la fila bloqueada y con las mismas cinco
    /// columnas, así que ninguna de las tres puede quedarse mirando un dato de menos.
    ///
    /// `decide` recibe el identificador y la situación y devuelve la consulta ya construida —con
    /// sus parámetros— en lugar de una lista de valores: una lista obligaría a convertir todo a
    /// `String` para poder guardarla, y `approved_by` es un `uuid` que la base rechazaría como
    /// texto.
    ///
    /// ## El identificador se enlaza DENTRO de `decide`, y el primero
    ///
    /// `sqlx` numera los parámetros por ORDEN DE ENLACE, no por el `$n` que lleven en el SQL. Si
    /// esta ayuda enlazara el identificador por su cuenta después de que `decide` hubiera enlazado
    /// `$2`, el `$1` recibiría el valor del `$2` y la consulta fallaría con un
    /// `operator does not exist: uuid = text` que no señala al sitio que se equivocó. Por eso el
    /// identificador entra por parámetro: quien escribe el `UPDATE` ve el `$1` que está enlazando.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si la calculadora no existe. Los que devuelva la decisión y
    /// [`Error::Storage`] si falla la escritura.
    async fn transicion<F>(&self, id: Uuid, decide: F) -> Result<()>
    where
        F: FnOnce(Uuid, &Situacion) -> Result<Query<'static, Postgres, PgArguments>>
            + Send
            + 'static,
    {
        exec_tx(&self.pool, move |tx| {
            Box::pin(async move {
                let situacion = lock_situacion(tx, id).await?;
                decide(id, &situacion)?
                    .execute(&mut **tx)
                    .await
                    .map_err(Error::from_sqlx)?;
                Ok(())
            })
        })
        .await
    }
}

/// Lee la situación de una calculadora con la fila bloqueada.
///
/// `FOR UPDATE` es lo que convierte «leer el estado y decidir» en una operación atómica: sin él,
/// dos coordinadores podrían aprobar y rechazar a la vez partiendo del mismo estado, y el
/// segundo escribiría sobre el resultado del primero.
///
/// # Errores
///
/// [`Error::NotFound`] si no existe. [`Error::Storage`] si falla la lectura.
async fn lock_situacion(tx: &mut Transaction<'static, Postgres>, id: Uuid) -> Result<Situacion> {
    let row = sqlx::query(
        "SELECT state, is_builtin, owner_id, version, published_version
           FROM calculators
          WHERE id = $1
            FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    let row = row.as_ref().ok_or(Error::NotFound)?;
    Ok(Situacion {
        state: State::from_db(
            &row.try_get::<String, _>("state")
                .map_err(Error::from_sqlx)?,
        )?,
        is_builtin: row.try_get("is_builtin").map_err(Error::from_sqlx)?,
        owner_id: row.try_get("owner_id").map_err(Error::from_sqlx)?,
        version: row.try_get("version").map_err(Error::from_sqlx)?,
        published_version: row.try_get("published_version").map_err(Error::from_sqlx)?,
    })
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
                //
                // El actor que se pasa es el AUTOR y no `None`: la lectura de vuelta tiene que
                // ver lo que se acaba de escribir, y la vista pública de una calculadora privada
                // no devuelve nada —`published_version` es nulo—. Devolver `NotFound` desde un
                // `upsert` que acaba de insertar la fila sería el peor de los dos mundos.
                read_one(&mut **tx, id, Some(owner_id)).await
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

        // La vista se elige UNA vez y la usan la página y el total.
        let version = if owner_id.is_some() && !only_published {
            // Listar las propias es listar el taller: el autor ve sus borradores, que es lo que
            // necesita para seguir trabajando.
            VERSION_VIGENTE
        } else {
            // El catálogo enseña lo aprobado aunque quien pregunte sea el autor: una lista
            // rotulada «publicadas» con un borrador dentro pondría en circulación una definición
            // que nadie aprobó (SC-018).
            VERSION_APROBADA
        };

        let page_sql = format!(
            "{}
              WHERE (c.owner_id = $1) OR ($2 AND c.state = 'publicada')
              ORDER BY c.name, c.id
              LIMIT $3 OFFSET $4",
            select_calculator(version)
        );

        let rows = sqlx::query(&page_sql)
            .bind(owner_id)
            .bind(only_published)
            .bind(i64::from(limit))
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(Error::from_sqlx)?;

        // El total usa la MISMA proyección que la página: contar filas que el `JOIN` de la
        // vista descarta daría un total que no corresponde a lo que se está listando —el
        // cliente pediría una página más y la recibiría vacía—.
        let total_sql = format!(
            "SELECT count(*)
               FROM calculators c
               JOIN calculator_definitions d
                 ON d.calculator_id = c.id
                AND d.version = {version}
              WHERE (c.owner_id = $1) OR ($2 AND c.state = 'publicada')"
        );

        let total: i64 = sqlx::query_scalar(&total_sql)
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

    async fn submit(&self, id: Uuid, owner_id: Uuid) -> Result<()> {
        self.transicion(id, move |id, situacion| {
            curation::submit(situacion, owner_id)?;
            Ok(sqlx::query(
                "UPDATE calculators
                    SET state = $2, rejection_reason = NULL, updated_at = now()
                  WHERE id = $1",
            )
            .bind(id)
            .bind(State::EnRevision.as_db()))
        })
        .await
    }

    async fn approve(&self, id: Uuid, coordinator_id: Uuid) -> Result<()> {
        self.transicion(id, move |id, situacion| {
            curation::approve(situacion, coordinator_id)?;
            // `published_version = version` publica la versión que se revisó. No se pasa como
            // parámetro aunque se conozca: leerla en el `UPDATE` la ata a la MISMA fila que el
            // `FOR UPDATE` bloqueó, y un parámetro abriría la puerta a publicar una versión
            // distinta de la que se leyó.
            Ok(sqlx::query(
                "UPDATE calculators
                    SET state = $2, published_version = version, approved_by = $3,
                        rejection_reason = NULL, updated_at = now()
                  WHERE id = $1",
            )
            .bind(id)
            .bind(State::Publicada.as_db())
            .bind(coordinator_id))
        })
        .await
    }

    async fn reject(&self, id: Uuid, coordinator_id: Uuid, reason: &str) -> Result<()> {
        let reason = reason.to_owned();
        self.transicion(id, move |id, situacion| {
            let siguiente = curation::reject(situacion, coordinator_id)?;
            Ok(sqlx::query(
                "UPDATE calculators
                    SET state = $2, rejection_reason = $3, updated_at = now()
                  WHERE id = $1",
            )
            .bind(id)
            .bind(siguiente.as_db())
            .bind(reason.clone()))
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

    async fn builtin_version(&self, name: &str) -> Result<Option<VersionRef>> {
        // Sin transacción: es una lectura, y abrirla solo retendría la conexión más tiempo
        // sin ganar ninguna garantía.
        //
        // No se filtra por estado: las semillas nacen `publicada` y ninguna transición de
        // curaduría las alcanza —`bump` y `delete` exigen autor, y una semilla no tiene—,
        // así que un filtro por estado aquí sería una condición que nunca se evalúa.
        let row = sqlx::query("SELECT id, version FROM calculators WHERE is_builtin AND name = $1")
            .bind(name)
            .fetch_optional(&self.pool)
            .await
            .map_err(Error::from_sqlx)?;

        row.map(|row| {
            Ok(VersionRef {
                id: row.try_get("id").map_err(Error::from_sqlx)?,
                version: row.try_get("version").map_err(Error::from_sqlx)?,
            })
        })
        .transpose()
    }
}

/// Proyección común de lectura, para que `get` y `list` no puedan divergir en columnas.
///
/// Se escribe una vez y se parametriza con el `WHERE` y con la VERSIÓN: dos listas de columnas
/// copiadas es como se llega a que `GetCalculator` devuelva un campo que `ListCalculators` deja
/// vacío.
///
/// `version_expr` es la condición que une cada calculadora con la definición que se sirve, y
/// `d.version` es lo que se devuelve como versión de la fila: la versión que se sirvió, no la que
/// la identidad tenga apuntada. Ver la nota de [`CalculatorRow::version`].
fn select_calculator(version_expr: &str) -> String {
    format!(
        "SELECT c.id, c.owner_id, c.name, c.description, c.is_builtin, c.state,
                c.approved_by, c.rejection_reason, c.published_version,
                d.version, d.inputs, d.validations, d.outputs
           FROM calculators c
           JOIN calculator_definitions d
             ON d.calculator_id = c.id AND d.version = {version_expr}"
    )
}

/// La definición vigente: la última que escribió el autor, aprobada o no.
const VERSION_VIGENTE: &str = "c.version";

/// La última definición aprobada: la que ve el mundo (FR-052).
///
/// Si la calculadora nunca se aprobó, `c.published_version` es nulo y la igualdad no se cumple
/// para ninguna fila: la calculadora simplemente no aparece en esta vista, que es lo que tiene
/// que pasar — sin necesidad de un `CASE` ni de una comprobación aparte.
const VERSION_APROBADA: &str = "c.published_version";

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
/// ## El estado se lee y se reescribe en la MISMA transacción (T113)
///
/// Editar una calculadora en revisión **retira la propuesta**, y esa transición no puede ser un
/// `CASE` dentro del `UPDATE`: quién puede pasar de `en_revision` a `privada` es una regla de
/// negocio y vive en [`crate::domain::curation::after_edit`]. Por eso se lee el estado con
/// `FOR UPDATE` —lo que impide que un coordinador apruebe entre la lectura y la escritura— y se
/// escribe el estado que devuelve el dominio.
///
/// `approved_by` y `published_version` NO se tocan: la versión aprobada sigue viva en el catálogo
/// mientras esta edición espera su turno (FR-052).
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
    let actual = sqlx::query(
        "SELECT state FROM calculators
          WHERE id = $1 AND owner_id = $2 AND NOT is_builtin
            FOR UPDATE",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    let state = actual
        .as_ref()
        .ok_or(Error::NotFound)?
        .try_get::<String, _>("state")
        .map_err(Error::from_sqlx)?;
    let siguiente_estado = curation::after_edit(State::from_db(&state)?);

    let row = sqlx::query(
        "UPDATE calculators
            SET name = $3, description = $4, state = $5, version = version + 1,
                updated_at = now()
          WHERE id = $1 AND owner_id = $2 AND NOT is_builtin
          RETURNING version",
    )
    .bind(id)
    .bind(owner_id)
    .bind(name)
    .bind(description)
    .bind(siguiente_estado.as_db())
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
///
/// `pub(crate)` y no privada porque la siembra de T095 (`repo::seeds`) escribe definiciones
/// por el MISMO camino. Una segunda copia del `INSERT` tendría que conocer la forma almacenada,
/// y la forma almacenada vive en un solo sitio a propósito: ver la nota de [`OutputJson`].
pub(crate) async fn insert_definition(
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
    // La vista se decide DENTRO de la consulta, con una condición sobre la propia fila, y no
    // leyendo antes quién es el autor: entre esa lectura y esta consulta cabría un cambio de
    // autor, y además costaría dos viajes a la base para una sola pregunta.
    //
    // `$2` aparece dos veces y se enlaza una sola vez: PostgreSQL permite repetir un parámetro, y
    // hacerlo es lo que evita tener que pasar el actor por duplicado a `sqlx`.
    let sql = format!(
        "{}
          WHERE c.id = $1 AND (c.state = 'publicada' OR c.owner_id = $2)",
        select_calculator(
            "CASE WHEN c.owner_id IS NOT NULL AND c.owner_id = $2\n                      THEN c.version ELSE c.published_version END"
        )
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
        published_version: row.try_get("published_version").map_err(Error::from_sqlx)?,
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
pub(crate) fn from_stored(
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
