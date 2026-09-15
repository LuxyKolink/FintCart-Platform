//! Definición de una calculadora: lo que el autor declara, cómo se valida al guardar y
//! cómo se ejecuta (T089; FR-044, FR-046, FR-047; research D-15).
//!
//! ## Las dos mitades de este módulo, y por qué están juntas
//!
//! 1. **`Draft::parse`** convierte lo que llega del formulario —expresiones todavía en
//!    texto— en una [`Definition`] con AST, o devuelve **todos** los problemas que
//!    encontró. Es la mitad que hace cierta la promesa de D-15: el autor se entera al
//!    guardar, no un lector tres semanas después.
//! 2. **`Definition::run`** ejecuta esa definición ya analizada, en el orden que D-15
//!    fija: rangos → validaciones del autor → salidas.
//!
//! Están juntas porque son la misma regla vista desde los dos lados. Separarlas dejaría el
//! orden de evaluación en un módulo y la forma de los datos en otro, y el orden ES la
//! semántica: si las validaciones se evaluaran después de las salidas, el mensaje del autor
//! llegaría tarde y el usuario leería una división por cero en lugar de «el ingreso mensual
//! debe ser mayor que cero».
//!
//! ## Por qué se devuelven TODOS los errores y no el primero
//!
//! `parse` acumula en lugar de abortar. Un autor que acaba de escribir una calculadora de
//! seis salidas con una errata en cada una no debería descubrirlas de una en una, guardando
//! seis veces. El coste es que hay que construir una definición a la que le faltan piezas
//! —de ahí que las expresiones que no analizan se descarten en lugar de sustituirse por un
//! valor neutro—, y ese coste se paga a gusto: la definición nunca se devuelve si hay
//! errores.

use std::collections::{BTreeSet, HashMap, HashSet};

use rust_decimal::Decimal;

use crate::domain::decimal_str::{self, DecimalStrError};
use crate::domain::error::{Error, Result as DomainResult};
use crate::domain::formula::ast::{Expr, InputKind, Schema};
use crate::domain::formula::eval::{self, Scope};
use crate::domain::formula::functions;
use crate::domain::formula::lexer::{self, Token};
use crate::domain::formula::limits;
use crate::domain::formula::parser::{self, Type};
use crate::domain::formula::{ErrorCode, FormulaError};

/// Definición ya analizada: lo que se persiste y lo que se ejecuta.
///
/// Los tres vectores conservan el ORDEN declarado, y no es un detalle de presentación: el
/// orden de `outputs` es el que ve el usuario en el resultado, y el de `validations` decide
/// qué mensaje recibe cuando incumple dos reglas a la vez. Un `HashMap` perdería los dos.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Definition {
    /// Campos de entrada (FR-044).
    pub inputs: Vec<InputField>,
    /// Reglas de dominio, evaluadas ANTES que las salidas.
    pub validations: Vec<ValidationRule>,
    /// Salidas calculadas.
    pub outputs: Vec<OutputField>,
}

/// Campo de entrada declarado por el autor (FR-044).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputField {
    /// Clave con la que las fórmulas lo referencian.
    pub key: String,
    /// Etiqueta que ve el usuario.
    pub label: String,
    /// Tipo declarado, que decide contra qué `NUMERIC` se valida su valor.
    pub kind: InputKind,
    /// Unidad mostrada (`COP`, `%`, `meses`).
    pub unit: String,
    /// Cota inferior. `None` ⇒ sin cota.
    pub min: Option<Decimal>,
    /// Cota superior. `None` ⇒ sin cota.
    pub max: Option<Decimal>,
    /// Valor por defecto cuando el campo es opcional y no se suministra.
    pub default: Option<Decimal>,
    /// Si el campo debe venir en toda ejecución.
    ///
    /// FR-044 obliga a declarar un valor por defecto a cada campo, pero eso no lo vuelve
    /// opcional: `required` es lo que decide si su ausencia es un error o una ausencia
    /// legítima que `presente(…)` puede consultar. Un campo obligatorio CON valor por
    /// defecto es una contradicción que el autor puede querer —el formulario lo prerrellena
    /// y aun así exige que se envíe— y no se rechaza.
    pub required: bool,
}

/// Regla de dominio del autor, evaluada antes que las salidas (D-15).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationRule {
    /// Condición que DEBE cumplirse.
    pub expr: Expr,
    /// Mensaje que ve el usuario cuando no se cumple.
    pub message: String,
    /// La condición tal como la escribió el autor.
    ///
    /// **La ejecución no la toca.** Existe para poder reabrir el constructor con la fórmula
    /// que su autor escribió y no con una versión reformateada por nosotros. Ver la nota
    /// sobre [`OutputField::source`].
    pub source: String,
}

/// Salida calculada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputField {
    /// Clave con la que el resultado viaja al cliente.
    pub key: String,
    /// Etiqueta que ve el usuario.
    pub label: String,
    /// Fórmula, ya analizada. Es lo ÚNICO que se recorre al ejecutar.
    pub expr: Expr,
    /// Decimales de redondeo half-even del resultado.
    pub scale: u32,
    /// Condición opcional: si viene y evalúa a falso, la salida se OMITE.
    ///
    /// Omitir no es lo mismo que devolver cero. `inversion` solo emite
    /// `valor_futuro_real` si se dio `inflacion_anual`; devolverlo siempre con inflación
    /// cero implícita sugeriría que se descontó algo cuando no se descontó nada.
    pub when: Option<Expr>,
    /// La fórmula tal como la escribió el autor.
    ///
    /// ## Por qué se guarda el texto si el árbol ya está
    ///
    /// Porque son dos cosas distintas: el árbol es el artefacto que se EJECUTA y el texto es
    /// el original que el autor REDACTÓ. Es la misma relación que hay entre el fuente y el
    /// binario de un programa.
    ///
    /// La alternativa era reconstruir el texto imprimiendo el árbol, y está descartada por
    /// una razón que este feature no puede permitirse ignorar: un impresor tiene que decidir
    /// los paréntesis, el espaciado y la asociatividad, y cualquier fallo suyo haría que el
    /// autor abriera su calculadora y leyera una fórmula **distinta de la que escribió** —
    /// sin que nada fallara y sin que el AST hubiera cambiado, porque la relectura ocurre
    /// fuera del servicio—. Es exactamente la clase de transformación silenciosa que D-15
    /// existe para evitar, y conservar el original la vuelve imposible.
    ///
    /// El riesgo contrario —que el texto y el árbol discrepen— no se da: las dos piezas se
    /// escriben en la misma llamada, y solo después de que el análisis del texto haya
    /// producido ese árbol.
    pub source: String,
    /// La condición de omisión tal como la escribió el autor, o vacío si no hay.
    pub when_source: String,
}

/// Lo que llega del formulario: las expresiones todavía son TEXTO.
///
/// La distinción con [`Definition`] no es ceremonia. Que un texto se convierta en AST es
/// LA decisión de la que depende todo D-15 —errores al guardar, coste acotado al ejecutar,
/// ninguna relectura de la fórmula publicada—, y tenerla en el tipo impide que un `String`
/// se cuele en el sitio donde ya hace falta un árbol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Draft {
    /// Entradas ya interpretadas: no llevan fórmula, así que no hay nada que analizar.
    pub inputs: Vec<InputField>,
    /// Reglas con la expresión sin analizar.
    pub validations: Vec<DraftValidation>,
    /// Salidas con la expresión sin analizar.
    pub outputs: Vec<DraftOutput>,
}

/// Regla del borrador, con la expresión en texto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftValidation {
    /// Expresión booleana tal como la escribió el autor.
    pub expression: String,
    /// Mensaje mostrado si no se cumple.
    pub message: String,
}

/// Salida del borrador, con la expresión en texto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftOutput {
    /// Clave del resultado.
    pub key: String,
    /// Etiqueta visible.
    pub label: String,
    /// Fórmula tal como la escribió el autor.
    pub expression: String,
    /// Decimales de redondeo.
    pub scale: u32,
    /// Condición de omisión, en texto y opcional.
    pub when: Option<String>,
}

/// Un problema concreto, con la ubicación que lo señala.
///
/// `location` se compone AQUÍ y no en el analizador: [`FormulaError`] no sabe si está
/// analizando la tercera salida o la primera validación, y pasarle ese contexto obligaría a
/// un parámetro que no le corresponde. Quien ensambla la definición sí lo sabe.
///
/// El formato (`outputs[1].expression`, `inputs[0].min`) es el mismo que documenta
/// `DefinitionError.location` en el contrato, porque de aquí sale tal cual.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// Dónde está el problema, en la forma que espera el constructor visual.
    pub location: String,
    /// Qué clase de problema es.
    pub code: ErrorCode,
    /// Explicación dirigida al autor.
    pub message: String,
}

impl Issue {
    /// Construye un problema en una ubicación.
    #[must_use]
    pub fn new(location: impl Into<String>, code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            location: location.into(),
            code,
            message: message.into(),
        }
    }

    /// Construye un problema a partir de un error del analizador.
    #[must_use]
    pub fn from_formula(location: impl Into<String>, error: &FormulaError) -> Self {
        Self {
            location: location.into(),
            code: error.code,
            message: error.message.clone(),
        }
    }
}

/// Máxima escala de redondeo de una salida.
///
/// Es la de [`functions::MAX_SCALE`], que a su vez es la que `redondear` acepta como
/// argumento. Que las dos coincidan es deliberado: un autor que puede escribir
/// `redondear(x, 20)` no debe encontrarse con que la escala de la salida no admite 20.
/// Más allá de ese número el redondeo no tiene efecto —`Decimal` no representa más
/// decimales—, así que aceptarlo sería prometer una precisión que el resultado no tiene.
const MAX_OUTPUT_SCALE: u32 = functions::MAX_SCALE;

/// Interpreta el valor de un campo según su tipo declarado.
///
/// Lo usan los DOS caminos, y por eso es una función y no un método de cada uno: la
/// validación al guardar (mínimo, máximo y valor por defecto) y la ejecución (lo que envía
/// el usuario). Si el guardado aceptara `0.1234567` como tasa y la ejecución lo rechazara
/// —o al revés—, el autor tendría una calculadora que se guarda y no corre.
///
/// `Monto` se contrasta con `NUMERIC(19,2)` y `Tasa` con `NUMERIC(9,6)`, las columnas que
/// documenta data-model.md. `Entero` no tiene columna propia: es un recuento de periodos y
/// se exige íntegro.
///
/// # Errores
///
/// [`ErrorCode::DefinicionInvalida`] con un mensaje escrito para el autor: nombra el valor
/// recibido y qué se esperaba. Nunca dice `decimal_str:`, que es el nombre de un módulo y
/// no algo que el autor pueda usar.
pub fn parse_value(kind: InputKind, raw: &str) -> Result<Decimal, FormulaError> {
    let parsed = match kind {
        InputKind::Monto => decimal_str::parse_money(raw),
        InputKind::Tasa => decimal_str::parse_rate(raw),
        InputKind::Entero => decimal_str::parse(raw),
    }
    .map_err(|err| {
        FormulaError::new(ErrorCode::DefinicionInvalida, describe_decimal_error(&err))
    })?;

    if kind == InputKind::Entero && !parsed.fract().is_zero() {
        return Err(FormulaError::new(
            ErrorCode::DefinicionInvalida,
            format!("«{raw}» no es un número entero"),
        ));
    }

    Ok(parsed)
}

/// Traduce un fallo de formato decimal a algo que el autor pueda accionar.
///
/// El `Display` de [`DecimalStrError`] empieza por `decimal_str:` porque está escrito para
/// el log de quien opera el servicio. Este mensaje lo lee quien redacta una fórmula.
fn describe_decimal_error(err: &DecimalStrError) -> String {
    match err {
        DecimalStrError::Empty => "falta un valor".to_owned(),
        DecimalStrError::Syntax(value) => format!(
            "«{value}» no es una cifra decimal: se escriben solo dígitos y un punto, sin \
             separador de miles, sin notación científica y sin espacios"
        ),
        DecimalStrError::Scale {
            value, got, max, ..
        } => format!("«{value}» tiene {got} decimales y su tipo admite {max} como máximo"),
        DecimalStrError::Range {
            value,
            precision,
            scale,
        } => format!(
            "«{value}» no cabe en su tipo (admite hasta {} dígitos, {scale} decimales)",
            precision - scale
        ),
        DecimalStrError::Unrepresentable(value) => {
            format!("«{value}» excede la precisión decimal que admite la plataforma")
        }
    }
}

impl Draft {
    /// Analiza las expresiones y valida la forma de la definición.
    ///
    /// Los indicadores que existen hoy llegan como parámetro porque este módulo **no
    /// consulta nada**: el analizador recibe los nombres ya resueltos y sigue siendo
    /// dominio puro, probable sin base de datos. Quien consulta es la capa de aplicación,
    /// que es la que tiene el repositorio.
    ///
    /// El [`Schema`] de campos se construye AQUÍ a partir de las propias entradas, y no se
    /// recibe de fuera. Es lo que impide el fallo más caro de este paso: un llamador que se
    /// olvide de incluir una entrada haría que toda fórmula que la use reportara
    /// `campo_inexistente`, y el autor se pondría a revisar una fórmula correcta.
    ///
    /// # Errores
    ///
    /// `Err` con TODOS los problemas encontrados, nunca con el primero. Si la lista viniera
    /// vacía el resultado habría sido `Ok`, así que un `Err(vec![])` sería un error del
    /// propio módulo; no se produce.
    pub fn parse(self, indicators: &BTreeSet<String>) -> Result<Definition, Vec<Issue>> {
        let mut issues = Vec::new();

        check_count(
            "inputs",
            self.inputs.len(),
            limits::MIN_INPUTS,
            limits::MAX_INPUTS,
            &mut issues,
        );
        check_count(
            "outputs",
            self.outputs.len(),
            limits::MIN_OUTPUTS,
            limits::MAX_OUTPUTS,
            &mut issues,
        );
        check_inputs(&self.inputs, &mut issues);
        check_output_keys(&self.outputs, &mut issues);

        let schema = Schema::new(
            self.inputs
                .iter()
                .map(|input| (input.key.clone(), input.kind)),
            indicators.iter().cloned(),
        );

        let mut validations = Vec::with_capacity(self.validations.len());
        for (index, draft) in self.validations.into_iter().enumerate() {
            if draft.message.trim().is_empty() {
                issues.push(Issue::new(
                    format!("validations[{index}].message"),
                    ErrorCode::DefinicionInvalida,
                    "una regla sin mensaje no puede explicarle nada al usuario: escribe qué \
                     debe corregir",
                ));
            }
            // Una condición booleana: `parse` la rechaza aquí si el autor escribió una
            // fórmula que produce un número, que es el error de tipo más fácil de cometer.
            match parser::parse(&draft.expression, &schema, Type::Boolean) {
                Ok(expr) => validations.push(ValidationRule {
                    expr,
                    message: draft.message,
                    source: draft.expression,
                }),
                Err(err) => issues.push(Issue::from_formula(
                    format!("validations[{index}].expression"),
                    &err,
                )),
            }
        }

        let mut outputs = Vec::with_capacity(self.outputs.len());
        for (index, draft) in self.outputs.into_iter().enumerate() {
            if draft.scale > MAX_OUTPUT_SCALE {
                issues.push(Issue::new(
                    format!("outputs[{index}].scale"),
                    ErrorCode::LimiteExcedido,
                    format!(
                        "la salida redondea a {} decimales y el máximo es {MAX_OUTPUT_SCALE}",
                        draft.scale
                    ),
                ));
            }

            let expression = parser::parse(&draft.expression, &schema, Type::Number)
                .map_err(|err| {
                    issues.push(Issue::from_formula(
                        format!("outputs[{index}].expression"),
                        &err,
                    ));
                })
                .ok();

            // El `when` vacío significa «sin condición», porque proto3 no distingue
            // ausente de vacío y el formulario manda `""` cuando el autor no escribe nada.
            let when_source = draft.when.unwrap_or_default();
            let when = match when_source.trim() {
                "" => Some(None),
                source => match parser::parse(source, &schema, Type::Boolean) {
                    Ok(expr) => Some(Some(expr)),
                    Err(err) => {
                        issues.push(Issue::from_formula(format!("outputs[{index}].when"), &err));
                        None
                    }
                },
            };

            // Las dos tienen que haber analizado. Publicar la salida con `when: None`
            // cuando su condición falló al analizar CAMBIARÍA su semántica —de «solo
            // cuando se cumpla» a «siempre»— justo en el caso en que el autor se
            // equivocó, que es el peor momento para hacer algo silencioso.
            if let (Some(expr), Some(when)) = (expression, when) {
                outputs.push(OutputField {
                    key: draft.key,
                    label: draft.label,
                    expr,
                    scale: draft.scale,
                    when,
                    source: draft.expression,
                    // Se guarda el original SIN recortar. El recorte sirve para decidir si
                    // hay condición; lo que se le devuelve al autor es lo que escribió.
                    when_source: when_source.trim().to_owned(),
                });
            }
        }

        if issues.is_empty() {
            Ok(Definition {
                inputs: self.inputs,
                validations,
                outputs,
            })
        } else {
            Err(issues)
        }
    }
}

impl Definition {
    /// Indicadores que la definición referencia, ordenados y sin repetir.
    ///
    /// Es la unión sobre las tres listas de expresiones. Se calcula del AST en lugar de
    /// leerse de `calculator_definitions.indicators_used` porque el AST es la fuente y la
    /// columna es la copia: recalcular hace imposible que discrepen, y lo que FR-058
    /// necesita de la columna —preguntar «qué calculadoras usan `@UVT`»— lo sigue dando
    /// el índice al escribirla.
    #[must_use]
    pub fn indicators_used(&self) -> Vec<String> {
        let mut found = BTreeSet::new();
        for rule in &self.validations {
            found.extend(rule.expr.indicators_used());
        }
        for output in &self.outputs {
            found.extend(output.expr.indicators_used());
            if let Some(condition) = &output.when {
                found.extend(condition.indicators_used());
            }
        }
        found.into_iter().collect()
    }

    /// Ejecuta la definición y devuelve las salidas en orden declarado.
    ///
    /// El orden de los pasos es la semántica que fija D-15 y no una preferencia:
    ///
    /// 1. **Se resuelven las entradas** contra su valor por defecto. Un campo obligatorio
    ///    ausente es un error aquí, antes de evaluar nada.
    /// 2. **Se comprueban los rangos declarados** (FR-044). Va antes que las reglas del
    ///    autor porque el rango es la promesa del propio campo: si un plazo declarado
    ///    `[1, 600]` llega con 5000, el usuario debe leer «el campo admite entre 1 y 600» y
    ///    no el mensaje de una regla del autor que habla de otra cosa.
    /// 3. **Se evalúan las reglas del autor**, en orden, y la primera que falle detiene la
    ///    ejecución con SU mensaje. Es lo que distingue esta plataforma de una hoja de
    ///    cálculo: el usuario lee «el ingreso mensual debe ser mayor que cero» en lugar de
    ///    una división por cero.
    /// 4. **Se calculan las salidas**, omitiendo las que declaren un `when` que no se
    ///    cumpla.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si falta un campo obligatorio, si un valor no es decimal
    /// canónico o cae fuera de su rango, si una regla del autor no se cumple —con el
    /// mensaje que escribió el autor— o si la evaluación falla (división por cero,
    /// desbordamiento).
    pub fn run(
        &self,
        raw_inputs: &HashMap<String, String>,
        indicators: &HashMap<String, Decimal>,
    ) -> DomainResult<Vec<(String, Decimal)>> {
        let (fields, supplied) = self.resolve_inputs(raw_inputs)?;
        self.check_ranges(&fields)?;

        let scope = Scope::new(&fields, indicators, &supplied);

        for rule in &self.validations {
            if !eval::evaluate_condition(&rule.expr, &scope)? {
                return Err(Error::InvalidInput(rule.message.clone()));
            }
        }

        let mut result = Vec::with_capacity(self.outputs.len());
        for output in &self.outputs {
            if let Some(condition) = &output.when {
                if !eval::evaluate_condition(condition, &scope)? {
                    continue;
                }
            }
            let value = eval::evaluate(&output.expr, &scope)?;
            // El redondeo va AQUÍ y solo aquí: los cálculos intermedios corren a la
            // precisión completa de `Decimal` y solo el resultado se redondea. Redondear
            // por el camino y seguir operando da una cifra distinta de la que da el banco
            // (research D-14).
            result.push((
                output.key.clone(),
                decimal_str::round_half_even(value, output.scale),
            ));
        }

        Ok(result)
    }

    /// Resuelve las entradas a valores, distinguiendo «no vino» de «vino con su defecto».
    ///
    /// La distinción la conserva `supplied`, que es lo que consulta `presente(…)`. Sin
    /// ella, un campo opcional no enviado y un campo enviado con su valor por defecto
    /// serían indistinguibles, y la salida condicional de `inversion` —que existe
    /// precisamente para eso— no podría escribirse.
    fn resolve_inputs(
        &self,
        raw: &HashMap<String, String>,
    ) -> DomainResult<(HashMap<String, Decimal>, HashSet<String>)> {
        let mut fields = HashMap::with_capacity(self.inputs.len());
        let mut supplied = HashSet::new();

        for input in &self.inputs {
            let value = match raw.get(&input.key) {
                Some(text) => {
                    let value = parse_value(input.kind, text).map_err(|err| {
                        Error::InvalidInput(format!("el campo «{}» {}", input.key, err.message))
                    })?;
                    supplied.insert(input.key.clone());
                    value
                }
                None if input.required => {
                    return Err(Error::InvalidInput(format!(
                        "falta el campo obligatorio «{}» ({})",
                        input.key, input.label
                    )));
                }
                // Sin valor por defecto, un opcional ausente vale cero, que es la
                // semántica que ya tienen las calculadoras nativas
                // (`Inputs::money_or_zero`). Sigue siendo consultable con `presente(…)`.
                None => input.default.unwrap_or(Decimal::ZERO),
            };
            fields.insert(input.key.clone(), value);
        }

        Ok((fields, supplied))
    }

    /// Comprueba cada valor efectivo contra el rango declarado (FR-044).
    ///
    /// Se comprueba el valor EFECTIVO, no solo el que envió el usuario: un campo opcional
    /// ausente sin valor por defecto vale cero, y si su rango empieza en uno ese cero es
    /// tan inválido como si lo hubieran escrito. Dejarlo pasar haría que la fórmula
    /// calculara con un valor que la propia definición prohíbe.
    fn check_ranges(&self, fields: &HashMap<String, Decimal>) -> DomainResult<()> {
        for input in &self.inputs {
            let Some(value) = fields.get(&input.key).copied() else {
                continue;
            };
            let below = input.min.is_some_and(|min| value < min);
            let above = input.max.is_some_and(|max| value > max);
            if below || above {
                return Err(Error::InvalidInput(format!(
                    "el campo «{}» ({}) admite {} y se recibió {}",
                    input.key,
                    input.label,
                    describe_range(input),
                    decimal_str::format(value)
                )));
            }
        }
        Ok(())
    }
}

/// Comprueba el número de entradas o de salidas contra las dos cotas.
fn check_count(field: &str, len: usize, min: usize, max: usize, issues: &mut Vec<Issue>) {
    if len < min {
        issues.push(Issue::new(
            field,
            ErrorCode::LimiteExcedido,
            format!("la definición necesita al menos {min} y no tiene ninguna"),
        ));
    } else if len > max {
        issues.push(Issue::new(
            field,
            ErrorCode::LimiteExcedido,
            format!("la definición declara {len} y el máximo es {max}"),
        ));
    }
}

/// Comprueba la forma de cada campo de entrada.
fn check_inputs(inputs: &[InputField], issues: &mut Vec<Issue>) {
    let mut seen: BTreeSet<&str> = BTreeSet::new();

    for (index, input) in inputs.iter().enumerate() {
        let key = input.key.as_str();

        if !is_field_key(key) {
            issues.push(Issue::new(
                format!("inputs[{index}].key"),
                ErrorCode::DefinicionInvalida,
                format!(
                    "«{key}» no sirve como clave de campo: debe empezar por letra o guion \
                     bajo y seguir con letras, dígitos o guiones bajos, sin espacios ni \
                     acentos"
                ),
            ));
        } else if parser::unavailable_as_field_name(key) {
            issues.push(Issue::new(
                format!("inputs[{index}].key"),
                ErrorCode::DefinicionInvalida,
                format!(
                    "«{key}» es una palabra del lenguaje de fórmulas y no puede ser el \
                     nombre de un campo: ninguna fórmula podría referenciarlo sin \
                     ambigüedad"
                ),
            ));
        } else if !seen.insert(key) {
            issues.push(Issue::new(
                format!("inputs[{index}].key"),
                ErrorCode::DefinicionInvalida,
                format!(
                    "«{key}» ya está declarado en otro campo: las dos entradas compartirían \
                     un único valor y la segunda quedaría inalcanzable"
                ),
            ));
        }

        if input.label.trim().is_empty() {
            issues.push(Issue::new(
                format!("inputs[{index}].label"),
                ErrorCode::DefinicionInvalida,
                format!("el campo «{key}» no tiene etiqueta"),
            ));
        }

        if let (Some(min), Some(max)) = (input.min, input.max) {
            if min > max {
                issues.push(Issue::new(
                    format!("inputs[{index}].min"),
                    ErrorCode::DefinicionInvalida,
                    format!(
                        "el campo «{key}» declara un mínimo ({}) mayor que su máximo ({}): \
                         ningún valor podría cumplirlo",
                        decimal_str::format(min),
                        decimal_str::format(max)
                    ),
                ));
            }
        }

        if let Some(default) = input.default {
            let below = input.min.is_some_and(|min| default < min);
            let above = input.max.is_some_and(|max| default > max);
            if below || above {
                issues.push(Issue::new(
                    format!("inputs[{index}].default"),
                    ErrorCode::DefinicionInvalida,
                    format!(
                        "el valor por defecto del campo «{key}» es {} y su rango es {}",
                        decimal_str::format(default),
                        describe_range(input)
                    ),
                ));
            }
        }
    }
}

/// Comprueba la clave de cada salida.
///
/// Se valida igual que la de una entrada aunque las salidas y las entradas vivan en mapas
/// distintos —`inputs` y `result`—, porque las dos acaban en el mismo formulario y una
/// salida llamada `1 2` sería tan impronunciable como una entrada así.
fn check_output_keys(outputs: &[DraftOutput], issues: &mut Vec<Issue>) {
    let mut seen: BTreeSet<&str> = BTreeSet::new();

    for (index, output) in outputs.iter().enumerate() {
        let key = output.key.as_str();

        if !is_field_key(key) {
            issues.push(Issue::new(
                format!("outputs[{index}].key"),
                ErrorCode::DefinicionInvalida,
                format!(
                    "«{key}» no sirve como clave de salida: debe empezar por letra o guion \
                     bajo y seguir con letras, dígitos o guiones bajos"
                ),
            ));
        } else if !seen.insert(key) {
            issues.push(Issue::new(
                format!("outputs[{index}].key"),
                ErrorCode::DefinicionInvalida,
                format!("«{key}» ya está declarado en otra salida"),
            ));
        }

        if output.label.trim().is_empty() {
            issues.push(Issue::new(
                format!("outputs[{index}].label"),
                ErrorCode::DefinicionInvalida,
                format!("la salida «{key}» no tiene etiqueta"),
            ));
        }
    }
}

/// Verdadero si `key` es lexable como UN identificador.
///
/// Se comprueba con el analizador léxico REAL y no con una expresión regular propia. Una
/// regla duplicada se desincroniza de la que de verdad usa el analizador, y el síntoma
/// sería el peor posible: un campo que el autor declara, la validación acepta, y ninguna
/// fórmula puede referenciar.
fn is_field_key(key: &str) -> bool {
    let Ok(tokens) = lexer::tokenize(key) else {
        return false;
    };
    let [only] = tokens.as_slice() else {
        return false;
    };
    matches!(&only.token, Token::Ident(name) if name == key)
}

/// Describe el rango declarado como lo leería el usuario.
fn describe_range(input: &InputField) -> String {
    match (input.min, input.max) {
        (Some(min), Some(max)) => format!(
            "un valor entre {} y {}",
            decimal_str::format(min),
            decimal_str::format(max)
        ),
        (Some(min), None) => format!("un valor mayor o igual que {}", decimal_str::format(min)),
        (None, Some(max)) => format!("un valor menor o igual que {}", decimal_str::format(max)),
        // Alcanzable: FR-044 obliga a declarar los campos, no a rellenarlos, y el
        // contrato dice expresamente que una cota vacía significa «sin cota».
        (None, None) => "cualquier valor".to_owned(),
    }
}
