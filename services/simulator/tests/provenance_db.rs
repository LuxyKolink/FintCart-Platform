//! Verificación del SQL de la procedencia contra PostgreSQL 16 (T091, T101, T103).
//!
//! ## Qué cubre esto que ninguna otra prueba puede
//!
//! El resto de la suite del Simulador no toca una base de datos: `cargo test` corre en CI sin
//! ninguna levantada, y las pruebas de contrato sustituyen la persistencia por dobles. Eso deja
//! un hueco concreto y estrecho —el que hay entre el SQL escrito en Rust y el esquema real— y es
//! justo donde vive un `$1`/`$2` intercambiado, un tipo que `sqlx` no sabe convertir o una
//! columna que se llama distinto. Un doble nunca lo delata: el doble acepta lo que le den.
//!
//! ## Están IGNORADAS a propósito, y por eso hay que pedirlas
//!
//! Corren contra la base de DESARROLLO (`dev/up`), así que no pueden formar parte de la suite
//! normal: atarlas a una base levantada haría que `cargo test` fallara en cualquier máquina
//! donde nadie la hubiera arrancado, que es exactamente lo que el módulo de `contract.rs`
//! documenta como motivo para usar dobles. Se ejecutan así:
//!
//! ```sh
//! dev/up && dev/migrate && dev/seed
//! cargo test --test provenance_db -- --ignored
//! ```
//!
//! `SIMULATOR_TEST_DB_ADDR` permite apuntar a otra base; por defecto usa la de desarrollo.
//!
//! ## Escriben y limpian
//!
//! Insertan filas de verdad —un `INSERT` que se quedara en una transacción sin confirmar no
//! probaría lo que hay que probar, que es que el esquema las ACEPTA— y las borran al terminar,
//! incluso si la prueba falla por el camino. Los nombres de indicador llevan el prefijo
//! `ZZTEST`, que ningún indicador real usa y que el `CHECK` de formato admite.

use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDate;
use fintcart_simulator::repo::calculators::{Calculators, PgCalculators, State};
use fintcart_simulator::repo::indicators::{Indicators, PgIndicators};
use fintcart_simulator::repo::simulations::{
    NewSimulation, PgSimulations, Provenance, Simulations,
};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Cadena de conexión a la base de desarrollo.
///
/// El valor por defecto es el de `dev/docker-compose.yaml` —incluida la contraseña, que es de
/// desarrollo y está a la vista en ese archivo—, y se puede sustituir por entorno para apuntar
/// a otra base.
fn db_addr() -> String {
    std::env::var("SIMULATOR_TEST_DB_ADDR").unwrap_or_else(|_| {
        "postgres://fintcart:dev_only_password@localhost:5436/simulator_db?sslmode=disable"
            .to_owned()
    })
}

/// Abre el pool, con un mensaje que dice qué hacer cuando no hay base.
async fn pool() -> PgPool {
    PgPool::connect(&db_addr()).await.unwrap_or_else(|err| {
        panic!(
            "no se pudo conectar a {}: {err}\n\
             Estas pruebas necesitan la base de desarrollo: `dev/up && dev/migrate && dev/seed`",
            db_addr()
        )
    })
}

/// Borra las filas de prueba al salir, incluso si la prueba falla.
///
/// Sin esto, una prueba que falle a mitad dejaría sus indicadores `ZZTEST` en la base y la
/// siguiente ejecución chocaría con `financial_indicators_no_overlap` — un fallo que hablaría
/// de la ejecución anterior en vez de la actual.
struct Limpieza {
    pool: PgPool,
    indicadores: Vec<String>,
    simulaciones: Vec<Uuid>,
}

impl Limpieza {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            indicadores: Vec::new(),
            simulaciones: Vec::new(),
        }
    }

    fn con_indicador(&mut self, name: &str) -> &mut Self {
        self.indicadores.push(name.to_owned());
        self
    }

    fn con_simulacion(&mut self, id: Uuid) -> &mut Self {
        self.simulaciones.push(id);
        self
    }

    async fn limpia(&self) {
        for name in &self.indicadores {
            let _ = sqlx::query("DELETE FROM financial_indicators WHERE name = $1")
                .bind(name)
                .execute(&self.pool)
                .await;
        }
        for id in &self.simulaciones {
            let _ = sqlx::query("DELETE FROM simulations WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await;
        }
    }
}

/// Inserta una vigencia de indicador, saltándose el repositorio a propósito.
///
/// Lo que se prueba es la LECTURA, así que la escritura se hace por SQL directo: pasar por un
/// `UpsertIndicator` que todavía no existe (T104) obligaría a implementarlo aquí para poder
/// probar otra cosa.
async fn siembra_indicador(pool: &PgPool, name: &str, value: &str, desde: &str, hasta: &str) {
    sqlx::query(
        "INSERT INTO financial_indicators (id, name, value, validity, registered_by)
         VALUES ($1, $2, $3::NUMERIC(20,6), daterange($4::date, $5::date, '[)'), $6)",
    )
    .bind(Uuid::new_v4())
    .bind(name)
    .bind(value)
    .bind(desde)
    .bind(hasta)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("la vigencia de prueba tiene que insertarse");
}

// ── T101: resolución por vigencia ───────────────────────────────────────────

/// El valor que se resuelve es el de la vigencia que CUBRE la fecha, no el último cargado.
///
/// Es la consulta de `PgIndicators::resolve` contra el esquema real: `name = ANY($1)` con
/// `validity @> $2::date`. Un error aquí no lo vería ninguna otra prueba —el doble de
/// indicadores devuelve un mapa que la prueba misma construyó—, y el síntoma en producción
/// sería un cálculo con el UVT de otro año.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_valor_resuelto_es_el_de_la_vigencia_que_cubre_la_fecha() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza
        .con_indicador("ZZTESTANUAL")
        .con_indicador("ZZTESTSINVIGENCIA");

    // Dos vigencias consecutivas del mismo indicador, con valores distintos: es el caso que
    // hace visible la diferencia entre «el valor de 2025» y «el de 2026».
    siembra_indicador(&pool, "ZZTESTANUAL", "100", "2025-01-01", "2026-01-01").await;
    siembra_indicador(&pool, "ZZTESTANUAL", "200", "2026-01-01", "2027-01-01").await;

    let repo = PgIndicators::new(pool.clone());
    let nombres = BTreeSet::from([
        "ZZTESTANUAL".to_owned(),
        "ZZTESTSINVIGENCIA".to_owned(),
        "ZZTESTNOEXISTE".to_owned(),
    ]);

    let en_2025 = repo
        .resolve(&nombres, NaiveDate::from_ymd_opt(2025, 6, 15).unwrap())
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(en_2025.get("ZZTESTANUAL"), Some(&Decimal::new(100, 0)));

    let en_2026 = repo
        .resolve(&nombres, NaiveDate::from_ymd_opt(2026, 6, 15).unwrap())
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(
        en_2026.get("ZZTESTANUAL"),
        Some(&Decimal::new(200, 0)),
        "la misma consulta, otra fecha, otro valor"
    );

    // El 1 de enero pertenece a la vigencia que EMPIEZA ese día, no a la que terminó el día
    // anterior. Es la convención `[inicio, fin)` que impone
    // `financial_indicators_validity_half_open`, y el día del cambio es exactamente donde una
    // consulta escrita con `BETWEEN` daría las dos respuestas.
    let el_dia_del_cambio = repo
        .resolve(&nombres, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap())
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(
        el_dia_del_cambio.get("ZZTESTANUAL"),
        Some(&Decimal::new(200, 0)),
        "el extremo inferior es INCLUSIVO y el superior EXCLUSIVO"
    );

    // Un nombre sin vigencia para esa fecha no aparece; tampoco uno que no existe. No es un
    // error aquí: el evaluador es perezoso y solo falla si de verdad llega a leerlo.
    assert!(!en_2026.contains_key("ZZTESTSINVIGENCIA"));
    assert!(!en_2026.contains_key("ZZTESTNOEXISTE"));
    assert_eq!(en_2026.len(), 1);

    // El texto que devuelve `value::text` es el que `decimal_str::parse_numeric` acepta:
    // `NUMERIC(20,6)` lo entrega relleno de ceros y con seis decimales.
    siembra_indicador(&pool, "ZZTESTCONESCALA", "0.05", "2026-01-01", "2027-01-01").await;
    let con_escala = repo
        .resolve(
            &BTreeSet::from(["ZZTESTCONESCALA".to_owned()]),
            NaiveDate::from_ymd_opt(2026, 6, 15).unwrap(),
        )
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(
        con_escala.get("ZZTESTCONESCALA"),
        Some(&Decimal::new(5, 2)),
        "un valor con decimales vuelve exacto, no redondeado a entero"
    );

    limpieza.con_indicador("ZZTESTCONESCALA").limpia().await;
}

// ── T091 / T103: procedencia persistida ─────────────────────────────────────

/// Una simulación vuelve del historial con su procedencia intacta (FR-050, FR-058, SC-019).
///
/// Comprueba las dos mitades de T103 contra el esquema real: que el `INSERT` con las tres
/// columnas nuevas es ACEPTADO —los CHECK de `calc_type`, la clave foránea a `calculators` y la
/// guardia de números JSON del snapshot— y que al releerla los valores vuelven como entraron,
/// sin pasar por ningún tipo binario.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn una_simulacion_conserva_su_procedencia_en_la_ida_y_vuelta() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());

    // La procedencia se toma de una semilla REAL, que es lo que hace el camino de
    // compatibilidad: `builtin_version` la busca por nombre. Si no está sembrada, esta prueba
    // no puede afirmar nada y lo dice.
    let calculadoras = PgCalculators::new(pool.clone());
    let semilla = calculadoras
        .builtin_version("gmf")
        .await
        .expect("la consulta debe funcionar")
        .expect("hace falta `dev/seed` ejecutado: la semilla `gmf` no está");

    let user_id = Uuid::new_v4();
    let repo = PgSimulations::new(pool.clone());

    let fila = repo
        .insert(&NewSimulation {
            user_id,
            // Una semilla NO se registra como 'usuario': `gmf` salió de la antigua
            // `colombia_especifica` (D-29).
            calc_type: "colombia_especifica".to_owned(),
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "1000000.00".to_owned())]),
            result: HashMap::from([("gravamen".to_owned(), "4000".to_owned())]),
            provenance: Provenance::definition(
                semilla.id,
                semilla.version,
                // Una cadena y no un número: `jsonb_has_no_numbers` rechazaría el número, y
                // ese rechazo es precisamente lo que esta prueba ejerce.
                HashMap::from([("UVT".to_owned(), "50000".to_owned())]),
            ),
            idempotency_key: None,
        })
        .await
        .expect("el esquema tiene que aceptar una simulación con procedencia");
    // Se apunta para borrarla al FINAL: limpiar aquí sería borrar la fila justo antes de
    // releerla, que es lo que hace que esta prueba no pruebe nada.
    limpieza.con_simulacion(fila.id);

    assert_eq!(fila.calculator_id, Some(semilla.id));
    assert_eq!(fila.calculator_version, Some(semilla.version));
    assert_eq!(
        fila.indicators_snapshot.get("UVT").map(String::as_str),
        Some("50000")
    );

    // Y al releerla del historial, la procedencia sigue ahí. Es la mitad de FR-058 que hace
    // auditable una simulación de hace un año: el resultado se explica con el valor que regía
    // entonces, no con el de hoy.
    let pagina = repo
        .list_by_user(user_id, 10, "")
        .await
        .expect("el historial tiene que leerse");
    let leida = pagina
        .items
        .iter()
        .find(|row| row.id == fila.id)
        .expect("la simulación recién insertada tiene que aparecer");

    assert_eq!(leida.calculator_id, Some(semilla.id));
    assert_eq!(leida.calculator_version, Some(semilla.version));
    assert_eq!(
        leida.indicators_snapshot.get("UVT").map(String::as_str),
        Some("50000")
    );

    limpieza.limpia().await;
}

/// Una simulación del código nativo se guarda sin indicadores, y eso es un dato.
///
/// El mapa vacío no es un hueco: las cinco calculadoras nativas llevan sus constantes en el
/// código y `gmf` recibe la UVT como ENTRADA, así que no leen ninguna fila de
/// `financial_indicators`. La columna lo dice, y `jsonb_typeof` tiene que seguir siendo
/// `object` —el CHECK rechazaría un `null`—.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn una_simulacion_nativa_se_guarda_sin_indicadores() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());

    let semilla = PgCalculators::new(pool.clone())
        .builtin_version("credito")
        .await
        .expect("la consulta debe funcionar")
        .expect("hace falta `dev/seed` ejecutado: la semilla `credito` no está");

    let user_id = Uuid::new_v4();
    let repo = PgSimulations::new(pool.clone());

    let fila = repo
        .insert(&NewSimulation {
            user_id,
            calc_type: "credito".to_owned(),
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "12000000.00".to_owned())]),
            result: HashMap::from([("cuota_mensual".to_owned(), "634000.00".to_owned())]),
            provenance: Provenance::native(Some(semilla)),
            idempotency_key: None,
        })
        .await
        .expect("el esquema tiene que aceptar una simulación sin indicadores");
    limpieza.con_simulacion(fila.id);

    assert!(fila.indicators_snapshot.is_empty());
    assert_eq!(fila.calculator_id, Some(semilla.id));

    // La columna guarda un OBJETO vacío y no un nulo: `indicators_snapshot` es `NOT NULL` con
    // `CHECK (jsonb_typeof(...) = 'object')`, y un mapa vacío serializado como `null` haría
    // fallar el CHECK en vez de guardar cero indicadores.
    let tipo: String = sqlx::query_scalar(
        "SELECT jsonb_typeof(indicators_snapshot) FROM simulations WHERE id = $1",
    )
    .bind(fila.id)
    .fetch_one(&pool)
    .await
    .expect("la fila tiene que leerse");
    assert_eq!(tipo, "object");

    limpieza.limpia().await;
}

/// El snapshot es una COPIA, no una referencia: cambiar el indicador no reescribe el pasado
/// (FR-058, SC-019).
///
/// Es la propiedad que justifica que la columna exista. Si el snapshot fuera una referencia
/// al valor vigente, reabrir en 2027 una simulación de 2026 mostraría una cifra que ya no se
/// puede reconstruir — y el historial dejaría de ser auditable justo cuando más importa.
///
/// Se comprueba en los dos sentidos a la vez, que es lo que hace la prueba concluyente: el
/// valor VIGENTE cambia, y el valor GUARDADO no.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn cambiar_un_indicador_no_altera_las_simulaciones_que_ya_lo_usaron() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con_indicador("ZZTESTUVR");

    let user_id = Uuid::new_v4();
    let repo = PgSimulations::new(pool.clone());
    let indicadores = PgIndicators::new(pool.clone());

    // La procedencia cita una semilla REAL: `simulations_calculator_id_fkey` exige que la
    // calculadora exista, así que un identificador inventado no probaría nada más que la
    // clave foránea. Lo que se prueba aquí es el snapshot, no la atribución.
    let semilla = PgCalculators::new(pool.clone())
        .builtin_version("gmf")
        .await
        .expect("la consulta debe funcionar")
        .expect("hace falta `dev/seed` ejecutado: la semilla `gmf` no está");

    // Una simulación calculada cuando el indicador valía 100.
    let fila = repo
        .insert(&NewSimulation {
            user_id,
            calc_type: "colombia_especifica".to_owned(),
            currency: "COP".to_owned(),
            inputs: HashMap::from([("monto".to_owned(), "1".to_owned())]),
            result: HashMap::from([("salida".to_owned(), "100".to_owned())]),
            provenance: Provenance::definition(
                semilla.id,
                1,
                HashMap::from([("ZZTESTUVR".to_owned(), "100".to_owned())]),
            ),
            idempotency_key: None,
        })
        .await
        .expect("el esquema tiene que aceptar la simulación");
    limpieza.con_simulacion(fila.id);

    // Y ahora el indicador cambia: se carga el del año siguiente con OTRO valor.
    siembra_indicador(&pool, "ZZTESTUVR", "100", "2025-01-01", "2026-01-01").await;
    siembra_indicador(&pool, "ZZTESTUVR", "250", "2026-01-01", "2027-01-01").await;

    // La resolución de HOY devuelve el valor nuevo — si devolviera el viejo, la prueba de
    // abajo pasaría por el motivo equivocado.
    let hoy = indicadores
        .resolve(
            &BTreeSet::from(["ZZTESTUVR".to_owned()]),
            NaiveDate::from_ymd_opt(2026, 6, 15).unwrap(),
        )
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(
        hoy.get("ZZTESTUVR"),
        Some(&Decimal::new(250, 0)),
        "el valor vigente tiene que haber cambiado, o esta prueba no prueba nada"
    );

    // Y la simulación guardada sigue diciendo 100: el resultado histórico se explica con el
    // valor que lo produjo, no con el de hoy.
    let pagina = repo
        .list_by_user(user_id, 10, "")
        .await
        .expect("el historial tiene que leerse");
    let leida = pagina
        .items
        .iter()
        .find(|row| row.id == fila.id)
        .expect("la simulación tiene que seguir en el historial");

    assert_eq!(
        leida
            .indicators_snapshot
            .get("ZZTESTUVR")
            .map(String::as_str),
        Some("100"),
        "el snapshot es una copia congelada, no una referencia al valor vigente"
    );

    limpieza.limpia().await;
}

// ── Semillas por nombre ─────────────────────────────────────────────────────

/// `builtin_version` encuentra las siete semillas y solo esas.
///
/// Es la consulta con la que el camino de compatibilidad atribuye una simulación a la
/// definición que la reproduce (FR-050). Si devolviera `None` para una semilla real, toda
/// ejecución por `calc_type` quedaría sin procedencia en silencio —el `UPDATE` de relleno de
/// T020 sí la puso en el historial antiguo, así que las dos quedarían explicadas de dos maneras
/// distintas— y nada fallaría.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn las_siete_semillas_se_encuentran_por_su_nombre() {
    let pool = pool().await;
    let repo = PgCalculators::new(pool);

    for name in [
        "ahorro",
        "credito",
        "presupuesto",
        "inversion",
        "ea_a_mv",
        "mv_a_ea",
        "gmf",
    ] {
        let encontrada = repo
            .builtin_version(name)
            .await
            .expect("la consulta debe funcionar")
            .unwrap_or_else(|| panic!("la semilla «{name}» no está: ¿falta `dev/seed`?"));

        assert!(
            encontrada.version >= 1,
            "«{name}» tiene una versión inválida"
        );

        // Y la fila ENTERA, que es lo que el camino de compatibilidad ejecuta desde T098: no solo
        // atribuye la simulación a la semilla, corre su definición. `builtin_by_name` trae las
        // tres columnas JSONB por el mismo `SELECT` que `get`, y esto comprueba justo eso — que la
        // definición vuelve analizable, con sus fórmulas y su escala, y no a medias.
        let completa = repo
            .builtin_by_name(name)
            .await
            .expect("la consulta debe funcionar")
            .unwrap_or_else(|| panic!("la semilla «{name}» no está: ¿falta `dev/seed`?"));
        assert!(completa.is_builtin, "«{name}» tendría que ser una semilla");
        assert_eq!(
            completa.state,
            State::Publicada,
            "las semillas nacen publicadas y ninguna transición de curaduría las alcanza"
        );
        assert_eq!(
            completa.id, encontrada.id,
            "las dos consultas tienen que devolver la MISMA fila: comparten el `SELECT`"
        );
        assert_eq!(
            completa.version, encontrada.version,
            "y la misma versión vigente"
        );
        // Una definición vacía analizaría igual: lo que se comprueba es que tiene las piezas, es
        // decir que las tres columnas JSONB llegaron al motor.
        assert!(
            !completa.definition.inputs.is_empty(),
            "«{name}» llegó sin campos de entrada"
        );
        assert!(
            !completa.definition.outputs.is_empty(),
            "«{name}» llegó sin resultados: no habría nada que calcular"
        );
    }

    // Un nombre que no es de ninguna semilla devuelve `None`, y NO el de una calculadora de
    // usuario que se llame igual: la consulta filtra por `is_builtin`.
    for consulta in ["mi-calculadora", ""] {
        assert_eq!(
            repo.builtin_version(consulta)
                .await
                .expect("la consulta debe funcionar"),
            None,
            "«{consulta}» no es una semilla y no puede encontrarse por esta vía"
        );
        assert!(
            repo.builtin_by_name(consulta)
                .await
                .expect("la consulta debe funcionar")
                .is_none(),
            "«{consulta}» no es una semilla: sin fila no hay definición que ejecutar"
        );
    }
}
