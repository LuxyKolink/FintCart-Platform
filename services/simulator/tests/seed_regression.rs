//! Regresión de las siete definiciones semilla contra el código nativo (T092; SC-015,
//! FR-049).
//!
//! ## Qué sostiene esta suite
//!
//! FR-049 dice que las cinco calculadoras de FR-019 se resiembran sobre el motor de fórmulas
//! **reproduciendo su resultado**. Esta es la prueba de esa palabra: para cada semilla, ejecuta
//! el MOTOR y el CÓDIGO NATIVO con las mismas entradas y exige el mismo mapa de salidas.
//!
//! Es la puerta de la fase: `services/simulator/src/calculators/` **no se elimina** (T098)
//! hasta que esta suite pase en verde. Mientras las dos implementaciones convivan, cualquier
//! divergencia que introduzca el motor aparece aquí y no tres semanas después en una cifra que
//! un usuario compara con la de su banco.
//!
//! ## Por qué se compara contra las funciones y no contra el despacho
//!
//! `domain::dispatch::compute` devuelve `map<string, string>` ya formateado, que es la forma
//! del contrato. Comparar ahí mediría a la vez el cálculo y el formateo, y un fallo de formato
//! se leería como un fallo de fórmula. Aquí se llaman `ahorro::compute`, `credito::compute`, …
//! y se comparan los [`Decimal`] del [`Outcome`] contra los del motor: si los dos coinciden,
//! cualquier diferencia de texto viene del formateo, que ya tiene sus propias pruebas.
//!
//! ## Por qué las tablas se GENERAN y no se escriben a mano
//!
//! Los bordes que importan son las combinaciones —el plazo máximo con la tasa mínima, el plazo
//! cero con aporte cero—, y una tabla escrita a mano acaba cubriendo cada campo por separado,
//! que es justo donde no hay nada que descubrir. El producto cartesiano de unas pocas
//! alternativas por campo cubre las combinaciones por construcción.
//!
//! ## La guarda contra el falso verde
//!
//! Una suite así puede pasar **sin calcular nada**: basta con que todas las entradas acaben
//! rechazadas para que las dos partes coincidan en el error. Por eso cada prueba cuenta los
//! casos que llegaron a calcular y exige un mínimo. Sin esa cuenta, romper el motor entero
//! —devolver siempre un error— dejaría la suite en verde, que es la peor forma de fallar: en
//! silencio y con el visto bueno puesto.
//!
//! ## Lo que esta suite NO comprueba
//!
//! Los MENSAJES de error no se comparan caso a caso. Las dos implementaciones escriben para
//! lectores distintos —el nativo para el log de quien opera el servicio, la semilla para el
//! usuario que redactó la calculadora— y los de la semilla son deliberadamente distintos y
//! mejores. Que el mensaje del autor llegue al usuario sí se comprueba, en
//! [`los_mensajes_del_autor_llegan_al_usuario`].
//!
//! Tampoco se comparan los casos en los que alguna de las dos **aborta**, porque no hay dos
//! resultados que contrastar. Esos casos se cuentan y se acotan, no se ignoran: la cota es lo
//! que impide que el conjunto incomparable crezca en silencio hasta que la suite esté verde
//! cubriendo cada vez menos. Y no son una nota al pie — son el hallazgo más importante de esta
//! tarea, y están en dos pruebas propias:
//!
//! - [`el_motor_no_hereda_los_panicos_del_codigo_nativo`]: `ahorro.rs:60` multiplica con `*`,
//!   que aborta al desbordar, y el motor no, porque su evaluador usa `checked_mul`.
//! - [`annuity_no_entra_en_panico_y_el_motor_tampoco`]: por la vía de `cuota`/`vf_serie` el
//!   motor **sí** abortaba, porque compartía `annuity` con el nativo y ahí las
//!   multiplicaciones también eran `*` —al contrario de lo que prometía la documentación del
//!   módulo—. **Corregido en T098** (D-27) al mudar `annuity` a `domain`: ahora los dos
//!   devuelven un error de dominio.
//!
//! Las cifras de la tabla, para que un cambio futuro en ellas se lea como lo que es: `ahorro`
//! conserva 3 casos en los que solo aborta el NATIVO —su `ahorro.rs` sigue multiplicando con
//! `*`, y ese archivo lo retira T098— y **cero** en los que abortan los dos. Los otros seis no
//! tienen ninguno.

use std::any::Any;
use std::collections::{BTreeMap, HashMap};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::str::FromStr;

use rust_decimal::Decimal;
use uuid::Uuid;

use fintcart_simulator::calculators::{ahorro, colombia, credito, inversion, presupuesto, Outcome};
use fintcart_simulator::domain::error::Error;
use fintcart_simulator::domain::inputs::{Inputs, MAX_PERIODS};
use fintcart_simulator::domain::seeds::{self, Compiled};

// ─────────────────────────────────────────────────────────────────────────────
// Andamiaje
// ─────────────────────────────────────────────────────────────────────────────

/// Las siete semillas, ya analizadas.
///
/// Falla aquí, y no en cada prueba, si alguna no analiza: `compile()` es la comprobación de
/// que las semillas pasan por el MISMO analizador que la definición de un usuario, y una
/// semilla que no analiza no tiene nada que comparar.
fn semillas() -> Vec<Compiled> {
    seeds::compile().unwrap_or_else(|fallos| {
        let detalle: Vec<String> = fallos
            .iter()
            .map(|fallo| {
                let issues: Vec<String> = fallo
                    .issues
                    .iter()
                    .map(|issue| {
                        format!(
                            "{} [{}] {}",
                            issue.location,
                            issue.code.as_str(),
                            issue.message
                        )
                    })
                    .collect();
                format!("  {}: {}", fallo.seed, issues.join("; "))
            })
            .collect();
        panic!(
            "las definiciones semilla deben analizar ({} con problemas):\n{}",
            fallos.len(),
            detalle.join("\n")
        );
    })
}

/// La semilla con ese nombre.
fn semilla(name: &str) -> Compiled {
    let mut todas = semillas();
    let index = todas
        .iter()
        .position(|seed| seed.name == name)
        .unwrap_or_else(|| panic!("no hay ninguna semilla llamada {name}"));
    todas.remove(index)
}

/// Qué pasó al ejecutar un caso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Desenlace {
    /// Las dos implementaciones calcularon y coincidieron.
    Calculado,
    /// Las dos rechazaron. Ver la nota del módulo sobre por qué no se comparan los mensajes.
    Rechazado,
    /// El código nativo entró en **pánico** y el motor devolvió un error limpio.
    ///
    /// El motor es mejor aquí, y por eso el caso NO cuenta como comparado: no hay dos
    /// resultados que contrastar. Ver [`el_motor_no_hereda_los_panicos_del_codigo_nativo`].
    PanicoNativo,
    /// Las dos entraron en **pánico**.
    ///
    /// No es «las dos rechazaron». Coinciden en abortar, que no es coincidir en un resultado:
    /// ninguna de las dos produjo nada que se pueda comparar.
    ///
    /// Ocurría porque el motor **comparte** `annuity` con el nativo —decisión deliberada de
    /// T083, para que esta suite no comparara el motor contra sí mismo— y ese módulo
    /// multiplicaba con `*` en vez de con `checked_mul`. **Corregido en T098** (D-27), así que
    /// hoy esta variante es inalcanzable y su tope está en cero para todas las semillas: no se
    /// retira para que, si alguien reintroduce una multiplicación que aborta en un camino que
    /// las dos comparten, la cuenta lo diga en vez de pasar por un rechazo.
    PanicoCompartido,
}

/// Qué hizo una de las dos implementaciones.
enum Hecho {
    /// Produjo un resultado.
    Calculo(BTreeMap<String, Decimal>),
    /// Rechazó con un error.
    Rechazo,
    /// Abortó.
    Panico,
}

/// Clasifica el resultado de llamar a una implementación.
fn hecho(
    resultado: Result<Result<BTreeMap<String, Decimal>, Error>, Box<dyn Any + Send>>,
) -> Hecho {
    match resultado {
        Ok(Ok(valores)) => Hecho::Calculo(valores),
        Ok(Err(_)) => Hecho::Rechazo,
        Err(_) => Hecho::Panico,
    }
}

/// Cuántos casos cayeron en cada desenlace.
///
/// Existe para poder afirmar DOS cosas a la vez: que la suite calculó bastante —y no pasa
/// porque todo se rechaza— y que los casos incomparables siguen siendo los que ya se conocían.
#[derive(Debug, Default)]
struct Recuento {
    calculados: usize,
    rechazados: usize,
    panicos_nativos: usize,
    panicos_compartidos: usize,
}

impl Recuento {
    fn anota(&mut self, desenlace: Desenlace) {
        match desenlace {
            Desenlace::Calculado => self.calculados += 1,
            Desenlace::Rechazado => self.rechazados += 1,
            Desenlace::PanicoNativo => self.panicos_nativos += 1,
            Desenlace::PanicoCompartido => self.panicos_compartidos += 1,
        }
    }

    fn total(&self) -> usize {
        self.calculados + self.rechazados + self.panicos_nativos + self.panicos_compartidos
    }
}

/// Un caso de la tabla: las entradas y los indicadores vigentes.
struct Caso {
    /// Descripción legible, para el mensaje de fallo.
    nombre: String,
    /// Entradas del motor, con las claves de la definición semilla.
    motor: HashMap<String, String>,
    /// Entradas del código nativo, que no siempre coinciden: `gmf` recibe la UVT como
    /// parámetro y la exención como texto.
    nativo: HashMap<String, String>,
    /// Indicadores vigentes.
    indicadores: HashMap<String, Decimal>,
}

impl Caso {
    /// Caso en el que las dos partes reciben exactamente las mismas entradas.
    fn iguales(nombre: String, fila: &[(&'static str, Option<&'static str>)]) -> Self {
        let entradas = sin_ausentes(fila);
        Self {
            nombre,
            motor: entradas.clone(),
            nativo: entradas,
            indicadores: HashMap::new(),
        }
    }

    /// Añade un indicador vigente.
    fn con_indicador(mut self, name: &str, value: &str) -> Self {
        self.indicadores.insert(
            name.to_owned(),
            Decimal::from_str(value).expect("valor de indicador"),
        );
        self
    }

    /// Añade una entrada SOLO al mapa del nativo.
    ///
    /// Es lo que necesita una calculadora colombiana: el nativo despacha por el texto
    /// `operacion`, y el motor ya no lo tiene porque cada operación es una definición.
    fn solo_nativo(mut self, key: &str, value: &str) -> Self {
        self.nativo.insert(key.to_owned(), value.to_owned());
        self
    }
}

/// Convierte la fila en mapa, descartando los campos ausentes.
///
/// «Ausente» y «vacío» no son lo mismo: un campo que llega como cadena vacía se rechaza por no
/// ser decimal, mientras que uno ausente toma su valor por defecto o dispara la obligatoriedad.
/// Por eso la tabla usa `Option` y no `""`.
fn sin_ausentes(fila: &[(&'static str, Option<&'static str>)]) -> HashMap<String, String> {
    fila.iter()
        .filter_map(|(key, value)| value.map(|value| ((*key).to_owned(), value.to_owned())))
        .collect()
}

/// Nombra una fila para el mensaje de fallo.
fn describe(fila: &[(&'static str, Option<&'static str>)]) -> String {
    fila.iter()
        .map(|(key, value)| match value {
            Some(value) => format!("{key}={value}"),
            None => format!("{key}=ausente"),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Producto cartesiano de las alternativas de cada campo.
fn producto(
    campos: &[(&'static str, &[Option<&'static str>])],
) -> Vec<Vec<(&'static str, Option<&'static str>)>> {
    let mut acumulado: Vec<Vec<(&'static str, Option<&'static str>)>> = vec![Vec::new()];

    for (key, alternativas) in campos {
        let mut siguiente = Vec::with_capacity(acumulado.len() * alternativas.len());
        for prefijo in &acumulado {
            for alternativa in *alternativas {
                let mut fila = prefijo.clone();
                fila.push((key, *alternativa));
                siguiente.push(fila);
            }
        }
        acumulado = siguiente;
    }

    acumulado
}

/// Ejecuta las dos implementaciones y compara.
///
/// # Panics
///
/// Si una calcula y la otra rechaza —que es la divergencia que esta suite existe para
/// atrapar— o si las dos calculan y los mapas difieren.
fn compara(
    seed: &Compiled,
    caso: &Caso,
    nativo: impl FnOnce(&HashMap<String, String>) -> Result<Outcome, Error>,
) -> Desenlace {
    // Las dos llamadas van dentro de `catch_unwind` porque las dos pueden ENTRAR EN PÁNICO: el
    // nativo por sus propias multiplicaciones y el motor porque comparte `annuity` con él. Sin
    // capturarlas, un caso así tumbaría la prueba entera y el fallo se leería como un problema
    // de esta suite en vez de como el defecto que es.
    let esperado = hecho(catch_unwind(AssertUnwindSafe(|| {
        nativo(&caso.nativo).map(|outcome| {
            outcome
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect()
        })
    })));
    let obtenido = hecho(catch_unwind(AssertUnwindSafe(|| {
        seed.definition
            .run(&caso.motor, &caso.indicadores)
            .map(|salidas| salidas.into_iter().collect())
    })));

    match (esperado, obtenido) {
        (Hecho::Calculo(esperado), Hecho::Calculo(obtenido)) => {
            assert_eq!(
                esperado, obtenido,
                "«{}» con {} ({}): el motor no reproduce el código nativo",
                seed.name, caso.nombre, seed.name
            );
            Desenlace::Calculado
        }
        (Hecho::Rechazo, Hecho::Rechazo) => Desenlace::Rechazado,
        // El motor es MEJOR: rechaza limpiamente donde el nativo aborta.
        (Hecho::Panico, Hecho::Rechazo) => Desenlace::PanicoNativo,
        // Coinciden en abortar, que no es coincidir en un resultado.
        (Hecho::Panico, Hecho::Panico) => Desenlace::PanicoCompartido,
        (Hecho::Calculo(_), Hecho::Rechazo) => panic!(
            "«{}» con {}: el código nativo calcula y el motor rechaza",
            seed.name, caso.nombre
        ),
        (Hecho::Rechazo, Hecho::Calculo(_)) => panic!(
            "«{}» con {}: el motor calcula y el código nativo rechaza",
            seed.name, caso.nombre
        ),
        // Las tres que quedan son el motor PEOR que el nativo, o calculando cosas distintas.
        // Ninguna es aceptable y ninguna está prevista: si alguna salta, hay que mirarla.
        (Hecho::Rechazo, Hecho::Panico) => panic!(
            "«{}» con {}: el motor entra en pánico donde el código nativo rechaza limpiamente",
            seed.name, caso.nombre
        ),
        (Hecho::Calculo(_), Hecho::Panico) => panic!(
            "«{}» con {}: el motor entra en pánico donde el código nativo calcula",
            seed.name, caso.nombre
        ),
        (Hecho::Panico, Hecho::Calculo(_)) => panic!(
            "«{}» con {}: el motor calcula donde el código nativo entra en pánico, así que las \
             dos implementaciones no están haciendo lo mismo",
            seed.name, caso.nombre
        ),
    }
}

/// Comprueba que la suite calculó bastante y que los casos incomparables no crecieron.
///
/// Las dos afirmaciones son necesarias y por razones distintas. Sin la primera, una suite en la
/// que TODO se rechaza —o en la que las dos implementaciones abortan en todos los casos— pasa
/// vacía. Sin las otras dos, los casos donde no hay nada que comparar podrían multiplicarse sin
/// que nadie lo notara, y la suite seguiría verde cubriendo cada vez menos.
fn exige(
    seed: &str,
    recuento: &Recuento,
    minimo_calculados: usize,
    maximo_panico_nativo: usize,
    maximo_panico_compartido: usize,
) {
    assert!(
        recuento.calculados >= minimo_calculados,
        "«{seed}»: solo {} de {} casos calcularon y se esperaban al menos {minimo_calculados} \
         ({} rechazados, {} con pánico solo del nativo, {} con pánico de los dos). Una suite que \
         pasa porque TODO se rechaza no comprueba nada",
        recuento.calculados,
        recuento.total(),
        recuento.rechazados,
        recuento.panicos_nativos,
        recuento.panicos_compartidos
    );
    assert!(
        recuento.panicos_nativos <= maximo_panico_nativo
            && recuento.panicos_compartidos <= maximo_panico_compartido,
        "«{seed}»: casos incomparables fuera de lo conocido — {} con pánico SOLO del código \
         nativo (se conocían {maximo_panico_nativo}) y {} con pánico de los DOS (se conocían \
         {maximo_panico_compartido}). Ver `el_motor_no_hereda_los_panicos_del_codigo_nativo` y \
         `el_motor_hereda_los_panicos_de_annuity`",
        recuento.panicos_nativos,
        recuento.panicos_compartidos
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Las siete semillas existen y analizan
// ─────────────────────────────────────────────────────────────────────────────

/// Los nombres son el contrato con `dev/seed` y con el despacho por `calculator_id`: una
/// semilla que se renombre deja de ser alcanzable por su nombre, y sin esta lista el renombrado
/// no rompería nada hasta que alguien pidiera esa calculadora.
#[test]
fn las_siete_semillas_existen_con_su_nombre() {
    let nombres: Vec<&str> = semillas().iter().map(|seed| seed.name).collect();
    assert_eq!(
        nombres,
        vec![
            "ahorro",
            "credito",
            "presupuesto",
            "inversion",
            "ea_a_mv",
            "mv_a_ea",
            "gmf",
        ]
    );
}

/// Los siete identificadores son distintos y viven en el bloque reservado (T095).
///
/// Es la invariante de la que depende el sembrado: si dos semillas compartieran identificador,
/// la segunda no se insertaría —la primera ya está— y `dev/seed` diría «7 semillas» sobre una
/// base con seis. Y si una se saliera del bloque `…e0NN`, dejaría de ser reconocible como
/// semilla en la base, que es la única señal de que esa fila no la creó nadie.
#[test]
fn cada_semilla_tiene_un_identificador_estable_y_distinto() {
    let semillas = semillas();
    let ids: Vec<Uuid> = semillas.iter().map(|seed| seed.id).collect();

    let distintos: std::collections::BTreeSet<Uuid> = ids.iter().copied().collect();
    assert_eq!(
        distintos.len(),
        ids.len(),
        "dos semillas comparten identificador: {ids:?}"
    );

    for (seed, id) in semillas.iter().zip(&ids) {
        let texto = id.to_string();
        assert!(
            texto.starts_with("00000000-0000-4000-8000-00000000e0"),
            "«{}» tiene {texto}, fuera del bloque reservado a las semillas",
            seed.name
        );
    }
}

/// Los nombres de los indicadores sembrados son EXACTAMENTE el catálogo de las semillas.
///
/// Las dos listas existen por razones distintas —una dice qué indicadores crea `dev/seed`, la
/// otra contra qué catálogo se analizan las fórmulas— y por eso pueden divergir. Si divergieran,
/// el síntoma sería una fila invisible: un indicador que existe en la base y que ninguna fórmula
/// puede referenciar, porque el analizador no lo conoce. La prueba las ata.
#[test]
fn los_indicadores_sembrados_son_el_catalogo_de_las_semillas() {
    let sembrados: Vec<&str> = fintcart_simulator::repo::seeds::YEAR_INDICATORS
        .iter()
        .map(|(name, _)| *name)
        .collect();

    assert_eq!(
        sembrados,
        fintcart_simulator::domain::seeds::INDICATORS.to_vec()
    );
}

/// Los valores de indicador que se siembran son decimales canónicos dentro de su columna.
///
/// `value` es `NUMERIC(20,6)` y `financial_indicators_value_non_negative` exige que no sea
/// negativo. Un valor sembrado que no encajara no fallaría hasta la siembra, y el mensaje sería
/// del driver.
#[test]
fn los_valores_sembrados_caben_en_su_columna() {
    for (name, value) in fintcart_simulator::repo::seeds::YEAR_INDICATORS {
        let decimal = Decimal::from_str(value)
            .unwrap_or_else(|_| panic!("«{name}» tiene un valor que no es decimal: {value:?}"));
        assert!(
            decimal >= Decimal::ZERO,
            "«{name}» tiene un valor negativo: {value}"
        );
        assert!(
            decimal.scale() <= 6,
            "«{name}» tiene más de seis decimales y no cabe en NUMERIC(20,6): {value}"
        );
    }
}

/// Solo `gmf` depende de un indicador.
///
/// Es la información con la que `dev/seed` decide qué indicadores tiene que crear (T095): sin
/// `UVT`, `gmf` no se puede ejecutar. Que las otras seis no dependan de ninguno es igual de
/// importante — si una empezara a hacerlo, el sembrado tendría que crecer y nadie lo notaría—.
#[test]
fn solo_gmf_depende_de_un_indicador() {
    for seed in semillas() {
        let usados = seed.definition.indicators_used();
        if seed.name == "gmf" {
            assert_eq!(usados, vec!["UVT".to_owned()], "gmf usa la UVT");
        } else {
            assert!(
                usados.is_empty(),
                "«{}» no debería depender de ningún indicador y usa {usados:?}",
                seed.name
            );
        }
    }
}

/// El mensaje del AUTOR es el que llega al usuario (FR-044, D-15).
///
/// Es la mitad de D-15 que no se ve en una comparación de resultados: el nativo devuelve
/// «el ingreso mensual debe ser mayor que cero» porque alguien lo escribió en un `return`, y la
/// semilla tiene que devolver **la misma frase** porque alguien la declaró en `validations`. Si
/// la regla se hubiera dejado fuera, el usuario habría leído una división por cero del motor, y
/// ninguna comparación de resultados lo habría notado: el caso se rechaza en las dos.
#[test]
fn los_mensajes_del_autor_llegan_al_usuario() {
    let presupuesto = semilla("presupuesto");
    let caso = Caso::iguales("ingreso cero".to_owned(), &[("ingreso_mensual", Some("0"))]);
    let error = presupuesto
        .definition
        .run(&caso.motor, &caso.indicadores)
        .expect_err("un ingreso de cero debe rechazarse");
    assert!(
        matches!(&error, Error::InvalidInput(msg) if msg == "el ingreso mensual debe ser mayor que cero"),
        "se esperaba el mensaje del autor y llegó: {error}"
    );

    // Y la regla sobre un INDICADOR, que es la que estuvo a punto de no estar: sin ella un
    // `@UVT` de cero daría una exención de cero a quien la pidió, sin decir nada.
    let gmf = semilla("gmf");
    let caso = Caso::iguales("uvt cero".to_owned(), &[("monto", Some("1000000"))])
        .con_indicador("UVT", "0");
    let error = gmf
        .definition
        .run(&caso.motor, &caso.indicadores)
        .expect_err("una UVT de cero debe rechazarse");
    assert!(
        matches!(&error, Error::InvalidInput(msg) if msg == "el valor de la UVT debe ser mayor que cero"),
        "se esperaba el mensaje del autor y llegó: {error}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// ahorro
// ─────────────────────────────────────────────────────────────────────────────

const DEPOSITO: &[Option<&str>] = &[None, Some("0"), Some("1000000")];
const APORTE: &[Option<&str>] = &[None, Some("0"), Some("250000")];
const TASA_ANUAL: &[Option<&str>] = &[Some("0"), Some("0.000001"), Some("0.12"), Some("0.6")];
const MESES: &[Option<&str>] = &[
    Some("1"),
    Some("12"),
    Some("60"),
    Some("1200"),
    Some("0"),
    Some("1201"),
];

fn casos_ahorro() -> Vec<Caso> {
    let mut casos: Vec<Caso> = producto(&[
        ("deposito_inicial", DEPOSITO),
        ("aporte_mensual", APORTE),
        ("tasa_anual", TASA_ANUAL),
        ("meses", MESES),
    ])
    .into_iter()
    .map(|fila| Caso::iguales(describe(&fila), &fila))
    .collect();

    // Montos NEGATIVOS. El código nativo los acepta —`money_or_zero` no los acota— y la
    // semilla tiene que aceptarlos igual: acotarlos sería corregir un comportamiento, que es
    // una decisión de alcance y no una traducción. Están aquí para que esa decisión esté
    // fijada por una prueba y no por un descuido.
    for (nombre, deposito, aporte) in [
        ("depósito negativo con aporte", "-100000", "250000"),
        ("los dos negativos", "-100", "-200"),
        ("los dos en cero", "0", "0"),
    ] {
        casos.push(Caso::iguales(
            nombre.to_owned(),
            &[
                ("deposito_inicial", Some(deposito)),
                ("aporte_mensual", Some(aporte)),
                ("tasa_anual", Some("0.12")),
                ("meses", Some("12")),
            ],
        ));
    }

    // Tasa negativa: la rechazan las dos, pero por caminos distintos —el nativo con un `if`, la
    // semilla con una regla del autor—, y eso es exactamente lo que hay que fijar.
    casos.push(Caso::iguales(
        "tasa negativa".to_owned(),
        &[
            ("deposito_inicial", Some("1000000")),
            ("tasa_anual", Some("-0.01")),
            ("meses", Some("12")),
        ],
    ));

    casos
}

#[test]
fn ahorro_reproduce_el_codigo_nativo() {
    let seed = semilla("ahorro");
    let casos = casos_ahorro();
    let mut recuento = Recuento::default();

    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            ahorro::compute(&Inputs::new(raw))
        }));
    }

    exige("ahorro", &recuento, 40, 3, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// credito
// ─────────────────────────────────────────────────────────────────────────────

const MONTO: &[Option<&str>] = &[Some("0"), Some("1"), Some("1000000"), Some("50000000")];
const MESES_CUOTA: &[Option<&str>] = &[
    Some("1"),
    Some("12"),
    Some("60"),
    Some("240"),
    Some("1200"),
    Some("0"),
    Some("1201"),
];
const TASA_CREDITO: &[Option<&str>] = &[Some("0"), Some("0.000001"), Some("0.24"), Some("0.6")];

/// La tasa CERO es el caso especial de las fórmulas de anualidad: dividirían por cero.
///
/// Está en la tabla general, pero se comprueba aparte con un crédito grande para que el
/// resultado sea un número con dígitos y no un cero que ocultaría un error de signo.
#[test]
fn ahorro_y_credito_resuelven_la_tasa_cero() {
    let credito_seed = semilla("credito");
    let caso = Caso::iguales(
        "cuota sin interés".to_owned(),
        &[
            ("monto", Some("1200000")),
            ("tasa_anual", Some("0")),
            ("meses", Some("12")),
        ],
    );
    assert_eq!(
        compara(&credito_seed, &caso, |raw| credito::compute(&Inputs::new(
            raw
        ))),
        Desenlace::Calculado
    );

    let ahorro_seed = semilla("ahorro");
    let caso = Caso::iguales(
        "ahorro bajo el colchón".to_owned(),
        &[
            ("deposito_inicial", Some("0")),
            ("aporte_mensual", Some("100000")),
            ("tasa_anual", Some("0")),
            ("meses", Some("24")),
        ],
    );
    assert_eq!(
        compara(&ahorro_seed, &caso, |raw| ahorro::compute(&Inputs::new(
            raw
        ))),
        Desenlace::Calculado
    );
}

#[test]
fn credito_reproduce_el_codigo_nativo() {
    let seed = semilla("credito");
    let mut casos: Vec<Caso> = producto(&[
        ("monto", MONTO),
        ("tasa_anual", TASA_CREDITO),
        ("meses", MESES_CUOTA),
    ])
    .into_iter()
    .map(|fila| Caso::iguales(describe(&fila), &fila))
    .collect();

    casos.push(Caso::iguales(
        "monto negativo".to_owned(),
        &[
            ("monto", Some("-1000000")),
            ("tasa_anual", Some("0.24")),
            ("meses", Some("12")),
        ],
    ));
    casos.push(Caso::iguales(
        "tasa negativa".to_owned(),
        &[
            ("monto", Some("1000000")),
            ("tasa_anual", Some("-0.1")),
            ("meses", Some("12")),
        ],
    ));

    let mut recuento = Recuento::default();
    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            credito::compute(&Inputs::new(raw))
        }));
    }

    exige("credito", &recuento, 40, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// presupuesto
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn presupuesto_reproduce_el_codigo_nativo() {
    let seed = semilla("presupuesto");
    let mut casos: Vec<Caso> = producto(&[
        (
            "ingreso_mensual",
            &[Some("0"), Some("1"), Some("3000000"), Some("99999999.99")],
        ),
        (
            "gastos_fijos",
            &[None, Some("0"), Some("1200000"), Some("50000000")],
        ),
        (
            "gastos_variables",
            &[None, Some("0"), Some("800000"), Some("50000000")],
        ),
    ])
    .into_iter()
    .map(|fila| Caso::iguales(describe(&fila), &fila))
    .collect();

    // Un presupuesto en DÉFICIT es una respuesta legítima y la más importante de esta
    // calculadora. Se fija aparte porque recortarlo a cero sería un cambio silencioso que la
    // tabla general podría no distinguir de un cálculo correcto.
    casos.push(Caso::iguales(
        "déficit".to_owned(),
        &[
            ("ingreso_mensual", Some("1000000")),
            ("gastos_fijos", Some("1200000")),
            ("gastos_variables", Some("300000")),
        ],
    ));
    // Gastos negativos: un abono, un reintegro. El nativo los rechaza y la semilla también.
    for (nombre, key) in [
        ("gastos fijos negativos", "gastos_fijos"),
        ("gastos variables negativos", "gastos_variables"),
    ] {
        casos.push(Caso::iguales(
            nombre.to_owned(),
            &[("ingreso_mensual", Some("3000000")), (key, Some("-1"))],
        ));
    }

    let mut recuento = Recuento::default();
    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            presupuesto::compute(&Inputs::new(raw))
        }));
    }

    exige("presupuesto", &recuento, 30, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// inversion
// ─────────────────────────────────────────────────────────────────────────────

const TASA_INVERSION: &[Option<&str>] = &[
    Some("-1"),
    Some("-0.05"),
    Some("0"),
    Some("0.08"),
    Some("0.5"),
];
const ANIOS: &[Option<&str>] = &[
    Some("1"),
    Some("10"),
    Some("100"),
    Some("1200"),
    Some("0"),
    Some("1201"),
];
const INFLACION: &[Option<&str>] = &[None, Some("0"), Some("0.08"), Some("-1")];

#[test]
fn inversion_reproduce_el_codigo_nativo() {
    let seed = semilla("inversion");
    let casos: Vec<Caso> = producto(&[
        ("capital", &[Some("0"), Some("10000000"), Some("500000000")]),
        ("tasa_anual", TASA_INVERSION),
        ("anios", ANIOS),
        ("aporte_anual", &[None, Some("1200000")]),
        ("inflacion_anual", INFLACION),
    ])
    .into_iter()
    .map(|fila| Caso::iguales(describe(&fila), &fila))
    .collect();

    let mut recuento = Recuento::default();
    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            inversion::compute(&Inputs::new(raw))
        }));
    }

    exige("inversion", &recuento, 60, 0, 0);
}

/// `valor_futuro_real` se OMITE cuando no se pidió la inflación, y aparece cuando sí.
///
/// Es la mitad de FR-019 que no se puede comprobar con una igualdad de mapas en el caso
/// ausente: si la salida condicional estuviera mal escrita, el motor devolvería un valor real
/// idéntico al nominal —inflación cero implícita— y la comparación contra el nativo seguiría
/// pasando, porque el nativo hace exactamente lo mismo. Lo que hay que fijar es la AUSENCIA.
#[test]
fn inversion_omite_el_valor_real_sin_inflacion() {
    let seed = semilla("inversion");
    let base = &[
        ("capital", Some("10000000")),
        ("tasa_anual", Some("0.1")),
        ("anios", Some("10")),
    ];

    let sin_inflacion = Caso::iguales("sin inflación".to_owned(), base);
    let salidas = seed
        .definition
        .run(&sin_inflacion.motor, &sin_inflacion.indicadores)
        .expect("debe calcular");
    let claves: Vec<&str> = salidas.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(
        claves,
        vec!["valor_futuro", "capital_invertido", "rendimiento"]
    );
    assert_eq!(
        compara(&seed, &sin_inflacion, |raw| inversion::compute(
            &Inputs::new(raw)
        )),
        Desenlace::Calculado
    );

    let mut fila = base.to_vec();
    fila.push(("inflacion_anual", Some("0.08")));
    let con_inflacion = Caso::iguales("con inflación".to_owned(), &fila);
    let salidas = seed
        .definition
        .run(&con_inflacion.motor, &con_inflacion.indicadores)
        .expect("debe calcular");
    let claves: Vec<&str> = salidas.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(
        claves,
        vec![
            "valor_futuro",
            "capital_invertido",
            "rendimiento",
            "valor_futuro_real"
        ]
    );
    assert_eq!(
        compara(&seed, &con_inflacion, |raw| inversion::compute(
            &Inputs::new(raw)
        )),
        Desenlace::Calculado
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Las tres colombianas
// ─────────────────────────────────────────────────────────────────────────────

const TASAS_EA: &[Option<&str>] = &[
    Some("-1.5"),
    Some("-1"),
    Some("-0.99"),
    Some("-0.5"),
    Some("0"),
    Some("0.000001"),
    Some("0.05"),
    Some("0.24"),
    Some("0.5"),
    Some("1"),
    Some("5"),
    Some("99"),
];

/// Un caso de una calculadora colombiana.
///
/// La única diferencia con [`Caso::iguales`] es que el nativo necesita además el
/// discriminador `operacion`: era el parámetro de texto con el que una sola calculadora
/// elegía entre tres, y el motor ya no lo tiene porque cada operación es una definición.
fn caso_colombiana(operacion: &str, fila: &[(&'static str, Option<&'static str>)]) -> Caso {
    Caso::iguales(describe(fila), fila).solo_nativo("operacion", operacion)
}

#[test]
fn ea_a_mv_reproduce_el_codigo_nativo() {
    let seed = semilla("ea_a_mv");
    let casos: Vec<Caso> = producto(&[("tasa_ea", TASAS_EA)])
        .into_iter()
        .map(|fila| caso_colombiana("ea_a_mv", &fila))
        .collect();

    let mut recuento = Recuento::default();
    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            colombia::compute(&Inputs::new(raw))
        }));
    }

    exige("ea_a_mv", &recuento, 8, 0, 0);
}

#[test]
fn mv_a_ea_reproduce_el_codigo_nativo() {
    let seed = semilla("mv_a_ea");
    let casos: Vec<Caso> = producto(&[(
        "tasa_mv",
        &[
            Some("-1.5"),
            Some("-1"),
            Some("-0.99"),
            Some("-0.5"),
            Some("0"),
            Some("0.000001"),
            Some("0.02"),
            Some("0.1"),
            Some("0.5"),
        ][..],
    )])
    .into_iter()
    .map(|fila| caso_colombiana("mv_a_ea", &fila))
    .collect();

    let mut recuento = Recuento::default();
    for caso in &casos {
        recuento.anota(compara(&seed, caso, |raw| {
            colombia::compute(&Inputs::new(raw))
        }));
    }

    exige("mv_a_ea", &recuento, 6, 0, 0);
}

/// Un caso de GMF, que es el único donde las dos entradas NO coinciden.
///
/// El motor recibe `exento` como el entero `1`/`0` —el lenguaje no tiene texto— y no recibe la
/// UVT, que toma del indicador `@UVT`. El nativo recibe `exento` como el texto `"si"`/`"no"` y
/// la UVT como el parámetro `valor_uvt`. Traducir es trabajo de la prueba: la divergencia es
/// deliberada y está documentada en `domain::seeds::colombia`.
fn caso_gmf(monto: Option<&str>, exento: Option<&str>, uvt: &str) -> Caso {
    let mut motor = HashMap::new();
    if let Some(monto) = monto {
        motor.insert("monto".to_owned(), monto.to_owned());
    }
    if let Some(exento) = exento {
        motor.insert("exento".to_owned(), exento.to_owned());
    }

    let mut nativo = motor.clone();
    nativo.insert("operacion".to_owned(), "gmf".to_owned());
    nativo.insert("valor_uvt".to_owned(), uvt.to_owned());
    match exento {
        Some("1") => {
            nativo.insert("exento".to_owned(), "si".to_owned());
        }
        Some(_) => {
            nativo.insert("exento".to_owned(), "no".to_owned());
        }
        None => {
            nativo.remove("exento");
        }
    }

    let nombre = format!("monto={monto:?} exento={exento:?} uvt={uvt}");
    Caso {
        nombre,
        motor,
        nativo,
        indicadores: HashMap::new(),
    }
    .con_indicador("UVT", uvt)
}

#[test]
fn gmf_reproduce_el_codigo_nativo() {
    let seed = semilla("gmf");
    let montos = [Some("0"), Some("1"), Some("1000000"), Some("99999999.99")];
    let exenciones = [None, Some("0"), Some("1")];
    let uvts = ["1", "47065", "1000000"];

    let mut recuento = Recuento::default();

    for monto in montos {
        for exento in exenciones {
            for uvt in uvts {
                let caso = caso_gmf(monto, exento, uvt);
                recuento.anota(compara(&seed, &caso, |raw| {
                    colombia::compute(&Inputs::new(raw))
                }));
            }
        }
    }

    exige("gmf", &recuento, 20, 0, 0);
}

/// La UVT de CERO la rechazan las dos.
///
/// Es el caso que obligó a que la regla `@UVT > 0` existiera. Sin ella la semilla habría
/// calculado —`tope_exencion = 0` y ninguna exención para quien la pidió— mientras el nativo
/// rechazaba, y esa asimetría es la que la tabla general de `gmf` no puede tener porque
/// excluye la UVT cero a propósito.
#[test]
fn gmf_rechaza_la_uvt_cero_como_el_codigo_nativo() {
    let seed = semilla("gmf");
    let caso = caso_gmf(Some("1000000"), Some("1"), "0");
    assert_eq!(
        compara(&seed, &caso, |raw| colombia::compute(&Inputs::new(raw))),
        Desenlace::Rechazado
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// El defecto que el motor NO hereda
// ─────────────────────────────────────────────────────────────────────────────

/// El código nativo **aborta** al desbordar donde el motor devuelve un error limpio.
///
/// Es el hallazgo más importante de esta suite, y no es una divergencia que haya que corregir
/// en el motor sino un defecto del código que sustituye. `ahorro.rs:60` multiplica con el
/// operador `*` de `Decimal`, que **aborta** cuando el producto no cabe en la mantisa de 96
/// bits; `annuity::growth_factor` sí usa `checked_powu` y devuelve un error limpio, de modo que
/// la calculadora protege la potencia y deja sin proteger la multiplicación que viene después.
///
/// La combinación no es exótica: los tres valores están dentro de lo que el contrato admite
/// —el plazo en su tope declarado de 1200, la tasa dentro de `NUMERIC(9,6)`—, así que un
/// usuario puede provocarla desde el simulador y hoy lo que obtiene es una tarea que aborta en
/// el servidor en vez del mensaje que nombra su parámetro.
///
/// El motor no lo hereda **en esta vía**: `eval.rs:176` multiplica con `Decimal::checked_mul`,
/// que devuelve `None` y se convierte en `Error::InvalidInput` (T084). Que las dos
/// implementaciones discrepen aquí es correcto y deliberado — una de las dos tiene que estar
/// mal, y la que aborta es la nativa—.
///
/// Esta prueba fija las dos mitades para que el día que alguien arregle el nativo, el cambio no
/// pase inadvertido: si `ahorro::compute` deja de entrar en pánico, la primera aserción falla y
/// obliga a releer esta nota.
///
/// **No es el único caso, ni el peor.** Ver [`el_motor_hereda_los_panicos_de_annuity`]: por la
/// vía de las primitivas de anualidad el motor **sí** aborta, porque las comparte con el nativo.
#[test]
fn el_motor_no_hereda_los_panicos_del_codigo_nativo() {
    // 1.05^1200 ≈ 2,7e25, que sí cabe; el producto por el depósito —2,7e31— no.
    let desbordante: HashMap<String, String> = [
        ("deposito_inicial", "1000000"),
        ("aporte_mensual", "0"),
        ("tasa_anual", "0.6"),
        ("meses", "1200"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect();

    assert!(
        catch_unwind(AssertUnwindSafe(|| ahorro::compute(&Inputs::new(
            &desbordante
        ))))
        .is_err(),
        "el código nativo ya no entra en pánico con esta combinación; si se arregló, hay que \
         retirar esta prueba y la nota que la acompaña"
    );

    let seed = semilla("ahorro");
    let error = seed
        .definition
        .run(&desbordante, &HashMap::new())
        .expect_err("el motor no puede calcular un valor que no cabe en la mantisa");
    assert!(
        matches!(error, Error::InvalidInput(_)),
        "el motor debe devolver un error de dominio y no un pánico: {error}"
    );
}

/// `annuity` ya NO entra en pánico, y el motor tampoco (D-27, T098).
///
/// Aquí vivía la cara opuesta de [`el_motor_no_hereda_los_panicos_del_codigo_nativo`]: un
/// caso en el que las DOS implementaciones abortaban, porque el motor comparte `annuity` con
/// el código nativo y ese módulo multiplicaba con `*` en vez de con `checked_mul`, al
/// contrario de lo que prometía su propia documentación.
///
/// Se corrigió en T098 al mudar el módulo a `domain`, y conviene notar cómo se supo: la
/// suite ACOTABA estos casos en lugar de ignorarlos, y esa cota es lo que hizo que esta
/// prueba fallara sola en cuanto el código nativo dejó de abortar. Un `#[ignore]` o un
/// «no se comparan» sin número habrían dejado pasar la corrección sin decir nada.
///
/// Lo que se fija ahora es la propiedad que importa, y no un recuento: los dos devuelven un
/// error de DOMINIO. Un pánico en el hilo del RPC se convierte en un fallo interno del
/// servicio, así que el usuario que escribió un plazo irrazonable vería «error del servidor»
/// en lugar del parámetro que envió mal.
#[test]
fn annuity_no_entra_en_panico_y_el_motor_tampoco() {
    let desbordante: HashMap<String, String> = [
        ("monto", "50000000"),
        ("tasa_anual", "0.6"),
        ("meses", "1200"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect();

    let nativo = catch_unwind(AssertUnwindSafe(|| {
        credito::compute(&Inputs::new(&desbordante))
    }));
    let nativo =
        nativo.expect("`annuity` ya no debe abortar: sus multiplicaciones son `checked_mul`");
    assert!(
        matches!(nativo, Err(Error::InvalidInput(_))),
        "el nativo debe devolver un error de dominio y no un pánico, ni un resultado: {nativo:?}"
    );

    let seed = semilla("credito");
    let motor = catch_unwind(AssertUnwindSafe(|| {
        seed.definition.run(&desbordante, &HashMap::new())
    }));
    let motor = motor.expect("el motor hereda `annuity`, así que tampoco debe abortar");
    assert!(
        matches!(motor, Err(Error::InvalidInput(_))),
        "el motor debe devolver un error de dominio: {motor:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Los topes de plazo
// ─────────────────────────────────────────────────────────────────────────────

/// El plazo máximo declarado en el rango de las semillas es el del código nativo.
///
/// Se comprueba contra la constante y no contra el literal `1200`, porque el rango declarado y
/// la barrera de representabilidad del nativo tienen que ser **el mismo número**: si el rango
/// fuera mayor, un plazo aceptado por el rango desbordaría la mantisa y el usuario leería un
/// desbordamiento en vez del parámetro que está mal.
#[test]
fn el_plazo_maximo_de_las_semillas_es_el_del_codigo_nativo() {
    for nombre in ["ahorro", "credito", "inversion"] {
        let seed = semilla(nombre);
        let campo = if nombre == "inversion" {
            "anios"
        } else {
            "meses"
        };
        let input = seed
            .definition
            .inputs
            .iter()
            .find(|input| input.key == campo)
            .unwrap_or_else(|| panic!("«{nombre}» debe declarar {campo}"));
        assert_eq!(
            input.max,
            Some(Decimal::from(MAX_PERIODS)),
            "«{nombre}»: el máximo de {campo} debe ser MAX_PERIODS"
        );
        assert_eq!(
            input.min,
            Some(Decimal::ONE),
            "«{nombre}»: el mínimo de {campo} debe ser 1"
        );
    }
}

/// La tabla de semillas y los tipos nativos dicen lo MISMO en las dos direcciones (D-29).
///
/// `dispatch::SEEDS` relaciona los dos vocabularios —el nombre de una definición semilla y el
/// tipo nativo que reproduce— y lo hace en los dos sentidos: `seed_name` va del tipo a la
/// semilla (para atribuir una simulación hecha por `calc_type`) y `kind_of_seed` al revés
/// (para decidir con qué `calc_type` se registra una hecha por `calculator_id`). Si las dos
/// direcciones discreparan, la misma calculadora quedaría registrada de dos maneras según
/// cómo la hubieran pedido, y las dos serían «correctas» por separado.
///
/// Se comprueba además contra `seeds::drafts()`, que es la lista de verdad: si `SEEDS`
/// nombrara una semilla que no existe, `builtin_version` no la encontraría nunca y toda
/// ejecución por `calc_type` quedaría sin procedencia en silencio.
#[test]
fn la_tabla_de_semillas_corresponde_a_las_semillas_de_verdad() {
    use fintcart_simulator::domain::dispatch::{kind_of_seed, seed_name, Kind, SEEDS};

    // Los nombres son EXACTAMENTE los de las siete definiciones, ni uno más ni uno menos.
    let declarados: Vec<&str> = SEEDS.iter().map(|(name, _)| *name).collect();
    let reales: Vec<&str> = semillas().iter().map(|seed| seed.name).collect();
    assert_eq!(
        declarados, reales,
        "la tabla de semillas no coincide con `domain::seeds::drafts()`"
    );

    for (name, kind) in SEEDS {
        // Ida: un nombre de semilla se resuelve a su tipo sin más contexto.
        assert_eq!(
            kind_of_seed(name),
            Some(kind),
            "«{name}» no vuelve a su propio tipo"
        );

        // Vuelta: del tipo a la semilla. Las tres colombianas necesitan el discriminador
        // —`colombia_especifica` era UNA calculadora que D-16 separó en tres, así que su
        // tipo no basta para saber cuál— y las otras cuatro no. Escribirlo como parte del
        // caso es lo que hace que esta prueba afirme la simetría EXACTA y no una aproximada:
        // si alguien diera por total la vuelta, la primera semilla colombiana lo delataría.
        let entradas = match kind {
            Kind::ColombiaEspecifica => HashMap::from([("operacion".to_owned(), name.to_owned())]),
            _ => HashMap::new(),
        };

        // `seed_name` devuelve `Result`, y [`Error`] no es `PartialEq` —envuelve un
        // `sqlx::Error`—, así que se compara el valor ya desenvolvido.
        assert_eq!(
            seed_name(kind, &entradas)
                .unwrap_or_else(|err| panic!("«{name}» no se resuelve por su tipo: {err}")),
            name,
            "«{name}» no es el nombre que devuelve su tipo"
        );
    }

    // Y un `colombia_especifica` sin discriminador reconocible NO se atribuye a ninguna,
    // en vez de elegir una de las tres por su orden en la tabla.
    assert!(
        seed_name(Kind::ColombiaEspecifica, &HashMap::new()).is_err(),
        "sin `operacion` no hay forma de saber cuál de las tres fue"
    );
    assert!(seed_name(
        Kind::ColombiaEspecifica,
        &HashMap::from([("operacion".to_owned(), "inventada".to_owned())])
    )
    .is_err());
}

/// Un nombre que no es de ninguna semilla no se atribuye a ninguna.
///
/// Es la mitad defensiva de D-29: una calculadora de un usuario puede llamarse `ahorro`, y sin
/// este `None` el nombre bastaría para atribuirle un tipo nativo que no le corresponde. Quien
/// decide es `is_builtin`, y aquí se fija que la tabla no da nada por su cuenta.
#[test]
fn un_nombre_desconocido_no_corresponde_a_ningun_tipo() {
    use fintcart_simulator::domain::dispatch::{kind_of_seed, stored_calc_type, CALC_TYPE_USUARIO};

    assert_eq!(kind_of_seed("mi-calculadora"), None);

    assert!(
        stored_calc_type(false, "ahorro").is_ok_and(|t| t == CALC_TYPE_USUARIO),
        "una calculadora de un usuario se llama 'usuario' aunque su nombre coincida \
         con el de una semilla"
    );
    assert!(stored_calc_type(true, "ahorro").is_ok_and(|t| t == "ahorro"));
    assert!(
        stored_calc_type(true, "gmf").is_ok_and(|t| t == "colombia_especifica"),
        "las tres semillas colombianas comparten el tipo nativo del que salieron"
    );

    // Una fila marcada `is_builtin` con un nombre que no es de las siete no se atribuye a
    // ningún tipo: el `CHECK` de la columna no tiene un valor que decir de ella, y elegir
    // uno por defecto sería afirmar algo falso sobre su procedencia.
    assert!(stored_calc_type(true, "inventada").is_err());
}
