//! Resolución de indicadores por fecha de ejecución (T101; FR-057, FR-059; research
//! D-22).
//!
//! Una consulta y un puerto. El trabajo de este módulo no está en la cantidad de código
//! sino en **qué significa que un indicador no esté**: la resolución devuelve lo que
//! encuentra y calla sobre lo que no, y quien decide qué hacer con un hueco es la
//! evaluación.
//!
//! ## Por qué NO se comprueba aquí que estén todos
//!
//! Sería tentador que [`Indicators::resolve`] fallara si un nombre pedido no tiene
//! vigencia, con un mensaje del tipo «falta el UVT para 2026». Sería un error. Las
//! fórmulas evalúan de forma PEREZOSA: `si(meses > 0, @TASA_USURA * monto, 0)` no lee el
//! indicador cuando `meses` es cero, y `presente(x) o @UVT > 0` no lo lee cuando `x` está.
//! Rechazar en la resolución castigaría ejecuciones que el evaluador habría completado sin
//! tocar el indicador ausente — y el usuario leería «falta el UVT» sobre una calculadora
//! que funciona.
//!
//! Así que el hueco se descubre donde se usa: [`crate::domain::formula::eval`] nombra el
//! indicador que faltó, y solo si de verdad llegó a leerlo. Es el mismo reparto que ya
//! tiene el ámbito con los campos.
//!
//! ## Por qué el valor se lee como TEXTO
//!
//! `value` es `NUMERIC(20,6)`. Leerlo como `Decimal` exigiría habilitar la integración
//! correspondiente de `sqlx`, y leerlo como `f64` está prohibido por el Principio VIII.
//! `value::text` da la representación decimal de PostgreSQL —`50000.000000`, sin notación
//! científica y sin separador de miles—, que [`decimal_str::parse_numeric`] convierte en
//! `Decimal` sin pasar por ningún tipo binario. Es la misma dirección que ya toma el
//! sembrado al escribir (`$3::NUMERIC(20, 6)` desde una cadena).

use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};

/// Una vigencia de indicador, tal como se almacena.
///
/// `value` sale como [`Decimal`] y no como el texto de la columna porque este tipo lo
/// consumen dos sitios con necesidades distintas —el listado de la pantalla de
/// administración y la traducción al contrato— y convertir a texto en cada uno sería tener
/// dos formatos posibles para la misma cifra. La conversión a la forma que viaja ocurre en
/// `grpc::mapping`, una sola vez (Principio IX regla 2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndicatorRow {
    /// Identificador opaco de la vigencia.
    pub id: Uuid,
    /// Nombre con el que las fórmulas la referencian como `@NOMBRE`.
    pub name: String,
    /// Valor vigente.
    pub value: Decimal,
    /// Primer día de vigencia, INCLUSIVE.
    pub valid_from: NaiveDate,
    /// Último día de vigencia EXCLUSIVE.
    ///
    /// Es `None` cuando la vigencia no tiene fin —`upper_inf(validity)`, que el `CHECK`
    /// admite—. No se representa con una fecha centinela porque `9999-12-31` y «sin fin» se
    /// comportan igual en la resolución por fecha pero no en el aviso de vencimiento: un
    /// centinela entraría en el cálculo de días restantes y la alerta diría que el UVT vence
    /// dentro de tres mil años. Ver [`CalendarStatus`].
    pub valid_to: Option<NaiveDate>,
    /// Administrador que la registró (FR-060), como identificador opaco.
    pub registered_by: Uuid,
}

/// Vigencia que termina dentro de la ventana de aviso (FR-061).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expiring {
    /// Nombre del indicador.
    pub name: String,
    /// Día en que deja de estar vigente —el primero SIN cubrir por la vigencia—.
    pub valid_to: NaiveDate,
    /// Días que quedan hasta entonces, contando desde hoy.
    ///
    /// Es `valid_to - hoy`, así que vale cero el día anterior a quedarse sin vigencia (el
    /// último día cubierto es `valid_to - 1`). Se documenta porque es la cifra que lee el
    /// administrador: «quedan 0 días» con el indicador todavía vigente hoy sería confuso si
    /// no estuviera escrito en algún sitio.
    pub days_remaining: i64,
}

/// Estado del calendario de indicadores (FR-061, FR-062).
///
/// ## Por qué «falta» se calcula sobre los nombres YA registrados
///
/// `missing` es la diferencia entre los nombres que existen en el catálogo y los que tienen
/// vigencia hoy. Un nombre que nunca se ha registrado NO puede aparecer aquí: la tabla sabe
/// qué indicadores conoce la plataforma, y pretender enumerar los que el contexto financiero
/// colombiano podría llegar a necesitar es una lista que nadie mantendría y que produciría
/// avisos sobre indicadores que quizá no se usen nunca.
///
/// Así, el aviso dice algo accionable: «el UVT se quedó sin vigencia el 1 de enero». Lo que
/// no dice es «no has cargado el SMMLV», porque de un indicador del que nadie ha oído hablar
/// todavía no hay nada que cargar.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CalendarStatus {
    /// Nombres conocidos sin vigencia para la fecha consultada.
    pub missing: Vec<String>,
    /// Vigencias que terminan dentro de la ventana de aviso.
    pub expiring: Vec<Expiring>,
}

impl CalendarStatus {
    /// Verdadero si no hay nada que avisar.
    ///
    /// Existe para que el barrido del Orquestador (T105) pueda decidir sin mirar las dos
    /// listas: un estado vacío no se publica, y una condición sobre `missing.is_empty() &&
    /// expiring.is_empty()` repetida en cada llamador acabaría olvidándose en uno.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.missing.is_empty() && self.expiring.is_empty()
    }
}

/// Puerta a los indicadores vigentes, vista desde la capa de aplicación.
///
/// Declarada en este módulo y no en `grpc` por la misma razón que
/// [`crate::repo::simulations::Simulations`]: los tipos de la firma son de aquí, y lo que
/// aporta es que `grpc::Service` no sostenga un `PgPool` — con lo que una prueba de
/// contrato puede ejercitar la ejecución sin PostgreSQL.
#[tonic::async_trait]
pub trait Indicators: Send + Sync + 'static {
    /// Valores vigentes en `on` para los indicadores pedidos.
    ///
    /// **Devuelve solo los que tienen vigencia ese día.** Un nombre que no exista, o que
    /// exista con una vigencia que no cubre `on`, simplemente no aparece en el mapa. Ver
    /// la nota del módulo sobre por qué eso no es un error aquí.
    ///
    /// No hay caso especial para el conjunto vacío: quien no tiene nada que preguntar no
    /// llama. La decisión vive en el llamador —`Service::snapshot_for`— porque es allí
    /// donde se sabe que una definición no referencia ningún indicador, y una guarda aquí
    /// sería una segunda copia de esa misma regla que nadie podría ejercitar.
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la consulta; [`Error::InvalidInput`] si un valor
    /// almacenado no es un decimal legible, que no debería ocurrir —`NUMERIC(20,6)`— pero
    /// tratarlo como imposible obligaría a un `unwrap` en la ruta del cálculo.
    async fn resolve(
        &self,
        names: &BTreeSet<String>,
        on: NaiveDate,
    ) -> Result<HashMap<String, Decimal>>;

    /// Registra una vigencia nueva (`existing = None`) o corrige una existente.
    ///
    /// `existing = Some(id)` **sí** modifica la fila, al contrario que en las calculadoras,
    /// donde editar inserta una versión nueva. La diferencia no es un descuido: una
    /// definición de calculadora es un documento que produjo un resultado y queda citado
    /// por él (FR-050), mientras que un indicador es una cifra oficial que se transcribe, y
    /// corregir una errata de transcripción no crea una versión de la ley. Lo que hace que
    /// corregir sea seguro es el snapshot: las simulaciones ya ejecutadas guardaron el valor
    /// que usaron (FR-058) y no cambian porque el catálogo se corrija.
    ///
    /// **El nombre no se puede cambiar.** No es una restricción de la tabla sino de este
    /// contrato: el nombre es el vínculo con las fórmulas que lo referencian, y una fórmula
    /// publicada que busque `@UVT` se quedaría sin valor si esa vigencia pasara a llamarse
    /// otra cosa. Renombrar es crear un indicador distinto, y eso es un alta.
    ///
    /// # Errores
    ///
    /// [`Error::NotFound`] si `existing` no existe.
    /// [`Error::AlreadyExists`] si la vigencia se solapa con otra del mismo nombre (FR-059).
    /// [`Error::InvalidInput`] si se intenta cambiar el nombre.
    /// [`Error::Storage`] si falla la escritura.
    async fn upsert(
        &self,
        existing: Option<Uuid>,
        name: &str,
        value: Decimal,
        from: NaiveDate,
        to: NaiveDate,
        actor_id: Uuid,
    ) -> Result<IndicatorRow>;

    /// Lista vigencias, opcionalmente de un nombre y opcionalmente las del día `on`.
    ///
    /// `on = Some(fecha)` devuelve la vigencia que rige ese día —a lo sumo una por nombre,
    /// porque el `EXCLUDE` garantiza que no se pisen— y `None` devuelve todas, que es lo que
    /// necesita la pantalla de administración para mostrar el histórico.
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la consulta.
    async fn list(&self, name: Option<&str>, on: Option<NaiveDate>) -> Result<Vec<IndicatorRow>>;

    /// Estado del calendario para la fecha `today` (FR-061, FR-062).
    ///
    /// La ventana de aviso entra como parámetro y no como constante del repositorio porque
    /// quien la decide es el dominio ([`crate::domain::indicators::CALENDAR_ALERT_WINDOW_DAYS`]),
    /// y este módulo no debe tener una segunda opinión sobre una regla de negocio.
    ///
    /// # Errores
    ///
    /// [`Error::Storage`] si falla la consulta.
    async fn calendar_status(&self, today: NaiveDate, window_days: i64) -> Result<CalendarStatus>;
}

/// Implementación sobre PostgreSQL.
pub struct PgIndicators {
    pool: PgPool,
}

impl PgIndicators {
    /// Envuelve un pool ya abierto (Principio X: la conexión la abre `main.rs`).
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Comprueba si la vigencia choca con otra y, si choca, la describe.
    ///
    /// ## Por qué hay una comprobación si la base ya lo impide
    ///
    /// El `EXCLUDE USING gist` de FR-059 es la GARANTÍA y sigue siendo el que decide: entre
    /// esta lectura y el `INSERT` cabe otro administrador cargando el mismo año, y la base
    /// rechaza el segundo. Lo que la restricción no puede dar es un mensaje —`sqlx` entrega
    /// «conflicting key value violates exclusion constraint», que no dice qué vigencia se
    /// está pisando—. Esta consulta existe por eso y solo por eso: para que el administrador
    /// lea cuál de las dos cifras sobra. El camino del solapamiento simultáneo lo cubre la
    /// traducción de `23P01` en [`Error::from_sqlx`], que da un mensaje sin el rango.
    ///
    /// # Errores
    ///
    /// [`Error::AlreadyExists`] con el rango que ya está registrado.
    async fn reject_overlap(
        &self,
        name: &str,
        from: NaiveDate,
        to: NaiveDate,
        except: Option<Uuid>,
    ) -> Result<()> {
        let row = sqlx::query(
            "SELECT lower(validity) AS valid_from,
                    CASE WHEN upper_inf(validity) THEN NULL ELSE upper(validity) END AS valid_to
               FROM financial_indicators
              WHERE name = $1
                AND validity && daterange($2::date, $3::date, '[)')
                AND ($4::uuid IS NULL OR id <> $4)
              LIMIT 1",
        )
        .bind(name)
        .bind(from)
        .bind(to)
        .bind(except)
        .fetch_optional(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        let Some(row) = row else {
            return Ok(());
        };

        let desde: NaiveDate = row.try_get("valid_from").map_err(Error::from_sqlx)?;
        let hasta: Option<NaiveDate> = row.try_get("valid_to").map_err(Error::from_sqlx)?;
        let ya_esta = match hasta {
            Some(hasta) => format!("del {desde} al {hasta}"),
            None => format!("desde el {desde} y sin fecha de fin"),
        };

        Err(Error::AlreadyExists(format!(
            "{name} ya tiene una vigencia {ya_esta}, que se solapa con la que se está \
             registrando ({from} a {to})"
        )))
    }
}

#[tonic::async_trait]
impl Indicators for PgIndicators {
    async fn resolve(
        &self,
        names: &BTreeSet<String>,
        on: NaiveDate,
    ) -> Result<HashMap<String, Decimal>> {
        let wanted: Vec<String> = names.iter().cloned().collect();

        // `validity @> $2::date` es la pertenencia al rango, y con la convención
        // `[inicio, fin)` que impone `financial_indicators_validity_half_open` la
        // respuesta es ÚNICA: ningún día pertenece a dos vigencias del mismo nombre, así
        // que no hay `ORDER BY` ni `LIMIT` que decidir aquí — el `EXCLUDE` de FR-059 ya
        // garantizó que no haya con qué desempatar.
        let rows = sqlx::query(
            "SELECT name, value::text AS value
               FROM financial_indicators
              WHERE name = ANY($1) AND validity @> $2::date",
        )
        .bind(&wanted)
        .bind(on)
        .fetch_all(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        rows.into_iter()
            .map(|row| {
                let name: String = row.try_get("name").map_err(Error::from_sqlx)?;
                let raw: String = row.try_get("value").map_err(Error::from_sqlx)?;
                let value = decimal_str::parse_numeric(&raw, 20, 6).map_err(|err| {
                    Error::InvalidInput(format!(
                        "el indicador {name} guarda un valor ilegible: {}",
                        decimal_str::describe(&err)
                    ))
                })?;
                Ok((name, value))
            })
            .collect()
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
        // El valor viaja como texto canónico y la consulta lo castea a `NUMERIC(20,6)`: es la
        // misma dirección que ya toma el sembrado y la única que no pasa por un tipo binario
        // (Principio VIII). `decimal_str::format` no produce notación científica, que es lo
        // que PostgreSQL sí aceptaría y `NUMERIC` guardaría como otra cosa.
        let value_text = decimal_str::format(value);

        if let Some(id) = existing {
            let stored: Option<String> =
                sqlx::query_scalar("SELECT name FROM financial_indicators WHERE id = $1")
                    .bind(id)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(Error::from_sqlx)?;

            let Some(stored) = stored else {
                return Err(Error::NotFound);
            };
            // El nombre es el vínculo con las fórmulas publicadas (ver la nota del trait).
            if stored != name {
                return Err(Error::InvalidInput(format!(
                    "un indicador no se puede renombrar: {stored} pasaría a llamarse {name}, \
                     y las fórmulas que referencian @{stored} se quedarían sin valor"
                )));
            }

            self.reject_overlap(name, from, to, Some(id)).await?;

            let row = sqlx::query(&format!(
                "UPDATE financial_indicators
                    SET value = $2::NUMERIC(20, 6),
                        validity = daterange($3::date, $4::date, '[)')
                  WHERE id = $1
              RETURNING {COLUMNS}"
            ))
            .bind(id)
            .bind(&value_text)
            .bind(from)
            .bind(to)
            .fetch_one(&self.pool)
            .await
            .map_err(Error::from_sqlx)?;

            return row_to_indicator(&row);
        }

        self.reject_overlap(name, from, to, None).await?;

        // El `id` lo pone el `DEFAULT gen_random_uuid()` de la tabla: generarlo aquí sería una
        // segunda forma de lo mismo, y la que manda es la de la base.
        let row = sqlx::query(&format!(
            "INSERT INTO financial_indicators (name, value, validity, registered_by)
             VALUES ($1, $2::NUMERIC(20, 6), daterange($3::date, $4::date, '[)'), $5)
          RETURNING {COLUMNS}"
        ))
        .bind(name)
        .bind(&value_text)
        .bind(from)
        .bind(to)
        .bind(actor_id)
        .fetch_one(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        row_to_indicator(&row)
    }

    async fn list(&self, name: Option<&str>, on: Option<NaiveDate>) -> Result<Vec<IndicatorRow>> {
        // Los dos filtros son opcionales y viajan como parámetros en lugar de armarse en SQL
        // interpolando texto: un nombre que lleve una comilla no debe cambiar la consulta.
        //
        // `ORDER BY name, lower(validity)` no es cosmético: sin orden, PostgreSQL devuelve las
        // filas en el orden que le convenga —que cambia con un `VACUUM` o un plan distinto— y
        // la pantalla de administración mostraría el histórico en un orden distinto cada vez.
        let rows = sqlx::query(&format!(
            "SELECT {COLUMNS}
               FROM financial_indicators
              WHERE ($1::text IS NULL OR name = $1)
                AND ($2::date IS NULL OR validity @> $2::date)
           ORDER BY name, lower(validity)"
        ))
        .bind(name)
        .bind(on)
        .fetch_all(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        rows.iter().map(row_to_indicator).collect()
    }

    async fn calendar_status(&self, today: NaiveDate, window_days: i64) -> Result<CalendarStatus> {
        // Un `NOT EXISTS` y no un `NOT IN`: con `NOT IN` basta que la subconsulta produzca un
        // `NULL` para que el resultado entero sea vacío, y ese es un fallo que no se ve —la
        // lista de «sin vigencia» saldría vacía y el administrador no recibiría nunca un
        // aviso—. `name` es `NOT NULL`, así que hoy no pasaría; la forma que no depende de eso
        // es esta.
        let missing: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT f.name
               FROM financial_indicators f
              WHERE NOT EXISTS (
                    SELECT 1 FROM financial_indicators g
                     WHERE g.name = f.name AND g.validity @> $1::date)
           ORDER BY f.name",
        )
        .bind(today)
        .fetch_all(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        // `NOT upper_inf` es lo que deja fuera las vigencias sin fecha de fin: con un upper
        // infinito, `upper(validity) <= hoy + ventana` sería falso y no aparecerían igualmente,
        // pero el `NOT` explícito documenta que ese caso se pensó en vez de que se descarte por
        // casualidad.
        //
        // El `NOT EXISTS` del sucesor es la diferencia entre un aviso útil y uno que se aprende
        // a ignorar: si el administrador ya cargó el UVT del año siguiente, la vigencia que
        // termina el 31 de diciembre no deja ningún hueco, y avisar de ella treinta días antes
        // sería un aviso que no pide nada. Una alerta que se dispara sin que haya nada que hacer
        // es la que enseña a no leerlas.
        let expiring_rows = sqlx::query(
            "SELECT f.name, upper(f.validity) AS valid_to,
                    (upper(f.validity) - $1::date)::bigint AS days_remaining
               FROM financial_indicators f
              WHERE f.validity @> $1::date
                AND NOT upper_inf(f.validity)
                AND upper(f.validity) <= ($1::date + $2::int)
                AND NOT EXISTS (
                      SELECT 1 FROM financial_indicators g
                       WHERE g.name = f.name AND lower(g.validity) >= upper(f.validity))
           ORDER BY valid_to, f.name",
        )
        .bind(today)
        .bind(i32::try_from(window_days).unwrap_or(i32::MAX))
        .fetch_all(&self.pool)
        .await
        .map_err(Error::from_sqlx)?;

        let expiring = expiring_rows
            .into_iter()
            .map(|row| {
                Ok(Expiring {
                    name: row.try_get("name").map_err(Error::from_sqlx)?,
                    valid_to: row.try_get("valid_to").map_err(Error::from_sqlx)?,
                    days_remaining: row.try_get("days_remaining").map_err(Error::from_sqlx)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(CalendarStatus { missing, expiring })
    }
}

/// Las columnas que devuelve cualquier lectura de este módulo.
///
/// Están en una constante y no repetidas en cada consulta porque `row_to_indicator` lee por
/// NOMBRE: si el `SELECT` de una de las consultas olvidara una columna, la lectura fallaría
/// con un error del driver en tiempo de ejecución —`sqlx` sin macros no comprueba el SQL— que
/// ninguna prueba unitaria vería. Con la lista en un solo sitio, olvidarla no es posible.
const COLUMNS: &str = "id, name, value::text AS value, lower(validity) AS valid_from, \
                      CASE WHEN upper_inf(validity) THEN NULL ELSE upper(validity) END AS valid_to, \
                      registered_by";

/// Traduce una fila a [`IndicatorRow`].
fn row_to_indicator(row: &sqlx::postgres::PgRow) -> Result<IndicatorRow> {
    let name: String = row.try_get("name").map_err(Error::from_sqlx)?;
    let raw: String = row.try_get("value").map_err(Error::from_sqlx)?;
    let value = decimal_str::parse_numeric(&raw, 20, 6).map_err(|err| {
        Error::InvalidInput(format!(
            "el indicador {name} guarda un valor ilegible: {}",
            decimal_str::describe(&err)
        ))
    })?;

    Ok(IndicatorRow {
        id: row.try_get("id").map_err(Error::from_sqlx)?,
        name,
        value,
        valid_from: row.try_get("valid_from").map_err(Error::from_sqlx)?,
        valid_to: row.try_get("valid_to").map_err(Error::from_sqlx)?,
        registered_by: row.try_get("registered_by").map_err(Error::from_sqlx)?,
    })
}
