//! Convención de errores del Simulador (Principio XI regla 6: «errores envueltos
//! con causa preservada»).
//!
//! La regla tiene dos mitades y las dos importan:
//!
//! 1. **La causa se preserva.** Cada variante que envuelve un error ajeno lo hace
//!    con `#[source]` o `#[from]`, nunca formateándolo en una `String`. Así
//!    `std::error::Error::source()` sigue funcionando y el que depura llega hasta el
//!    `sqlx::Error` original —o hasta el `DecimalStrError` que lo originó— en lugar
//!    de leer un mensaje que ya perdió el detalle.
//! 2. **El tipo del driver NO cruza la frontera.** La capa gRPC razona sobre estas
//!    variantes, no sobre `sqlx::Error`. Eso permite cambiar de driver sin tocar el
//!    mapeo a códigos de estado.
//!
//! El resultado es un error que se discrimina por variante en la capa de arriba y
//! que sigue conteniendo el detalle técnico para el log.

use crate::domain::decimal_str::DecimalStrError;

/// Error de dominio del Simulador.
///
/// Es un enum y no un `Box<dyn Error>` a propósito: la capa de transporte tiene que
/// decidir un código gRPC por cada caso, y con un error opaco esa decisión se
/// convertiría en comparar cadenas. Con un enum, añadir una variante rompe el `match`
/// del mapeo y el compilador obliga a decidir su código.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Entrada que no se puede usar: falta un parámetro o el tipo de cálculo no
    /// admite el conjunto recibido.
    #[error("simulador: entrada inválida: {0}")]
    InvalidInput(String),

    /// Un valor decimal del contrato no es canónico o no cabe en su columna.
    ///
    /// Se envuelve con `#[from]` para que `?` convierta automáticamente: el helper
    /// `decimal_str` se usa en cada frontera, y tener que mapear el error a mano en
    /// cada llamada invitaría a escribir un `.unwrap()` (Principio VIII).
    #[error("simulador: valor decimal no válido")]
    Decimal(#[from] DecimalStrError),

    /// La simulación pedida no existe.
    #[error("simulador: no encontrado")]
    NotFound,

    /// Fallo de la capa de persistencia.
    ///
    /// `#[source]` y no `#[from]`: la conversión automática desde `sqlx::Error` sería
    /// cómoda, pero haría que un `?` en cualquier sitio convirtiera silenciosamente un
    /// error del driver en un error de dominio. En particular, `sqlx::Error::RowNotFound`
    /// debe convertirse en [`Error::NotFound`] y no en un `Storage` genérico —y con
    /// `#[from]` esa distinción se perdería sin que nada avisara.
    #[error("simulador: fallo de persistencia")]
    Storage(#[source] sqlx::Error),

    /// Marca lo que todavía no tiene cuerpo (esqueleto de T024–T031).
    ///
    /// Explícito a propósito: un `Default` silencioso devolvería un resultado con
    /// todos los montos en cero, indistinguible de un cálculo legítimo.
    #[error("simulador: no implementado")]
    NotImplemented,
}

/// Alias del `Result` del servicio.
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Convierte un error de `sqlx` preservando la distinción de «no encontrado».
    ///
    /// Es el único punto donde un `sqlx::Error` entra al dominio, y por eso es también
    /// el único lugar donde puede olvidarse esta traducción. `RowNotFound` tratado como
    /// `Storage` haría que una consulta sin resultados se presentara como un fallo de
    /// infraestructura: el cliente recibiría un 500 reintentable en lugar de un 404, y
    /// reintentaría indefinidamente algo que nunca va a existir.
    pub fn from_sqlx(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => Self::NotFound,
            other => Self::Storage(other),
        }
    }
}
