//! Pruebas del evaluador (T076, Principio VIII).
//!
//! ## Qué se está comprobando en realidad
//!
//! Que los caminos de fallo **devuelvan un error de dominio y no entren en pánico**. La
//! distinción no es académica: aquí el desbordamiento no es un fallo del programa, es un
//! resultado que el usuario produjo con sus datos. Los operadores `+`, `*`, `/` de
//! `Decimal` entran en pánico al desbordar; las variantes `checked_*` devuelven `None`. Con
//! los primeros, un plazo de cien años se convierte en un fallo interno del servicio y el
//! usuario ve «error del servidor» en lugar del parámetro que envió mal.
//!
//! La forma de comprobarlo es no comprobar nada especial: si el evaluador entrara en
//! pánico, la prueba fallaría con el pánico. Lo que se afirma es que devuelve `Err`.
//!
//! ## Y que las ramas se evalúan de forma perezosa
//!
//! `si(cond, a, b)` evalúa solo la rama tomada. Es la única forma de que un autor pueda
//! protegerse de una operación inválida en un lenguaje sin sentencias, y por eso tiene sus
//! propias pruebas: sin ellas, alguien podría «optimizar» el evaluador para calcular las
//! dos ramas y solo entonces elegir, y `si(meses > 0, monto / meses, 0)` empezaría a fallar
//! exactamente con `meses = 0`, que es el caso que existe para cubrir.

use std::collections::{HashMap, HashSet};

use fintcart_simulator::domain::error::Error;
use fintcart_simulator::domain::formula::ast::{Expr, InputKind, Schema};
use fintcart_simulator::domain::formula::eval::{evaluate, evaluate_condition, Scope};
use fintcart_simulator::domain::formula::parser::{parse, Type};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// Ámbito de trabajo con una tasa y un plazo razonables.
fn scope_of(pairs: &[(&str, Decimal)]) -> (HashMap<String, Decimal>, HashSet<String>) {
    let fields: HashMap<String, Decimal> = pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), *value))
        .collect();
    let supplied: HashSet<String> = fields.keys().cloned().collect();
    (fields, supplied)
}

fn schema() -> Schema {
    Schema::new(
        [
            ("monto", InputKind::Monto),
            ("meses", InputKind::Entero),
            ("tasa_anual", InputKind::Tasa),
        ]
        .map(|(key, kind)| (key.to_owned(), kind)),
        ["UVT".to_owned()],
    )
}

/// Analiza y evalúa una fórmula numérica sobre los campos dados.
fn run(source: &str, pairs: &[(&str, Decimal)]) -> Result<Decimal, Error> {
    let expr = parse(source, &schema(), Type::Number).expect("la fórmula debe analizarse");
    let (fields, supplied) = scope_of(pairs);
    let indicators: HashMap<String, Decimal> =
        [("UVT".to_owned(), dec!(52374))].into_iter().collect();
    let scope = Scope::new(&fields, &indicators, &supplied);
    evaluate(&expr, &scope)
}

/// Analiza y evalúa una fórmula de condición sobre los campos dados.
fn run_condition(source: &str, pairs: &[(&str, Decimal)]) -> Result<bool, Error> {
    let expr = parse(source, &schema(), Type::Boolean).expect("la fórmula debe analizarse");
    let (fields, supplied) = scope_of(pairs);
    let indicators: HashMap<String, Decimal> = HashMap::new();
    let scope = Scope::new(&fields, &indicators, &supplied);
    evaluate_condition(&expr, &scope)
}

// ── 1. División por cero ────────────────────────────────────────────────────

/// Dividir entre cero es un error de dominio que nombra la causa.
#[test]
fn la_division_por_cero_es_un_error_de_dominio() {
    let err = run("monto / 0", &[("monto", dec!(1000))]).expect_err("debía fallar");
    assert!(
        matches!(err, Error::InvalidInput(ref msg) if msg.contains("cero")),
        "se esperaba un error que hablara de la división por cero, no {err:?}"
    );
}

/// El cero puede venir de un campo, no solo de un literal.
#[test]
fn la_division_por_cero_de_un_campo_tambien_se_detecta() {
    let err = run(
        "monto / meses",
        &[("monto", dec!(1000)), ("meses", dec!(0))],
    )
    .expect_err("debía fallar");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

/// El mensaje distingue «dividiste por cero» de «desbordaste».
///
/// `checked_div` devuelve `None` en los dos casos, así que sin comprobar el cero aparte el
/// autor que dividió entre cero leería un mensaje sobre la precisión disponible — cierto
/// sobre el motor y equivocado sobre su fórmula.
#[test]
fn el_mensaje_de_la_division_por_cero_no_habla_de_precision() {
    let err = run("monto / 0", &[("monto", dec!(1000))]).expect_err("debía fallar");
    let Error::InvalidInput(msg) = &err else {
        panic!("se esperaba InvalidInput, no {err:?}");
    };
    assert!(msg.contains("división por cero"), "{msg}");
    assert!(
        msg.contains("si("),
        "el mensaje debe sugerir cómo protegerse: {msg}"
    );
}

// ── 2. Desbordamiento ───────────────────────────────────────────────────────

#[test]
fn la_multiplicacion_que_desborda_es_un_error_y_no_un_panico() {
    let grande = Decimal::MAX / dec!(2);
    let err = run("monto * monto", &[("monto", grande)]).expect_err("debía desbordar");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

#[test]
fn la_suma_que_desborda_es_un_error_y_no_un_panico() {
    let err = run("monto + monto", &[("monto", Decimal::MAX)]).expect_err("debía desbordar");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

#[test]
fn la_resta_que_desborda_es_un_error_y_no_un_panico() {
    let err = run("monto - 1", &[("monto", Decimal::MIN)]).expect_err("debía desbordar");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

/// Negar el extremo de la mantisa es representable, y la prueba fija POR QUÉ.
///
/// La mantisa de `Decimal` es de 96 bits con signo, así que su rango es **simétrico**:
/// `MIN` es exactamente `-MAX`. Escribiendo esta prueba se comprobó que la negación no
/// puede desbordar, contra lo que sugiere la intuición de un entero de complemento a dos.
///
/// El evaluador usa igualmente `0 - x` con `checked_sub` en lugar de `-x`, y la prueba
/// queda para que ese detalle no se degrade en silencio: si el rango dejara de ser
/// simétrico, el camino de error ya está escrito y esta prueba lo delataría.
#[test]
fn negar_el_extremo_de_la_mantisa_es_representable() {
    let resultado = run("-monto", &[("monto", Decimal::MIN)]).expect("la negación es exacta");
    assert_eq!(
        resultado,
        Decimal::MAX,
        "el rango de Decimal es simétrico: -MIN debe dar MAX"
    );
    // Y el doble signo vuelve al origen.
    assert_eq!(
        run("- -monto", &[("monto", Decimal::MIN)]).expect("dos negaciones"),
        Decimal::MIN
    );
}

/// Un valor no representable como resultado de una división también se informa.
#[test]
fn una_division_que_no_es_representable_es_un_error() {
    // Un dividendo enorme entre un divisor diminuto: el cociente no cabe en `Decimal`.
    let err = run(
        "monto / tasa_anual",
        &[
            ("monto", Decimal::MAX),
            ("tasa_anual", dec!(0.0000000000000000000000000001)),
        ],
    )
    .expect_err("el cociente no es representable");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

// ── 3. Ámbito incompleto ────────────────────────────────────────────────────

/// Un campo referenciado que no está en el ámbito falla en vez de valer cero.
///
/// Devolver cero sería peor que fallar: un resultado con un cero donde debía ir un dato se
/// lee como un cálculo legítimo, y nadie lo revisa.
#[test]
fn un_campo_ausente_del_ambito_falla_en_vez_de_valer_cero() {
    let err = run("monto * meses", &[("monto", dec!(1000))]).expect_err("falta `meses`");
    assert!(
        matches!(err, Error::InvalidInput(ref msg) if msg.contains("meses")),
        "el error debe nombrar el campo que falta: {err:?}"
    );
}

/// Un indicador sin valor vigente falla nombrando el indicador.
#[test]
fn un_indicador_sin_valor_vigente_falla() {
    let expr = parse(
        "@SMMLV * 2",
        &Schema::new([], ["SMMLV".to_owned()]),
        Type::Number,
    )
    .expect("el indicador existe en el esquema");
    let fields = HashMap::new();
    let indicators = HashMap::new();
    let supplied = HashSet::new();
    let scope = Scope::new(&fields, &indicators, &supplied);

    let err = evaluate(&expr, &scope).expect_err("no hay valor vigente");
    assert!(
        matches!(err, Error::InvalidInput(ref msg) if msg.contains("SMMLV")),
        "{err:?}"
    );
}

// ── 4. Pereza de las ramas ──────────────────────────────────────────────────

/// El caso que justifica la evaluación perezosa: protegerse de dividir entre cero.
#[test]
fn el_condicional_no_evalua_la_rama_que_no_toma() {
    let source = "si(meses > 0, monto / meses, 0)";

    // Con `meses = 0` se toma la rama del cero, y la división no llega a ocurrir.
    let resultado = run(source, &[("monto", dec!(1000)), ("meses", dec!(0))])
        .expect("la rama no tomada no debe evaluarse");
    assert_eq!(resultado, dec!(0));

    // Y con un plazo real sí divide.
    let resultado =
        run(source, &[("monto", dec!(1000)), ("meses", dec!(4))]).expect("debe dividir");
    assert_eq!(resultado, dec!(250));
}

/// `y` cortocircuita: el lado derecho no se evalúa si el izquierdo ya es falso.
#[test]
fn la_conjuncion_cortocircuita() {
    // Si se evaluaran los dos lados, `monto / meses` fallaría con `meses = 0`.
    let resultado = run_condition(
        "meses > 0 y monto / meses > 100",
        &[("monto", dec!(1000)), ("meses", dec!(0))],
    )
    .expect("el lado derecho no debe evaluarse");
    assert!(!resultado);
}

/// `o` cortocircuita igual.
#[test]
fn la_disyuncion_cortocircuita() {
    let resultado = run_condition(
        "meses == 0 o monto / meses > 100",
        &[("monto", dec!(1000)), ("meses", dec!(0))],
    )
    .expect("el lado derecho no debe evaluarse");
    assert!(resultado);
}

// ── 5. Aritmética y comparación ─────────────────────────────────────────────

#[test]
fn la_aritmetica_basica_es_exacta() {
    assert_eq!(
        run("monto * 3", &[("monto", dec!(1234.56))]).unwrap(),
        dec!(3703.68)
    );
    assert_eq!(
        run("monto - 34.56", &[("monto", dec!(1234.56))]).unwrap(),
        dec!(1200.00)
    );
    assert_eq!(
        run("monto + 0.44", &[("monto", dec!(1234.56))]).unwrap(),
        dec!(1235.00)
    );
    // Una división con resto se deja a la precisión plena de `Decimal`; el redondeo es una
    // decisión del autor, y por eso existe `redondear`.
    assert_eq!(run("1 / 3", &[]).unwrap(), dec!(1) / dec!(3));
}

#[test]
fn las_comparaciones_funcionan() {
    let casos = [
        ("monto < 2000", true),
        ("monto <= 1000", true),
        ("monto > 2000", false),
        ("monto >= 1000", true),
        ("monto == 1000", true),
        ("monto != 1000", false),
    ];
    for (source, esperado) in casos {
        let obtenido = run_condition(source, &[("monto", dec!(1000))])
            .unwrap_or_else(|err| panic!("{source:?} debía evaluar: {err:?}"));
        assert_eq!(obtenido, esperado, "{source:?}");
    }
}

#[test]
fn la_negacion_y_la_conjuncion_funcionan() {
    let campos = [("monto", dec!(1000))];
    assert!(run_condition("no monto < 500", &campos).unwrap());
    assert!(run_condition("monto > 500 y monto < 2000", &campos).unwrap());
    assert!(!run_condition("monto > 500 y monto < 800", &campos).unwrap());
    assert!(run_condition("monto > 5000 o monto < 2000", &campos).unwrap());
}

// ── 6. `presente` ───────────────────────────────────────────────────────────

/// `presente` distingue «no lo envió» de «lo envió como cero».
///
/// Es la distinción que necesita `inversion`, que solo emite `valor_futuro_real` cuando se
/// suministró la inflación (`inversion.rs:78`). Si «ausente» y «cero» se confundieran,
/// aparecería siempre una cifra «real» idéntica a la nominal y el lector creería que se
/// descontó algo cuando no se descontó nada.
#[test]
fn presente_distingue_ausente_de_cero() {
    let expr = parse(
        "presente(inflacion_anual)",
        &Schema::new([("inflacion_anual".to_owned(), InputKind::Tasa)], []),
        Type::Boolean,
    )
    .expect("válida");

    let indicators = HashMap::new();

    // Ausente.
    let fields = HashMap::new();
    let supplied = HashSet::new();
    assert!(!evaluate_condition(&expr, &Scope::new(&fields, &indicators, &supplied)).unwrap());

    // Presente y valiendo cero.
    let fields: HashMap<String, Decimal> = [("inflacion_anual".to_owned(), Decimal::ZERO)]
        .into_iter()
        .collect();
    let supplied = HashSet::from(["inflacion_anual".to_owned()]);
    assert!(evaluate_condition(&expr, &Scope::new(&fields, &indicators, &supplied)).unwrap());
}

// ── 7. Robustez frente a un AST que no pasó por el analizador ───────────────

/// Un AST leído de `JSONB` con un tipo incoherente se rechaza en vez de convertirse en cero.
///
/// El AST se persiste, así que pudo escribirlo otra versión del código. Convertir una
/// condición en cero sería el peor desenlace posible: un resultado plausible y falso.
#[test]
fn una_condicion_donde_se_espera_un_numero_no_se_convierte_en_cero() {
    let condicion = Expr::Gt {
        left: Box::new(Expr::Num { value: dec!(1) }),
        right: Box::new(Expr::Num { value: dec!(0) }),
    };
    let fields = HashMap::new();
    let indicators = HashMap::new();
    let supplied = HashSet::new();
    let scope = Scope::new(&fields, &indicators, &supplied);

    let err = evaluate(&condicion, &scope).expect_err("debía rechazarse");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}

/// Y al revés: un número donde se espera una condición.
#[test]
fn un_numero_donde_se_espera_una_condicion_no_se_convierte_en_verdadero() {
    let numero = Expr::Num { value: dec!(1) };
    let fields = HashMap::new();
    let indicators = HashMap::new();
    let supplied = HashSet::new();
    let scope = Scope::new(&fields, &indicators, &supplied);

    let err = evaluate_condition(&numero, &scope).expect_err("debía rechazarse");
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
}
