//! Pruebas de la definición de una calculadora (T089): forma declarada, validación al
//! guardar y orden de evaluación al ejecutar.
//!
//! Sin PostgreSQL y sin gRPC: `Draft::parse` y `Definition::run` son dominio puro, y ese es
//! el punto de que lo sean (Principio IX). Un fallo aquí es un fallo de la regla, no del
//! transporte.

use std::collections::{BTreeSet, HashMap};

use fintcart_simulator::domain::definition::{
    parse_value, Definition, Draft, DraftOutput, DraftValidation, InputField,
};
use fintcart_simulator::domain::error::Error;
use fintcart_simulator::domain::formula::ast::InputKind;
use fintcart_simulator::domain::formula::ErrorCode;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

// ── constructores de apoyo ──────────────────────────────────────────────────

fn campo(key: &str, kind: InputKind, required: bool) -> InputField {
    InputField {
        key: key.to_owned(),
        label: key.to_owned(),
        kind,
        unit: String::new(),
        min: None,
        max: None,
        default: None,
        required,
    }
}

fn monto(key: &str, required: bool) -> InputField {
    campo(key, InputKind::Monto, required)
}

fn entero(key: &str, required: bool) -> InputField {
    campo(key, InputKind::Entero, required)
}

fn con_rango(mut field: InputField, min: Option<Decimal>, max: Option<Decimal>) -> InputField {
    field.min = min;
    field.max = max;
    field
}

fn con_defecto(mut field: InputField, default: Decimal) -> InputField {
    field.default = Some(default);
    field
}

fn output(key: &str, expression: &str) -> DraftOutput {
    DraftOutput {
        key: key.to_owned(),
        label: key.to_owned(),
        expression: expression.to_owned(),
        scale: 2,
        when: None,
    }
}

fn rule(expression: &str, message: &str) -> DraftValidation {
    DraftValidation {
        expression: expression.to_owned(),
        message: message.to_owned(),
    }
}

/// Borrador mínimo válido: una entrada `monto`, una salida que la devuelve.
fn borrador() -> Draft {
    Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![output("resultado", "monto")],
    }
}

fn indicadores(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn sin_indicadores() -> BTreeSet<String> {
    BTreeSet::new()
}

fn parse_ok(draft: Draft) -> Definition {
    parse_con(draft, &sin_indicadores())
}

fn parse_con(draft: Draft, catalogo: &BTreeSet<String>) -> Definition {
    draft
        .parse(catalogo)
        .unwrap_or_else(|issues| panic!("la definición debía ser válida: {issues:?}"))
}

fn ejecutar(def: &Definition, inputs: &[(&str, &str)]) -> Vec<(String, Decimal)> {
    let raw: HashMap<String, String> = inputs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    def.run(&raw, &HashMap::new())
        .unwrap_or_else(|err| panic!("la ejecución debía funcionar: {err}"))
}

// ── forma de la definición ──────────────────────────────────────────────────

#[test]
fn un_borrador_valido_produce_una_definicion() {
    let definicion = parse_ok(Draft {
        inputs: vec![monto("monto", true), entero("meses", true)],
        validations: vec![rule("monto > 0", "el monto debe ser mayor que cero")],
        outputs: vec![output("cuota", "monto / meses")],
    });

    assert_eq!(definicion.inputs.len(), 2);
    assert_eq!(definicion.validations.len(), 1);
    assert_eq!(definicion.outputs.len(), 1);
    assert_eq!(definicion.outputs[0].key, "cuota");
}

/// El punto de acumular y no abortar: quien acaba de escribir seis salidas con una errata
/// en cada una no debe descubrirlas de una en una, guardando seis veces.
#[test]
fn devuelve_todos_los_problemas_y_no_solo_el_primero() {
    let issues = Draft {
        inputs: vec![monto("monto", true)],
        validations: vec![rule("monto > 0", "")],
        outputs: vec![
            output("a", "monto +"),
            output("b", "no_existe"),
            output("c", "monto"),
        ],
    }
    .parse(&sin_indicadores())
    .expect_err("la definición no es válida");

    assert_eq!(
        issues.len(),
        3,
        "se esperaban tres problemas (when/expresión, campo y mensaje): {issues:?}"
    );
}

#[test]
fn la_ubicacion_senala_la_salida_concreta() {
    let issues = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![
            output("a", "monto * 2"),
            output("b", "monto +"),
            output("c", "monto * 3"),
        ],
    }
    .parse(&sin_indicadores())
    .expect_err("la segunda salida no analiza");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].location, "outputs[1].expression");
    assert_eq!(issues[0].code, ErrorCode::ExpresionMalFormada);
}

#[test]
fn una_clave_repetida_se_rechaza() {
    let issues = Draft {
        inputs: vec![monto("monto", true), entero("monto", false)],
        validations: Vec::new(),
        outputs: vec![output("resultado", "monto")],
    }
    .parse(&sin_indicadores())
    .expect_err("dos entradas con la misma clave comparten un valor");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].location, "inputs[1].key");
    assert_eq!(issues[0].code, ErrorCode::DefinicionInvalida);
}

/// `si` y `pot` son palabras del lenguaje: declararlas como campo haría que la fórmula que
/// las nombra fuera ambigua entre el campo y la palabra.
#[test]
fn una_clave_que_es_palabra_del_lenguaje_se_rechaza() {
    for reservada in ["si", "y", "pot", "min", "presente"] {
        let issues = Draft {
            inputs: vec![monto("monto", true), entero(reservada, false)],
            validations: Vec::new(),
            outputs: vec![output("resultado", "monto")],
        }
        .parse(&sin_indicadores())
        .expect_err("una palabra del lenguaje no puede ser clave de campo");

        assert_eq!(issues.len(), 1, "«{reservada}» produce un solo problema");
        assert_eq!(issues[0].location, "inputs[1].key");
        assert_eq!(issues[0].code, ErrorCode::DefinicionInvalida);
    }
}

/// La comprobación se hace con el analizador léxico REAL: una regla propia duplicada se
/// desincroniza, y el síntoma sería un campo que el autor declara, la validación acepta y
/// ninguna fórmula puede referenciar.
#[test]
fn una_clave_que_el_lenguaje_no_puede_nombrar_se_rechaza() {
    for invalida in ["monto mensual", "año", "1monto", "monto-mensual", ""] {
        let resultado = Draft {
            inputs: vec![monto("monto", true), entero(invalida, false)],
            validations: Vec::new(),
            outputs: vec![output("resultado", "monto")],
        }
        .parse(&sin_indicadores());

        let issues = resultado.expect_err("la clave no es un identificador");
        assert!(
            issues.iter().any(|i| i.location == "inputs[1].key"),
            "«{invalida}» debía señalarse como clave inválida: {issues:?}"
        );
    }
}

#[test]
fn un_minimo_mayor_que_su_maximo_se_rechaza() {
    let issues = Draft {
        inputs: vec![con_rango(
            monto("monto", true),
            Some(dec!(100)),
            Some(dec!(10)),
        )],
        validations: Vec::new(),
        outputs: vec![output("resultado", "monto")],
    }
    .parse(&sin_indicadores())
    .expect_err("ningún valor podría cumplir ese rango");

    assert_eq!(issues[0].location, "inputs[0].min");
}

/// Un valor por defecto fuera de su propio rango hace que la calculadora falle con los
/// datos que ella misma propone.
#[test]
fn un_valor_por_defecto_fuera_de_su_rango_se_rechaza() {
    let issues = Draft {
        inputs: vec![con_defecto(
            con_rango(monto("monto", false), Some(dec!(1)), Some(dec!(10))),
            dec!(50),
        )],
        validations: Vec::new(),
        outputs: vec![output("resultado", "monto")],
    }
    .parse(&sin_indicadores())
    .expect_err("el defecto está fuera del rango");

    assert_eq!(issues[0].location, "inputs[0].default");
}

/// Una definición sin salidas no es una calculadora: se guardaría y fallaría al ejecutarse,
/// delante del lector en vez de delante del autor.
#[test]
fn sin_entradas_o_sin_salidas_se_rechaza_como_limite() {
    let sin_salidas = Draft {
        outputs: Vec::new(),
        ..borrador()
    }
    .parse(&sin_indicadores())
    .expect_err("sin salidas no hay nada que calcular");
    assert_eq!(sin_salidas[0].code, ErrorCode::LimiteExcedido);
    assert_eq!(sin_salidas[0].location, "outputs");

    let sin_entradas = Draft {
        inputs: Vec::new(),
        validations: Vec::new(),
        outputs: vec![output("constante", "1")],
    }
    .parse(&sin_indicadores())
    .expect_err("sin entradas es una constante disfrazada");
    assert_eq!(sin_entradas[0].code, ErrorCode::LimiteExcedido);
    assert_eq!(sin_entradas[0].location, "inputs");
}

#[test]
fn se_rechazan_mas_entradas_o_salidas_de_las_declaradas() {
    let demasiadas_entradas = Draft {
        inputs: (0..21).map(|i| entero(&format!("c{i}"), false)).collect(),
        validations: Vec::new(),
        outputs: vec![output("resultado", "c0")],
    }
    .parse(&sin_indicadores())
    .expect_err("el máximo es 20");
    assert_eq!(demasiadas_entradas[0].code, ErrorCode::LimiteExcedido);

    let demasiadas_salidas = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: (0..11).map(|i| output(&format!("s{i}"), "monto")).collect(),
    }
    .parse(&sin_indicadores())
    .expect_err("el máximo es 10");
    assert_eq!(demasiadas_salidas[0].code, ErrorCode::LimiteExcedido);
}

/// El contrato quiere que cada salida sea un número. Escribir una condición es un error del
/// autor que debe salir al GUARDAR, no una interpretación silenciosa al ejecutar.
#[test]
fn una_salida_que_produce_una_condicion_se_rechaza_como_tipo() {
    let issues = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![output("resultado", "monto > 0")],
    }
    .parse(&sin_indicadores())
    .expect_err("una salida booleana no es un resultado");

    assert_eq!(issues[0].code, ErrorCode::TipoIncompatible);
    assert_eq!(issues[0].location, "outputs[0].expression");
}

#[test]
fn un_when_que_no_es_condicion_se_rechaza_en_su_propia_ubicacion() {
    let issues = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![DraftOutput {
            when: Some("monto".to_owned()),
            ..output("resultado", "monto")
        }],
    }
    .parse(&sin_indicadores())
    .expect_err("un `when` debe ser una condición");

    assert_eq!(issues[0].code, ErrorCode::TipoIncompatible);
    assert_eq!(issues[0].location, "outputs[0].when");
}

/// Una regla sin mensaje no puede explicarle nada al usuario: el mensaje del autor es LA
/// razón de que las validaciones existan aparte de las fórmulas (D-15).
#[test]
fn una_validacion_sin_mensaje_se_rechaza() {
    let issues = Draft {
        validations: vec![rule("monto > 0", "   ")],
        ..borrador()
    }
    .parse(&sin_indicadores())
    .expect_err("una regla muda no sirve");

    assert_eq!(issues[0].location, "validations[0].message");
}

#[test]
fn una_validacion_que_produce_un_numero_se_rechaza() {
    let issues = Draft {
        validations: vec![rule("monto + 1", "mensaje")],
        ..borrador()
    }
    .parse(&sin_indicadores())
    .expect_err("una validación debe ser una condición");

    assert!(issues
        .iter()
        .any(|i| i.location == "validations[0].expression"));
}

#[test]
fn una_escala_de_salida_desmedida_se_rechaza() {
    let issues = Draft {
        outputs: vec![DraftOutput {
            scale: 29,
            ..output("resultado", "monto")
        }],
        ..borrador()
    }
    .parse(&sin_indicadores())
    .expect_err("más allá de la escala de Decimal el redondeo no hace nada");

    assert_eq!(issues[0].location, "outputs[0].scale");
    assert_eq!(issues[0].code, ErrorCode::LimiteExcedido);
}

#[test]
fn un_indicador_desconocido_se_rechaza_con_su_propio_codigo() {
    let issues = Draft {
        outputs: vec![output("en_uvt", "monto / @UVT")],
        ..borrador()
    }
    .parse(&sin_indicadores())
    .expect_err("el catálogo está vacío");

    assert_eq!(issues[0].code, ErrorCode::IndicadorDesconocido);
    assert_eq!(issues[0].location, "outputs[0].expression");
}

// ── ejecución ───────────────────────────────────────────────────────────────

#[test]
fn ejecuta_las_salidas_en_orden_declarado() {
    let definicion = parse_ok(Draft {
        inputs: vec![monto("monto", true), entero("meses", true)],
        validations: Vec::new(),
        outputs: vec![
            output("por_mes", "monto / meses"),
            output("doble", "monto * 2"),
        ],
    });

    let resultado = ejecutar(&definicion, &[("monto", "100"), ("meses", "4")]);

    assert_eq!(
        resultado,
        vec![
            ("por_mes".to_owned(), dec!(25.00)),
            ("doble".to_owned(), dec!(200.00)),
        ],
        "el orden declarado es el que ve el usuario"
    );
}

/// Es la razón de ser de las dos listas separadas: el usuario debe leer el mensaje del
/// autor y no una división por cero. Si las salidas se evaluaran antes, la regla llegaría
/// tarde y el mensaje sería el genérico del evaluador.
#[test]
fn las_validaciones_del_autor_corren_antes_que_las_salidas() {
    let definicion = parse_ok(Draft {
        inputs: vec![monto("monto", true), entero("meses", true)],
        validations: vec![rule("meses > 0", "el plazo debe ser mayor que cero")],
        // Con `meses = 0` esta salida dividiría por cero si llegara a evaluarse.
        outputs: vec![output("cuota", "monto / meses")],
    });

    let error = definicion
        .run(
            &[("monto", "100"), ("meses", "0")]
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            &HashMap::new(),
        )
        .expect_err("la regla del autor no se cumple");

    match error {
        Error::InvalidInput(message) => assert_eq!(message, "el plazo debe ser mayor que cero"),
        other => panic!("se esperaba el mensaje del autor, llegó {other:?}"),
    }
}

/// FR-044: se rechaza la ejecución indicando **el campo y el rango admitido**.
#[test]
fn un_valor_fuera_de_rango_nombra_el_campo_y_su_rango() {
    let definicion = parse_ok(Draft {
        inputs: vec![con_rango(
            entero("meses", true),
            Some(dec!(1)),
            Some(dec!(600)),
        )],
        validations: Vec::new(),
        outputs: vec![output("resultado", "meses * 2")],
    });

    let error = definicion
        .run(
            &[("meses", "5000")]
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            &HashMap::new(),
        )
        .expect_err("5000 está fuera de [1, 600]");

    match error {
        Error::InvalidInput(message) => {
            assert!(
                message.contains("meses"),
                "debe nombrar el campo: {message}"
            );
            assert!(message.contains('1'), "debe dar el rango: {message}");
            assert!(message.contains("600"), "debe dar el rango: {message}");
        }
        other => panic!("se esperaba InvalidInput, llegó {other:?}"),
    }
}

/// El rango se comprueba sobre el valor EFECTIVO: un opcional ausente sin defecto vale
/// cero, y si su rango empieza en uno ese cero es tan inválido como si lo hubieran escrito.
/// Dejarlo pasar haría que la fórmula calculara con un valor que la propia definición
/// prohíbe.
#[test]
fn el_rango_se_comprueba_tambien_sobre_el_valor_efectivo() {
    let definicion = parse_ok(Draft {
        inputs: vec![con_rango(monto("aporte", false), Some(dec!(1)), None)],
        validations: Vec::new(),
        outputs: vec![output("resultado", "aporte")],
    });

    let error = definicion
        .run(&HashMap::new(), &HashMap::new())
        .expect_err("el cero implícito está por debajo del mínimo");

    assert!(matches!(error, Error::InvalidInput(_)));
}

#[test]
fn un_campo_obligatorio_ausente_es_un_error_que_lo_nombra() {
    let definicion = parse_ok(borrador());

    let error = definicion
        .run(&HashMap::new(), &HashMap::new())
        .expect_err("`monto` es obligatorio");

    match error {
        Error::InvalidInput(message) => assert!(message.contains("monto"), "{message}"),
        other => panic!("se esperaba InvalidInput, llegó {other:?}"),
    }
}

#[test]
fn un_opcional_ausente_toma_su_valor_por_defecto() {
    let definicion = parse_ok(Draft {
        inputs: vec![con_defecto(monto("aporte", false), dec!(50))],
        validations: Vec::new(),
        outputs: vec![output("resultado", "aporte * 2")],
    });

    assert_eq!(
        ejecutar(&definicion, &[]),
        vec![("resultado".to_owned(), dec!(100.00))]
    );
}

/// La distinción que hace posible la salida condicional de `inversion`: un campo enviado
/// con su valor por defecto y un campo ausente valen lo mismo pero NO son lo mismo.
#[test]
fn ausente_y_enviado_con_su_defecto_no_son_lo_mismo() {
    let definicion = parse_ok(Draft {
        inputs: vec![con_defecto(monto("inflacion", false), dec!(0))],
        validations: Vec::new(),
        outputs: vec![DraftOutput {
            when: Some("presente(inflacion)".to_owned()),
            ..output("valor_real", "1")
        }],
    });

    assert!(
        ejecutar(&definicion, &[]).is_empty(),
        "no se envió la inflación, así que la salida se omite"
    );
    assert_eq!(
        ejecutar(&definicion, &[("inflacion", "0")]).len(),
        1,
        "se envió como cero, así que la salida existe"
    );
}

#[test]
fn el_resultado_se_redondea_a_la_escala_declarada_con_half_even() {
    let definicion = parse_ok(Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![
            DraftOutput {
                scale: 2,
                ..output("dos", "monto / 3")
            },
            // 2.5 y 3.5 con half-even van a 2 y 4: la mitad exacta va al par.
            DraftOutput {
                scale: 0,
                ..output("par", "2.5")
            },
            DraftOutput {
                scale: 0,
                ..output("impar", "3.5")
            },
        ],
    });

    let resultado = ejecutar(&definicion, &[("monto", "10")]);

    assert_eq!(resultado[0].1, dec!(3.33));
    assert_eq!(resultado[1].1, dec!(2));
    assert_eq!(resultado[2].1, dec!(4));
}

#[test]
fn los_indicadores_llegan_por_el_ambito_y_no_del_catalogo() {
    let indicadores: BTreeSet<String> = ["UVT".to_owned()].into_iter().collect();
    let definicion = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![output("en_uvt", "monto / @UVT")],
    }
    .parse(&indicadores)
    .expect("el catálogo declara UVT");

    let mut valores = HashMap::new();
    valores.insert("UVT".to_owned(), dec!(47065));

    let resultado = definicion
        .run(
            &[("monto", "94130")]
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            &valores,
        )
        .expect("la ejecución debía funcionar");

    assert_eq!(resultado[0].1, dec!(2.00));
}

/// Sin valor vigente, la evaluación falla en vez de usar cero: un resultado con un cero
/// donde debía ir el UVT se lee como un cálculo legítimo.
#[test]
fn un_indicador_sin_valor_vigente_falla_en_vez_de_valer_cero() {
    let indicadores: BTreeSet<String> = ["UVT".to_owned()].into_iter().collect();
    let definicion = Draft {
        inputs: vec![monto("monto", true)],
        validations: Vec::new(),
        outputs: vec![output("en_uvt", "monto / @UVT")],
    }
    .parse(&indicadores)
    .expect("el catálogo declara UVT");

    let error = definicion
        .run(
            &[("monto", "94130")]
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            &HashMap::new(),
        )
        .expect_err("no hay valor vigente de UVT");

    match error {
        Error::InvalidInput(message) => assert!(message.contains("UVT"), "{message}"),
        other => panic!("se esperaba InvalidInput, llegó {other:?}"),
    }
}

/// Los indicadores salen de las TRES listas. Olvidar el `when` dejaría una calculadora que
/// usa `@UVT` solo en su condición sin avisar de que su vigencia está por vencer (FR-061).
#[test]
fn indicators_used_junta_las_tres_listas_de_expresiones() {
    let definicion = parse_con(
        Draft {
            inputs: vec![monto("monto", true)],
            validations: vec![rule("monto > @SMMLV", "mensaje")],
            outputs: vec![
                output("a", "monto / @UVT"),
                DraftOutput {
                    when: Some("@IPC > 0".to_owned()),
                    ..output("b", "monto")
                },
            ],
        },
        &indicadores(&["IPC", "SMMLV", "UVT"]),
    );

    assert_eq!(
        definicion.indicators_used(),
        vec!["IPC".to_owned(), "SMMLV".to_owned(), "UVT".to_owned()],
        "ordenado y sin repetir, venga de donde venga"
    );
}

// ── el valor declarado, interpretado igual al guardar y al ejecutar ─────────

/// La misma función interpreta el mínimo al guardar y el valor del usuario al ejecutar. Si
/// fueran dos, una calculadora podría guardarse con un valor que luego la ejecución rechaza.
#[test]
fn el_valor_declarado_se_interpreta_igual_en_los_dos_caminos() {
    // Monto: `NUMERIC(19,2)`, así que tres decimales no caben.
    assert!(parse_value(InputKind::Monto, "10.123").is_err());
    assert_eq!(parse_value(InputKind::Monto, "10.12").unwrap(), dec!(10.12));

    // Tasa: `NUMERIC(9,6)`.
    assert!(parse_value(InputKind::Tasa, "0.1234567").is_err());
    assert_eq!(
        parse_value(InputKind::Tasa, "0.123456").unwrap(),
        dec!(0.123456)
    );

    // Entero: no admite fracción.
    assert!(parse_value(InputKind::Entero, "12.5").is_err());
    assert_eq!(parse_value(InputKind::Entero, "12").unwrap(), dec!(12));

    // Y el mensaje no filtra el nombre del módulo interno.
    let error = parse_value(InputKind::Monto, "1.000,00").unwrap_err();
    assert!(
        !error.message.contains("decimal_str"),
        "el mensaje lo lee el autor, no quien opera el servicio: {}",
        error.message
    );
}
