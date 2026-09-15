//! Pruebas del analizador de fórmulas (T075, FR-046, research D-15).
//!
//! ## Qué se comprueba aquí, y por qué importa tanto
//!
//! Toda la promesa de D-15 descansa en que los errores aparezcan **al guardar**. Un autor
//! que escribe `pot(x, 2.5)` tiene que enterarse mientras edita; si la fórmula se
//! persistiera, el fallo saldría delante del lector, en una pantalla que no es suya y sin
//! nada que pueda hacer. Por eso cada caso de esta suite comprueba dos cosas: que la
//! fórmula se RECHAZA, y que se rechaza con el **código** que el constructor visual
//! necesita para resaltar el campo correcto.
//!
//! Los códigos se afirman como cadena literal y no como variante del enum a propósito: la
//! cadena es la que cruza el contrato hasta el frontend, y comparar contra `ErrorCode`
//! dejaría pasar un cambio de `as_str()` que rompiera el `switch` del constructor sin que
//! ninguna prueba se enterara.

use std::collections::HashMap;

use fintcart_simulator::domain::formula::ast::{Expr, InputKind, Schema};
use fintcart_simulator::domain::formula::eval::{evaluate, Scope};
use fintcart_simulator::domain::formula::limits;
use fintcart_simulator::domain::formula::parser::{parse, unavailable_as_field_name, Type};
use fintcart_simulator::domain::formula::FormulaError;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// Esquema de trabajo: los campos que una calculadora de ahorro declararía de verdad.
///
/// Se usa el mismo en casi todas las pruebas para que un fallo se lea como «esta fórmula»
/// y no como «este esquema montado para la ocasión».
fn schema() -> Schema {
    Schema::new(
        [
            ("monto", InputKind::Monto),
            ("deposito_inicial", InputKind::Monto),
            ("tasa_anual", InputKind::Tasa),
            ("inflacion_anual", InputKind::Tasa),
            ("meses", InputKind::Entero),
        ]
        .map(|(key, kind)| (key.to_owned(), kind)),
        ["UVT", "SMMLV"].map(str::to_owned),
    )
}

/// Analiza exigiendo un número, que es el caso de una salida.
fn parse_number(source: &str) -> Result<Expr, FormulaError> {
    parse(source, &schema(), Type::Number)
}

/// Analiza exigiendo una condición, que es el caso de una validación o un `cuando`.
fn parse_condition(source: &str) -> Result<Expr, FormulaError> {
    parse(source, &schema(), Type::Boolean)
}

/// Afirma que una fórmula numérica se rechaza con un código concreto.
fn rejected_with(source: &str, expected_code: &str) {
    match parse_number(source) {
        Ok(_) => panic!("la fórmula {source:?} debía rechazarse y se aceptó"),
        Err(err) => assert_eq!(
            err.code.as_str(),
            expected_code,
            "la fórmula {source:?} se rechazó, pero con el código equivocado: {}",
            err.message
        ),
    }
}

// ── 1. Campo inexistente ────────────────────────────────────────────────────

/// El error más frecuente al escribir una calculadora: una errata en el nombre de un campo.
#[test]
fn un_campo_no_declarado_se_rechaza_por_su_nombre() {
    rejected_with("ingreso_mensual * 2", "campo_inexistente");
    // Dentro de una función: el recorrido tiene que llegar igual de hondo.
    rejected_with("pot(mesess, 2)", "campo_inexistente");
    // Y dentro de `presente(…)`, cuyo argumento es un nombre y no una expresión.
    rejected_with("si(presente(aporte), 1, 0)", "campo_inexistente");
}

/// El mensaje tiene que nombrar el campo y, además, listar los declarados.
///
/// Una errata de una letra es lo más común que hay, y sin la lista el autor tiene que
/// subir a mirar sus entradas para descubrir que escribió `mesess`.
#[test]
fn el_mensaje_de_campo_inexistente_lista_los_declarados() {
    let err = parse("mesess * 2", &schema(), Type::Number).expect_err("debía rechazarse");
    assert!(err.message.contains("mesess"), "{}", err.message);
    assert!(err.message.contains("meses"), "{}", err.message);
}

// ── 2. Expresión mal formada ────────────────────────────────────────────────

#[test]
fn una_expresion_mal_formada_se_rechaza() {
    rejected_with("monto +", "expresion_mal_formada");
    rejected_with("(monto", "expresion_mal_formada");
    rejected_with("monto)", "expresion_mal_formada");
    rejected_with("monto + * 2", "expresion_mal_formada");
    rejected_with("", "expresion_mal_formada");
    rejected_with("monto $ 2", "expresion_mal_formada");
}

/// Las comparaciones no se encadenan, y el mensaje dice qué hacer en su lugar.
///
/// Sin esta comprobación, `a < b < c` se analizaría como `(a < b) < c` y el autor recibiría
/// un «tipo incompatible» —cierto pero inútil— en vez de la instrucción que necesita.
#[test]
fn las_comparaciones_no_se_encadenan() {
    let err = parse_condition("monto < 100 < 200").expect_err("debía rechazarse");
    assert_eq!(err.code.as_str(), "expresion_mal_formada");
    assert!(err.message.contains('y'), "{}", err.message);
}

/// Los operadores de dos caracteres se reconocen como uno solo.
///
/// Es el fallo que tendría un lexer que probara `<` antes de `<=`: `monto <= 5` se
/// convertiría en `<` seguido de un `=` que no es token válido, y el error hablaría del
/// `=`.
#[test]
fn los_operadores_de_dos_caracteres_se_leen_enteros() {
    for source in ["monto <= 5", "monto >= 5", "monto == 5", "monto != 5"] {
        parse_condition(source).unwrap_or_else(|err| panic!("{source:?} debía aceptarse: {err}"));
    }
}

// ── 3. Función desconocida ──────────────────────────────────────────────────

#[test]
fn una_funcion_que_no_existe_se_rechaza() {
    rejected_with("raiz(monto)", "funcion_desconocida");
    rejected_with("promedio(monto, 2)", "funcion_desconocida");
}

/// Una función conocida a la que le faltan los paréntesis se distingue de una inventada.
///
/// Las dos son errores, pero la corrección es distinta: aquí falta escribir `(…)`, y decir
/// «la función no existe» mandaría al autor a buscar una función que sí existe.
#[test]
fn una_funcion_sin_parentesis_no_se_confunde_con_una_inventada() {
    let err = parse_number("pot").expect_err("debía rechazarse");
    assert_eq!(err.code.as_str(), "expresion_mal_formada");
    assert!(err.message.contains("paréntesis"), "{}", err.message);
}

#[test]
fn una_funcion_con_la_aridad_equivocada_se_rechaza() {
    rejected_with("pot(monto)", "expresion_mal_formada");
    rejected_with("abs(monto, 2)", "expresion_mal_formada");
    rejected_with("redondear(monto, 2, 3)", "expresion_mal_formada");
}

// ── 4. Indicador desconocido ────────────────────────────────────────────────

#[test]
fn un_indicador_que_no_esta_en_el_catalogo_se_rechaza() {
    rejected_with("monto * @IPC", "indicador_desconocido");
    rejected_with("@TASA_USURA * 350", "indicador_desconocido");
    // Y el que SÍ está cargado se acepta, que es la otra mitad de la comprobación: si
    // todo se rechazara, la prueba pasaría por el motivo equivocado.
    parse_number("@UVT * 350").expect("@UVT está en el catálogo y debe aceptarse");
    parse_number("@SMMLV - 1").expect("@SMMLV está en el catálogo y debe aceptarse");
}

/// El mensaje de indicador desconocido lista los que sí están cargados.
#[test]
fn el_mensaje_de_indicador_desconocido_lista_los_cargados() {
    let err = parse_number("@IPC * 2").expect_err("debía rechazarse");
    assert!(err.message.contains("@IPC"), "{}", err.message);
    assert!(err.message.contains("@UVT"), "{}", err.message);
}

/// Sin ningún indicador cargado, el mensaje lo dice en vez de dejar la lista vacía.
///
/// Es el estado de una instalación recién levantada, antes de `dev/seed`, y el momento en
/// que el autor más necesita saber POR QUÉ su fórmula no se guarda.
#[test]
fn sin_indicadores_cargados_el_mensaje_lo_dice() {
    let err = parse("@UVT", &Schema::new([], []), Type::Number).expect_err("debía rechazarse");
    assert_eq!(err.code.as_str(), "indicador_desconocido");
    assert!(err.message.contains("todavía no hay"), "{}", err.message);
}

/// Un indicador en minúsculas no es «desconocido»: es inescribible.
///
/// La base impone `^[A-Z][A-Z0-9_]*$` sobre `financial_indicators.name`, así que `@uvt`
/// **nunca** podrá existir. Reportarlo como desconocido mandaría al autor a pedirle al
/// administrador que cargue un indicador que en realidad está cargado.
#[test]
fn un_indicador_en_minusculas_se_rechaza_por_su_forma() {
    let err = parse_number("monto * @uvt").expect_err("debía rechazarse");
    assert_eq!(err.code.as_str(), "expresion_mal_formada");
    assert!(err.message.contains("mayúsculas"), "{}", err.message);
}

/// Un `@` suelto es un error de forma, no un indicador llamado «».
#[test]
fn una_arroba_sin_nombre_se_rechaza() {
    rejected_with("monto * @", "expresion_mal_formada");
}

// ── 5. Exponente no entero en `pot` ─────────────────────────────────────────

/// El caso que D-15 usa para justificar que `pot` y `potd` sean funciones separadas.
#[test]
fn pot_rechaza_un_exponente_decimal() {
    rejected_with("pot(monto, 2.5)", "exponente_no_entero");
    rejected_with("pot(monto, 0.5)", "exponente_no_entero");
}

#[test]
fn pot_rechaza_un_exponente_negativo() {
    // Un exponente negativo obligaría a invertir y a dividir con resto, y convertiría en
    // aproximada una operación que existe para ser exacta.
    rejected_with("pot(monto, -2)", "exponente_no_entero");
}

/// Un campo de tipo `tasa` no sirve como exponente, aunque su valor sea entero.
///
/// Lo que se demuestra al guardar es el TIPO, no el valor: `tasa_anual = 0.24` hoy y
/// `0.2401` mañana. Aceptar por el valor de hoy sería aceptar una calculadora que se rompe
/// sola con el primer dato distinto.
#[test]
fn pot_rechaza_un_campo_que_no_es_entero() {
    rejected_with("pot(monto, tasa_anual)", "exponente_no_entero");
    rejected_with("pot(monto, inflacion_anual)", "exponente_no_entero");
}

/// Un campo declarado entero SÍ vale, que es la forma que usan las siete semillas.
#[test]
fn pot_acepta_un_campo_declarado_entero() {
    parse_number("pot(1.02, meses)").expect("un campo entero debe servir de exponente");
    parse_number("pot(monto, 12)").expect("un literal entero debe servir");
    // `x^0` es uno y es una operación legítima; el tope de periodos no aplica a `pot`.
    parse_number("pot(monto, 0)").expect("el exponente cero es válido");
}

/// Una expresión calculada no permite DEMOSTRAR que es entera, así que se rechaza.
#[test]
fn pot_rechaza_un_exponente_calculado() {
    rejected_with("pot(monto, meses / 12)", "exponente_no_entero");
    rejected_with("pot(monto, meses + 1)", "exponente_no_entero");
}

#[test]
fn las_demas_funciones_de_periodos_tambien_exigen_entero() {
    rejected_with("cuota(monto, 0.01, 2.5)", "exponente_no_entero");
    rejected_with("vf_serie(monto, 0.01, 2.5)", "exponente_no_entero");
    rejected_with("tasa_periodica(0.12, 2.5)", "exponente_no_entero");
    // Y con un campo entero sí se aceptan.
    parse_number("cuota(monto, 0.01, meses)").expect("cuota con un campo entero");
}

#[test]
fn redondear_exige_una_escala_literal() {
    rejected_with("redondear(monto, meses)", "expresion_mal_formada");
    rejected_with("redondear(monto, 2.5)", "expresion_mal_formada");
    // Dentro del rango admitido.
    parse_number("redondear(monto, 6)").expect("una escala válida");
    // Por encima de la capacidad de `Decimal`.
    rejected_with("redondear(monto, 40)", "limite_excedido");
}

// ── 6. Límites de nodos y profundidad (FR-046) ──────────────────────────────

/// Una fórmula con más de 64 nodos se rechaza al GUARDAR.
#[test]
fn una_formula_con_demasiados_nodos_se_rechaza() {
    // Cada término aporta dos nodos —el literal y la suma—, así que 40 términos pasan de
    // 64 de sobra.
    let source = vec!["1"; 40].join(" + ");
    rejected_with(&source, "limite_excedido");
}

/// Una fórmula que anida más de 16 niveles se rechaza al GUARDAR.
#[test]
fn una_formula_demasiado_anidada_se_rechaza() {
    let source = format!("{}1{}", "1 + (".repeat(20), ")".repeat(20));
    rejected_with(&source, "limite_excedido");
}

/// La distinción entre el tope del analizador y el de FR-046 se comprueba aquí.
///
/// Los paréntesis son **transparentes** en el árbol: `((((1))))` tiene un solo nodo y
/// profundidad 1. Si el tope de pila del analizador se usara como el límite del producto,
/// esta fórmula se rechazaría por incumplir un límite que en realidad no incumple.
#[test]
fn los_parentesis_de_mas_no_cuentan_como_profundidad() {
    let source = format!("{}1{}", "(".repeat(30), ")".repeat(30));
    let expr = parse_number(&source).expect("30 paréntesis no superan ningún límite de FR-046");
    let (nodes, depth) = limits::measure(&expr);
    assert_eq!(nodes, 1, "los paréntesis no crean nodos");
    assert_eq!(depth, 1, "los paréntesis no anidan el árbol");
}

/// El analizador SÍ tiene su propio tope de pila, y aborta antes de desbordarla.
///
/// Sin él, una cadena larga de paréntesis agotaría la pila **antes** de que
/// [`limits::check`] pudiera informar de nada, y el servicio se caería en lugar de
/// rechazar la fórmula.
#[test]
fn una_cadena_larguisima_de_parentesis_se_rechaza_sin_desbordar_la_pila() {
    let source = format!("{}1{}", "(".repeat(500), ")".repeat(500));
    rejected_with(&source, "limite_excedido");
}

/// Un árbol enorme construido con sumas tampoco desborda la pila.
///
/// Es el caso que obliga a llevar el presupuesto de nodos DURANTE el análisis y no solo a
/// medirlo después: liberar un `Box<Expr>` encadenado es recursivo, así que un árbol de
/// diez mil niveles desbordaría la pila al destruirse, fuera de toda guardia.
#[test]
fn una_suma_larguisima_se_rechaza_sin_desbordar_la_pila() {
    let source = vec!["1"; 5000].join(" + ");
    rejected_with(&source, "limite_excedido");
}

/// Los topes de FR-046 valen lo que dice el contrato.
#[test]
fn los_topes_de_fr_046_son_los_documentados() {
    assert_eq!(limits::MAX_NODES, 64);
    assert_eq!(limits::MAX_DEPTH, 16);
    assert_eq!(limits::MAX_INPUTS, 20);
    assert_eq!(limits::MAX_OUTPUTS, 10);
}

// ── 7. Tipos ────────────────────────────────────────────────────────────────

#[test]
fn una_condicion_no_se_puede_sumar() {
    rejected_with("monto + (monto > 0)", "tipo_incompatible");
}

#[test]
fn un_numero_no_vale_como_condicion() {
    rejected_with("si(monto, 1, 2)", "tipo_incompatible");
    rejected_with("monto y 1", "tipo_incompatible");
    rejected_with("no monto", "tipo_incompatible");
}

#[test]
fn una_condicion_no_vale_como_salida() {
    // El contexto lo pone quien llama: la misma expresión es correcta como validación y
    // un error como salida.
    parse_condition("monto > 0").expect("como validación es correcta");
    rejected_with("monto > 0", "tipo_incompatible");
}

#[test]
fn las_ramas_del_condicional_deben_coincidir() {
    rejected_with("si(monto > 0, 1, monto < 5)", "tipo_incompatible");
}

#[test]
fn las_comparaciones_comparan_numeros() {
    rejected_with("(monto > 0) > (monto < 5)", "tipo_incompatible");
}

// ── 8. Palabras reservadas y espacios de nombres ────────────────────────────

/// Las palabras del lenguaje no pueden usarse como campo, y se dice cuáles son.
#[test]
fn una_palabra_del_lenguaje_no_es_un_campo() {
    let err = parse_number("y + 1").expect_err("debía rechazarse");
    assert_eq!(err.code.as_str(), "expresion_mal_formada");
    assert!(
        err.message.contains("palabra del lenguaje"),
        "{}",
        err.message
    );
}

/// La lista que consulta el analizador es la misma que consultará T089.
#[test]
fn la_lista_de_nombres_no_usables_es_la_que_espera_la_validacion_de_definiciones() {
    for reserved in ["y", "o", "no", "si", "presente", "pot", "redondear"] {
        assert!(
            unavailable_as_field_name(reserved),
            "{reserved} no puede ser clave de un campo"
        );
    }
    for usable in ["monto", "meses", "tasa_anual", "aporte"] {
        assert!(
            !unavailable_as_field_name(usable),
            "{usable} sí puede ser clave de un campo"
        );
    }
}

/// Un campo y un indicador con el mismo nombre conviven sin confundirse.
///
/// Es la propiedad que D-15 promete: cargar un indicador nuevo nunca puede cambiar el
/// significado de una calculadora existente. Si la resolución de `meses` pudiera caer al
/// indicador homónimo, cargar ese indicador alteraría resultados ya publicados.
#[test]
fn un_campo_y_un_indicador_homonimos_son_valores_distintos() {
    let schema = Schema::new([("UVT".to_owned(), InputKind::Monto)], ["UVT".to_owned()]);

    let campo = parse("UVT", &schema, Type::Number).expect("el campo existe");
    let indicador = parse("@UVT", &schema, Type::Number).expect("el indicador existe");

    assert!(
        matches!(campo, Expr::Field { .. }),
        "«UVT» sin arroba debe resolverse al CAMPO"
    );
    assert!(
        matches!(indicador, Expr::Indicator { .. }),
        "«@UVT» debe resolverse al INDICADOR"
    );

    // Y evalúan a valores distintos, que es lo que de verdad importa.
    let fields: HashMap<String, Decimal> = [("UVT".to_owned(), dec!(100))].into_iter().collect();
    let indicators: HashMap<String, Decimal> =
        [("UVT".to_owned(), dec!(52374))].into_iter().collect();
    let supplied = std::collections::HashSet::from(["UVT".to_owned()]);
    let scope = Scope::new(&fields, &indicators, &supplied);

    assert_eq!(evaluate(&campo, &scope).expect("evalúa"), dec!(100));
    assert_eq!(evaluate(&indicador, &scope).expect("evalúa"), dec!(52374));
}

// ── 9. Construcción del árbol ───────────────────────────────────────────────

/// La precedencia es la que dice la tabla del módulo.
#[test]
fn la_precedencia_es_la_documentada() {
    // `*` antes que `+`.
    let expr = parse_number("1 + 2 * 3").expect("válida");
    assert!(
        matches!(expr, Expr::Add { .. }),
        "2 * 3 debe agruparse primero"
    );

    // El menos unario se aplica al literal, no a la suma.
    let expr = parse_number("-1 + 2").expect("válida");
    assert!(matches!(expr, Expr::Add { .. }), "«-1» es un operando");

    // `no` se aplica a la comparación entera.
    let expr = parse_condition("no monto == 5").expect("válida");
    assert!(
        matches!(expr, Expr::Not { .. }),
        "«no monto == 5» debe leerse como no (monto == 5)"
    );
}

/// `-5` y `- 5` producen el MISMO árbol.
///
/// Dos formas de escribir lo mismo con dos árboles distintos haría que dos calculadoras
/// idénticas en apariencia guardaran definiciones diferentes, y que el resultado de una
/// simulación histórica dependiera de cómo se escribió el espacio.
#[test]
fn el_signo_unario_no_depende_del_espaciado() {
    let junto = parse_number("-5").expect("válida");
    let separado = parse_number("- 5").expect("válida");
    assert_eq!(junto, separado);
}

/// Los indicadores usados se extraen ordenados y sin repetir (T086).
#[test]
fn los_indicadores_usados_se_extraen_del_arbol() {
    let expr = parse_number("@UVT * 350 + @SMMLV - @UVT").expect("válida");
    assert_eq!(expr.indicators_used(), vec!["SMMLV", "UVT"]);

    // El orden de escritura no cambia la lista: dos versiones de una definición que solo
    // se diferencian en el orden de los indicadores deben producir la misma columna.
    let otra = parse_number("@SMMLV - @UVT + @UVT * 350").expect("válida");
    assert_eq!(otra.indicators_used(), expr.indicators_used());

    // Y una fórmula sin indicadores no inventa ninguno.
    let sin = parse_number("monto * 2").expect("válida");
    assert!(sin.indicators_used().is_empty());
}
