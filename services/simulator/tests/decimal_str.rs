//! Pruebas del tipo lógico `DecimalString` (T023).
//!
//! Cubren montos extremos, escala máxima, notación científica rechazada y
//! overflow, más la propiedad que motiva el Principio VIII: la aritmética debe
//! ser exacta justo donde `f64` falla.

use fintcart_simulator::domain::decimal_str::{
    format, format_fixed, parse, parse_money, parse_rate, parse_score, round_half_even,
    DecimalStrError,
};
use rust_decimal::Decimal;

/// Atajo para las pruebas: parsea o hace pánico con contexto.
fn d(s: &str) -> Decimal {
    parse(s).unwrap_or_else(|e| panic!("parse({s:?}) falló: {e}"))
}

#[test]
fn parse_acepta_la_forma_canonica() {
    for s in [
        "0",
        "-0",
        "5",
        "123",
        "0.5",
        "-0.5",
        "1500000.00",
        "-1500000.00",
        "0.000000000000000001",
    ] {
        assert!(parse(s).is_ok(), "parse({s:?}) debería aceptarse");
    }
}

#[test]
fn parse_rechaza_lo_no_canonico() {
    // Sintaxis: cada caso es una forma en que un emisor podría equivocarse.
    for s in [
        "1.5e3",    // notación científica
        "1.5E3",    // idem, mayúscula
        "1e5",      // idem, sin punto
        "1.5e-3",   // idem, exponente negativo
        "1,500.00", // separador de miles
        "1.500,00", // formato europeo
        "+1.5",     // signo positivo explícito
        ".5",       // sin parte entera
        "5.",       // sin parte decimal
        " 1.5",     // espacio inicial
        "1.5 ",     // espacio final
        "1 500",    // espacio interno
        "--1",      // doble signo
        "1.2.3",    // doble punto
        "0x10",     // hexadecimal
        "abc",      // texto
        "Infinity", // infinito
        "NaN",      // NaN
        "-",        // solo signo
        "1_000",    // guion bajo
        "$1500",    // símbolo de moneda
        "5%",       // porcentaje
        "1.5-",     // signo al final
    ] {
        match parse(s) {
            Err(DecimalStrError::Syntax(_)) => {}
            otro => panic!("parse({s:?}) debería dar Syntax, dio {otro:?}"),
        }
    }

    assert_eq!(parse(""), Err(DecimalStrError::Empty));
}

#[test]
fn parse_rechaza_lo_que_no_cabe_en_un_decimal() {
    // `rust_decimal` tiene mantisa de 96 bits: una parte entera de 40 dígitos no
    // es representable. Debe dar error, NO redondear en silencio ni entrar en
    // pánico. (En Go el equivalente usa big.Int y sí lo admite; la diferencia es
    // irrelevante porque toda columna del modelo cabe de sobra.)
    let enorme = "9".repeat(40);
    match parse(&enorme) {
        Err(DecimalStrError::Unrepresentable(_)) => {}
        otro => panic!("parse(40 nueves) debería dar Unrepresentable, dio {otro:?}"),
    }

    // Escala mayor que la máxima de Decimal (28) tampoco puede redondearse.
    let escala_absurda = format!("0.{}", "1".repeat(40));
    match parse(&escala_absurda) {
        Err(DecimalStrError::Unrepresentable(_)) => {}
        otro => panic!("parse(40 decimales) debería dar Unrepresentable, dio {otro:?}"),
    }
}

#[test]
fn parse_money_respeta_numeric_19_2() {
    // Aceptados: 17 dígitos enteros y 2 decimales es el máximo exacto.
    for s in [
        "0",
        "1500000.00",
        "99999999999999999.99",
        "-99999999999999999.99",
        "1.500", // los ceros de relleno no cuentan como escala
    ] {
        assert!(
            parse_money(s).is_ok(),
            "parse_money({s:?}) debería aceptarse"
        );
    }

    // Un dígito entero más ya no cabe.
    for s in ["100000000000000000.00", "-100000000000000000.00"] {
        match parse_money(s) {
            Err(DecimalStrError::Range { .. }) => {}
            otro => panic!("parse_money({s:?}) debería dar Range, dio {otro:?}"),
        }
    }

    // Tres decimales significativos exceden la escala de la columna.
    for s in ["1.001", "0.000000000000000001"] {
        match parse_money(s) {
            Err(DecimalStrError::Scale { .. }) => {}
            otro => panic!("parse_money({s:?}) debería dar Scale, dio {otro:?}"),
        }
    }
}

#[test]
fn parse_rate_y_parse_score_respetan_sus_columnas() {
    // Tasas: NUMERIC(9,6) → 3 enteros, 6 decimales.
    assert!(parse_rate("999.999999").is_ok());
    assert!(matches!(
        parse_rate("1000.0"),
        Err(DecimalStrError::Range { .. })
    ));
    assert!(matches!(
        parse_rate("0.0000001"),
        Err(DecimalStrError::Scale { .. })
    ));

    // Calificaciones: NUMERIC(6,2) → 4 enteros, 2 decimales.
    assert!(parse_score("100.00").is_ok());
    assert!(matches!(
        parse_score("10000.00"),
        Err(DecimalStrError::Range { .. })
    ));
}

#[test]
fn format_es_canonico_y_estable() {
    for (entrada, esperado) in [
        ("0", "0"),
        ("-0", "0"), // el cero negativo no es canónico en la salida
        ("5", "5"),
        ("1500000.00", "1500000"),
        ("1.500", "1.5"),
        ("-0.50", "-0.5"),
        ("100", "100"), // no se tocan los ceros de la parte entera
        ("0.010", "0.01"),
    ] {
        let salida = format(d(entrada));
        assert_eq!(salida, esperado, "format(parse({entrada:?}))");

        // Idempotencia: la salida canónica vuelve a parsearse igual.
        assert_eq!(format(d(&salida)), salida, "format no es idempotente");
    }
}

#[test]
fn format_nunca_usa_notacion_cientifica() {
    // Una serialización ingenua emitiría "1E+18" y rompería a cualquier
    // consumidor del contrato.
    for s in [
        "1000000000000000000",
        "0.000000000000000001",
        "-1000000000000000000",
    ] {
        let salida = format(d(s));
        assert!(
            !salida.contains('e') && !salida.contains('E'),
            "format({s:?}) = {salida:?} contiene notación científica"
        );
        assert!(
            parse(&salida).is_ok(),
            "format({s:?}) = {salida:?} no es canónico"
        );
    }
}

#[test]
fn format_fixed_rellena_pero_no_redondea_en_silencio() {
    assert_eq!(format_fixed(d("1.5"), 2).unwrap(), "1.50");
    assert_eq!(format_fixed(d("0"), 2).unwrap(), "0.00");

    // Pedir menos decimales de los que el valor tiene debe fallar, no redondear:
    // la pérdida silenciosa de precisión es lo que el Principio VIII evita.
    assert!(matches!(
        format_fixed(d("1.005"), 2),
        Err(DecimalStrError::Scale { .. })
    ));
}

#[test]
fn round_half_even_es_bancario() {
    for (entrada, escala, esperado) in [
        // El empate se resuelve hacia el dígito par, no siempre hacia arriba.
        ("0.125", 2, "0.12"),
        ("0.135", 2, "0.14"),
        ("2.5", 0, "2"),
        ("3.5", 0, "4"),
        ("-2.5", 0, "-2"),
        ("-0.125", 2, "-0.12"),
        // Sin empate se redondea normalmente.
        ("0.126", 2, "0.13"),
        ("0.124", 2, "0.12"),
    ] {
        let salida = format(round_half_even(d(entrada), escala));
        assert_eq!(salida, esperado, "round_half_even({entrada}, {escala})");
    }
}

/// La prueba del Principio VIII (SC-004): los casos clásicos en los que `f64`
/// da un resultado incorrecto deben ser exactos por esta vía.
#[test]
fn aritmetica_exacta_donde_el_float_falla() {
    // 0.1 + 0.2 != 0.3 en binario.
    assert_eq!(format(d("0.1") + d("0.2")), "0.3");

    // Un monto grande en COP más un centavo: con f64 el centavo se pierde por
    // falta de dígitos significativos.
    assert_eq!(
        format(d("99999999999999.99") + d("0.01")),
        "100000000000000"
    );

    // Diez veces 0.1 debe ser exactamente 1.
    let mut acc = Decimal::ZERO;
    for _ in 0..10 {
        acc += d("0.1");
    }
    assert_eq!(format(acc), "1");
}
