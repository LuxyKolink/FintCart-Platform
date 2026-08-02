//! Mapeo proto ↔ dominio (Principio IX regla 3: la conversión ocurre en la frontera,
//! y solo ahí).
//!
//! Los tipos generados por `tonic` NO cruzan hacia `domain` ni hacia `repo`, y los
//! tipos de esos módulos no aparecen en la respuesta sin pasar por aquí. La razón
//! práctica: `ComputeResponse` y [`crate::repo::simulations::SimulationRow`] contienen
//! casi los mismos campos, y en cuanto uno se usa en lugar del otro, un cambio del
//! `.proto` empieza a propagarse hasta el SQL.
//!
//! Aquí no se convierte NINGÚN decimal. Los montos ya llegan y salen como cadena
//! canónica; el único módulo que convierte texto ↔ [`rust_decimal::Decimal`] es
//! `domain::decimal_str` (Principio VIII / D-10).

use crate::domain::dispatch::Kind;
use crate::domain::error::{Error, Result};
use crate::pb::fintcart::common::v1::PageResponse;
use crate::pb::fintcart::simulator::v1::{
    list_history_response::Entry, ComputeResponse, ListHistoryResponse,
};
use crate::repo::simulations::{HistoryPage, SimulationRow};

/// Formato en el que viajan los instantes: RFC-3339 en UTC, como declara el contrato.
///
/// Se serializa con `to_rfc3339` y no con el `Display` por defecto de `chrono`, que
/// produce `2026-08-01 12:00:00 UTC` — legible pero no parseable por un cliente que
/// espera un `Timestamp` del contrato.
fn rfc3339(instant: chrono::DateTime<chrono::Utc>) -> String {
    instant.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Convierte la fila recién insertada en la respuesta de `Compute`.
#[must_use]
pub fn compute_response(row: &SimulationRow) -> ComputeResponse {
    ComputeResponse {
        simulation_id: row.id.to_string(),
        result: row.result.clone(),
        computed_at: rfc3339(row.created_at),
    }
}

/// Convierte una página del historial en la respuesta de `ListHistory`.
///
/// # Errores
///
/// [`Error::InvalidInput`] si una fila guarda un `calc_type` que ya no corresponde a
/// ninguna calculadora. Ver [`Kind::from_db`].
pub fn history_response(page: HistoryPage) -> Result<ListHistoryResponse> {
    let items = page
        .items
        .into_iter()
        .map(|row| {
            Ok(Entry {
                simulation_id: row.id.to_string(),
                calc_type: Kind::from_db(&row.calc_type)?.as_proto() as i32,
                currency: row.currency,
                inputs: row.inputs,
                result: row.result,
                created_at: rfc3339(row.created_at),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(ListHistoryResponse {
        items,
        page: Some(PageResponse {
            next_page_token: page.next_page_token,
            total_size: page.total,
        }),
    })
}

/// Interpreta el UUID opaco de un titular.
///
/// # Errores
///
/// [`Error::InvalidInput`] si no es un UUID. Se valida ANTES de llegar al SQL: `sqlx`
/// lo rechazaría igual, pero como un error del driver, y el mensaje resultante hablaría
/// de tipos de PostgreSQL en lugar del campo que venía mal.
pub fn parse_user_id(raw: &str) -> Result<uuid::Uuid> {
    uuid::Uuid::parse_str(raw)
        .map_err(|_| Error::InvalidInput(format!("user_id {raw:?} no es un UUID")))
}
