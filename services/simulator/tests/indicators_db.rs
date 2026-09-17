//! Verificación del SQL de indicadores contra PostgreSQL 16 (T104, T099; FR-055…FR-062).
//!
//! ## Qué cubre esto que ninguna otra prueba puede
//!
//! El resto de la suite de indicadores usa un doble del repositorio, así que acepta lo que le
//! den. Lo que **no** puede ver es el SQL: ni la restricción de exclusión que impide dos
//! vigencias solapadas —FR-059 pide que la impida la BASE, y una comprobación «leer y luego
//! escribir» no la ve un doble—, ni que la consulta del calendario distinga bien «sin vigencia»
//! de «por vencer», ni que el `DEFAULT gen_random_uuid()` devuelva un identificador, ni que la
//! ida y vuelta por `NUMERIC(20,6)` conserve el valor.
//!
//! ## Están IGNORADAS a propósito, y por eso hay que pedirlas
//!
//! Corren contra la base de DESARROLLO, así que no pueden formar parte de la suite normal: atar
//! `cargo test` a una base levantada haría que fallara en cualquier máquina donde nadie la
//! hubiera arrancado. Se ejecutan así:
//!
//! ```sh
//! dev/up && dev/migrate && dev/seed
//! cargo test --test indicators_db -- --ignored
//! ```
//!
//! `SIMULATOR_TEST_DB_ADDR` permite apuntar a otra base; por defecto usa la de desarrollo.
//!
//! ## El «hoy» de las pruebas del calendario es una fecha FIJA
//!
//! [`Indicators::calendar_status`] recibe la fecha en lugar de leer el reloj, así que estas
//! pruebas le pasan un día elegido y construyen las vigencias alrededor. Una prueba que
//! dependiera del día real fallaría el 1 de enero de un año y nadie sabría por qué.
//!
//! Los nombres de indicador llevan el prefijo `ZZTEST` —que ningún indicador real usa y que el
//! `CHECK` de formato admite— y se borran al terminar, incluso si la prueba falla por el camino.

use std::collections::BTreeSet;

use chrono::NaiveDate;
use fintcart_simulator::domain::error::Error;
use fintcart_simulator::repo::indicators::{Indicators, PgIndicators};
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

/// El «hoy» de las pruebas del calendario.
fn hoy() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 6, 15).unwrap()
}

/// Borra las filas de prueba al salir, incluso si la prueba falla.
///
/// Sin esto, una prueba que falle a mitad dejaría sus indicadores `ZZTEST` en la base y la
/// siguiente ejecución chocaría con `financial_indicators_no_overlap` — un fallo que hablaría de
/// la ejecución anterior en vez de la actual.
struct Limpieza {
    pool: PgPool,
    nombres: Vec<String>,
}

impl Limpieza {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            nombres: Vec::new(),
        }
    }

    fn con(&mut self, name: &str) -> &mut Self {
        self.nombres.push(name.to_owned());
        self
    }

    /// Borra por PREFIJO y no por nombre exacto: una prueba que inserte vigencias de varios años
    /// del mismo indicador no tiene por qué enumerarlas todas.
    async fn limpia(&self) {
        for name in &self.nombres {
            let _ = sqlx::query("DELETE FROM financial_indicators WHERE name = $1")
                .bind(name)
                .execute(&self.pool)
                .await;
        }
    }
}

fn fecha(iso: &str) -> NaiveDate {
    iso.parse().expect("fecha de prueba")
}

/// Identificador opaco del administrador de prueba.
fn admin() -> Uuid {
    Uuid::parse_str("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d").unwrap()
}

// ── escritura ───────────────────────────────────────────────────────────────

/// Alta y relectura: la fila vuelve con lo que se escribió (FR-055, FR-060).
///
/// Comprueba de paso tres cosas que solo se ven contra el esquema: que el `DEFAULT
/// gen_random_uuid()` produce el identificador, que `daterange($3, $4, '[)')` deja la vigencia
/// con el extremo inferior inclusivo y el superior exclusivo, y que el valor vuelve EXACTO del
/// `NUMERIC(20,6)` —con sus seis decimales rellenos de ceros— sin pasar por ningún tipo binario.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn una_vigencia_nueva_se_guarda_y_se_relee() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTNUEVO");

    let repo = PgIndicators::new(pool.clone());
    let row = repo
        .upsert(
            None,
            "ZZTESTNUEVO",
            Decimal::new(1234, 2),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect("el alta tiene que aceptarse");

    assert_eq!(row.name, "ZZTESTNUEVO");
    assert_eq!(row.value, Decimal::new(1234, 2));
    assert_eq!(row.valid_from, fecha("2026-01-01"));
    assert_eq!(row.valid_to, Some(fecha("2027-01-01")));
    assert_eq!(row.registered_by, admin());
    assert!(!row.id.is_nil());

    let leidas = repo
        .list(Some("ZZTESTNUEVO"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(leidas.len(), 1);
    assert_eq!(leidas[0].id, row.id);
    assert_eq!(
        leidas[0].value,
        Decimal::new(1234, 2),
        "12.34, no 12 ni 12.3: la escala de la columna no recorta el valor"
    );

    limpieza.limpia().await;
}

/// Corregir una vigencia NO crea otra: es la diferencia con las calculadoras (FR-060).
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn una_vigencia_se_corrige_conservando_su_identificador() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTCORRIGE");

    let repo = PgIndicators::new(pool.clone());
    let original = repo
        .upsert(
            None,
            "ZZTESTCORRIGE",
            Decimal::new(100, 0),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect("el alta tiene que aceptarse");

    let corregida = repo
        .upsert(
            Some(original.id),
            "ZZTESTCORRIGE",
            Decimal::new(200, 0),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect("corregir el valor de una vigencia es legítimo");

    assert_eq!(corregida.id, original.id, "la corrección edita, no duplica");
    assert_eq!(corregida.value, Decimal::new(200, 0));

    let leidas = repo
        .list(Some("ZZTESTCORRIGE"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(
        leidas.len(),
        1,
        "una corrección no puede dejar dos vigencias del mismo año"
    );

    limpieza.limpia().await;
}

/// Una corrección sobre una fila que no existe es `not_found`, no un alta silenciosa.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn editar_una_vigencia_inexistente_es_no_encontrado() {
    let pool = pool().await;
    let repo = PgIndicators::new(pool.clone());

    let err = repo
        .upsert(
            Some(Uuid::new_v4()),
            "ZZTESTFANTASMA",
            Decimal::new(1, 0),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect_err("no hay nada que corregir");

    assert!(
        matches!(err, Error::NotFound),
        "se esperaba NotFound y llegó {err:?}"
    );
}

/// Renombrar se rechaza: el nombre es el vínculo con las fórmulas que lo referencian.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn renombrar_una_vigencia_se_rechaza() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTRENOMBRA");

    let repo = PgIndicators::new(pool.clone());
    let original = repo
        .upsert(
            None,
            "ZZTESTRENOMBRA",
            Decimal::new(1, 0),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect("el alta tiene que aceptarse");

    let err = repo
        .upsert(
            Some(original.id),
            "ZZTESTOTRO",
            Decimal::new(1, 0),
            fecha("2026-01-01"),
            fecha("2027-01-01"),
            admin(),
        )
        .await
        .expect_err("un indicador no se renombra");

    match err {
        Error::InvalidInput(msg) => assert!(
            msg.contains("ZZTESTRENOMBRA") && msg.contains("ZZTESTOTRO"),
            "el mensaje tiene que decir de qué nombre a cuál: {msg}"
        ),
        otro => panic!("se esperaba InvalidInput y llegó {otro:?}"),
    }

    // Y la fila sigue como estaba: el rechazo no puede haber dejado el nombre cambiado.
    let leidas = repo
        .list(Some("ZZTESTRENOMBRA"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(leidas.len(), 1);

    limpieza.limpia().await;
}

// ── solapamiento (FR-059, T099) ─────────────────────────────────────────────

/// Dos vigencias del mismo indicador que se pisan: la base las rechaza.
///
/// ## Por qué la prueba del `INSERT` directo es la que importa
///
/// El repositorio comprueba el solapamiento antes de escribir, pero esa comprobación NO es la
/// garantía: entre la lectura y el `INSERT` cabe otro administrador cargando el mismo año. La
/// garantía es `financial_indicators_no_overlap`, que es una restricción de EXCLUSIÓN —no una
/// consulta que haya que acordarse de hacer—, y se comprueba aquí con un `INSERT` que se salta
/// el repositorio entero. Si esta prueba pasara con el `INSERT` directo y fallara el repositorio,
/// sería al revés de lo que FR-059 pide.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn dos_vigencias_solapadas_las_rechaza_la_base() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTSOLAPA");

    let repo = PgIndicators::new(pool.clone());
    repo.upsert(
        None,
        "ZZTESTSOLAPA",
        Decimal::new(100, 0),
        fecha("2026-01-01"),
        fecha("2027-01-01"),
        admin(),
    )
    .await
    .expect("la primera vigencia tiene que entrar");

    // (1) Por el repositorio: el mensaje nombra el rango que ya está, que es lo que necesita
    // quien lo está intentando cargar.
    let err = repo
        .upsert(
            None,
            "ZZTESTSOLAPA",
            Decimal::new(200, 0),
            fecha("2026-06-01"),
            fecha("2026-08-01"),
            admin(),
        )
        .await
        .expect_err("dos vigencias del mismo año se pisan");

    match err {
        Error::AlreadyExists(msg) => assert!(
            msg.contains("2026-01-01") && msg.contains("2027-01-01"),
            "el mensaje tiene que decir con qué choca: {msg}"
        ),
        otro => panic!("se esperaba AlreadyExists y llegó {otro:?}"),
    }

    // (2) Por SQL directo, saltándose toda comprobación de la aplicación: la que manda.
    let bruto = sqlx::query(
        "INSERT INTO financial_indicators (name, value, validity, registered_by)
         VALUES ($1, $2::NUMERIC(20,6), daterange($3::date, $4::date, '[)'), $5)",
    )
    .bind("ZZTESTSOLAPA")
    .bind("300")
    .bind(fecha("2026-12-01"))
    .bind(fecha("2027-06-01"))
    .bind(admin())
    .execute(&pool)
    .await
    .expect_err("el EXCLUDE tiene que rechazarlo");

    assert_eq!(
        bruto.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23P01"),
        "el código tiene que ser el de violación de exclusión, no otro"
    );

    // Y esa misma violación, al pasar por el embudo de errores del servicio, es un «ya existe» y
    // no un fallo de infraestructura: es lo que hace que dos administradores simultáneos reciban
    // un 409 en vez de un 500 reintentable.
    assert!(
        matches!(Error::from_sqlx(bruto), Error::AlreadyExists(_)),
        "23P01 tiene que traducirse a AlreadyExists"
    );

    // Nada de lo rechazado se guardó.
    let leidas = repo
        .list(Some("ZZTESTSOLAPA"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(leidas.len(), 1, "solo queda la vigencia original");
    assert_eq!(leidas[0].value, Decimal::new(100, 0));

    limpieza.limpia().await;
}

/// Las vigencias CONTIGUAS no se pisan: el extremo superior es exclusivo.
///
/// Es el caso real del procedimiento anual —cargar el UVT de 2027 sin tocar el de 2026—, y el
/// que distingue `[inicio, fin)` de un rango cerrado: con `&&` sobre rangos cerrados, el 1 de
/// enero pertenecería a los dos y esta carga legítima fallaría.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn dos_vigencias_contiguas_conviven() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTCONTIGUA");

    let repo = PgIndicators::new(pool.clone());
    repo.upsert(
        None,
        "ZZTESTCONTIGUA",
        Decimal::new(100, 0),
        fecha("2026-01-01"),
        fecha("2027-01-01"),
        admin(),
    )
    .await
    .expect("la vigencia de 2026 tiene que entrar");

    repo.upsert(
        None,
        "ZZTESTCONTIGUA",
        Decimal::new(200, 0),
        fecha("2027-01-01"),
        fecha("2028-01-01"),
        admin(),
    )
    .await
    .expect("la de 2027 empieza justo cuando termina la otra y no se pisan");

    let leidas = repo
        .list(Some("ZZTESTCONTIGUA"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(leidas.len(), 2);

    // Y el día del relevo lo cubre la vigencia nueva, sola.
    let el_dia_del_cambio = repo
        .list(Some("ZZTESTCONTIGUA"), Some(fecha("2027-01-01")))
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(el_dia_del_cambio.len(), 1);
    assert_eq!(el_dia_del_cambio[0].value, Decimal::new(200, 0));

    limpieza.limpia().await;
}

// ── listado ─────────────────────────────────────────────────────────────────

/// El listado filtra por nombre y por fecha, y las dos cosas a la vez.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_listado_filtra_por_nombre_y_por_fecha() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTLISTA").con("ZZTESTOTRO");

    let repo = PgIndicators::new(pool.clone());
    for (name, value, desde, hasta) in [
        ("ZZTESTLISTA", "100", "2025-01-01", "2026-01-01"),
        ("ZZTESTLISTA", "200", "2026-01-01", "2027-01-01"),
        ("ZZTESTOTRO", "300", "2026-01-01", "2027-01-01"),
    ] {
        repo.upsert(
            None,
            name,
            value.parse().unwrap(),
            fecha(desde),
            fecha(hasta),
            admin(),
        )
        .await
        .expect("la vigencia de prueba tiene que entrar");
    }

    let solo_uno = repo
        .list(Some("ZZTESTLISTA"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(solo_uno.len(), 2);
    assert_eq!(
        solo_uno[0].valid_from,
        fecha("2025-01-01"),
        "el orden es por vigencia, no el que devuelva el plan de la consulta"
    );

    let vigente_en_2026 = repo
        .list(Some("ZZTESTLISTA"), Some(fecha("2026-06-15")))
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(vigente_en_2026.len(), 1);
    assert_eq!(vigente_en_2026[0].value, Decimal::new(200, 0));

    let todos = repo
        .list(None, None)
        .await
        .expect("la consulta debe funcionar");
    assert!(
        todos.iter().any(|row| row.name == "ZZTESTOTRO"),
        "sin filtro de nombre tienen que aparecer los de otros indicadores"
    );

    limpieza.limpia().await;
}

// ── calendario (FR-061, FR-062) ─────────────────────────────────────────────

/// Un nombre registrado cuya vigencia ya terminó está «sin vigencia»; uno cubierto, no.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_calendario_reporta_los_nombres_que_quedaron_sin_vigencia() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTVENCIDO").con("ZZTESTALDIACONVIGENCIA");

    let repo = PgIndicators::new(pool.clone());
    for (name, desde, hasta) in [
        ("ZZTESTVENCIDO", "2025-01-01", "2026-01-01"),
        ("ZZTESTALDIACONVIGENCIA", "2026-01-01", "2027-01-01"),
    ] {
        repo.upsert(
            None,
            name,
            Decimal::new(1, 0),
            fecha(desde),
            fecha(hasta),
            admin(),
        )
        .await
        .expect("la vigencia de prueba tiene que entrar");
    }

    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");

    assert!(
        estado.missing.contains(&"ZZTESTVENCIDO".to_owned()),
        "el que quedó sin vigencia tiene que aparecer"
    );
    assert!(
        !estado
            .missing
            .contains(&"ZZTESTALDIACONVIGENCIA".to_owned()),
        "el que cubre el día de hoy no"
    );

    limpieza.limpia().await;
}

/// Un nombre que nunca se registró NO aparece como «sin vigencia».
///
/// La lista se calcula sobre los nombres que están en la tabla: enumerar los indicadores que el
/// contexto financiero colombiano podría llegar a necesitar sería una lista que nadie mantiene,
/// y el aviso hablaría de indicadores de los que no hay nada que cargar.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_calendario_no_inventa_nombres_que_nadie_registro() {
    let pool = pool().await;
    let repo = PgIndicators::new(pool.clone());

    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");

    assert!(
        !estado
            .missing
            .iter()
            .any(|name| name.contains("ZZTESTNUNCAEXISTIO")),
        "de un nombre que no está en la tabla no se puede decir que le falte vigencia"
    );
}

/// El aviso de vencimiento respeta la ventana y cuenta los días que quedan.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_calendario_avisa_de_lo_que_vence_dentro_de_la_ventana() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTPORVENCER");

    let repo = PgIndicators::new(pool.clone());
    // Vence el 25 de junio: diez días después del «hoy» de la prueba.
    repo.upsert(
        None,
        "ZZTESTPORVENCER",
        Decimal::new(1, 0),
        fecha("2026-01-01"),
        fecha("2026-06-25"),
        admin(),
    )
    .await
    .expect("la vigencia de prueba tiene que entrar");

    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");

    let aviso = estado
        .expiring
        .iter()
        .find(|e| e.name == "ZZTESTPORVENCER")
        .expect("tiene que aparecer entre los que vencen");
    assert_eq!(aviso.valid_to, fecha("2026-06-25"));
    assert_eq!(
        aviso.days_remaining, 10,
        "del 15 al 25 de junio hay diez días, y el 25 ya no está cubierto"
    );

    limpieza.limpia().await;
}

/// Lo que vence FUERA de la ventana no genera aviso: 30 días de antelación y no dos meses.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_calendario_calla_lo_que_vence_fuera_de_la_ventana() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTLEJOS");

    let repo = PgIndicators::new(pool.clone());
    repo.upsert(
        None,
        "ZZTESTLEJOS",
        Decimal::new(1, 0),
        fecha("2026-01-01"),
        fecha("2027-01-01"),
        admin(),
    )
    .await
    .expect("la vigencia de prueba tiene que entrar");

    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");

    assert!(
        !estado.expiring.iter().any(|e| e.name == "ZZTESTLEJOS"),
        "todavía no toca avisar de esta"
    );

    limpieza.limpia().await;
}

/// Si el sucesor ya está cargado, no hay nada que avisar.
///
/// Es la diferencia entre un aviso útil y uno que se aprende a ignorar: la vigencia que termina
/// el 31 de diciembre no deja ningún hueco si el año siguiente ya está en la tabla. Una alerta
/// que se dispara sin que haya nada que hacer es la que enseña a no leerlas.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn el_calendario_no_avisa_si_el_sucesor_ya_esta_cargado() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTCONSUCESOR");

    let repo = PgIndicators::new(pool.clone());
    repo.upsert(
        None,
        "ZZTESTCONSUCESOR",
        Decimal::new(100, 0),
        fecha("2026-01-01"),
        fecha("2026-06-25"),
        admin(),
    )
    .await
    .expect("la vigencia que vence tiene que entrar");
    repo.upsert(
        None,
        "ZZTESTCONSUCESOR",
        Decimal::new(200, 0),
        fecha("2026-06-25"),
        fecha("2027-06-25"),
        admin(),
    )
    .await
    .expect("la sucesora tiene que entrar");

    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");

    assert!(
        !estado.expiring.iter().any(|e| e.name == "ZZTESTCONSUCESOR"),
        "con el año siguiente ya cargado no hay hueco que avisar"
    );
    assert!(
        !estado.missing.contains(&"ZZTESTCONSUCESOR".to_owned()),
        "y desde luego no está sin vigencia: la sucesora cubre hoy"
    );

    limpieza.limpia().await;
}

/// Una vigencia SIN FECHA DE FIN no vence nunca, y el aviso no puede decir que vence en 3.000 años.
///
/// El esquema admite `[2026-01-01,)` (`upper_inf`), y el contrato no puede expresarlo —`valid_to`
/// vacío—, así que hoy solo puede llegar por SQL. Se comprueba igual porque el código tiene que
/// saber tratarlo: sin el `NOT upper_inf` de la consulta, un cálculo con fechas infinitas
/// produciría un `days_remaining` absurdo y un aviso que no se puede atender.
#[tokio::test]
#[ignore = "necesita la base de desarrollo; ver la nota del módulo"]
async fn una_vigencia_sin_fecha_de_fin_no_vence() {
    let pool = pool().await;
    let mut limpieza = Limpieza::new(pool.clone());
    limpieza.con("ZZTESTSINFIN");

    sqlx::query(
        "INSERT INTO financial_indicators (name, value, validity, registered_by)
         VALUES ($1, $2::NUMERIC(20,6), daterange($3::date, NULL, '[)'), $4)",
    )
    .bind("ZZTESTSINFIN")
    .bind("7")
    .bind(fecha("2026-01-01"))
    .bind(admin())
    .execute(&pool)
    .await
    .expect("el esquema admite una vigencia sin fecha de fin");

    let repo = PgIndicators::new(pool.clone());

    // La lectura la devuelve sin fin, y sin inventarse una fecha.
    let leidas = repo
        .list(Some("ZZTESTSINFIN"), None)
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(leidas.len(), 1);
    assert_eq!(leidas[0].valid_to, None);

    // Y el calendario ni la avisa ni la da por ausente.
    let estado = repo
        .calendar_status(hoy(), 30)
        .await
        .expect("la consulta debe funcionar");
    assert!(
        !estado.expiring.iter().any(|e| e.name == "ZZTESTSINFIN"),
        "una vigencia sin fin no está por vencer"
    );
    assert!(
        !estado.missing.contains(&"ZZTESTSINFIN".to_owned()),
        "y cubre el día de hoy"
    );

    // La resolución por fecha la encuentra, que es lo que garantiza que una fórmula pueda leerla.
    let resuelto = repo
        .resolve(&BTreeSet::from(["ZZTESTSINFIN".to_owned()]), hoy())
        .await
        .expect("la consulta debe funcionar");
    assert_eq!(resuelto.get("ZZTESTSINFIN"), Some(&Decimal::new(7, 0)));

    limpieza.limpia().await;
}
