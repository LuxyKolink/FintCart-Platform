//! Pruebas de que el motor de fórmulas no alcanza NINGÚN punto flotante (T078, Principio
//! VIII).
//!
//! ## Por qué hace falta una prueba si clippy ya lo prohíbe
//!
//! `clippy.toml` declara `f32` y `f64` como tipos vetados, y `#![deny(clippy::disallowed_types)]`
//! está en la raíz de la librería y del binario. Esa regla es la primera barrera y es
//! buena: impide *nombrar* un flotante.
//!
//! Pero no ve las vías **indirectas**, que son las que de verdad aparecen al escribir
//! código decimal:
//!
//! - `valor.to_f64()` — el nombre del tipo no aparece en ningún sitio del código propio,
//!   está en la firma de la biblioteca.
//! - `Decimal::from_f64(x)` — igual.
//! - `use num_traits::Float;` — la regla veta TIPOS, y `Float` es un trait.
//! - `let x = 1.5;` — un literal decimal sin anotación de tipo se infiere como `f64`, y
//!   tampoco nombra nada.
//!
//! Ninguna de las cuatro la detiene clippy, y las cuatro introducen una pérdida de
//! precisión que el Principio VIII prohíbe. Esta prueba las cubre.
//!
//! ## Lo que esta prueba NO es
//!
//! No es un analizador de Rust. Quita comentarios y literales de cadena con un
//! desplazador de estados y busca subcadenas; no entiende de tipos ni de ámbitos. Sirve
//! para lo que sirve: que añadir `to_f64()` al motor exija borrar una prueba que dice por
//! qué no se hace, en vez de pasar inadvertido.

use std::fs;
use std::path::{Path, PathBuf};

/// Directorio del motor, relativo a la raíz del paquete.
const ENGINE_DIR: &[&str] = &["src", "domain", "formula"];

/// Vías indirectas al punto flotante, en el código ya sin comentarios ni cadenas.
///
/// `f32` y `f64` cubren por sí solos casi todo —`to_f64`, `from_f64`, `as f64`,
/// `f64::consts` los contienen—, pero se listan aparte los casos que se le escapan a esa
/// subcadena para que la lista se lea como lo que es: un inventario de las formas
/// conocidas de llegar a un flotante, no una expresión regular afortunada.
const FORBIDDEN: &[&str] = &["f32", "f64", "Float", "to_float", "from_float"];

/// Quita comentarios y literales de cadena.
///
/// Es imprescindible y no un refinamiento: **este mismo módulo explica en sus comentarios
/// qué tipos están prohibidos**, así que sin quitarlos la prueba fallaría por su propia
/// documentación. Es el primer obstáculo que habría tenido la prueba y conviene que esté
/// resuelto de forma visible.
///
/// Limitaciones conocidas y deliberadas: no trata los comentarios de bloque anidados ni
/// los literales de carácter (`'/'`). Ninguno de los dos aparece en este módulo, y
/// soportarlos costaría más de lo que aporta a una comprobación que ya es una red de
/// seguridad y no un analizador.
fn strip_comments_and_strings(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut in_string = false;

    while let Some(current) = chars.next() {
        if in_line_comment {
            if current == '\n' {
                in_line_comment = false;
                out.push('\n');
            }
            continue;
        }
        if in_block_comment {
            if current == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }
        if in_string {
            if current == '\\' {
                chars.next();
            } else if current == '"' {
                in_string = false;
            }
            continue;
        }

        match current {
            '/' if chars.peek() == Some(&'/') => {
                chars.next();
                in_line_comment = true;
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                in_block_comment = true;
            }
            '"' => in_string = true,
            _ => out.push(current),
        }
    }

    out
}

/// Busca un literal decimal de coma flotante.
///
/// En Rust, `let x = 1.5;` sin anotación de tipo se infiere como `f64`. Es la vía más
/// silenciosa de todas: el código no nombra ningún tipo vetado, compila, y el valor pierde
/// exactitud. En este módulo cualquier `d.d` es un error, porque `Decimal` no tiene
/// literales — se construye con constantes (`Decimal::ONE`) o desde texto.
fn find_float_literal(code: &str) -> Option<String> {
    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }

        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }

        if i >= chars.len() || chars[i] != '.' {
            continue;
        }
        // `1..=2` es un rango: el segundo punto lo delata.
        if chars.get(i + 1) == Some(&'.') {
            continue;
        }

        let mut end = i + 1;
        while end < chars.len() && chars[end].is_ascii_digit() {
            end += 1;
        }
        return Some(chars[start..end].iter().collect());
    }

    None
}

/// Ficheros `.rs` del motor.
fn engine_sources() -> Vec<PathBuf> {
    let dir = ENGINE_DIR.iter().fold(
        Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf(),
        |path, part| path.join(part),
    );

    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("no se pudo leer {}: {err}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    // Orden estable: un fallo que nombra ficheros debe leerse igual en dos ejecuciones.
    files.sort();
    files
}

/// Ningún fichero del motor nombra ni alcanza un punto flotante.
#[test]
fn el_motor_no_alcanza_ningun_flotante() {
    let sources = engine_sources();

    // La guardia contra el falso verde: una prueba que recorre cero ficheros pasa siempre.
    // Si alguien mueve el módulo, esta afirmación falla antes que la de abajo pase en vacío.
    assert!(
        sources.len() >= 6,
        "se esperaban al menos 6 ficheros en src/domain/formula y se encontraron {}: {:?}",
        sources.len(),
        sources
    );

    for path in &sources {
        let raw = fs::read_to_string(path)
            .unwrap_or_else(|err| panic!("no se pudo leer {}: {err}", path.display()));
        let code = strip_comments_and_strings(&raw);
        let name = path.file_name().unwrap_or_default().to_string_lossy();

        for forbidden in FORBIDDEN {
            assert!(
                !code.contains(forbidden),
                "{name} contiene «{forbidden}» fuera de comentarios y cadenas. \
                 El Principio VIII prohíbe el punto flotante para dinero y tasas (NON-NEGOTIABLE)."
            );
        }

        if let Some(literal) = find_float_literal(&code) {
            panic!(
                "{name} contiene el literal decimal «{literal}», que Rust infiere como f64. \
                 Usa rust_decimal::Decimal: no tiene literales, se construye con sus \
                 constantes o desde texto."
            );
        }
    }
}

/// La comprobación de arriba MIDE algo: sin esto, un `strip_comments_and_strings` que lo
/// borrara todo —o un `find_float_literal` que nunca encontrara nada— pasaría inadvertido.
#[test]
fn las_comprobaciones_detectan_lo_que_dicen_detectar() {
    // Quitar comentarios y cadenas: lo que queda es el código.
    let stripped = strip_comments_and_strings(
        r#"
        // Un comentario que menciona f64 y 1.5
        /* Otro bloque, también con f32 */
        let mensaje = "una cadena con f64 y 2.5";
        let valor = Decimal::ONE;
        "#,
    );
    assert!(
        !stripped.contains("f64"),
        "los comentarios y cadenas deben desaparecer"
    );
    assert!(
        stripped.contains("Decimal::ONE"),
        "el código debe sobrevivir"
    );

    // …y la búsqueda encuentra un flotante real en el código que queda.
    let con_flotante = strip_comments_and_strings("let x = 1.5; // f64\n");
    assert_eq!(
        find_float_literal(&con_flotante),
        Some("1.5".to_owned()),
        "un literal decimal debe detectarse"
    );

    // Y no confunde un entero, un rango ni un acceso a campo con un literal decimal.
    for innocuous in ["let n = 12;", "for i in 0..=28 {}", "self.position += 1;"] {
        assert_eq!(
            find_float_literal(innocuous),
            None,
            "{innocuous:?} no es un literal decimal"
        );
    }
}

/// La regla de clippy sigue declarada, y en los dos sitios donde hace falta.
///
/// `clippy.toml` declara los tipos vetados, pero la SEVERIDAD se fija en la raíz de cada
/// crate, y la librería y el binario son crates distintos (`Cargo.toml` los declara
/// separados). Quitar una de las dos líneas dejaría medio crate sin la comprobación y nada
/// fallaría, porque clippy avisa pero no rompe la compilación si la severidad se perdió.
#[test]
fn la_regla_de_clippy_que_declara_los_tipos_vetados_sigue_en_su_sitio() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));

    let clippy = fs::read_to_string(root.join("clippy.toml"))
        .expect("clippy.toml debe existir: es donde se declaran los tipos vetados");
    assert!(
        clippy.contains("disallowed-types"),
        "clippy.toml debe declarar la lista"
    );
    assert!(clippy.contains("\"f32\""), "clippy.toml debe vetar f32");
    assert!(clippy.contains("\"f64\""), "clippy.toml debe vetar f64");

    for crate_root in ["src/lib.rs", "src/main.rs"] {
        let source = fs::read_to_string(root.join(crate_root))
            .unwrap_or_else(|err| panic!("{crate_root} debe existir: {err}"));
        assert!(
            source.contains("deny(clippy::disallowed_types)"),
            "{crate_root} debe fijar la severidad: clippy.toml solo declara los tipos, \
             y lib y bin son crates distintos"
        );
    }
}
