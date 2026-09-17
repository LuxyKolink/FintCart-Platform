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
    ///
    /// El `Display` incluye la causa porque es el que acaba en el LOG (`%err`). Al cliente le
    /// llega [`decimal_str::describe`], que no nombra el módulo; al log le conviene el detalle
    /// completo, y sin él una entrada mal formada dejaría dos líneas idénticas para dos motivos
    /// distintos —«siete decimales» y «separador de miles»—.
    #[error("simulador: valor decimal no válido: {0}")]
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

    /// Marca lo que todavía no tiene cuerpo.
    /// Explícito a propósito: un `Default` silencioso devolvería un resultado con
    /// todos los montos en cero, indistinguible de un cálculo legítimo.
    ///
    /// Lleva el MOTIVO porque el cliente lo lee. «No implementado» a secas deja a quien
    /// llamó sin saber si el problema está en su petición o en el servicio, y en un
    /// contrato que conserva un camino de compatibilidad junto al preferente —`calc_type`
    /// frente a `calculator_id` (FR-043)— esa diferencia es justo la que necesita.
    #[error("simulador: no implementado: {0}")]
    NotImplemented(String),

    /// La operación choca con algo que ya existe.
    ///
    /// Hoy tiene un solo productor: dos vigencias del mismo indicador que se pisan
    /// (FR-059). Está separado de [`Error::InvalidInput`] porque el cliente tiene que
    /// reaccionar distinto: una entrada inválida se corrige y se reintenta con los mismos
    /// datos, un solapamiento se resuelve mirando lo que ya hay. Con un solo código, la
    /// pantalla de administración no podría ofrecer «ver las vigencias de este indicador»
    /// en el caso en que eso es exactamente lo que hace falta.
    ///
    /// El mensaje lleva dentro QUÉ choca cuando se sabe —el rango ya registrado—, porque
    /// quien lo lee está cargando el UVT del año siguiente y lo que necesita saber es cuál
    /// de las dos cifras sobra.
    #[error("simulador: ya existe: {0}")]
    AlreadyExists(String),
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
            // `23P01` es `exclusion_violation`, y hoy la única restricción de exclusión
            // del esquema es `financial_indicators_no_overlap` (FR-059): dos vigencias
            // del mismo indicador que se pisan. Se traduce aquí y no en el repositorio
            // porque es el MISMO embudo por el que entra cualquier otro error del
            // driver, y una segunda puerta para el mismo tipo de error es donde acaba
            // escribiéndose la traducción que falta.
            //
            // Se traduce aunque el repositorio ya compruebe el solapamiento ANTES de
            // insertar: esa comprobación da el mensaje bueno —nombra el rango que ya
            // está—, pero no es una garantía, porque entre la lectura y la escritura
            // cabe otro administrador. El que manda es el `EXCLUDE`, y su error tiene
            // que llegar al cliente como «ya existe» y no como un 500.
            //
            // SI APARECE OTRA RESTRICCIÓN DE EXCLUSIÓN, ESTE MAPEO HAY QUE REVISARLO:
            // atribuiría a un solapamiento de vigencias un choque que es de otra cosa.
            sqlx::Error::Database(ref db) if db.code().as_deref() == Some("23P01") => Self::AlreadyExists(
                "esa vigencia se solapa con otra ya registrada para el mismo indicador".to_owned(),
            ),
            other => Self::Storage(other),
        }
    }
}
