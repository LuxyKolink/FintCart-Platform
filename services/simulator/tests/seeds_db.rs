//! La siembra de una base VACÍA, contra el esquema de verdad (T163).
//!
//! ## El defecto que esta prueba existe para no repetir
//!
//! Verificando T163 —`dev/build && dev/up && dev/migrate && dev/seed` sin ningún paso manual— sobre
//! un entorno recién creado, `dev/seed` falló:
//!
//! ```text
//! error: simulador: fallo de persistencia: new row for relation "calculators" violates check
//! constraint "calculators_published_has_version"
//! ```
//!
//! La siembra insertaba las siete calculadoras con `state = 'publicada'` y **sin
//! `published_version`**, y la restricción —que existe desde T113: una calculadora publicada cita
//! la definición aprobada— lo rechaza. El síntoma era el peor posible: en una instalación NUEVA
//! —es decir, en el despliegue— la plataforma se quedaba **sin ninguna calculadora**, y el error
//! hablaba de una restricción y no de una siembra.
//!
//! ¿Por qué no lo cazó nada antes? Porque **ninguna prueba sembraba una base vacía**: las siembras
//! se hacen con `dev/seed` (un paso manual de desarrollo) y todas las pruebas existentes corren
//! sobre una base que YA tiene las semillas. Sobre una base ya sembrada el `INSERT` no se ejecuta
//! —es idempotente— así que el camino que falla es justo el que nadie recorría.
//!
//! ## Por qué contra PostgreSQL y no contra un doble
//!
//! Porque lo que falló fue una RESTRICCIÓN del esquema. Ningún `pg-mem` la habría impuesto, y un
//! doble del repositorio tampoco: el error vivía exactamente en la frontera entre el `INSERT` y las
//! restricciones, que es donde tiene que mirar una prueba así.
//!
//! ## Estado que deja
//!
//! **Deja las siete semillas sembradas**, que es el estado que debe tener una base de desarrollo:
//! la prueba primero las quita para poder recorrer el camino de la creación, comprueba el
//! resultado y vuelve a sembrar (dos veces, para comprobar que repetir no duplica). Para poder
//! quitar una calculadora cita sus simulaciones, así que **borra las simulaciones que citen a las
//! siete semillas** —son las del historial de desarrollo—; es una prueba de base de desarrollo, se
//! ejecuta a mano (`--ignored`) y conviene saberlo antes de lanzarla.
//!
//! `SIMULATOR_TEST_DB_ADDR` apunta a la base del entorno; ver `provenance_db.rs`.

use fintcart_simulator::domain::seeds;
use fintcart_simulator::repo::calculators::{Calculators, PgCalculators};
use fintcart_simulator::repo::seeds::{seed_builtins, Resumen, Sembrada};
use sqlx::PgPool;
use uuid::Uuid;

/// Cadena de conexión a la base de desarrollo, con el mismo defecto que las otras pruebas de base.
fn db_addr() -> String {
    std::env::var("SIMULATOR_TEST_DB_ADDR").unwrap_or_else(|_| {
        "postgres://fintcart:dev_only_password@localhost:5436/simulator_db?sslmode=disable"
            .to_owned()
    })
}

async fn pool() -> PgPool {
    PgPool::connect(&db_addr()).await.unwrap_or_else(|err| {
        panic!(
            "no se pudo conectar a {}: {err}\n\
             Estas pruebas necesitan la base de desarrollo: `dev/up && dev/migrate`",
            db_addr()
        )
    })
}

/// Deja la base como si las semillas nunca hubieran existido.
///
/// El orden lo imponen las claves ajenas, y no es el que parece: las simulaciones citan a la
/// calculadora (`RESTRICT`) y van primero, pero **las definiciones NO se pueden borrar antes que la
/// calculadora** —la propia calculadora cita su versión aprobada
/// (`calculators_published_version_exists`), así que borrarlas dejaría a la calculadora apuntando a
/// algo que ya no existe—. Lo cazó esta prueba al ejecutarla. Se borra la calculadora y sus
/// definiciones caen en cascada (`ON DELETE CASCADE`), que es el orden que el esquema admite.
async fn vaciar_semillas(pool: &PgPool) {
    let ids = seeds::compile()
        .expect("las semillas del código tienen que compilar")
        .into_iter()
        .map(|seed| seed.id)
        .collect::<Vec<Uuid>>();

    sqlx::query("DELETE FROM simulations WHERE calculator_id = ANY($1)")
        .bind(&ids)
        .execute(pool)
        .await
        .expect("borrar las simulaciones que citan las semillas");
    sqlx::query("DELETE FROM calculators WHERE id = ANY($1)")
        .bind(&ids)
        .execute(pool)
        .await
        .expect("borrar las calculadoras semilla");
}

#[tokio::test]
#[ignore = "necesita PostgreSQL (SIMULATOR_TEST_DB_ADDR)"]
async fn una_base_vacia_se_siembra_entera_y_repetirlo_no_duplica() {
    let pool = pool().await;

    // ── Una base sin semillas, que es el estado de una instalación recién migrada ──────
    vaciar_semillas(&pool).await;
    let restantes: i64 = sqlx::query_scalar("SELECT count(*) FROM calculators WHERE is_builtin")
        .fetch_one(&pool)
        .await
        .expect("contar las semillas");
    assert_eq!(restantes, 0, "la base tenía que quedar sin ninguna semilla");

    let compiled = seeds::compile().expect("las semillas compilan");

    // ── La siembra, que es lo que `dev/seed` ejecuta ──────────────────────────────────
    let primera: Resumen = seed_builtins(&pool, &compiled)
        .await
        .expect("sembrar una base vacía no puede fallar");

    assert_eq!(
        primera,
        Resumen {
            creadas: compiled.len(),
            actualizadas: 0,
            iguales: 0,
        },
        "las siete tienen que crearse, ninguna actualizarse"
    );

    // ── El estado que exige el esquema, comprobado contra la base ─────────────────────
    let filas = sqlx::query_as::<_, (Uuid, String, Option<i32>, i64)>(
        "SELECT c.id, c.state, c.published_version,
                (SELECT count(*) FROM calculator_definitions d WHERE d.calculator_id = c.id)
           FROM calculators c WHERE c.is_builtin ORDER BY c.name",
    )
    .fetch_all(&pool)
    .await
    .expect("leer el estado sembrado");

    assert_eq!(filas.len(), 7, "tienen que quedar siete calculadoras semilla");
    for (id, estado, publicada, definiciones) in &filas {
        assert_eq!(estado, "publicada", "la semilla {id} tiene que nacer publicada");
        // Es la comprobación que faltaba: `calculators_published_has_version` exige que una
        // calculadora publicada cite la definición aprobada, y el `INSERT` no lo hacía.
        assert_eq!(
            *publicada,
            Some(1),
            "la semilla {id} tiene que citar su versión aprobada en la MISMA fila"
        );
        assert_eq!(*definiciones, 1, "la semilla {id} tiene que tener su definición");
    }

    // Y el camino de ejecución la encuentra, que es lo que hace útil una semilla (T098): el
    // `SELECT` de `builtin_by_name` resuelve la versión APROBADA, no la última escrita.
    let repo = PgCalculators::new(pool.clone());
    let ahorro = repo
        .builtin_by_name("ahorro")
        .await
        .expect("buscar la semilla por nombre")
        .expect("la semilla «ahorro» tiene que estar");
    assert_eq!(ahorro.version, 1);
    assert_eq!(ahorro.state, fintcart_simulator::repo::calculators::State::Publicada);

    // ── Sembrar otra vez no duplica ni versiona ──────────────────────────────────────
    let segunda = seed_builtins(&pool, &compiled)
        .await
        .expect("repetir la siembra no puede fallar");
    assert_eq!(
        segunda,
        Resumen {
            creadas: 0,
            actualizadas: 0,
            iguales: compiled.len(),
        },
        "como el código no cambió, las siete tienen que quedar iguales"
    );

    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM calculators WHERE is_builtin")
        .fetch_one(&pool)
        .await
        .expect("contar tras la segunda siembra");
    assert_eq!(total, 7, "repetir la siembra no puede duplicar nada");

    let versiones: i64 = sqlx::query_scalar("SELECT count(*) FROM calculator_definitions")
        .fetch_one(&pool)
        .await
        .expect("contar definiciones");
    assert_eq!(
        versiones, 7,
        "repetir la siembra no puede crear versiones nuevas: la definición es la misma"
    );
}

/// La siembra informa lo que hizo, y `Sembrada` se puede comparar en las pruebas.
///
/// Parece trivial y no lo es: si `Resumen` dejara de distinguir «creada» de «igual», la prueba
/// anterior pasaría sin comprobar la idempotencia.
#[test]
fn el_resumen_distingue_lo_que_hizo() {
    assert_ne!(Sembrada::Creada, Sembrada::Igual);
    assert_ne!(Sembrada::Actualizada, Sembrada::Igual);
    assert_ne!(Sembrada::Creada, Sembrada::Actualizada);
}
