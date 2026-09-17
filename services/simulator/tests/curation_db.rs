//! Curaduría de calculadoras contra PostgreSQL 16 (T111, T112; FR-052, FR-053, FR-054).
//!
//! ## Qué cubre esto que ninguna otra prueba puede
//!
//! Las transiciones ya están probadas sin base (`domain::curation`), y lo que falta es
//! justo lo que un doble no puede dar:
//!
//!   · que la RESTRICCIÓN de la base impida aprobar la calculadora propia aunque la aplicación
//!     tuviera un defecto (T111 lo pide literalmente: «tanto en la capa de aplicación como por la
//!     restricción de la base»),
//!   · que una calculadora publicada no pueda quedarse sin versión aprobada,
//!   · que `published_version` no pueda apuntar a una definición que no existe,
//!   · y que **editar una publicada no cambie lo que sirve el catálogo** (T112), que es una
//!     propiedad de las dos consultas de lectura y no de una función.
//!
//! ## Están IGNORADAS a propósito, y por eso hay que pedirlas
//!
//! Igual que las de indicadores: corren contra la base de DESARROLLO, así que no pueden formar
//! parte de la suite normal. Se ejecutan así:
//!
//! ```sh
//! dev/up && dev/migrate && dev/seed
//! cargo test --test curation_db -- --ignored
//! ```
//!
//! `SIMULATOR_TEST_DB_ADDR` permite apuntar a otra base.
//!
//! ## Las filas que se crean se borran al terminar
//!
//! Cada prueba crea sus calculadoras con un autor de FIXTURE y las borra en un `guard` que corre
//! también cuando la prueba falla. No es aseo: la lista de calculadoras de un autor real se ve en
//! el catálogo, y una prueba que dejara basura cambiaría el estado de la siguiente ejecución —
//! como ya pasó con los indicadores.

use fintcart_simulator::domain::curation::State;
use fintcart_simulator::domain::definition::{Definition, Draft, DraftOutput, InputField};
use fintcart_simulator::domain::error::Error;
use fintcart_simulator::domain::formula::ast::InputKind;
use fintcart_simulator::repo::calculators::{Calculators, PgCalculators};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Cadena de conexión a la base de desarrollo.
///
/// El puerto 5436 es el que `dev/docker-compose.yaml` publica para el Simulador. Dentro del
/// contenedor hay que apuntar al hostname: `SIMULATOR_TEST_DB_ADDR=postgres://…@postgres-simulator:5432/…`.
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

/// Borra las calculadoras de un autor de fixture al salir del ámbito.
///
/// El borrado es por AUTOR y no por identificador: una prueba que falle a mitad deja filas de las
/// que ya no conoce el identificador, y son justo las que hay que limpiar. `ON DELETE CASCADE` se
/// lleva las definiciones.
struct Guard {
    pool: PgPool,
    autor: Uuid,
}

impl Guard {
    async fn nuevo(pool: &PgPool, autor: Uuid) -> Self {
        Self {
            pool: pool.clone(),
            autor,
        }
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        // `Drop` no puede ser `async`, y el runtime de la prueba no admite `block_in_place` —no
        // es multi-hilo—. Así que el borrado corre en un hilo propio con su runtime pequeño, y se
        // ESPERA a que termine: si se dejara suelto, el pool se cerraría antes de que el `DELETE`
        // llegara a la base y la basura quedaría ahí sin que nadie se enterase.
        let pool = self.pool.clone();
        let autor = self.autor;
        let limpieza = std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(_) => return,
            };
            runtime.block_on(async move {
                let _ = sqlx::query("DELETE FROM calculators WHERE owner_id = $1")
                    .bind(autor)
                    .execute(&pool)
                    .await;
            });
        });
        let _ = limpieza.join();
    }
}

/// Un autor de fixture distinto por prueba, para que dos pruebas simultáneas no se pisen.
fn autor() -> Uuid {
    Uuid::new_v4()
}

/// Una definición válida, con el mismo cuerpo que usa la prueba del constructor.
fn definicion() -> Definition {
    definicion_con("Monto", "monto * 2")
}

/// La misma definición con otra etiqueta y otra fórmula.
///
/// Existe para poder distinguir dos VERSIONES de una misma calculadora: la etiqueta de una
/// entrada y la expresión de una salida son parte de la definición, y la definición es lo que
/// `published_version` fija.
fn definicion_alterna() -> Definition {
    definicion_con("Monto actualizado", "monto * 3")
}

fn definicion_con(etiqueta: &str, expresion: &str) -> Definition {
    Draft {
        inputs: vec![InputField {
            key: "monto".to_owned(),
            label: etiqueta.to_owned(),
            kind: InputKind::Monto,
            unit: "COP".to_owned(),
            min: None,
            max: None,
            default: None,
            required: true,
        }],
        validations: vec![],
        outputs: vec![DraftOutput {
            key: "total".to_owned(),
            label: "Total".to_owned(),
            expression: expresion.to_owned(),
            scale: 2,
            when: None,
        }],
    }
    .parse(&std::collections::BTreeSet::new())
    .expect("la definición de apoyo debe ser válida")
}

/// Lee el estado crudo de una calculadora, sin pasar por el repositorio.
async fn fila(pool: &PgPool, id: Uuid) -> (String, i32, Option<i32>, Option<Uuid>, Option<String>) {
    let row = sqlx::query(
        "SELECT state, version, published_version, approved_by, rejection_reason
           FROM calculators WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("la calculadora tiene que existir");

    (
        row.get("state"),
        row.get("version"),
        row.get("published_version"),
        row.get("approved_by"),
        row.get("rejection_reason"),
    )
}

/// Deja una calculadora publicada, pasando por las tres transiciones reales.
///
/// Se recorre el camino de verdad —proponer y aprobar con un coordinador distinto— en lugar de
/// escribir el estado con un `UPDATE`: una prueba que se fabricara el estado saltándose las
/// transiciones comprobaría las consultas de lectura contra un estado que el sistema no puede
/// alcanzar.
async fn publicada(repo: &PgCalculators, duenio: Uuid) -> Uuid {
    let creada = repo
        .upsert(None, duenio, "ZZ TEST publicable", "", &definicion())
        .await
        .expect("la calculadora se tiene que crear");

    repo.submit(creada.id, duenio)
        .await
        .expect("la propuesta tiene que aceptarse");
    repo.approve(creada.id, autor())
        .await
        .expect("la aprobación de otro coordinador tiene que aceptarse");

    creada.id
}

/// La base impide que el autor apruebe su propia calculadora (T111, FR-053).
///
/// Se escribe el `UPDATE` a mano porque es exactamente lo que pasaría si la comprobación de la
/// aplicación desapareciera o tuviera un defecto: la fila quedaría publicada con el autor como
/// aprobador. La restricción tiene que rechazarla.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn la_base_rechaza_aprobar_la_calculadora_propia() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let id = publicada(&repo, duenio).await;
    let publicada = repo.get(id, None).await.expect("tiene que ser visible");

    // El estado se fuerza para que la restricción que se prueba sea la de AUTORÍA y no la de
    // «solo se aprueba lo que está en revisión»: si no, el rechazo podría venir de la
    // comprobación equivocada y la prueba pasaría sin haber probado nada.
    let err = sqlx::query(
        "UPDATE calculators
            SET state = 'publicada', published_version = version, approved_by = $2
          WHERE id = $1",
    )
    .bind(id)
    .bind(duenio)
    .execute(&pool)
    .await
    .expect_err("la base tiene que rechazar que el autor se apruebe a sí mismo");

    let texto = err.to_string();
    assert!(
        texto.contains("calculators_approver_differs_from_owner"),
        "el rechazo tiene que venir de la restricción de autoría: {texto}"
    );

    // Y la comprobación de la aplicación da el mismo veredicto, con su propio mensaje.
    assert!(publicada.approved_by.is_some());
    let err = repo
        .approve(id, duenio)
        .await
        .expect_err("aprobar dos veces ya está mal, y hacerlo como autor, peor: tiene que fallar");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

/// Una calculadora publicada no puede quedarse sin versión aprobada (SC-018).
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn la_base_rechaza_publicar_sin_version_aprobada() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let creada = repo
        .upsert(None, duenio, "ZZ TEST sin version", "", &definicion())
        .await
        .expect("la calculadora se tiene que crear");

    let err =
        sqlx::query("UPDATE calculators SET state = 'publicada', approved_by = $2 WHERE id = $1")
            .bind(creada.id)
            .bind(autor())
            .execute(&pool)
            .await
            .expect_err("publicar sin versión aprobada tiene que ser imposible");

    assert!(
        err.to_string()
            .contains("calculators_published_has_version"),
        "el rechazo tiene que venir de la restricción de versión publicada: {err}"
    );
}

/// `published_version` apunta a una definición que existe, y a ninguna otra.
///
/// Son dos comprobaciones distintas y las dos importan: el `CHECK` de rango rechaza una versión
/// que no se ha escrito todavía —en el momento, sin esperar a nada— y la clave foránea rechaza
/// una versión que no existe pese a estar dentro del rango. Esa segunda es la razón de que la
/// clave foránea sea diferible: la relación con `calculator_definitions` es circular, así que su
/// error aparece al confirmar. Y eso también se comprueba aquí, porque una foránea que no se
/// comprobara nunca sería peor que no tenerla.
///
/// ## Por qué hay que borrar una definición para provocar el segundo caso
///
/// El rango ya impide apuntar más allá de la última versión escrita, y las versiones se escriben
/// siempre con su definición, así que no hay ningún camino normal que deje un apunte colgando. Se
/// llega a él por donde llegaría de verdad: una escritura por fuera del repositorio que borrase la
/// definición. Es el escenario que la clave foránea existe para cubrir, y probarlo cuesta un
/// `DELETE` a mano.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn la_version_publicada_no_puede_apuntar_a_una_definicion_inexistente() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let id = publicada(&repo, duenio).await;

    let futura =
        sqlx::query("UPDATE calculators SET published_version = version + 1 WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .expect_err("una versión que no se ha escrito no puede estar publicada");
    assert!(
        futura
            .to_string()
            .contains("calculators_published_version_range"),
        "el rechazo tiene que venir del rango: {futura}"
    );

    // La definición de la versión 1 desaparece: ahora el apunte existe en el rango y no en la
    // tabla. La calculadora se deja privada para que su `published_version` no estorbe.
    sqlx::query("UPDATE calculators SET state = 'privada', published_version = NULL WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .expect("dejarla privada es una escritura válida");
    sqlx::query("DELETE FROM calculator_definitions WHERE calculator_id = $1 AND version = 1")
        .bind(id)
        .execute(&pool)
        .await
        .expect("la definición se puede borrar: nadie la está citando");

    let inexistente = sqlx::query("UPDATE calculators SET published_version = 1 WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .expect_err("una versión inexistente no puede estar publicada");
    assert!(
        inexistente
            .to_string()
            .contains("calculators_published_version_exists"),
        "el rechazo tiene que venir de la clave foránea: {inexistente}"
    );
}

/// Editar una calculadora publicada no altera lo que ve el mundo (T112, FR-052).
///
/// Es la prueba central de la separación entre las dos versiones. Lo que se comprueba no es solo
/// que la columna no cambie, sino que **las dos lecturas devuelvan definiciones distintas**: el
/// catálogo la vieja y el autor la nueva. Si las dos devolvieran lo mismo, `published_version`
/// sería un dato decorativo.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn editar_una_publicada_no_cambia_lo_que_sirve_el_catalogo() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let id = publicada(&repo, duenio).await;
    let antes = repo.get(id, None).await.expect("publicada y visible");

    // La edición cambia la DEFINICIÓN —la etiqueta de una entrada y la fórmula de la salida— y no
    // solo la descripción. Es lo que hace falta para distinguir las dos versiones: la descripción
    // vive en la IDENTIDAD de la calculadora y cambia para todas las vistas a la vez, mientras que
    // lo que `published_version` fija es la definición.
    let editada = repo
        .upsert(
            Some(id),
            duenio,
            "ZZ TEST publicable",
            "",
            &definicion_alterna(),
        )
        .await
        .expect("el autor tiene que poder editar lo suyo");

    assert_eq!(editada.version, 2, "la vigente avanza");
    assert_eq!(
        editada.state,
        State::Publicada,
        "seguir publicada no es un descuido: FR-052"
    );

    let (estado, vigente, aprobada, _, _) = fila(&pool, id).await;
    assert_eq!(estado, "publicada");
    assert_eq!(vigente, 2);
    assert_eq!(
        aprobada,
        Some(1),
        "la aprobada NO se mueve hasta pasar por revisión"
    );

    let publico = repo.get(id, None).await.expect("sigue visible para todos");
    assert_eq!(publico.version, 1, "el catálogo sirve la aprobada");
    assert_eq!(
        publico.definition, antes.definition,
        "el catálogo tiene que seguir calculando con la definición aprobada"
    );
    assert_ne!(
        publico.definition, editada.definition,
        "las dos vistas tienen que diferenciarse; si no, published_version no sirve de nada"
    );

    let propio = repo
        .get(id, Some(duenio))
        .await
        .expect("el autor ve la suya");
    assert_eq!(propio.version, 2, "el autor ve su borrador");
    assert_eq!(propio.definition, editada.definition);

    // Y el listado del catálogo también sirve la aprobada, no el borrador: es la misma regla en
    // otra consulta, y una vista que solo se aplicara en `get` dejaría el catálogo enseñando lo
    // no aprobado.
    let catalogo = repo
        .list(None, true, None, 100, "")
        .await
        .expect("el catálogo tiene que listarse");
    let en_catalogo = catalogo
        .items
        .iter()
        .find(|row| row.id == id)
        .expect("la calculadora publicada tiene que estar en el catálogo");
    assert_eq!(en_catalogo.version, 1);

    // Proponer de nuevo y aprobar publica la versión nueva.
    repo.submit(id, duenio).await.expect("la propuesta vuelve");
    repo.approve(id, autor())
        .await
        .expect("un coordinador distinto la aprueba");

    let (_, _, aprobada, _, _) = fila(&pool, id).await;
    assert_eq!(aprobada, Some(2));
    let publico = repo.get(id, None).await.expect("visible");
    assert_eq!(publico.version, 2);
    assert_eq!(publico.definition, editada.definition);
}

/// Editar durante la revisión retira la propuesta (T113).
///
/// El caso que motiva la regla: el coordinador está leyendo una versión concreta, y si la
/// propuesta sobreviviera a una edición lo que aprobaría sería la siguiente —que nadie ha leído—
/// porque la aprobación publica la versión vigente en ese momento.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn editar_lo_que_esta_en_revision_lo_devuelve_a_privada() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let creada = repo
        .upsert(None, duenio, "ZZ TEST en revision", "", &definicion())
        .await
        .expect("se crea");
    repo.submit(creada.id, duenio).await.expect("se propone");

    let (estado, _, _, _, _) = fila(&pool, creada.id).await;
    assert_eq!(estado, "en_revision");

    repo.upsert(
        Some(creada.id),
        duenio,
        "ZZ TEST en revision",
        "cambio",
        &definicion(),
    )
    .await
    .expect("se edita");

    let (estado, vigente, _, _, _) = fila(&pool, creada.id).await;
    assert_eq!(estado, "privada", "la propuesta se retiró");
    assert_eq!(vigente, 2);

    // Y un coordinador que llegara tarde no puede aprobarla por el camino.
    let err = repo
        .approve(creada.id, autor())
        .await
        .expect_err("ya no está en revisión");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

/// El rechazo guarda el motivo y lo deja donde el autor lo lee (FR-054).
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn el_rechazo_guarda_el_motivo_y_una_publicada_sigue_publicada() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    // Primera propuesta, rechazada: queda privada.
    let creada = repo
        .upsert(None, duenio, "ZZ TEST rechazable", "", &definicion())
        .await
        .expect("se crea");
    repo.submit(creada.id, duenio).await.expect("se propone");
    repo.reject(creada.id, autor(), "falta explicar de dónde sale la tasa")
        .await
        .expect("el rechazo tiene que aceptarse");

    let (estado, _, _, _, motivo) = fila(&pool, creada.id).await;
    assert_eq!(estado, "privada");
    assert_eq!(
        motivo.as_deref(),
        Some("falta explicar de dónde sale la tasa"),
        "el motivo es lo que el autor necesita para corregir"
    );

    // Al proponerla otra vez el motivo se retira: si se quedara, el coordinador leería la queja
    // de una versión que ya no existe.
    repo.submit(creada.id, duenio)
        .await
        .expect("se propone otra vez");
    let (_, _, _, _, motivo) = fila(&pool, creada.id).await;
    assert_eq!(motivo, None);

    // Ahora se aprueba y se edita: el rechazo del borrador NO despublica la versión aprobada.
    repo.approve(creada.id, autor()).await.expect("se aprueba");
    repo.upsert(
        Some(creada.id),
        duenio,
        "ZZ TEST rechazable",
        "borrador",
        &definicion(),
    )
    .await
    .expect("se edita");
    repo.submit(creada.id, duenio)
        .await
        .expect("se propone el borrador");
    repo.reject(creada.id, autor(), "el borrador no aclara el redondeo")
        .await
        .expect("se rechaza el borrador");

    let (estado, vigente, aprobada, _, motivo) = fila(&pool, creada.id).await;
    assert_eq!(
        estado, "publicada",
        "el rechazo se lleva el borrador, no la publicación"
    );
    assert_eq!(vigente, 2);
    assert_eq!(aprobada, Some(1));
    assert_eq!(motivo.as_deref(), Some("el borrador no aclara el redondeo"));

    let publico = repo.get(creada.id, None).await.expect("sigue visible");
    assert_eq!(publico.version, 1);
}

/// La columna rechaza un motivo vacío aunque la aplicación lo dejara pasar.
///
/// Es la red por debajo de FR-054: el repositorio recibe el motivo ya normalizado por la capa
/// gRPC, y esta prueba demuestra que si esa normalización desapareciera, la base seguiría
/// impidiendo un rechazo sin motivo.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn la_base_rechaza_un_motivo_de_rechazo_vacio() {
    let pool = pool().await;
    let duenio = autor();
    let _guard = Guard::nuevo(&pool, duenio).await;
    let repo = PgCalculators::new(pool.clone());

    let creada = repo
        .upsert(None, duenio, "ZZ TEST motivo", "", &definicion())
        .await
        .expect("se crea");
    repo.submit(creada.id, duenio).await.expect("se propone");

    let err = repo
        .reject(creada.id, autor(), "   ")
        .await
        .expect_err("un motivo de espacios no es un motivo");

    assert!(matches!(err, Error::Storage(_)), "{err:?}");
}

/// No se aprueba lo que no existe, y el mensaje no distingue «no existe» de «no es tuyo».
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn aprobar_lo_que_no_existe_es_un_no_encontrado() {
    let pool = pool().await;
    let repo = PgCalculators::new(pool.clone());
    let inventado = Uuid::new_v4();

    assert!(matches!(
        repo.approve(inventado, autor()).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        repo.reject(inventado, autor(), "no").await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        repo.submit(inventado, autor()).await,
        Err(Error::NotFound)
    ));
}

/// El filtro de estado ACOTA la visibilidad; no la abre (FR-051).
///
/// Es la propiedad que hace segura la bandeja de curaduría (T116), y la que un doble no puede
/// comprobar porque vive en el `WHERE`. Se comprueban las tres direcciones:
///
///   · `en_revision` sin ningún otro filtro devuelve las propuestas de CUALQUIERA —es lo que la
///     curaduría tiene que poder leer, y por eso el filtro abre esa puerta y solo esa—;
///   · `privada` sin `owner_id` no devuelve nada ajeno, aunque el estado exista y esté pedido;
///   · el catálogo (`only_published`) sigue sin incluir lo que no está aprobado.
#[tokio::test]
#[ignore = "necesita PostgreSQL: dev/up && dev/migrate"]
async fn el_filtro_de_estado_no_abre_las_privadas_ajenas() {
    let pool = pool().await;
    let autor_a = autor();
    let autor_b = autor();
    let _guard_a = Guard::nuevo(&pool, autor_a).await;
    let _guard_b = Guard::nuevo(&pool, autor_b).await;
    let repo = PgCalculators::new(pool.clone());

    // A: una privada y una propuesta. B: una privada y una publicada.
    let privada_a = repo
        .upsert(None, autor_a, "ZZ TEST privada de A", "", &definicion())
        .await
        .expect("se crea");
    let propuesta_a = repo
        .upsert(None, autor_a, "ZZ TEST propuesta de A", "", &definicion())
        .await
        .expect("se crea");
    repo.submit(propuesta_a.id, autor_a)
        .await
        .expect("se propone");

    let privada_b = repo
        .upsert(None, autor_b, "ZZ TEST privada de B", "", &definicion())
        .await
        .expect("se crea");
    let publicada_b = repo
        .upsert(None, autor_b, "ZZ TEST publicada de B", "", &definicion())
        .await
        .expect("se crea");
    repo.submit(publicada_b.id, autor_b)
        .await
        .expect("se propone");
    repo.approve(publicada_b.id, autor_a)
        .await
        .expect("A aprueba lo de B");

    // 1) La bandeja: las propuestas de los dos, y solo las propuestas.
    let bandeja = repo
        .list(None, false, Some(State::EnRevision), 100, "")
        .await
        .expect("la bandeja tiene que listarse");
    let en_bandeja: Vec<Uuid> = bandeja.items.iter().map(|row| row.id).collect();
    assert!(
        en_bandeja.contains(&propuesta_a.id),
        "la propuesta de A está"
    );
    assert!(!en_bandeja.contains(&privada_a.id), "una privada NO está");
    assert!(
        !en_bandeja.contains(&privada_b.id),
        "ni la privada de nadie"
    );
    assert!(
        !en_bandeja.contains(&publicada_b.id),
        "una aprobada tampoco"
    );
    assert!(
        bandeja.total >= 2,
        "el total tiene que contar lo mismo que la página"
    );

    // 2) Pedir las privadas sin ser el autor no devuelve ninguna ajena. Es la comprobación que
    //    hace segura la existencia del filtro.
    let privadas = repo
        .list(None, false, Some(State::Privada), 100, "")
        .await
        .expect("la consulta es válida");
    assert!(
        privadas.items.is_empty(),
        "sin owner_id no puede salir ninguna privada, ni la propia: no se pidió ninguna"
    );

    // Y las propias sí, con `owner_id`.
    let mis_privadas = repo
        .list(Some(autor_a), false, Some(State::Privada), 100, "")
        .await
        .expect("la consulta es válida");
    let ids: Vec<Uuid> = mis_privadas.items.iter().map(|row| row.id).collect();
    assert_eq!(ids, vec![privada_a.id]);

    // 3) El catálogo sigue sin incluir lo no aprobado, ni siquiera pidiendo el estado.
    let catalogo = repo
        .list(None, true, None, 100, "")
        .await
        .expect("el catálogo tiene que listarse");
    let ids: Vec<Uuid> = catalogo.items.iter().map(|row| row.id).collect();
    assert!(
        ids.contains(&publicada_b.id),
        "lo aprobado está en el catálogo"
    );
    assert!(!ids.contains(&propuesta_a.id), "una propuesta no está");
    assert!(!ids.contains(&privada_a.id), "una privada tampoco");

    // Y la propuesta se sirve con su DEFINICIÓN VIGENTE, que es la que se aprobaría: si la
    // bandeja enseñara la publicada, para una primera propuesta no habría fila y saldría vacía.
    let en_bandeja = bandeja
        .items
        .iter()
        .find(|row| row.id == propuesta_a.id)
        .expect("la propuesta de A está en la bandeja");
    assert_eq!(en_bandeja.version, 1);
    assert_eq!(en_bandeja.published_version, None);
}
