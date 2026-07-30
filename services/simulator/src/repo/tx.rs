//! Helper de transacción del Simulador (Principio XI regla 4: «escrituras
//! multi-tabla vía helper `exec_tx`»).
//!
//! Es el equivalente Rust del `execTx(ctx, fn)` de los servicios Go, y existe por la
//! misma razón: que haya UN solo lugar donde se abre, confirma y revierte una
//! transacción. Una escritura que gestiona su propia transacción y olvida el
//! `rollback` en un camino de error retiene una conexión del pool hasta el timeout, y
//! el síntoma —agotamiento del pool bajo carga— aparece lejísimos de la causa.
//!
//! En Rust el argumento es incluso más fuerte que en Go: `sqlx::Transaction`
//! implementa `Drop` haciendo rollback, así que un `?` en medio de una función
//! revierte de forma silenciosa y CORRECTA... pero sin registrar nada. Con este
//! helper el fallo pasa por un punto que sí puede observarlo.

use std::future::Future;
use std::pin::Pin;

use sqlx::{PgPool, Postgres, Transaction};
use tracing::warn;

use crate::domain::error::{Error, Result};

/// Futuro que devuelve la clausura de [`exec_tx`].
///
/// Hay que boxearlo porque Rust todavía no admite `async` en un parámetro genérico con
/// un lifetime prestado de la propia llamada (`async FnOnce` con HRTB). El coste es una
/// asignación por transacción, irrelevante frente a la ida y vuelta a PostgreSQL.
pub type TxFuture<'c, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'c>>;

/// Ejecuta `f` dentro de una transacción: confirma si devuelve `Ok`, revierte si no.
///
/// La clausura recibe `&mut Transaction` y NO el pool, de modo que dentro de `f` no hay
/// forma de escribir fuera de la transacción por descuido. Ese es el punto de la firma:
/// mezclar una escritura transaccional con otra que va directa al pool produce un estado
/// parcialmente confirmado que ninguna compensación de saga sabe deshacer.
///
/// # Ejemplo
///
/// ```ignore
/// let id = exec_tx(&pool, |tx| Box::pin(async move {
///     let id = insert_simulation(tx, &row).await?;
///     insert_inputs(tx, id, &inputs).await?;
///     Ok(id)
/// })).await?;
/// ```
pub async fn exec_tx<F, T>(pool: &PgPool, f: F) -> Result<T>
where
    F: for<'c> FnOnce(&'c mut Transaction<'static, Postgres>) -> TxFuture<'c, T> + Send,
    T: Send,
{
    let mut tx = pool.begin().await.map_err(Error::from_sqlx)?;

    match f(&mut tx).await {
        Ok(value) => {
            tx.commit().await.map_err(Error::from_sqlx)?;
            Ok(value)
        }
        Err(err) => {
            // El error de la reversión se REGISTRA pero no sustituye al original: el
            // llamador necesita saber por qué falló la operación, no por qué falló el
            // intento de deshacerla. Que el rollback también falle es un dato operativo
            // —normalmente indica que la conexión se cayó— y su sitio es el log.
            if let Err(rollback_err) = tx.rollback().await {
                warn!(
                    error = %rollback_err,
                    "no se pudo revertir la transacción; se propaga el error original"
                );
            }
            Err(err)
        }
    }
}
