//! Pruebas de las primitivas financieras del motor (T077, research D-16).
//!
//! ## Qué se compara contra qué, y por qué es lo importante de esta suite
//!
//! Las primitivas del motor **delegan** en [`fintcart_simulator::calculators::annuity`], el
//! mismo módulo que usan las cinco calculadoras nativas. Estas pruebas comparan el
//! resultado del motor contra esa llamada directa: si alguien reimplementara `cuota` dentro
//! del motor, la comparación seguiría pasando —estarían comparándose dos copias de lo
//! mismo— y el fallo aparecería solo al retirar el código nativo, cuando ya no hubiera con
//! qué contrastar.
//!
//! Por eso las pruebas de aquí afirman dos cosas distintas: que el motor y `annuity`
//! coinciden, **y** que `annuity` produce los valores que esta suite fija por escrito. Lo
//! segundo es lo que convierte la comparación en una comprobación real.
//!
//! ## `pot` frente a `potd`, que es la distinción que sostiene FR-049
//!
//! D-16 cierra el riesgo de FR-049 con una condición: que el motor exponga la potencia
//! entera (exacta) y la decimal (aproximada) como funciones SEPARADAS, y que las semillas
//! usen la misma que usa hoy el código nativo. Estas pruebas fijan que las dos existen, que
//! dan resultados distintos, y que `pot` coincide con `checked_powu` — que es exactamente
//! lo que hace `annuity::growth_factor`.

use std::collections::{HashMap, HashSet};

use fintcart_simulator::calculators::annuity;
use fintcart_simulator::domain::decimal_str;
use fintcart_simulator::domain::formula::ast::{Func, InputKind, Schema};
use fintcart_simulator::domain::formula::eval::{evaluate, Scope};
use fintcart_simulator::domain::formula::functions::{self, MAX_EXPONENT, MAX_SCALE};
use fintcart_simulator::domain::formula::parser::{parse, Type};
use rust_decimal::{Decimal, MathematicalOps};
use rust_decimal_macros::dec;

/// Evalúa una fórmula sin campos ni indicadores.
fn eval(source: &str) -> Decimal {
    let schema = Schema::new([], []);
    let expr = parse(source, &schema, Type::Number)
        .unwrap_or_else(|err| panic!("{source:?} debía analizarse: {err}"));
    let fields = HashMap::new();
    let indicators = HashMap::new();
    let supplied = HashSet::new();
    evaluate(&expr, &Scope::new(&fields, &indicators, &supplied))
        .unwrap_or_else(|err| panic!("{source:?} debía evaluar: {err:?}"))
}

// ── 1. `pot` es exacta y coincide con el código nativo ──────────────────────

/// `pot` debe dar EXACTAMENTE lo mismo que `annuity::growth_factor`.
///
/// Es la comparación de la que depende que las siete semillas reproduzcan las cinco
/// calculadoras. `growth_factor` usa `checked_powu` —multiplicación repetida, exacta— y no
/// la exponenciación por logaritmos, cuya diferencia en 240 meses «llega a los pesos».
#[test]
fn pot_coincide_con_el_factor_de_capitalizacion_nativo() {
    let casos = [
        (dec!(0.01), 12_u32),
        (dec!(0.02), 240),
        (dec!(0.009489), 360),
        (dec!(0.12), 1),
        (dec!(0), 24),
    ];
    for (tasa, periodos) in casos {
        let nativo = annuity::growth_factor(tasa, periodos).expect("el nativo calcula");
        let motor = eval(&format!("pot(1 + {tasa}, {periodos})"));
        assert_eq!(
            motor, nativo,
            "pot(1 + {tasa}, {periodos}) se separó del código nativo"
        );
    }
}

/// `pot` coincide además con `checked_powu` directamente, sin pasar por `1 + i`.
#[test]
fn pot_es_la_potencia_entera_exacta() {
    for (base, exponente) in [(dec!(1.02), 240_u64), (dec!(2), 10), (dec!(1.5), 7)] {
        let esperado = base
            .checked_powu(exponente)
            .expect("la potencia entera es calculable");
        let motor = eval(&format!("pot({base}, {exponente})"));
        assert_eq!(motor, esperado, "pot({base}, {exponente})");
    }
}

/// `potd` es APROXIMADA, y esta prueba fija que lo sea.
///
/// No es un defecto que haya que corregir: es la única forma de elevar a un exponente
/// decimal. Lo que importa es que exista con su nombre propio, para que quien necesite
/// exactitud no la obtenga por accidente.
#[test]
fn potd_es_la_potencia_decimal_aproximada() {
    // La raíz duodécima de `effective_to_nominal`, el caso real que usa `potd`.
    let base = dec!(1.24);
    let exponente = Decimal::ONE / Decimal::from(12);

    let esperado = base
        .checked_powd(exponente)
        .expect("la potencia decimal es calculable");
    let motor = eval("potd(1.24, 1 / 12)");
    assert_eq!(motor, esperado);

    // La ida y vuelta `EA → MV → EA` NO vuelve exactamente al origen, y la prueba fija
    // cuánto se desvía en vez de fingir que no lo hace. Es la misma propiedad —y el mismo
    // margen— que comprueba `tests/numeric_edge.rs` sobre el código nativo: el redondeo de
    // la tasa mensual a seis decimales, amplificado al elevar a doce, cuesta alrededor de
    // una cienmilésima. Es el límite del DATO publicado, no del cálculo, y por eso se
    // afirma una cota y no una igualdad.
    let mensual = decimal_str::round_half_even(esperado - Decimal::ONE, 6);
    let vuelta = eval(&format!("redondear(pot(1 + {mensual}, 12) - 1, 6)"));
    let desvio = (vuelta - dec!(0.24)).abs();
    assert!(
        desvio <= dec!(0.000010),
        "la ida y vuelta EA → MV → EA se desvió {desvio}, por encima del margen de una \
         cienmilésima que impone el redondeo a seis decimales"
    );
}

/// Con un exponente ENTERO, `potd` da el mismo resultado que `pot`.
///
/// Es un hallazgo de esta suite y conviene dejarlo escrito, porque corrige la intuición
/// con la que se escribió la prueba: `checked_powd` **detecta el exponente entero y delega
/// en la vía exacta**, así que la aproximación no aparece por usar `potd`, sino por elevar
/// a un exponente que no es entero.
///
/// La consecuencia práctica importa para leer D-16 bien: lo que hace necesaria la
/// separación de funciones no es que den resultados distintos —con exponente entero no los
/// dan—, sino que `pot` **rechaza** el exponente decimal y `potd` lo acepta. Así la
/// aproximación solo puede aparecer donde es matemáticamente inevitable, y nunca donde
/// había una vía exacta disponible.
#[test]
fn potd_con_exponente_entero_delega_en_la_via_exacta() {
    assert_eq!(eval("pot(1.02, 240)"), eval("potd(1.02, 240.0)"));
    assert_eq!(eval("pot(1.02, 240)"), eval("potd(1.02, 240)"));
}

/// Con un exponente decimal, `pot` no existe y `potd` es la única vía — aproximada.
///
/// Es el caso real de `colombia.rs`: la raíz duodécima de una tasa efectiva anual. La
/// fórmula que la calcula NO se puede escribir con `pot`, y el analizador lo dice al
/// guardar en vez de aceptarla y aproximar en silencio.
#[test]
fn con_exponente_decimal_solo_existe_potd() {
    // `pot` la rechaza al guardar.
    let schema = Schema::new([], []);
    let err = parse("pot(1.24, 1 / 12)", &schema, Type::Number)
        .expect_err("pot no admite exponente decimal");
    assert_eq!(err.code.as_str(), "exponente_no_entero", "{}", err.message);

    // `potd` la acepta, y el resultado necesita redondeo para ser estable.
    let aproximada = eval("potd(1.24, 1 / 12)");
    assert_ne!(
        aproximada,
        eval("redondear(potd(1.24, 1 / 12), 6)"),
        "la vía decimal no es exacta: por eso el resultado se redondea a la escala de la \
         columna de tasas antes de publicarse"
    );
}

// ── 2. `cuota`, `vf_serie` y `tasa_periodica` delegan en `annuity` ──────────

#[test]
fn cuota_coincide_con_la_primitiva_nativa() {
    for (capital, tasa, meses) in [
        (dec!(10000000), dec!(0.02), 60_u32),
        (dec!(50000000), dec!(0.009489), 240),
        (dec!(1500000), dec!(0.01), 12),
    ] {
        let nativo = annuity::level_payment(capital, tasa, meses).expect("el nativo calcula");
        let motor = eval(&format!("cuota({capital}, {tasa}, {meses})"));
        assert_eq!(motor, nativo, "cuota({capital}, {tasa}, {meses})");
    }
}

#[test]
fn vf_serie_coincide_con_la_primitiva_nativa() {
    for (aporte, tasa, meses) in [
        (dec!(500000), dec!(0.01), 120_u32),
        (dec!(250000), dec!(0.009489), 240),
    ] {
        let nativo = annuity::future_value_of_series(aporte, tasa, meses).expect("el nativo");
        let motor = eval(&format!("vf_serie({aporte}, {tasa}, {meses})"));
        assert_eq!(motor, nativo, "vf_serie({aporte}, {tasa}, {meses})");
    }
}

/// El caso `i = 0` de `vf_serie`, que la fórmula cerrada resolvería con una división por
/// cero.
///
/// No es una curiosidad: una simulación de ahorro «bajo el colchón» es un escenario
/// perfectamente razonable, y es el caso que `annuity.rs:66` resuelve aparte como `A · n`.
#[test]
fn vf_serie_con_tasa_cero_es_aporte_por_periodos() {
    let motor = eval("vf_serie(500000, 0, 12)");
    assert_eq!(motor, dec!(6000000));

    // Y coincide con lo que devuelve la primitiva nativa, que es la que tiene el caso
    // especial escrito.
    let nativo = annuity::future_value_of_series(dec!(500000), Decimal::ZERO, 12)
        .expect("el nativo resuelve el caso cero");
    assert_eq!(motor, nativo);
}

#[test]
fn tasa_periodica_coincide_con_la_primitiva_nativa() {
    for (anual, periodos) in [(dec!(0.12), 12_u32), (dec!(0.24), 12), (dec!(0.36), 12)] {
        let nativo = annuity::periodic_rate(anual, periodos).expect("el nativo calcula");
        let motor = eval(&format!("tasa_periodica({anual}, {periodos})"));
        assert_eq!(motor, nativo, "tasa_periodica({anual}, {periodos})");
    }
}

/// La tasa periódica es NOMINAL —anual entre doce— y no la efectiva.
///
/// Las dos existen en el mercado colombiano y no son intercambiables: para una tasa del
/// 12 %, la nominal da 1 % mensual y la efectiva 0,9489 %. Confundirlas es el error de
/// lectura más común de un crédito de consumo.
#[test]
fn tasa_periodica_es_nominal_y_no_efectiva() {
    assert_eq!(eval("tasa_periodica(0.12, 12)"), dec!(0.01));
    assert_ne!(eval("tasa_periodica(0.12, 12)"), dec!(0.009489));
}

// ── 3. Redondeo ─────────────────────────────────────────────────────────────

/// El caso que distingue half-even de half-up, que es el que un `.round_dp(2)` falla.
#[test]
fn redondear_usa_half_even() {
    // Con half-up las dos subirían; con half-even, la primera baja y la segunda sube.
    assert_eq!(eval("redondear(2.345, 2)"), dec!(2.34));
    assert_eq!(eval("redondear(2.355, 2)"), dec!(2.36));
    // Y un empate exacto en el cero.
    assert_eq!(eval("redondear(0.125, 2)"), dec!(0.12));
    assert_eq!(eval("redondear(0.135, 2)"), dec!(0.14));
}

#[test]
fn redondear_dinero_usa_la_escala_monetaria() {
    assert_eq!(eval("redondear_dinero(1234.565)"), dec!(1234.56));
    assert_eq!(eval("redondear_dinero(1234.575)"), dec!(1234.58));
    // Y coincide con la primitiva del dominio, que es donde está escrita la escala.
    let nativo = fintcart_simulator::domain::currency::round_money(dec!(1234.565));
    assert_eq!(eval("redondear_dinero(1234.565)"), nativo);
}

#[test]
fn la_escala_de_redondear_es_la_que_se_pide() {
    assert_eq!(eval("redondear(1.23456789, 0)"), dec!(1));
    assert_eq!(eval("redondear(1.23456789, 3)"), dec!(1.235));
    assert_eq!(eval("redondear(1.23456789, 6)"), dec!(1.234568));
}

// ── 4. Funciones auxiliares ─────────────────────────────────────────────────

#[test]
fn min_max_y_abs_funcionan() {
    assert_eq!(eval("min(3, 5)"), dec!(3));
    assert_eq!(eval("max(3, 5)"), dec!(5));
    assert_eq!(eval("abs(-7.5)"), dec!(7.5));
    assert_eq!(eval("abs(7.5)"), dec!(7.5));
    assert_eq!(eval("min(-3, -5)"), dec!(-5));
}

/// El GMF de `colombia.rs` expresado con `min`, que es como lo usará la semilla.
#[test]
fn min_expresa_el_tope_de_exencion_del_gmf() {
    // Exención de 350 UVT sobre un retiro que la supera.
    let motor = eval("min(20000000, 350 * 52374)");
    assert_eq!(motor, dec!(18330900));
    // Y sobre uno que no la alcanza, el exento es el monto entero.
    assert_eq!(eval("min(1000000, 350 * 52374)"), dec!(1000000));
}

// ── 5. Metadatos de la tabla ────────────────────────────────────────────────

/// Las diez funciones de D-15 existen con su nombre y su aridad.
#[test]
fn la_tabla_tiene_las_funciones_documentadas() {
    let esperadas = [
        ("pot", 2),
        ("potd", 2),
        ("redondear", 2),
        ("redondear_dinero", 1),
        ("min", 2),
        ("max", 2),
        ("abs", 1),
        ("cuota", 3),
        ("vf_serie", 3),
        ("tasa_periodica", 2),
    ];
    for (nombre, aridad) in esperadas {
        let func =
            Func::from_name(nombre).unwrap_or_else(|| panic!("la función {nombre} debe existir"));
        assert_eq!(func.name(), nombre);
        assert_eq!(func.arity(), aridad, "aridad de {nombre}");
        // Toda función tiene ayuda contextual (T160), y no vacía.
        assert!(!func.help().is_empty(), "{nombre} debe tener ayuda");
    }
    assert!(Func::from_name("raiz").is_none(), "«raiz» no existe");
}

/// `presente` NO es una función de la tabla, y esa ausencia es deliberada.
///
/// Su argumento es el NOMBRE de un campo y no una expresión, así que tiene su propia
/// variante del AST. Si estuviera aquí, `functions::apply` tendría que decidir qué hacer
/// con un argumento que ya se evaluó, y `presente(1 + 2)` sería representable.
#[test]
fn presente_no_esta_en_la_tabla_de_funciones() {
    assert!(Func::from_name("presente").is_none());
}

/// Los topes de la tabla son los que impiden un cálculo sin fin.
#[test]
fn los_topes_de_los_argumentos_enteros_son_los_documentados() {
    assert_eq!(MAX_SCALE, 28);
    assert_eq!(
        MAX_EXPONENT,
        fintcart_simulator::domain::inputs::MAX_PERIODS
    );
}

/// `pot` con un exponente enorme se rechaza en vez de multiplicar mil millones de veces.
///
/// Es la razón de que exista un tope y no solo la comprobación de desbordamiento: `pot(1, n)`
/// no desborda nunca —uno elevado a lo que sea es uno— así que sin tope daría mil millones
/// de multiplicaciones, y la promesa de coste acotado de D-15 sería falsa para una fórmula
/// perfectamente aceptable al guardar.
#[test]
fn un_exponente_desmedido_se_rechaza_al_evaluar() {
    let enorme = Decimal::from(MAX_EXPONENT) + Decimal::ONE;
    let err = functions::apply(Func::Pot, &[Decimal::ONE, enorme])
        .expect_err("debía rechazarse por el tope");
    assert!(
        matches!(
            err,
            fintcart_simulator::domain::error::Error::InvalidInput(_)
        ),
        "{err:?}"
    );

    // Y en el tope exacto sí se acepta.
    assert_eq!(
        functions::apply(Func::Pot, &[Decimal::ONE, Decimal::from(MAX_EXPONENT)]).unwrap(),
        Decimal::ONE
    );
}

/// Un exponente con parte fraccionaria se rechaza también en tiempo de evaluación.
///
/// El analizador ya lo impide al guardar, pero el tipo declarado es una promesa sobre el
/// DATO y no sobre lo que llega: un campo de tipo entero puede recibir `"12.5"`. Sin esta
/// comprobación, la conversión a `u32` entraría en pánico.
#[test]
fn un_exponente_con_decimales_se_rechaza_al_evaluar() {
    let err = functions::apply(Func::Pot, &[dec!(1.02), dec!(2.5)]).expect_err("debía rechazarse");
    assert!(
        matches!(
            err,
            fintcart_simulator::domain::error::Error::InvalidInput(_)
        ),
        "{err:?}"
    );
}

/// Una aridad equivocada no entra en pánico: se informa.
///
/// Solo puede llegar así un AST leído de la base que no pasó por este analizador —o escrito
/// por otra versión del código—, y sin la comprobación los índices de `apply` entrarían en
/// pánico.
#[test]
fn una_aridad_equivocada_no_entra_en_panico() {
    let err = functions::apply(Func::Cuota, &[dec!(1), dec!(2)]).expect_err("faltan argumentos");
    assert!(
        matches!(
            err,
            fintcart_simulator::domain::error::Error::InvalidInput(_)
        ),
        "{err:?}"
    );
}

// ── 6. La semilla de ahorro, extremo a extremo ──────────────────────────────

/// Una fórmula con la forma de la semilla `ahorro` reproduce el código nativo.
///
/// Es un adelanto de lo que hará la suite de regresión de T092 con las siete: aquí se
/// comprueba que las piezas del LENGUAJE alcanzan para expresarla, que es la condición
/// previa para que la siembra sea posible.
#[test]
fn la_forma_de_la_semilla_de_ahorro_reproduce_el_codigo_nativo() {
    let deposito = dec!(5000000);
    let aporte = dec!(800000);
    let tasa_anual = dec!(0.09);
    let meses = 60_u32;

    // El código nativo, tal cual.
    let mensual = annuity::periodic_rate(tasa_anual, 12).expect("tasa periódica");
    let nativo_final = deposito * annuity::growth_factor(mensual, meses).expect("factor")
        + annuity::future_value_of_series(aporte, mensual, meses).expect("serie");

    // Y la misma cuenta como fórmula del motor.
    let schema = Schema::new(
        [
            ("deposito_inicial".to_owned(), InputKind::Monto),
            ("aporte_mensual".to_owned(), InputKind::Monto),
            ("tasa_anual".to_owned(), InputKind::Tasa),
            ("meses".to_owned(), InputKind::Entero),
        ],
        [],
    );
    let fuente = "deposito_inicial * pot(1 + tasa_anual / 12, meses) \
                  + vf_serie(aporte_mensual, tasa_anual / 12, meses)";
    let expr = parse(fuente, &schema, Type::Number).expect("la fórmula debe analizarse");

    let fields: HashMap<String, Decimal> = [
        ("deposito_inicial".to_owned(), deposito),
        ("aporte_mensual".to_owned(), aporte),
        ("tasa_anual".to_owned(), tasa_anual),
        ("meses".to_owned(), Decimal::from(meses)),
    ]
    .into_iter()
    .collect();
    let supplied: HashSet<String> = fields.keys().cloned().collect();
    let indicators = HashMap::new();
    let scope = Scope::new(&fields, &indicators, &supplied);

    let motor = evaluate(&expr, &scope).expect("la fórmula debe evaluar");
    assert_eq!(
        motor, nativo_final,
        "el motor y el código nativo deben dar el MISMO saldo final"
    );

    // Y al centavo, que es lo que la suite de regresión de T092 va a exigir.
    let motor_redondeado = fintcart_simulator::domain::currency::round_money(motor);
    assert_eq!(
        motor_redondeado.to_string(),
        fintcart_simulator::domain::currency::round_money(nativo_final).to_string()
    );
}

/// La función de ayuda de `pot` distingue las dos potencias, que es lo que pide T160.
#[test]
fn la_ayuda_de_las_potencias_distingue_exacta_de_aproximada() {
    let exacta = Func::Pot.help();
    let aproximada = Func::Potd.help();
    assert!(exacta.contains("ENTERO"), "{exacta}");
    assert!(aproximada.contains("APROXIMADA"), "{aproximada}");
    assert!(
        aproximada.contains("pot "),
        "debe dirigir a `pot`: {aproximada}"
    );
}

/// La aritmética del motor es decimal, no binaria.
///
/// El caso es el ejemplo clásico y basta para distinguirlas: en coma flotante binaria
/// `0.1 + 0.2` da 0.30000000000000004 y **no** es igual a `0.3`. Aquí tiene que dar
/// exactamente `0.3`. Es la diferencia entre cumplir el Principio VIII y violarlo,
/// expresada en una línea — y por eso esta prueba no necesita nombrar un flotante para
/// demostrar que no se usa ninguno.
#[test]
fn la_aritmetica_es_decimal_y_no_binaria() {
    assert_eq!(eval("0.1 + 0.2"), dec!(0.3));
    assert_eq!(eval("0.3 - 0.1"), dec!(0.2));
    assert_eq!(eval("0.1 * 3"), dec!(0.3));
    // Y el redondeo bancario conserva el valor exacto en vez de arrastrar el error del
    // último bit.
    assert_eq!(eval("redondear(0.1 + 0.2, 2)"), dec!(0.30));
}
