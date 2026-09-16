//! Capa de persistencia del Simulador (Principio IX: la capa de abajo).
//!
//! Traduce llamadas de función en SQL contra `simulator_db` y nada más: sin reglas de
//! negocio, sin tipos proto y sin decidir el alcance de una transacción fuera de
//! [`tx::exec_tx`].
//!
//! La anonimización (FR-030) NO tiene módulo propio: vive junto al resto de las
//! operaciones sobre `simulations`, porque es un `UPDATE` sobre esa misma tabla.
//! Separarla sugeriría que toca otro almacén.

pub mod calculators;
pub mod seeds;
pub mod simulations;
pub mod tx;

/// Tamaño de página por defecto cuando el cliente no pide ninguno.
pub const DEFAULT_PAGE_SIZE: i32 = 20;

/// Tope de página.
///
/// No es negociable con el cliente: sin él, un `page_size` de un millón traería la tabla
/// entera a memoria y el fallo aparecería como una caída del servicio, no como una
/// petición desmedida.
pub const MAX_PAGE_SIZE: i32 = 100;

/// Acota el tamaño de página pedido.
///
/// Vive aquí y no en cada módulo porque lo usan las dos tablas paginadas —el historial y el
/// catálogo de calculadoras— y dos copias divergirían justo en el borde: una aceptaría 100 y
/// la otra 50, y el cliente que pagina las dos no tendría forma de saber por qué.
pub fn clamp_page_size(requested: i32) -> i32 {
    match requested {
        n if n <= 0 => DEFAULT_PAGE_SIZE,
        n if n > MAX_PAGE_SIZE => MAX_PAGE_SIZE,
        n => n,
    }
}

/// Interpreta el token de página como desplazamiento.
///
/// # Errores
///
/// [`crate::domain::error::Error::InvalidInput`] si el token no es un entero no negativo.
/// Se rechaza en vez de tratarlo como cero: devolver silenciosamente la primera página ante
/// un token corrupto haría que un cliente con un error de paginación recorriera la lista en
/// bucle sin enterarse.
pub fn parse_page_token(token: &str) -> crate::domain::error::Result<i64> {
    use crate::domain::error::Error;

    if token.is_empty() {
        return Ok(0);
    }
    token
        .parse::<i64>()
        .ok()
        .filter(|offset| *offset >= 0)
        .ok_or_else(|| Error::InvalidInput(format!("page_token {token:?} no es válido")))
}
