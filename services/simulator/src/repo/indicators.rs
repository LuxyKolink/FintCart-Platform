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

use crate::domain::decimal_str::{self, DecimalStrError};
use crate::domain::error::{Error, Result};

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
                        describe_decimal_error(&err)
                    ))
                })?;
                Ok((name, value))
            })
            .collect()
    }
}

/// Traduce un fallo de formato a algo que se pueda leer en un log.
///
/// El `Display` de [`DecimalStrError`] empieza por `decimal_str:`, que es el nombre de un
/// módulo y no algo que quien lea el log pueda usar.
fn describe_decimal_error(err: &DecimalStrError) -> String {
    match err {
        DecimalStrError::Empty => "está vacío".to_owned(),
        DecimalStrError::Syntax(value) => {
            format!("«{value}» no es una cifra decimal canónica")
        }
        DecimalStrError::Scale { got, max, .. } => {
            format!("tiene {got} decimales y la columna admite {max}")
        }
        DecimalStrError::Range {
            precision, scale, ..
        } => format!("no cabe en NUMERIC({precision}, {scale})"),
        DecimalStrError::Unrepresentable(value) => {
            format!("«{value}» excede la precisión decimal que admite la plataforma")
        }
    }
}
