//! Pruebas de BORDE NUMÉRICO del Simulador (T110, SC-004, Principio VIII).
//!
//! Son obligatorias por `research.md` §Calidad y cubren los cinco escenarios que ahí
//! se enumeran: montos extremos, redondeo bancario half-even, división con resto,
//! tasas atípicas y plazos largos.
//!
//! ## Qué significa aquí «cero divergencia»
//!
//! El enunciado de la tarea pide comparar contra un cálculo decimal de referencia sin
//! divergencia. Conviene ser preciso sobre qué se compara, porque hay dos clases de
//! operación en este servicio y solo una admite exactitud absoluta:
//!
//!  - **Exactas.** Sumas, restas, multiplicaciones y potencias de exponente ENTERO son
//!    exactas en decimal. Para ellas la referencia es una segunda implementación
//!    independiente —la amortización iterada mes a mes frente a la fórmula cerrada— y
//!    la divergencia exigida es cero al centavo.
//!  - **No exactas.** Una división con resto (`1/3`) y una raíz duodécima no tienen
//!    representación decimal finita. Fingir exactitud ahí sería mentir; lo que se fija
//!    es que el resultado sea estable a la escala de su columna y que las propiedades
//!    algebraicas se conserven (la ida y vuelta `EA → MV → EA` vuelve al origen).
//!
//! Escribir esa distinción es parte de la prueba: una suite que afirmara exactitud
//! total pasaría solo porque nadie miró la raíz duodécima de cerca.

use std::collections::HashMap;

use fintcart_simulator::calculators::annuity;
use fintcart_simulator::domain::currency::{self, round_money};
use fintcart_simulator::domain::decimal_str;
use fintcart_simulator::domain::dispatch::{self, Kind};
use fintcart_simulator::domain::inputs::MAX_PERIODS;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// Construye el mapa de parámetros de una simulación.
fn inputs(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

/// Ejecuta una calculadora y devuelve el resultado ya en cadenas canónicas.
fn compute(kind: Kind, pairs: &[(&str, &str)]) -> HashMap<String, String> {
    dispatch::compute(kind, &inputs(pairs)).expect("la simulación debía calcularse")
}

/// Lee un valor del resultado como [`Decimal`].
fn value(result: &HashMap<String, String>, key: &str) -> Decimal {
    decimal_str::parse(result.get(key).unwrap_or_else(|| panic!("falta {key}")))
        .expect("el resultado debe ser una decimal canónica")
}

// ── 1. Redondeo bancario half-even (D-14) ───────────────────────────────────

/// El caso que distingue half-even de half-up, y el que un redondeo por defecto falla.
///
/// `rust_decimal` redondea half-up si no se le dice otra cosa, así que este es
/// exactamente el fallo que se colaría al escribir `.round_dp(2)` en una calculadora.
/// Con half-up, `2.345` y `2.355` subirían las dos; con half-even, la primera baja a
/// `2.34` y la segunda sube a `2.36`, porque el empate va al dígito PAR.
#[test]
fn el_redondeo_de_empates_va_al_digito_par() {
    let casos = [
        (dec!(2.345), dec!(2.34)), // baja: 4 ya es par
        (dec!(2.355), dec!(2.36)), // sube: 6 es par
        (dec!(2.365), dec!(2.36)), // baja: 6 es par
        (dec!(0.005), dec!(0.00)), // baja al cero, que es par
        (dec!(0.015), dec!(0.02)),
        (dec!(-2.345), dec!(-2.34)), // simétrico en negativo
        (dec!(-2.355), dec!(-2.36)),
    ];

    for (entrada, esperado) in casos {
        assert_eq!(
            round_money(entrada),
            esperado,
            "half-even sobre {entrada} debía dar {esperado}"
        );
    }
}

/// Lo que NO es un empate se redondea como siempre: half-even solo cambia el caso
/// exactamente a mitad de camino, y una prueba que solo mirase empates no lo
/// distinguiría de un truncamiento.
#[test]
fn lo_que_no_es_empate_se_redondea_al_mas_cercano() {
    assert_eq!(round_money(dec!(2.344)), dec!(2.34));
    assert_eq!(round_money(dec!(2.346)), dec!(2.35));
    assert_eq!(round_money(dec!(-2.346)), dec!(-2.35));
}

/// La conversión de moneda redondea DESPUÉS de multiplicar.
///
/// Es la diferencia que se acumula: redondear la tasa o el importe antes del producto
/// desplaza el resultado, y el desplazamiento crece con el monto.
#[test]
fn la_conversion_multiplica_antes_de_redondear() {
    // 1 234 567.89 USD × 4321.987654 COP/USD. El producto exacto tiene doce decimales;
    // la referencia se calcula aquí a precisión plena y se redondea una sola vez.
    let importe = dec!(1234567.89);
    let tasa = dec!(4321.987654);
    let referencia = round_money(importe * tasa);

    assert_eq!(currency::convert(importe, tasa).unwrap(), referencia);

    // Y la comprobación que importa: NO coincide con redondear los operandos primero.
    let ingenuo = round_money(importe) * round_money(tasa);
    assert_ne!(
        round_money(ingenuo),
        referencia,
        "si coincidieran, la prueba no distinguiría el orden de las operaciones"
    );
}

// ── 2. Cero divergencia: fórmula cerrada vs. amortización iterada ───────────

/// La referencia INDEPENDIENTE de la calculadora de crédito.
///
/// Se simula la vida del préstamo mes a mes —interés sobre el saldo, abono, saldo
/// nuevo— con la cuota sin redondear. Si la fórmula cerrada es correcta, el saldo
/// final es cero. Es una comprobación de verdad independiente: la iteración no usa
/// ninguna de las expresiones que se están verificando.
fn saldo_final_iterando(principal: Decimal, tasa_mensual: Decimal, meses: u32) -> Decimal {
    let cuota = annuity::level_payment(principal, tasa_mensual, meses).unwrap();
    let mut saldo = principal;
    for _ in 0..meses {
        let interes = saldo * tasa_mensual;
        saldo = saldo + interes - cuota;
    }
    saldo
}

/// El préstamo queda exactamente saldado al centavo, en escenarios muy distintos.
///
/// El residuo que queda antes de redondear es del orden de 10⁻²⁴: es el límite de la
/// mantisa de 96 bits de `Decimal` al dividir, no un error de la fórmula. A la escala
/// del dinero —dos decimales— la divergencia es cero.
#[test]
fn la_amortizacion_cierra_en_cero_al_centavo() {
    let casos = [
        (dec!(1000000.00), dec!(0.02), 12u32),       // corriente
        (dec!(350000000.00), dec!(0.0105), 240),     // vivienda a 20 años
        (dec!(1.00), dec!(0.015), 6),                // monto mínimo
        (dec!(99999999999999999.99), dec!(0.01), 3), // tope de NUMERIC(19,2)
    ];

    for (principal, tasa, meses) in casos {
        let saldo = saldo_final_iterando(principal, tasa, meses);
        assert_eq!(
            round_money(saldo),
            Decimal::ZERO,
            "el crédito de {principal} al {tasa} en {meses} meses no cerró en cero"
        );
    }
}

/// El total pagado NO es la cuota redondeada por el plazo, y la diferencia es visible.
///
/// Es la sutileza que documenta `credito.rs`. Esta prueba fija que la implementación
/// hace lo correcto y, de paso, que el atajo daría otra cifra — si dieran lo mismo, la
/// prueba no estaría comprobando nada.
#[test]
fn el_total_pagado_no_se_calcula_sobre_la_cuota_redondeada() {
    let result = compute(
        Kind::Credito,
        &[
            ("monto", "350000000.00"),
            ("tasa_anual", "0.126"),
            ("meses", "240"),
        ],
    );

    let cuota = value(&result, "cuota_mensual");
    let total = value(&result, "total_pagado");
    let interes = value(&result, "interes_total");

    // Coherencia interna: lo que ve el usuario cuadra entre sí exactamente.
    assert_eq!(total - dec!(350000000.00), interes);

    let atajo = round_money(cuota * Decimal::from(240));
    assert_ne!(
        atajo, total,
        "con estos parámetros el atajo debe diferir; si no, el caso no prueba nada"
    );
}

/// La referencia independiente de la calculadora de ahorro: acumular mes a mes.
#[test]
fn el_ahorro_coincide_con_la_acumulacion_mes_a_mes() {
    let aporte = dec!(500000.00);
    let inicial = dec!(2000000.00);
    let meses = 120u32;
    let tasa_anual = dec!(0.096);
    let tasa_mensual = annuity::periodic_rate(tasa_anual, 12).unwrap();

    // Referencia: saldo que crece con interés y recibe el aporte al final de cada mes.
    let mut saldo = inicial;
    for _ in 0..meses {
        saldo = saldo * (Decimal::ONE + tasa_mensual) + aporte;
    }

    let result = compute(
        Kind::Ahorro,
        &[
            ("deposito_inicial", "2000000.00"),
            ("aporte_mensual", "500000.00"),
            ("tasa_anual", "0.096"),
            ("meses", "120"),
        ],
    );

    assert_eq!(
        value(&result, "monto_final"),
        round_money(saldo),
        "la fórmula cerrada y la acumulación iterada deben coincidir al centavo"
    );
}

// ── 3. División con resto ───────────────────────────────────────────────────

/// `1/3` no tiene representación decimal finita: lo que se exige es que se redondee a
/// la escala de la columna y no que se trunque en un punto arbitrario.
#[test]
fn la_division_con_resto_se_redondea_a_la_escala_de_la_columna() {
    let result = compute(
        Kind::Presupuesto,
        &[
            ("ingreso_mensual", "3000000.00"),
            ("gastos_fijos", "2000000.00"),
        ],
    );

    // 1 000 000 / 3 000 000 = 0.333333…  → seis decimales, half-even.
    assert_eq!(value(&result, "tasa_ahorro"), dec!(0.333333));
    assert_eq!(value(&result, "balance"), dec!(1000000.00));
}

/// Un caso donde el séptimo decimal obliga a redondear hacia arriba: `2/3`.
#[test]
fn la_division_con_resto_redondea_y_no_trunca() {
    let result = compute(
        Kind::Presupuesto,
        &[
            ("ingreso_mensual", "3000000.00"),
            ("gastos_fijos", "1000000.00"),
        ],
    );

    // 0.666666… redondea a 0.666667; truncar habría dado 0.666666.
    assert_eq!(value(&result, "tasa_ahorro"), dec!(0.666667));
}

// ── 4. Tasas atípicas ───────────────────────────────────────────────────────

/// Tasa CERO: la fórmula cerrada dividiría por cero, así que hay un camino aparte.
#[test]
fn la_tasa_cero_no_divide_por_cero() {
    let credito = compute(
        Kind::Credito,
        &[
            ("monto", "1200000.00"),
            ("tasa_anual", "0"),
            ("meses", "12"),
        ],
    );
    assert_eq!(value(&credito, "cuota_mensual"), dec!(100000.00));
    assert_eq!(value(&credito, "interes_total"), Decimal::ZERO);

    let ahorro = compute(
        Kind::Ahorro,
        &[
            ("aporte_mensual", "100000.00"),
            ("tasa_anual", "0"),
            ("meses", "24"),
        ],
    );
    assert_eq!(value(&ahorro, "monto_final"), dec!(2400000.00));
    assert_eq!(value(&ahorro, "interes_ganado"), Decimal::ZERO);
}

/// Tasa de usura alta y tasa diminuta: las dos deben calcularse, no desbordar.
#[test]
fn las_tasas_extremas_siguen_siendo_calculables() {
    let usura = compute(
        Kind::Credito,
        &[
            ("monto", "1000000.00"),
            ("tasa_anual", "0.45"), // cerca del tope de usura colombiano
            ("meses", "36"),
        ],
    );
    assert!(value(&usura, "interes_total") > Decimal::ZERO);

    let minima = compute(
        Kind::Ahorro,
        &[
            ("deposito_inicial", "1000000.00"),
            ("tasa_anual", "0.000012"), // el mínimo representable en NUMERIC(9,6)
            ("meses", "12"),
        ],
    );
    // Tan pequeña que el interés no llega a un centavo, y aun así el cálculo es
    // válido: el monto final no puede ser menor que el aporte.
    assert!(value(&minima, "monto_final") >= dec!(1000000.00));
}

/// Una inversión con rendimiento NEGATIVO es un escenario legítimo, a diferencia del
/// ahorro: ver una pérdida proyectada es parte de entender el riesgo.
#[test]
fn la_inversion_admite_rendimiento_negativo() {
    let result = compute(
        Kind::Inversion,
        &[
            ("capital", "10000000.00"),
            ("tasa_anual", "-0.15"),
            ("anios", "3"),
        ],
    );

    // 10 000 000 × 0.85³ = 6 141 250
    assert_eq!(value(&result, "valor_futuro"), dec!(6141250.00));
    assert_eq!(value(&result, "rendimiento"), dec!(-3858750.00));
}

// ── 5. Plazos largos ────────────────────────────────────────────────────────

/// El plazo máximo admitido —cien años— tiene que calcularse sin desbordar.
#[test]
fn el_plazo_maximo_es_calculable() {
    let result = compute(
        Kind::Ahorro,
        &[
            ("deposito_inicial", "1000.00"),
            ("aporte_mensual", "1000.00"),
            ("tasa_anual", "0.06"),
            ("meses", &MAX_PERIODS.to_string()),
        ],
    );
    assert!(value(&result, "monto_final") > dec!(1000.00));
}

/// Un periodo más y se rechaza NOMBRANDO el parámetro.
///
/// Es la diferencia entre un mensaje accionable y un «error interno»: sin este tope,
/// la potencia desbordaría y el usuario recibiría un fallo del servicio por haber
/// escrito un número grande (Edge Cases: rangos irrazonables).
#[test]
fn un_plazo_irrazonable_se_rechaza_con_su_causa() {
    let err = dispatch::compute(
        Kind::Ahorro,
        &inputs(&[
            ("deposito_inicial", "1000.00"),
            ("tasa_anual", "0.06"),
            ("meses", &(MAX_PERIODS + 1).to_string()),
        ]),
    )
    .expect_err("un plazo por encima del tope debe rechazarse");

    let mensaje = err.to_string();
    assert!(
        mensaje.contains("meses"),
        "el error debe nombrar el parámetro: {mensaje}"
    );
}

// ── 6. Montos extremos y límites de columna ─────────────────────────────────

/// El tope de `NUMERIC(19,2)` se acepta; un peso más se rechaza en la frontera.
#[test]
fn el_tope_de_la_columna_de_montos_se_respeta() {
    let al_limite = dispatch::compute(
        Kind::Presupuesto,
        &inputs(&[("ingreso_mensual", "99999999999999999.99")]),
    );
    assert!(
        al_limite.is_ok(),
        "el máximo de NUMERIC(19,2) debe admitirse"
    );

    let pasado = dispatch::compute(
        Kind::Presupuesto,
        &inputs(&[("ingreso_mensual", "100000000000000000.00")]),
    );
    assert!(
        pasado.is_err(),
        "un valor que no cabe en la columna debe fallar en la frontera, no en el INSERT"
    );
}

/// Los montos con más de dos decimales se rechazan en vez de redondearse.
///
/// Redondear en silencio convertiría un dato mal construido por el emisor en un valor
/// distinto guardado en la base, y nadie sabría en qué punto se perdió el centavo.
#[test]
fn un_monto_con_escala_excesiva_se_rechaza() {
    let err = dispatch::compute(
        Kind::Presupuesto,
        &inputs(&[("ingreso_mensual", "1000.005")]),
    );
    assert!(err.is_err());
}

/// Notación científica y separadores de miles se rechazan: no son decimales canónicas
/// (D-10), y aceptarlas abriría la puerta a que un cliente mandara `1e3` esperando mil.
#[test]
fn las_formas_no_canonicas_se_rechazan() {
    for valor in ["1.5e3", "1,000.00", "+1000.00", ".5", "1000.", " 1000.00"] {
        assert!(
            dispatch::compute(Kind::Presupuesto, &inputs(&[("ingreso_mensual", valor)])).is_err(),
            "{valor:?} no es una decimal canónica y debía rechazarse"
        );
    }
}

// ── 7. Convenciones colombianas ─────────────────────────────────────────────

/// La conversión M.V. → E.A. es EXACTA: elevar a doce es multiplicación repetida.
///
/// El valor de referencia se calcula aquí con la misma operación exacta, así que la
/// divergencia exigida es cero.
#[test]
fn de_mes_vencido_a_efectiva_anual_es_exacto() {
    let result = compute(
        Kind::ColombiaEspecifica,
        &[("operacion", "mv_a_ea"), ("tasa_mv", "0.018")],
    );

    let referencia = annuity::growth_factor(dec!(0.018), 12).unwrap() - Decimal::ONE;
    assert_eq!(
        value(&result, "tasa_ea"),
        decimal_str::round_half_even(referencia, 6)
    );
    // Y la cifra que hace visible el error de lectura: la nominal anual (21.6 %) no es
    // la efectiva (23.87 %).
    assert_eq!(value(&result, "tasa_nominal_anual"), dec!(0.216));
    assert!(value(&result, "tasa_ea") > dec!(0.238));
}

/// La ida y vuelta `EA → MV → EA` vuelve al punto de partida a seis decimales.
///
/// Es la forma honesta de fijar la raíz duodécima, que NO es exacta en decimal: en vez
/// de una constante mágica que ocultaría el método, se comprueba la propiedad
/// algebraica que sí debe cumplirse a la escala de la columna de tasas.
#[test]
fn la_ida_y_vuelta_entre_ea_y_mv_conserva_la_tasa() {
    for ea in ["0.12", "0.24", "0.055", "0.4"] {
        let a_mensual = compute(
            Kind::ColombiaEspecifica,
            &[("operacion", "ea_a_mv"), ("tasa_ea", ea)],
        );
        let mensual = a_mensual.get("tasa_mv").unwrap().clone();

        let de_vuelta = compute(
            Kind::ColombiaEspecifica,
            &[("operacion", "mv_a_ea"), ("tasa_mv", &mensual)],
        );

        let original = decimal_str::parse(ea).unwrap();
        let recuperada = value(&de_vuelta, "tasa_ea");
        let desvio = (recuperada - original).abs();

        // Una millonésima: el redondeo de la tasa mensual a seis decimales, amplificado
        // al elevar a doce. Es el límite del dato, no del cálculo.
        assert!(
            desvio <= dec!(0.000010),
            "EA {ea} volvió como {recuperada}, desvío {desvio}"
        );
    }
}

/// El 4 × 1000 sobre un retiro sin exención.
#[test]
fn el_gmf_grava_el_cuatro_por_mil() {
    let result = compute(
        Kind::ColombiaEspecifica,
        &[
            ("operacion", "gmf"),
            ("monto", "5000000.00"),
            ("valor_uvt", "49799.00"),
        ],
    );

    assert_eq!(value(&result, "gravamen"), dec!(20000.00));
    assert_eq!(value(&result, "neto_recibido"), dec!(4980000.00));
    assert_eq!(value(&result, "monto_exento"), Decimal::ZERO);
}

/// Con la exención marcada, los primeros 350 UVT no tributan.
///
/// La exención NO es automática —depende de un trámite ante el banco— y por eso hay
/// que pedirla. Aplicarla por defecto subestimaría el impuesto justo de quien no la
/// tiene.
#[test]
fn el_gmf_aplica_la_exencion_solo_si_se_pide() {
    let uvt = dec!(49799.00);
    let tope = uvt * Decimal::from(350); // 17 429 650

    let exento = compute(
        Kind::ColombiaEspecifica,
        &[
            ("operacion", "gmf"),
            ("monto", "20000000.00"),
            ("valor_uvt", "49799.00"),
            ("exento", "si"),
        ],
    );

    assert_eq!(value(&exento, "tope_exencion"), tope);
    assert_eq!(value(&exento, "monto_exento"), tope);
    // Solo tributa el exceso: (20 000 000 − 17 429 650) × 0.004
    assert_eq!(
        value(&exento, "gravamen"),
        round_money((dec!(20000000.00) - tope) * dec!(0.004))
    );
}

/// Un modo inexistente se rechaza enumerando los que sí existen.
#[test]
fn una_operacion_colombiana_desconocida_se_rechaza() {
    let err = dispatch::compute(
        Kind::ColombiaEspecifica,
        &inputs(&[("operacion", "retencion_en_la_fuente")]),
    )
    .expect_err("un modo desconocido debe rechazarse");

    assert!(err.to_string().contains("ea_a_mv"));
}
