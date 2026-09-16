//! Las **siete definiciones semilla** que sustituyen a las cinco calculadoras nativas
//! (FR-019, FR-049; research D-16).
//!
//! ## Por qué siete y no cinco
//!
//! Las cinco de FR-019 se resiembran como siete porque la quinta —«específicas del contexto
//! colombiano»— no era una calculadora sino tres, seleccionadas por el parámetro de texto
//! `operacion` (`colombia.rs:62`). Separarlas en `ea_a_mv`, `mv_a_ea` y `gmf` es lo que
//! elimina **la única entrada de texto del sistema** y deja el lenguaje de fórmulas
//! puramente numérico (D-16, hallazgo 4). No es una desviación del alcance: FR-019 dice
//! «calculadoras», en plural.
//!
//! ## Por qué son DATOS y no código
//!
//! Las semillas se escriben como [`Draft`] —el mismo tipo que produce el formulario del
//! constructor— y se analizan con [`Draft::parse`], exactamente como las de un usuario. Si
//! se escribieran como `Definition` directas, con los AST a mano, las semillas **no pasarían
//! por las mismas comprobaciones que todo lo demás**: una semilla con dos campos homónimos
//! o con una expresión fuera de los límites de FR-046 se guardaría por la puerta de atrás y
//! nadie lo notaría hasta ejecutarla. Escribirlas en el mismo lenguaje que escribe el usuario
//! es lo que hace que el motor se pruebe a sí mismo con su propio contenido.
//!
//! ## El contrato que las ata al código nativo
//!
//! FR-049 exige que las semillas reproduzcan **resultado a resultado** lo que hoy hacen
//! `crate::calculators::*`. Eso obliga a dos cosas que no son evidentes leyendo una fórmula
//! suelta:
//!
//! 1. **Usar la misma función exacta donde el nativo la usa.** `ahorro` y `credito` elevan
//!    con `pot` porque `annuity::growth_factor` usa `checked_powu`; `ea_a_mv` usa `potd`
//!    porque `colombia::effective_to_nominal` usa `checked_powd`. Cambiar una por la otra
//!    da un resultado plausible y distinto.
//! 2. **Respetar el ORDEN de las operaciones.** En decimal, dividir trunca a la escala
//!    máxima; reagrupar una expresión puede mover el último dígito. Por eso las fórmulas de
//!    aquí están escritas en el mismo orden en que las evalúa el código nativo, y por eso
//!    `inversion` comparte una única definición del valor futuro entre sus dos salidas que lo
//!    usan, en vez de repetir la expresión.
//!
//! `tests/seed_regression.rs` (T092) es la prueba que sostiene ese contrato: compara el
//! motor contra el código nativo sobre rangos de uso y casos de borde. **Es la puerta de
//! FR-049**: `src/calculators/` no se elimina (T098) hasta que pase.

use std::collections::BTreeSet;

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::domain::definition::{
    Definition, Draft, DraftOutput, DraftValidation, InputField, Issue,
};
use crate::domain::formula::ast::InputKind;

pub mod colombia;
pub mod generales;

/// Identificador estable de una semilla, en `calculators.id` (T095).
///
/// Las siete viven en un bloque fijo y consecutivo —`…-00000000e001` a `…-00000000e007`— en
/// lugar de recibir un `gen_random_uuid()` como cualquier calculadora. La razón no es la
/// comodidad: `dev/seed` es idempotente y el relleno del historial de T020 empareja las
/// simulaciones viejas con las semillas **por nombre**, así que un identificador aleatorio
/// haría que una segunda ejecución creara un juego nuevo de semillas y dejara el historial
/// apuntando a la copia que ya nadie actualiza.
///
/// Se construye desde la POSICIÓN en la lista y no desde el nombre para que el bloque sea
/// legible en la base: un `…e003` en `calculators.id` es una semilla de la plataforma y no la
/// calculadora de alguien.
///
/// El parámetro es `u16` y el bloque reserva los dígitos bajos, así que la posición no puede
/// desbordar hacia el `e` que lo identifica.
const fn seed_id(posicion: u16) -> Uuid {
    Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_e000 | posicion as u128)
}

/// Indicadores que la plataforma siembra (T095) y que una semilla puede referenciar.
///
/// Es la lista de nombres **conocidos sin consultar la base**, y existe porque las semillas
/// se analizan en pruebas y en el sembrado sin conexión a un catálogo. Sin ella habría que
/// analizar una semilla contra los indicadores que ella misma declara usar, y entonces una
/// errata (`@UV` por `@UVT`) sería aceptada por el catálogo que la errata acaba de definir.
///
/// Los cinco nombres son los del catálogo de indicadores (`data-model.md`); de momento solo
/// `gmf` usa uno, pero la lista es del catálogo entero y no de lo que hoy se consume.
pub const INDICATORS: [&str; 5] = ["IPC", "SMMLV", "TASA_USURA", "UVR", "UVT"];

/// Una semilla todavía en texto, antes de analizarse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seed {
    /// Identificador estable de la fila. Ver [`seed_id`].
    pub id: Uuid,
    /// Nombre con el que se persiste y con el que se referencia desde `Compute`.
    pub name: &'static str,
    /// Descripción que ve el usuario en el catálogo.
    pub description: &'static str,
    /// La definición sin analizar.
    pub draft: Draft,
}

/// Una semilla ya analizada, lista para persistir y para ejecutar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Compiled {
    /// Identificador estable con el que se siembra y se cita desde `simulations`.
    pub id: Uuid,
    /// Nombre de la semilla.
    pub name: &'static str,
    /// Descripción visible.
    pub description: &'static str,
    /// Definición con AST, validada por las mismas reglas que la de un usuario.
    pub definition: Definition,
}

/// Los problemas de UNA semilla.
///
/// Lleva el nombre de la semilla porque un `Issue` dice `outputs[1].expression` y, sin el
/// nombre, un fallo en el arranque no diría **cuál de las siete** definiciones está mal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedError {
    /// Semilla que no analizó.
    pub seed: &'static str,
    /// Todos sus problemas, no solo el primero.
    pub issues: Vec<Issue>,
}

/// Las siete semillas en texto, en el orden en que se listan al usuario.
///
/// El identificador se pasa en la MISMA línea que el constructor y no se asigna después: así
/// no existe una semilla sin identificador, ni un identificador sin semilla, ni una lista
/// paralela de la que alguien pueda olvidarse.
#[must_use]
pub fn drafts() -> Vec<Seed> {
    vec![
        generales::ahorro(seed_id(1)),
        generales::credito(seed_id(2)),
        generales::presupuesto(seed_id(3)),
        generales::inversion(seed_id(4)),
        colombia::ea_a_mv(seed_id(5)),
        colombia::mv_a_ea(seed_id(6)),
        colombia::gmf(seed_id(7)),
    ]
}

/// Analiza las siete semillas contra el catálogo de [`INDICATORS`].
///
/// Devuelve **todas** las semillas que fallan, no la primera: un cambio en el lenguaje de
/// fórmulas que rompiera una construcción rompería las que la usan, y descubrirlas de una en
/// una convertiría una tarde de trabajo en siete.
///
/// # Errores
///
/// Los [`Issue`] de cada semilla que no analiza. Que esto ocurra en tiempo de ejecución es
/// un fallo del programa y no una entrada del usuario —las semillas son constantes del
/// binario—, así que el llamador debe tratarlo como tal; lo que **no** debe es ignorarlo y
/// arrancar con seis calculadoras de siete.
pub fn compile() -> Result<Vec<Compiled>, Vec<SeedError>> {
    let catalog: BTreeSet<String> = INDICATORS.iter().map(|name| (*name).to_owned()).collect();

    let mut compiled = Vec::new();
    let mut failures = Vec::new();

    for seed in drafts() {
        match seed.draft.parse(&catalog) {
            Ok(definition) => compiled.push(Compiled {
                id: seed.id,
                name: seed.name,
                description: seed.description,
                definition,
            }),
            Err(issues) => failures.push(SeedError {
                seed: seed.name,
                issues,
            }),
        }
    }

    if failures.is_empty() {
        Ok(compiled)
    } else {
        Err(failures)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructores de campos y fórmulas
//
// Las semillas son DATOS y se leen como una tabla; estos ayudantes existen para que cada
// campo quepa en una línea y lo que se vea sea la definición y no la construcción de una
// estructura de ocho campos. Los mismos nombres que usan los ayudantes de `tests/definition.rs`
// y `tests/calculators.rs`, para que leer una prueba y leer una semilla no exija dos
// vocabularios.
// ─────────────────────────────────────────────────────────────────────────────

/// Un campo de entrada sin cota ni valor por defecto.
fn campo(key: &str, label: &str, kind: InputKind, unit: &str, required: bool) -> InputField {
    InputField {
        key: key.to_owned(),
        label: label.to_owned(),
        kind,
        unit: unit.to_owned(),
        min: None,
        max: None,
        default: None,
        required,
    }
}

/// Monto obligatorio, en pesos.
fn monto(key: &str, label: &str) -> InputField {
    campo(key, label, InputKind::Monto, "COP", true)
}

/// Monto opcional que vale cero cuando no se envía.
///
/// El valor por defecto es explícito y no dejado al «ausente vale cero» de
/// [`crate::domain::definition::Definition::run`]: los dos dan el mismo número, pero el
/// explícito aparece en el formulario prerrellenado y hace visible que el campo es opcional.
fn monto_opcional(key: &str, label: &str) -> InputField {
    let mut field = campo(key, label, InputKind::Monto, "COP", false);
    field.default = Some(Decimal::ZERO);
    field
}

/// Tasa obligatoria, expresada como FRACCIÓN (el 12 % se escribe `0.12`).
///
/// La unidad dice «fracción» y no «%» a propósito: el usuario ve la unidad junto al campo, y
/// un campo rotulado `%` que espera `0.12` es exactamente el error de lectura que
/// `presupuesto.rs` documenta para las tasas. Ver `Inputs::rate`.
fn tasa(key: &str, label: &str) -> InputField {
    campo(key, label, InputKind::Tasa, "fracción", true)
}

/// Tasa opcional sin valor por defecto: ausente significa «no se pidió», no «vale cero».
///
/// La distinción es la que sostiene la salida condicional de `inversion`: una inflación del
/// 0 % es una afirmación sobre el escenario y su ausencia es otra cosa.
fn tasa_opcional(key: &str, label: &str) -> InputField {
    campo(key, label, InputKind::Tasa, "fracción", false)
}

/// Entero obligatorio acotado.
///
/// La cota superior es una barrera de representabilidad, no una regla de negocio: más allá
/// de [`MAX_PERIODS`] el factor de capitalización desborda la mantisa de 96 bits. Está
/// declarada como rango para que el rechazo ocurra ANTES de evaluar y con el nombre del
/// campo, en vez de aparecer como un desbordamiento del motor.
///
/// [`MAX_PERIODS`]: crate::domain::inputs::MAX_PERIODS
fn entero(key: &str, label: &str, unit: &str, max: u32) -> InputField {
    let mut field = campo(key, label, InputKind::Entero, unit, true);
    field.min = Some(Decimal::ONE);
    field.max = Some(Decimal::from(max));
    field
}

/// Entero opcional acotado, con su valor por defecto.
fn entero_opcional(key: &str, label: &str, unit: &str, min: u32, max: u32) -> InputField {
    let mut field = campo(key, label, InputKind::Entero, unit, false);
    field.min = Some(Decimal::from(min));
    field.max = Some(Decimal::from(max));
    field.default = Some(Decimal::from(min));
    field
}

/// Regla de dominio, con la expresión todavía en texto.
fn regla(expression: &str, message: &str) -> DraftValidation {
    DraftValidation {
        expression: expression.to_owned(),
        message: message.to_owned(),
    }
}

/// Salida incondicional, a la escala indicada.
fn salida(key: &str, label: &str, expression: &str, scale: u32) -> DraftOutput {
    DraftOutput {
        key: key.to_owned(),
        label: label.to_owned(),
        expression: expression.to_owned(),
        scale,
        when: None,
    }
}

/// Salida que se OMITE cuando su condición no se cumple.
///
/// Omitir no es devolver cero: `inversion` solo emite `valor_futuro_real` si se suministró
/// la inflación, y devolverlo siempre con inflación cero implícita sugeriría que se descontó
/// algo cuando no se descontó nada (`inversion.rs:78`).
fn salida_condicional(
    key: &str,
    label: &str,
    expression: &str,
    scale: u32,
    when: &str,
) -> DraftOutput {
    DraftOutput {
        key: key.to_owned(),
        label: label.to_owned(),
        expression: expression.to_owned(),
        scale,
        when: Some(when.to_owned()),
    }
}
