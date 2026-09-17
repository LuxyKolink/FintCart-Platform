//! El coste de una definición está acotado POR CONSTRUCCIÓN, y aquí se mide cuánto es (T162).
//!
//! FR-047 exige que la evaluación sea **acotada** y sin código arbitrario, y D-15 prometió que eso
//! fuera «coste acotado por construcción»: los topes de FR-046 —64 nodos, 16 niveles de anidación,
//! 20 entradas, 10 salidas— y el tope de exponente de `pot` (1200) existen para que ninguna
//! definición ACEPTABLE pueda ser caro. Esta suite comprueba las dos mitades de esa promesa:
//!
//! 1. **La estructura**: el peor caso admisible se acepta, y un nodo más se rechaza. Sin la segunda
//!    mitad la primera no significa nada —«está acotado» porque nadie ha probado el borde—.
//! 2. **La medida**: cuánto tarda ese peor caso. Se mide y se IMPRIME, y la aserción es un
//!    **disparador de regresión con dos órdenes de magnitud de margen**, no una promesa de latencia:
//!    una aserción de tiempo ajustada falla en una máquina cargada y acaba desactivada, que es la
//!    forma habitual de perder una garantía.
//!
//! Lo que se persigue no es el número exacto sino su orden: si alguien cambiara `checked_powu` por
//! un algoritmo accidentalmente cuadrático o quitara el tope del exponente, la medición dejaría de
//! estar donde está. La latencia de la plataforma bajo carga es otra cosa y se mide donde se puede
//! medir: `deploy/loadtest/k6-calculadora.js`.
//!
//! ## El peor caso admisible, y por qué es este
//!
//! Diez salidas —el máximo—, cada una con `pot` elevado al exponente máximo (1200): son las dos
//! palancas que tiene un autor para hacer trabajar al evaluador, y están las dos al tope. La base
//! es una cifra ligeramente mayor que uno (1.000001) para que el resultado siga siendo
//! representable: elevar 2 a 1200 desborda los 28 decimales de `Decimal` y el motor responde con un
//! error de dominio **sin haber hecho el trabajo**, así que una base grande mediría el camino del
//! error y no el del cálculo.

use std::collections::HashMap;
use std::time::Instant;

use fintcart_simulator::domain::definition::{Definition, Draft, DraftOutput, InputField};
use fintcart_simulator::domain::formula::ast::InputKind;
use fintcart_simulator::domain::formula::ErrorCode;
use rust_decimal::Decimal;

/// Las dos palancas del peor caso admisible: 10 salidas × exponente 1200.
const SALIDAS: usize = 10;
const EXPONENTE: u32 = 1200;

fn entrada() -> InputField {
    InputField {
        key: "base".to_owned(),
        label: "Base".to_owned(),
        kind: InputKind::Tasa,
        unit: String::new(),
        min: None,
        max: None,
        default: None,
        required: true,
    }
}

fn salida(i: usize, expression: &str) -> DraftOutput {
    DraftOutput {
        key: format!("r{i}"),
        label: format!("R{i}"),
        expression: expression.to_owned(),
        scale: 2,
        when: None,
    }
}

/// El peor caso admisible: todas las palancas al tope y ninguna fuera de él.
fn peor_caso() -> Draft {
    let mut outputs = Vec::with_capacity(SALIDAS);
    for i in 1..SALIDAS {
        // Bases distintas a propósito: si fueran la misma expresión, un futuro plegado de
        // constantes la evaluaría una vez y la medición mentiría por abajo.
        outputs.push(salida(i, &format!("pot(1.00000{i}, {EXPONENTE})")));
    }
    outputs.push(salida(
        SALIDAS,
        &format!("pot(1.000001, {})", EXPONENTE - 1),
    ));
    Draft {
        inputs: vec![entrada()],
        validations: Vec::new(),
        outputs,
    }
}

fn parsear(draft: Draft) -> Definition {
    draft
        .parse(&std::collections::BTreeSet::new())
        .unwrap_or_else(|issues| panic!("el peor caso admisible tiene que ser válido: {issues:?}"))
}

fn ejecutar(def: &Definition) -> Vec<(String, Decimal)> {
    let raw: HashMap<String, String> = [("base".to_owned(), "0.05".to_owned())]
        .into_iter()
        .collect();
    def.run(&raw, &HashMap::new())
        .unwrap_or_else(|err| panic!("el peor caso admisible tiene que ejecutarse: {err}"))
}

/// El peor caso admisible se ACEPTA, y da los diez resultados.
///
/// Es la mitad que hace que la otra signifique algo: medir el coste de algo que la validación
/// rechazaría no diría nada del sistema en producción.
#[test]
fn el_peor_caso_admisible_se_acepta_y_calcula() {
    let def = parsear(peor_caso());
    let resultados = ejecutar(&def);
    assert_eq!(
        resultados.len(),
        SALIDAS,
        "las diez salidas tienen que calcularse"
    );
    for (key, _) in &resultados {
        assert!(key.starts_with('r'), "salida inesperada: {key}");
    }
}

/// La anidación admisible se acepta y un nivel MÁS se rechaza al guardar.
///
/// El tope de profundidad es el otro límite de forma, y comprobarlo SOLO en el lado que se acepta
/// —«una fórmula honda se acepta»— no probaría nada: lo que hay que probar es el borde.
///
/// El anidamiento se construye con llamadas (`abs(abs(…))`) y **no con paréntesis**: el analizador
/// los colapsa, así que `((((base))))` es el mismo nodo que `base` —medido, no supuesto: la primera
/// versión de esta prueba daba 17 niveles de paréntesis por válidos—. Lo que cuenta como nivel es
/// un NODO, no un carácter.
#[test]
fn los_topes_de_forma_se_comprueban_en_el_borde() {
    let anidado = |niveles: usize| format!("{}base{}", "abs(".repeat(niveles), ")".repeat(niveles));

    let con = |expression: &str| Draft {
        inputs: vec![entrada()],
        validations: Vec::new(),
        outputs: vec![salida(1, expression)],
    };

    // La profundidad cuenta NODOS, no llamadas: la raíz es el nivel 1 y el nodo más hondo de
    // `abs(abs(base))` es la variable, en el nivel 3. Así que 16 niveles son **15** llamadas
    // anidadas, y la decimosexta se pasa. Es la clase de desfase que conviene tener escrito: la
    // primera versión de esta prueba daba 16 llamadas por válidas y falló, que es como se midió.
    let en_el_tope = con(&anidado(15));
    assert!(
        en_el_tope.parse(&std::collections::BTreeSet::new()).is_ok(),
        "15 llamadas anidadas (16 nodos de profundidad) son el tope y tienen que pasar: {}",
        anidado(15)
    );

    let un_nivel_mas = con(&anidado(16));
    let issues = un_nivel_mas
        .parse(&std::collections::BTreeSet::new())
        .expect_err("16 llamadas anidadas (17 de profundidad) tienen que rechazarse");
    assert!(
        issues.iter().any(|i| i.code == ErrorCode::LimiteExcedido),
        "el rechazo tiene que ser por el límite declarado: {issues:?}"
    );
}

/// Cuánto cuesta el peor caso admisible, medido en el crate (sin red y sin base).
///
/// El número importa menos que su orden de magnitud: se imprime para poder citarlo y la aserción
/// solo dispara si algo lo empeora en más de cien veces.
#[test]
fn el_peor_caso_admisible_cuesta_cientos_de_microsegundos() {
    let def = parsear(peor_caso());

    // Una pasada de calentamiento: la primera incluye lo que el sistema operativo haga la primera
    // vez (páginas, cachés), y medirla sería medir el arranque del proceso.
    ejecutar(&def);

    const REPETICIONES: u32 = 200;
    let inicio = Instant::now();
    for _ in 0..REPETICIONES {
        ejecutar(&def);
    }
    let total = inicio.elapsed();
    let por_ejecucion = total / REPETICIONES;

    println!(
        "peor caso admisible ({} salidas × pot(·, {EXPONENTE})): {:?} por ejecución",
        SALIDAS, por_ejecucion
    );

    // Medido en este contenedor (2026-02): ~290 µs por ejecución. El umbral es un disparador de
    // regresión con más de cien veces de margen, no una promesa de latencia.
    assert!(
        por_ejecucion.as_millis() < 100,
        "el peor caso admisible tardó {por_ejecucion:?} por ejecución; el orden esperado es de \
         microsegundos, así que esto apunta a que el coste dejó de estar acotado"
    );
}

/// El peor caso admisible cabe de sobra en el presupuesto de una petición.
///
/// Lo que compara esta prueba es lo que importa para SC-005: el peor caso admisible cuesta
/// **cientos de microsegundos** contra un presupuesto de dos SEGUNDOS de respuesta percibida, es
/// decir cuatro órdenes de magnitud de margen. Cuántas veces cuesta más que un caso trivial es un
/// dato que se imprime —del orden de decenas de veces— y la aserción solo exige que no se
/// desmadre; exigir un factor concreto sería fijar un número de máquina.
#[test]
fn el_peor_caso_admisible_cabe_en_el_presupuesto_de_una_peticion() {
    let trivial = parsear(Draft {
        inputs: vec![entrada()],
        validations: Vec::new(),
        outputs: vec![salida(1, "base * 2")],
    });
    let peor = parsear(peor_caso());

    ejecutar(&trivial);
    ejecutar(&peor);

    const REPETICIONES: u32 = 200;
    let medir = |def: &Definition| {
        let inicio = Instant::now();
        for _ in 0..REPETICIONES {
            ejecutar(def);
        }
        inicio.elapsed()
    };

    let trivial = medir(&trivial);
    let peor = medir(&peor);
    println!("trivial: {trivial:?} / peor: {peor:?} (200 ejecuciones cada uno)");

    assert!(
        peor < trivial * 1000,
        "el peor caso admisible fue mil veces más caro que uno trivial ({peor:?} contra \
         {trivial:?}); eso significa que el tope no está conteniendo el coste"
    );
    assert!(
        peor.as_millis() < 100,
        "200 ejecuciones del peor caso admisible tardaron {peor:?}, y el presupuesto de una sola \
         petición es de segundos"
    );
}
