//! Siembra de las definiciones semilla, del catálogo de indicadores y del relleno del
//! historial (T095; FR-019, FR-058, Principio XII).
//!
//! ## Por qué el sembrado es código Rust y no SQL en `dev/seed`
//!
//! El resto del sembrado del proyecto —el cliente OAuth, el catálogo de ejemplo— es SQL dentro
//! de `dev/seed`, y aquí no puede serlo: una definición semilla son tres columnas `JSONB`
//! producidas por el ANALIZADOR de fórmulas (research D-15). Escribirlas a mano en un
//! `INSERT` significaría mantener una segunda copia del AST, y una copia que no pasa por el
//! analizador es exactamente lo que `seeds::compile()` existe para impedir.
//!
//! Así que el SQL de las semillas vive aquí, junto a la forma almacenada que ya conoce
//! [`crate::repo::calculators`], y `dev/seed` se limita a invocar el binario.
//!
//! ## Por qué la siembra CONVERGE en vez de insertar una vez
//!
//! Ejecutar `dev/seed` dos veces no debe duplicar nada —eso es lo que significa idempotente—,
//! pero «no hacer nada si ya está» sería insuficiente: si la definición de una semilla cambia
//! en el código y la fila se queda como estaba, `Compute` por `calculator_id` ejecutaría el AST
//! VIEJO mientras el binario tiene el nuevo, y nada fallaría. La base y el código dirían cosas
//! distintas sobre la misma calculadora.
//!
//! Por eso la siembra compara la definición almacenada con la compilada y, cuando difieren,
//! **inserta una versión nueva** —nunca sobrescribe— por el mismo camino que una edición de
//! usuario. El historial que citaba la versión anterior sigue explicándose con ella (FR-050).
//!
//! ## Los indicadores son una AYUDA, no la fuente de verdad
//!
//! Ver [`YEAR_INDICATORS`]: los valores sembrados son de EJEMPLO.

use chrono::NaiveDate;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::domain::definition::Definition;
use crate::domain::error::{Error, Result};
use crate::domain::seeds::Compiled;
use crate::repo::calculators::{from_stored, insert_definition};
use crate::repo::tx::exec_tx;

/// Qué le pasó a una semilla al sembrarla.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sembrada {
    /// No existía y se creó con su primera versión.
    Creada,
    /// Existía, pero su definición cambió en el código: se añadió una versión nueva.
    Actualizada,
    /// Existía y coincide con el código: no se tocó.
    Igual,
}

/// Resumen de una siembra de semillas.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Resumen {
    /// Cuántas se crearon.
    pub creadas: usize,
    /// Cuántas recibieron una versión nueva.
    pub actualizadas: usize,
    /// Cuántas ya coincidían.
    pub iguales: usize,
}

impl Resumen {
    fn anota(&mut self, sembrada: Sembrada) {
        match sembrada {
            Sembrada::Creada => self.creadas += 1,
            Sembrada::Actualizada => self.actualizadas += 1,
            Sembrada::Igual => self.iguales += 1,
        }
    }
}

/// Identificador opaco del administrador que registra los indicadores de ejemplo.
///
/// No corresponde a ninguna cuenta real, igual que las identidades del catálogo de ejemplo de
/// `dev/seed`: en desarrollo no hay —ni tiene por qué haber— un administrador dado de alta, y
/// `financial_indicators.registered_by` es `NOT NULL`. Es un identificador de FIXTURE y no debe
/// llegar a producción, donde el valor lo carga un administrador real por `UpsertIndicator`
/// (FR-060).
const FIXTURE_ADMIN: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0ad1);

/// Indicadores que la siembra deja vigentes durante el año en curso.
///
/// ## Estos valores son de EJEMPLO y no son oficiales
///
/// Son cifras REDONDAS a propósito. Un SMMLV o una UVT con aspecto de dato real acabaría
/// citándose como si lo fuera —el simulador los usa para calcular, y una cifra equivocada
/// presentada como buena es el fallo que la plataforma entera existe para evitar—. Redondear
/// los hace reconocibles como lo que son: relleno de desarrollo que permite ejecutar `gmf`
/// —que depende de `@UVT`— y poblar la pantalla de administración.
///
/// **La fuente de verdad es `UpsertIndicator`** (FR-060), con el valor oficial de cada año.
/// Esta lista no la sustituye: existe para que una base recién sembrada sea utilizable.
///
/// Los nombres coinciden exactamente con [`crate::domain::seeds::INDICATORS`], que es el
/// catálogo contra el que se analizan las semillas; hay una prueba que lo comprueba, porque un
/// indicador sembrado con un nombre que ninguna fórmula puede referenciar sería una fila
/// invisible.
pub const YEAR_INDICATORS: [(&str, &str); 5] = [
    ("IPC", "0.05"),
    ("SMMLV", "1600000"),
    ("TASA_USURA", "0.25"),
    ("UVR", "400"),
    ("UVT", "50000"),
];

/// Siembra las siete definiciones semilla.
///
/// # Errores
///
/// [`Error::Storage`] si falla la escritura. Una transacción por semilla y no una para las
/// siete: que la cuarta falle no debe deshacer las tres anteriores, porque el estado que deja
/// es correcto —cada semilla es independiente— y repetir la siembra la retoma donde quedó.
pub async fn seed_builtins(pool: &PgPool, compiled: &[Compiled]) -> Result<Resumen> {
    let mut resumen = Resumen::default();
    for seed in compiled {
        resumen.anota(sembrar_una(pool, seed).await?);
    }
    Ok(resumen)
}

/// Siembra una semilla: la crea, le añade una versión o no la toca.
async fn sembrar_una(pool: &PgPool, seed: &Compiled) -> Result<Sembrada> {
    // La definición se clona para el futuro boxeado de `exec_tx`, que exige `'static`. Es la
    // misma razón —y el mismo coste— que en `PgCalculators::upsert`.
    let definition = seed.definition.clone();
    let id = seed.id;
    let name = seed.name;
    let description = seed.description;

    exec_tx(pool, move |tx| {
        Box::pin(async move {
            let Some(version) = version_vigente(tx, id).await? else {
                // `published_version = 1` en la MISMA fila y no un `UPDATE` después: la
                // restricción `calculators_published_has_version` exige que una calculadora
                // publicada cite la definición aprobada, así que insertarla sin el campo y
                // rellenarlo luego dejaría una fila que el esquema no admite ni un instante.
                //
                // Que la definición todavía no exista no es un problema y no lo es por diseño:
                // la clave foránea `calculators_published_version_exists` es DIFERIBLE y se
                // comprueba al confirmar, así que el orden dentro de esta transacción —primero
                // la calculadora, después su definición— es válido. Ese diferimiento existe
                // justo para este momento.
                //
                // Este error se cazó sembrando una base VACÍA (T163): sobre una base ya
                // sembrada antes de que existiera la restricción, las semillas nunca volvían a
                // insertar —son idempotentes— y la migración de T113 rellenó el campo. El
                // síntoma era el peor posible: `dev/seed` fallando en el único camino que
                // tiene una instalación nueva, con el catálogo de calculadoras vacío.
                sqlx::query(
                    "INSERT INTO calculators \
                       (id, owner_id, name, description, is_builtin, state, published_version)
                     VALUES ($1, NULL, $2, $3, TRUE, 'publicada', 1)",
                )
                .bind(id)
                .bind(name)
                .bind(description)
                .execute(&mut **tx)
                .await
                .map_err(Error::from_sqlx)?;

                insert_definition(tx, id, 1, &definition).await?;
                return Ok(Sembrada::Creada);
            };

            // Se compara la definición almacenada ENTERA con la compilada, `texto` incluido.
            //
            // Comprobado contra una base real, y el resultado corrige lo que yo había escrito
            // aquí: un cambio de SOLO espaciado en una fórmula **sí** crea una versión nueva,
            // porque `OutputField::source` forma parte de `Definition` y el árbol no es lo
            // único que se compara. No es un defecto que haya que arreglar; es la elección
            // conservadora, y conviene tener claro cuál de las dos es:
            //
            //   · Comparar de menos (ignorar `source`) arriesga dejar un AST VIEJO en la base
            //     mientras el binario tiene el nuevo — el fallo silencioso que esta función
            //     existe para impedir.
            //   · Comparar de más cuesta una fila de versión de más cuando alguien refluye una
            //     fórmula. El `texto` es lo que el constructor reabre, así que refrescarlo
            //     tampoco es gratis.
            //
            // Se elige el error barato. Y de paso queda consistente con la regla de la tabla:
            // una definición nunca se actualiza, editar produce una fila nueva.
            let almacenada = definition_vigente(tx, id).await?;
            if almacenada == definition {
                return Ok(Sembrada::Igual);
            }

            let siguiente = version + 1;
            // El nombre y la descripción SÍ se actualizan aquí, al contrario que en la edición
            // de un usuario: son parte del contenido semilla y no hay autoría que respetar.
            sqlx::query(
                "UPDATE calculators
                    SET name = $2, description = $3, version = $4, updated_at = now()
                  WHERE id = $1",
            )
            .bind(id)
            .bind(name)
            .bind(description)
            .bind(siguiente)
            .execute(&mut **tx)
            .await
            .map_err(Error::from_sqlx)?;

            insert_definition(tx, id, siguiente, &definition).await?;
            Ok(Sembrada::Actualizada)
        })
    })
    .await
}

/// Versión vigente de una calculadora, o `None` si no existe.
async fn version_vigente(tx: &mut Transaction<'static, Postgres>, id: Uuid) -> Result<Option<i32>> {
    let row = sqlx::query("SELECT version FROM calculators WHERE id = $1")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(Error::from_sqlx)?;

    row.map(|row| row.try_get("version").map_err(Error::from_sqlx))
        .transpose()
}

/// Definición vigente de una calculadora, reconstruida desde sus tres columnas `JSONB`.
async fn definition_vigente(
    tx: &mut Transaction<'static, Postgres>,
    id: Uuid,
) -> Result<Definition> {
    let row = sqlx::query(
        "SELECT d.inputs, d.validations, d.outputs
           FROM calculators c
           JOIN calculator_definitions d
             ON d.calculator_id = c.id AND d.version = c.version
          WHERE c.id = $1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Error::from_sqlx)?;

    let Some(row) = row else {
        // La calculadora existe pero su versión vigente no está en la tabla de definiciones.
        // No puede pasar —`version` solo sube junto con la inserción de una definición, en la
        // misma transacción— y por eso mismo no se inventa una recuperación: se dice lo que
        // pasa.
        return Err(Error::Storage(sqlx::Error::RowNotFound));
    };

    from_stored(
        row.try_get("inputs").map_err(Error::from_sqlx)?,
        row.try_get("validations").map_err(Error::from_sqlx)?,
        row.try_get("outputs").map_err(Error::from_sqlx)?,
    )
}

/// Deja vigentes los indicadores de EJEMPLO durante el año indicado.
///
/// Devuelve cuántas filas se insertaron. Idempotente: un indicador que ya tiene vigencia
/// solapada con ese año no se vuelve a insertar.
///
/// # Errores
///
/// [`Error::Storage`] si falla la escritura.
pub async fn seed_indicators(pool: &PgPool, year: i32) -> Result<u64> {
    let desde = NaiveDate::from_ymd_opt(year, 1, 1)
        .ok_or_else(|| Error::InvalidInput(format!("año fuera de rango: {year}")))?;
    let hasta = NaiveDate::from_ymd_opt(year + 1, 1, 1)
        .ok_or_else(|| Error::InvalidInput(format!("año fuera de rango: {year}")))?;

    let mut insertadas = 0_u64;

    for (name, value) in YEAR_INDICATORS {
        // La guarda de solapamiento va en el `WHERE NOT EXISTS` y no en un `ON CONFLICT`:
        // `financial_indicators_no_overlap` es una restricción de EXCLUSIÓN, y para que
        // `ON CONFLICT` la reconozca como árbitro habría que nombrarla —y nombrar una
        // restricción de exclusión como destino de conflicto no está admitido—. La
        // comprobación explícita dice además QUÉ se está evitando, que es lo que el
        // `EXCLUDE` protege: que dos vigencias del mismo nombre se pisen.
        let filas = sqlx::query(
            "INSERT INTO financial_indicators (id, name, value, validity, registered_by)
             SELECT $1, $2, $3::NUMERIC(20, 6), daterange($4::date, $5::date, '[)'), $6
              WHERE NOT EXISTS (
                    SELECT 1 FROM financial_indicators
                     WHERE name = $2 AND validity && daterange($4::date, $5::date, '[)')
              )",
        )
        .bind(Uuid::new_v4())
        .bind(name)
        .bind(value)
        .bind(desde)
        .bind(hasta)
        .bind(FIXTURE_ADMIN)
        .execute(pool)
        .await
        .map_err(Error::from_sqlx)?
        .rows_affected();

        insertadas += filas;
    }

    Ok(insertadas)
}

/// Repite el relleno del historial que hace la migración de T020.
///
/// La migración corre ANTES que el sembrado (`dev/build → dev/up → dev/migrate → dev/seed`,
/// Principio XII), así que sobre una base virgen no encuentra ninguna semilla que citar y deja
/// las filas anteriores en `NULL`. Esto cierra ese hueco desde el otro lado.
///
/// ## Por qué el emparejamiento está duplicado, y por qué es aceptable
///
/// Es la misma regla que `20260902123000_simulations_calculator_ref.up.sql`, escrita dos
/// veces. No se puede evitar: una migración ya aplicada no se puede reescribir, y el SQL no
/// puede llamar a código Rust. Lo que sí se puede es que el enunciado viva en un solo sitio
/// —`Calculator.name` y `simulations.calc_type`, ambos con el mismo vocabulario que
/// [`crate::domain::seeds`]— y que las dos copias se lean juntas: la migración apunta aquí y
/// esta función apunta allí.
///
/// Devuelve cuántas filas quedaron explicadas.
///
/// # Errores
///
/// [`Error::Storage`] si falla la escritura.
pub async fn backfill_history(pool: &PgPool) -> Result<u64> {
    let filas = sqlx::query(
        "UPDATE simulations s
            SET calculator_id      = c.id,
                calculator_version = c.version
           FROM calculators c
          WHERE s.calculator_id IS NULL
            AND c.is_builtin
            AND c.name = CASE s.calc_type
                             WHEN 'colombia_especifica' THEN s.inputs ->> 'operacion'
                             ELSE s.calc_type
                         END",
    )
    .execute(pool)
    .await
    .map_err(Error::from_sqlx)?
    .rows_affected();

    Ok(filas)
}
