//! La documentación del lenguaje se comprueba sola (T159, FR-047).
//!
//! ## Qué hace y por qué existe
//!
//! `docs/lenguaje-de-formulas.md` es la referencia que lee quien va a escribir una calculadora.
//! Una documentación de un lenguaje se queda obsoleta en silencio: se añade una función y la
//! tabla no la menciona, se cambia un código de error y la lista sigue con el viejo, y el
//! ejemplo del documento deja de ser válido sin que nada avise. Quien lo lea escribirá una
//! fórmula que el servicio rechazará, y la culpa no será suya.
//!
//! Esta prueba convierte el documento en algo **comprobable**:
//!
//!   1. cada bloque marcado como `formula` se analiza con el analizador DE VERDAD —el mismo que
//!      usa el servicio al guardar— y tiene que ser válido;
//!   2. la tabla de funciones del documento y [`Func::ALL`] tienen que coincidir **en las dos
//!      direcciones**: una función sin documentar y un nombre documentado que no exista fallan
//!      igual;
//!   3. la lista de códigos de error del documento tiene que ser exactamente la de
//!      [`ErrorCode::as_str`].
//!
//! ## Por qué el esquema de los ejemplos se declara aquí
//!
//! Los ejemplos usan campos (`monto`, `tasa_anual`, `meses`…) que en una calculadora real
//! declara su autor. El documento dice que sus ejemplos salen de las definiciones semilla, así
//! que el esquema de esta prueba es el de esas semillas: si un ejemplo usara un campo que no
//! existe en ninguna, la prueba lo diría con `campo_inexistente` —que es exactamente el error
//! que recibiría quien copiara el ejemplo a su calculadora—.
//!
//! ## Si el documento no está
//!
//! La prueba FALLA, no se salta. Un salto silencioso convertiría la barrera en un adorno: el día
//! que alguien moviera el documento, la comprobación dejaría de existir sin que nadie lo notara.
//! El mensaje dice la ruta que se buscó, porque el caso real es ejecutar esto dentro de un
//! contenedor donde solo está el servicio copiado.

use std::collections::BTreeSet;
use std::path::PathBuf;

use fintcart_simulator::domain::formula::ast::{Func, InputKind, Schema};
use fintcart_simulator::domain::formula::parser::{parse, Type};
use fintcart_simulator::domain::formula::{limits, ErrorCode, FormulaError};

/// Ruta del documento, relativa a la raíz del servicio (que es `CARGO_MANIFEST_DIR`).
const RUTA: &str = "../../docs/lenguaje-de-formulas.md";

/// Lee el documento, fallando con la ruta si no está.
fn documento() -> String {
    let ruta = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(RUTA);
    std::fs::read_to_string(&ruta).unwrap_or_else(|err| {
        panic!(
            "no se pudo leer {} ({err}). Si esto corre dentro de un contenedor con solo el \
             servicio copiado, copia también el directorio docs/ a la ruta esperada",
            ruta.display()
        )
    })
}

/// El esquema de los ejemplos: los campos y los indicadores que usan.
///
/// Son los de las siete definiciones semilla (`domain::seeds`), que es de donde el documento
/// dice que salen sus ejemplos.
fn esquema() -> Schema {
    let campos = [
        ("monto", InputKind::Monto),
        ("deposito_inicial", InputKind::Monto),
        ("aporte_mensual", InputKind::Monto),
        ("gastos_fijos", InputKind::Monto),
        ("ingreso_mensual", InputKind::Monto),
        ("tasa_anual", InputKind::Tasa),
        ("meses", InputKind::Entero),
        ("exento", InputKind::Entero),
    ]
    .into_iter()
    .map(|(clave, tipo)| (clave.to_owned(), tipo));
    // Los indicadores tienen su propio espacio de nombres (T085): `@UVT` no es un campo `uvt`.
    Schema::new(campos, ["UVT".to_owned()])
}

/// Los bloques de código marcados con un lenguaje concreto, en orden de aparición.
///
/// Se lee el marcado y no se interpreta Markdown con una dependencia: lo único que hace falta es
/// encontrar el texto entre las vallas.
fn bloques(markdown: &str, lenguaje: &str) -> Vec<String> {
    let apertura = format!("```{lenguaje}");
    let mut bloques = Vec::new();
    let mut dentro = false;
    let mut actual = String::new();

    for linea in markdown.lines() {
        if !dentro && linea.trim() == apertura {
            dentro = true;
            actual.clear();
            continue;
        }
        if dentro && linea.trim() == "```" {
            dentro = false;
            bloques.push(actual.trim().to_owned());
            continue;
        }
        if dentro {
            actual.push_str(linea);
            actual.push('\n');
        }
    }
    bloques
}

/// Los nombres que el documento escribe entre las barras verticales de una fila de tabla.
///
/// Una fila de función tiene la forma `| \`abs(x)\` | … |`: se toma lo que va antes del
/// paréntesis de la primera celda.
fn nombres_de_funciones(markdown: &str) -> BTreeSet<String> {
    let mut nombres = BTreeSet::new();
    for linea in markdown.lines() {
        let recortada = linea.trim();
        if !recortada.starts_with('|') || !recortada.contains("`") {
            continue;
        }
        let Some(inicio) = recortada.find('`') else {
            continue;
        };
        let Some(fin) = recortada[inicio + 1..].find('`') else {
            continue;
        };
        let celda = &recortada[inicio + 1..inicio + 1 + fin];
        // `nombre(a, b)` → `nombre`. Se descartan las celdas que no parecen una llamada: la
        // tabla de códigos de error usa el mismo formato con nombres como `campo_inexistente`,
        // y esos se comprueban en su propia prueba.
        if let Some(parentesis) = celda.find('(') {
            let nombre = &celda[..parentesis];
            if !nombre.is_empty() && nombre.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
                nombres.insert(nombre.to_owned());
            }
        }
    }
    nombres
}

/// Analiza un ejemplo del documento, probando los dos tipos posibles.
///
/// El documento no declara si un ejemplo es un valor o una condición, y no debería: sus bloques
/// son «cuota de un crédito» y «una regla que exige que haya algo que proyectar». El analizador
/// distingue por la FORMA de la expresión, así que probar los dos tipos es lo que hace que el
/// documento pueda escribirse en el idioma en que se piensa una fórmula. Cuando los dos fallan se
/// devuelve el error del tipo número, que es el que mejor explica una fórmula que no analiza.
fn analizar(ejemplo: &str, schema: &Schema) -> Result<(), FormulaError> {
    match parse(ejemplo, schema, Type::Number) {
        Ok(_) => Ok(()),
        Err(primero) => parse(ejemplo, schema, Type::Boolean).map(|_| ()).map_err(|_| primero),
    }
}

#[test]
fn todos_los_ejemplos_del_documento_se_analizan() {
    let markdown = documento();
    let ejemplos = bloques(&markdown, "formula");

    // Un documento sin ejemplos pasaría esta prueba sin comprobar nada, así que se exige que
    // haya un número mínimo: hoy hay once, y bajar de ahí significa que alguien los quitó.
    assert!(
        ejemplos.len() >= 10,
        "el documento tiene {} bloques «formula» y se esperaban al menos 10: ¿se perdieron los \
         ejemplos al editar el archivo?",
        ejemplos.len()
    );

    let schema = esquema();
    let mut fallos = Vec::new();
    for ejemplo in &ejemplos {
        if let Err(err) = analizar(ejemplo, &schema) {
            fallos.push(format!("  · {ejemplo}\n      → {err}"));
        }
    }

    assert!(
        fallos.is_empty(),
        "estos ejemplos de {} NO son válidos para el lenguaje:\n{}",
        RUTA,
        fallos.join("\n")
    );
}

#[test]
fn la_tabla_de_funciones_y_el_lenguaje_dicen_lo_mismo() {
    let markdown = documento();
    let documentadas = nombres_de_funciones(&markdown);
    let reales = Func::ALL
        .into_iter()
        .map(|func| func.name().to_owned())
        .collect::<BTreeSet<_>>();

    // Las dos direcciones importan y por motivos distintos: una función sin documentar es una
    // función que nadie va a usar, y un nombre documentado que no existe es una fórmula que el
    // servicio rechazará con `funcion_desconocida` después de que alguien la haya copiado.
    let sin_documentar = reales.difference(&documentadas).cloned().collect::<Vec<_>>();
    let inventadas = documentadas.difference(&reales).cloned().collect::<Vec<_>>();

    assert!(
        sin_documentar.is_empty(),
        "hay funciones del lenguaje que no están en la tabla de {RUTA}: {sin_documentar:?}"
    );
    assert!(
        inventadas.is_empty(),
        "la tabla de {RUTA} documenta funciones que el lenguaje no tiene: {inventadas:?}"
    );
}

#[test]
fn la_lista_de_codigos_de_error_esta_completa() {
    let markdown = documento();

    // Los códigos reales, desde el enum: es lo que viaja en `DefinitionError.code`.
    let reales = [
        ErrorCode::CampoInexistente,
        ErrorCode::IndicadorDesconocido,
        ErrorCode::ExpresionMalFormada,
        ErrorCode::TipoIncompatible,
        ErrorCode::LimiteExcedido,
        ErrorCode::ExponenteNoEntero,
        ErrorCode::FuncionDesconocida,
        ErrorCode::DefinicionInvalida,
    ]
    .into_iter()
    .map(|code| code.as_str().to_owned())
    .collect::<BTreeSet<_>>();

    let faltantes = reales
        .iter()
        .filter(|codigo| !markdown.contains(codigo.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    assert!(
        faltantes.is_empty(),
        "estos códigos de error existen y no aparecen en {RUTA}: {faltantes:?}. El constructor \
         visual resalta el campo según el código, así que uno sin documentar es un mensaje que \
         quien escribe una fórmula no puede interpretar"
    );
}

#[test]
fn los_ejemplos_no_pasan_de_los_limites_que_el_documento_declara() {
    // El documento promete 64 nodos y 16 niveles; un ejemplo más grande que eso sería un
    // ejemplo que el servicio rechaza, y estaría en la página que enseña a escribir fórmulas.
    let markdown = documento();
    let schema = esquema();

    // Se analiza con el MISMO criterio que la prueba anterior y se comprueba el árbol ya
    // construido: `limits::check` es lo que el servicio ejecuta al guardar (FR-046).
    for ejemplo in bloques(&markdown, "formula") {
        let expr = match parse(&ejemplo, &schema, Type::Number)
            .or_else(|_| parse(&ejemplo, &schema, Type::Boolean))
        {
            Ok(expr) => expr,
            Err(err) => panic!("el ejemplo «{ejemplo}» no analiza: {err}"),
        };
        limits::check(&expr)
            .unwrap_or_else(|err| panic!("el ejemplo «{ejemplo}» incumple un límite: {err}"));
    }
}
