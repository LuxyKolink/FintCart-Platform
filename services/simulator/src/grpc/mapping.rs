//! Mapeo proto ↔ dominio (Principio IX regla 3: la conversión ocurre en la frontera,
//! y solo ahí).
//!
//! Los tipos generados por `tonic` NO cruzan hacia `domain` ni hacia `repo`, y los
//! tipos de esos módulos no aparecen en la respuesta sin pasar por aquí. La razón
//! práctica: `ComputeResponse` y [`crate::repo::simulations::SimulationRow`] contienen
//! casi los mismos campos, y en cuanto uno se usa en lugar del otro, un cambio del
//! `.proto` empieza a propagarse hasta el SQL.
//!
//! Aquí se convierte texto ↔ [`rust_decimal::Decimal`] únicamente para los valores
//! DECLARADOS de una calculadora —el mínimo, el máximo y el valor por defecto de cada
//! entrada—, y se hace llamando a `domain::definition::parse_value`, que es la misma
//! función que interpreta lo que envía el usuario al ejecutar. Los montos y tasas de una
//! simulación no se tocan: cruzan como cadena canónica y el único módulo que sabe
//! interpretarlos es `domain::decimal_str` (Principio VIII / D-10).
//!
//! Que la regla de interpretación sea una sola importa más de lo que parece: si el guardado
//! aceptara `0.1234567` como tasa y la ejecución lo rechazara, el autor tendría una
//! calculadora que se guarda y no corre, y el error aparecería delante de un lector.

use rust_decimal::Decimal;

use crate::domain::decimal_str;
use crate::domain::definition::{
    self, Definition, Draft, DraftOutput, DraftValidation, InputField, Issue,
};
use crate::domain::dispatch;
use crate::domain::error::{Error, Result};
use crate::domain::formula::ast::InputKind;
use crate::domain::formula::ErrorCode;
use crate::pb::fintcart::common::v1::PageResponse;
use crate::pb::fintcart::simulator::v1::{
    list_history_response::Entry, Calculator, CalculatorDefinition, CalculatorInput,
    CalculatorOutput, CalculatorValidation, ComputeResponse, DefinitionError, InputType,
    ListCalculatorsResponse, ListHistoryResponse,
};
use crate::repo::calculators::{CalculatorPage, CalculatorRow};
use crate::repo::simulations::{HistoryPage, SimulationRow};

/// Formato en el que viajan los instantes: RFC-3339 en UTC, como declara el contrato.
///
/// Se serializa con `to_rfc3339` y no con el `Display` por defecto de `chrono`, que
/// produce `2026-08-01 12:00:00 UTC` — legible pero no parseable por un cliente que
/// espera un `Timestamp` del contrato.
fn rfc3339(instant: chrono::DateTime<chrono::Utc>) -> String {
    instant.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Convierte la fila recién insertada en la respuesta de `Compute`.
///
/// La procedencia sale de la FILA y no de la petición, que es lo que la hace cierta: es lo
/// que la base acabó guardando. En el camino por idempotencia la fila es la que ya existía,
/// con su versión y su snapshot originales, así que un reintento de la saga devuelve lo
/// mismo que devolvió la primera llamada — que es justo lo que un reintento espera (T176).
///
/// El valor `0` y el mapa vacío siguen siendo respuestas correctas, no marcadores de
/// «pendiente», para las filas del historial anterior a la enmienda que la migración de T020
/// no pudo atribuir: se calcularon con el código nativo y constantes cableadas, y no había
/// definición que citar.
#[must_use]
pub fn compute_response(row: &SimulationRow) -> ComputeResponse {
    ComputeResponse {
        simulation_id: row.id.to_string(),
        result: row.result.clone(),
        computed_at: rfc3339(row.created_at),
        calculator_version: row.calculator_version.unwrap_or(0),
        indicators_used: row.indicators_snapshot.clone(),
    }
}

/// Convierte una página del historial en la respuesta de `ListHistory`.
///
/// # Errores
///
/// [`Error::InvalidInput`] si una fila guarda un `calc_type` que ya no corresponde a
/// ninguna calculadora. Ver [`Kind::from_db`].
pub fn history_response(page: HistoryPage) -> Result<ListHistoryResponse> {
    let items = page
        .items
        .into_iter()
        .map(|row| {
            Ok(Entry {
                simulation_id: row.id.to_string(),
                calc_type: dispatch::stored_to_proto(&row.calc_type)? as i32,
                currency: row.currency,
                inputs: row.inputs,
                result: row.result,
                created_at: rfc3339(row.created_at),
                // FR-058: la entrada se explica por sí sola. Los tres campos salen de la
                // FILA, así que una simulación de hace un año sigue diciendo con qué
                // versión y con qué indicadores se calculó aunque los dos hayan cambiado
                // desde entonces — que es exactamente lo que SC-019 comprueba.
                calculator_id: row
                    .calculator_id
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
                calculator_version: row.calculator_version.unwrap_or(0),
                indicators_used: row.indicators_snapshot,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(ListHistoryResponse {
        items,
        page: Some(PageResponse {
            next_page_token: page.next_page_token,
            total_size: page.total,
        }),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor de calculadoras (T087)
// ─────────────────────────────────────────────────────────────────────────────

/// Construye el borrador que el dominio sabe analizar, a partir del mensaje del contrato.
///
/// Se devuelven SIEMPRE las dos cosas —el borrador y los problemas— porque un valor
/// ilegible (`min` que no es decimal, un `tipo` que no existe) no impide leer el resto.
/// Abortar en el primero obligaría al autor a corregir la definición de uno en uno, que es
/// justo lo que `Draft::parse` existe para evitar.
///
/// Las entradas con un escalar roto se incluyen igualmente, con ese escalar ausente. Quitar
/// la entrada entera haría que toda fórmula que la use reportara además `campo_inexistente`,
/// y el autor se pondría a revisar una fórmula que está bien.
#[must_use]
pub fn draft_from_proto(definition: CalculatorDefinition) -> (Draft, Vec<DefinitionError>) {
    let mut errors = Vec::new();

    let inputs = definition
        .inputs
        .into_iter()
        .enumerate()
        .map(|(index, input)| {
            let kind = match InputType::try_from(input.r#type) {
                Ok(InputType::Monto) => InputKind::Monto,
                Ok(InputType::Tasa) => InputKind::Tasa,
                Ok(InputType::Entero) => InputKind::Entero,
                // `Unspecified` es el cero de proto3, así que un cliente que OLVIDA el
                // campo llega aquí indistinguible de uno que lo puso a cero. Los dos son el
                // mismo error, y ninguno de los tres tipos es un defecto que se pueda
                // elegir en silencio.
                Ok(InputType::Unspecified) | Err(_) => {
                    errors.push(definition_error(
                        format!("inputs[{index}].type"),
                        ErrorCode::DefinicionInvalida,
                        format!(
                            "el tipo {} no corresponde a ninguna entrada del contrato",
                            input.r#type
                        ),
                    ));
                    // Se sigue con `Monto` para no perder la entrada: el error de tipo ya
                    // está anotado, y sin la entrada las fórmulas que la usan arrastrarían
                    // un `campo_inexistente` que no es el problema.
                    InputKind::Monto
                }
            };

            InputField {
                key: input.key,
                label: input.label,
                kind,
                unit: input.unit,
                min: declared(
                    &input.min_value,
                    kind,
                    &format!("inputs[{index}].min_value"),
                    &mut errors,
                ),
                max: declared(
                    &input.max_value,
                    kind,
                    &format!("inputs[{index}].max_value"),
                    &mut errors,
                ),
                default: declared(
                    &input.default_value,
                    kind,
                    &format!("inputs[{index}].default_value"),
                    &mut errors,
                ),
                required: input.required,
            }
        })
        .collect();

    let validations = definition
        .validations
        .into_iter()
        .map(|rule| DraftValidation {
            expression: rule.expression,
            message: rule.message,
        })
        .collect();

    let outputs = definition
        .outputs
        .into_iter()
        .enumerate()
        .map(|(index, output)| {
            // `escala` viaja como `i32` porque proto3 no tiene enteros sin signo. Un valor
            // negativo no tiene representación en `u32`, y convertirlo con `as` daría un
            // número gigantesco: el autor leería «redondea a 4294967295 decimales», que
            // describe mal lo que pasó.
            let scale = match u32::try_from(output.scale) {
                Ok(scale) => scale,
                Err(_) => {
                    errors.push(definition_error(
                        format!("outputs[{index}].scale"),
                        ErrorCode::DefinicionInvalida,
                        format!("la escala {} no puede ser negativa", output.scale),
                    ));
                    0
                }
            };

            DraftOutput {
                key: output.key,
                label: output.label,
                expression: output.expression,
                scale,
                // proto3 no distingue «ausente» de «vacío»: `""` significa «sin condición»,
                // igual que una cota vacía significa «sin cota».
                when: (!output.when.is_empty()).then_some(output.when),
            }
        })
        .collect();

    (
        Draft {
            inputs,
            validations,
            outputs,
        },
        errors,
    )
}

/// Interpreta un valor declarado, o `None` si viene vacío.
///
/// Se valida contra el tipo declarado del campo y no con un `parse` genérico: un mínimo de
/// tasa con siete decimales no cabe en `NUMERIC(9,6)`, y descubrirlo al insertar —cuando ya
/// se perdió el contexto de la petición— sería mucho peor que decirlo aquí.
fn declared(
    raw: &str,
    kind: InputKind,
    location: &str,
    errors: &mut Vec<DefinitionError>,
) -> Option<Decimal> {
    if raw.is_empty() {
        return None;
    }
    match definition::parse_value(kind, raw) {
        Ok(value) => Some(value),
        Err(err) => {
            errors.push(definition_error(location, err.code, err.message));
            None
        }
    }
}

/// Traduce los problemas del dominio a los del contrato.
#[must_use]
pub fn issues_to_proto(issues: Vec<Issue>) -> Vec<DefinitionError> {
    issues
        .into_iter()
        .map(|issue| definition_error(issue.location, issue.code, issue.message))
        .collect()
}

/// Compone un `DefinitionError`.
fn definition_error(
    location: impl Into<String>,
    code: ErrorCode,
    message: impl Into<String>,
) -> DefinitionError {
    DefinitionError {
        location: location.into(),
        // El código sale de `ErrorCode::as_str` y no de un literal: es lo que impide que el
        // frontend reciba un código que su `switch` no contempla.
        code: code.as_str().to_owned(),
        message: message.into(),
    }
}

/// Convierte una definición de dominio en el mensaje del contrato.
///
/// Las fórmulas viajan como TEXTO, y es el original del autor (`source`), no una
/// reconstrucción del árbol. Ver la nota de `domain::definition::OutputField::source`: el
/// constructor visual tiene que reabrir la calculadora con lo que su autor escribió.
#[must_use]
pub fn definition_to_proto(definition: &Definition) -> CalculatorDefinition {
    CalculatorDefinition {
        inputs: definition
            .inputs
            .iter()
            .map(|input| CalculatorInput {
                key: input.key.clone(),
                label: input.label.clone(),
                r#type: input_type(input.kind) as i32,
                unit: input.unit.clone(),
                min_value: optional_decimal(input.min),
                max_value: optional_decimal(input.max),
                default_value: optional_decimal(input.default),
                required: input.required,
            })
            .collect(),
        validations: definition
            .validations
            .iter()
            .map(|rule| CalculatorValidation {
                expression: rule.source.clone(),
                message: rule.message.clone(),
            })
            .collect(),
        outputs: definition
            .outputs
            .iter()
            .map(|output| CalculatorOutput {
                key: output.key.clone(),
                label: output.label.clone(),
                expression: output.source.clone(),
                // La escala ya está acotada a `MAX_OUTPUT_SCALE` por la validación, así que
                // el `unwrap_or` no se alcanza; existe para no escribir un `as` que
                // truncaría en silencio si alguien cambiara ese límite.
                scale: i32::try_from(output.scale).unwrap_or(i32::MAX),
                when: output.when_source.clone(),
            })
            .collect(),
    }
}

/// Convierte una calculadora almacenada en el mensaje del contrato.
#[must_use]
pub fn calculator_from_row(row: CalculatorRow) -> Calculator {
    // Se recalcula del AST en lugar de leer `calculator_definitions.indicators_used`: el AST
    // es la fuente y la columna la copia, y recalcular hace imposible que discrepen.
    let indicators_used = row.definition.indicators_used();

    Calculator {
        calculator_id: row.id.to_string(),
        owner_id: row.owner_id.map(|id| id.to_string()).unwrap_or_default(),
        name: row.name,
        description: row.description,
        is_builtin: row.is_builtin,
        // El estado viaja como `string` porque el contrato lo declara así; sale de
        // `State::as_db` para que coincida con el CHECK de la columna.
        state: row.state.as_db().to_owned(),
        approved_by: row.approved_by.map(|id| id.to_string()).unwrap_or_default(),
        rejection_reason: row.rejection_reason.unwrap_or_default(),
        version: row.version,
        definition: Some(definition_to_proto(&row.definition)),
        indicators_used,
    }
}

/// Convierte una página de calculadoras en la respuesta de `ListCalculators`.
#[must_use]
pub fn calculators_response(page: CalculatorPage) -> ListCalculatorsResponse {
    ListCalculatorsResponse {
        items: page.items.into_iter().map(calculator_from_row).collect(),
        page: Some(PageResponse {
            next_page_token: page.next_page_token,
            total_size: page.total,
        }),
    }
}

/// Traduce el tipo declarado al enum del contrato.
fn input_type(kind: InputKind) -> InputType {
    match kind {
        InputKind::Monto => InputType::Monto,
        InputKind::Tasa => InputType::Tasa,
        InputKind::Entero => InputType::Entero,
    }
}

/// Serializa una cota, con la cadena vacía como «sin cota».
///
/// Es la convención que documenta `CalculatorInput`: proto3 no distingue ausente de vacío, y
/// aquí los dos significan lo mismo.
fn optional_decimal(value: Option<Decimal>) -> String {
    value.map_or_else(String::new, decimal_str::format)
}

/// Interpreta un UUID opaco del contrato.
///
/// # Errores
///
/// [`Error::InvalidInput`] si no es un UUID. Se valida ANTES de llegar al SQL: `sqlx` lo
/// rechazaría igual, pero como un error del driver, y el mensaje resultante hablaría de
/// tipos de PostgreSQL en lugar del campo que venía mal.
pub fn parse_uuid(raw: &str, field: &str) -> Result<uuid::Uuid> {
    uuid::Uuid::parse_str(raw)
        .map_err(|_| Error::InvalidInput(format!("{field} {raw:?} no es un UUID")))
}

/// Interpreta un UUID opcional: la cadena vacía significa «ninguno».
///
/// # Errores
///
/// Ver [`parse_uuid`].
pub fn parse_optional_uuid(raw: &str, field: &str) -> Result<Option<uuid::Uuid>> {
    if raw.is_empty() {
        return Ok(None);
    }
    parse_uuid(raw, field).map(Some)
}

/// Interpreta el UUID opaco de un titular.
///
/// # Errores
///
/// [`Error::InvalidInput`] si no es un UUID. Se valida ANTES de llegar al SQL: `sqlx`
/// lo rechazaría igual, pero como un error del driver, y el mensaje resultante hablaría
/// de tipos de PostgreSQL en lugar del campo que venía mal.
pub fn parse_user_id(raw: &str) -> Result<uuid::Uuid> {
    parse_uuid(raw, "user_id")
}

/// Interpreta el identificador de una calculadora del constructor.
///
/// # Errores
///
/// [`Error::InvalidInput`] si no es un UUID, con la misma razón que [`parse_user_id`].
pub fn parse_calculator_id(raw: &str) -> Result<uuid::Uuid> {
    parse_uuid(raw, "calculator_id")
}
