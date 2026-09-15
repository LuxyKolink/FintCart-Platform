//! Analizador sintáctico: tokens → AST validado (T081, D-15).
//!
//! Descenso recursivo con precedencia por niveles. El lenguaje no tiene sentencias ni
//! asignaciones: una fórmula es UNA expresión, y eso es lo que permite analizarla entera
//! al guardar sin dejar nada para el momento de ejecutar.
//!
//! ## Precedencia, de menor a mayor
//!
//! ```text
//! o                  disyunción
//! y                  conjunción
//! no                 negación lógica
//! == != < <= > >=    comparación  (NO se encadenan)
//! + -                aditiva
//! * /                multiplicativa
//! -x                 negación aritmética unaria
//! (…)  f(…)  literales  campos  @INDICADOR  si(…)  presente(…)
//! ```
//!
//! `no` está por DEBAJO de la comparación, de modo que `no a == b` se lee `no (a == b)`.
//! Es la lectura que espera quien escribe una condición, y la contraria —`(no a) == b`—
//! obligaría a paréntesis justo en el caso más común.
//!
//! ## Dos guardias contra el desbordamiento de pila, y por qué hacen falta las dos
//!
//! El analizador es recursivo, así que una fórmula disparatada puede agotar la pila
//! **antes** de que la comprobación de límites pueda informar de nada:
//!
//! - Una cadena de paréntesis `((((…1…))))` no crea nodos —los paréntesis son
//!   transparentes en el árbol— pero anida la recursión una vez por paréntesis. La caza
//!   el **contador de anidamiento**.
//! - Una suma de diez mil términos `1+1+1+…` apenas anida, pero produce un árbol de diez
//!   mil nodos. La caza el **presupuesto de nodos**, que aborta al pasar de
//!   [`limits::MAX_NODES`].
//!
//! El presupuesto de nodos cubre además un problema que ninguna validación posterior
//! podría cubrir: liberar un `Box<Expr>` encadenado es recursivo, así que un árbol de
//! diez mil niveles desbordaría la pila al DESTRUIRSE, ya fuera de toda guardia. No
//! llegar a construirlo es lo único que lo evita.
//!
//! ## Qué se comprueba aquí y qué después
//!
//! El analizador comprueba lo que el flujo de tokens le pone delante: aridad, palabras
//! reservadas, campos e indicadores declarados. La forma de los argumentos —que el
//! exponente de `pot` sea entero— y los tipos se comprueban en recorridos aparte, y
//! **solo una vez que [`limits::check`] ha acotado el árbol**, porque esos recorridos
//! también son recursivos y sería absurdo proteger la recursión del analizador para
//! dejársela abierta al verificador de tipos.

use rust_decimal::prelude::ToPrimitive;

use crate::domain::formula::ast::{Expr, Func, Schema};
use crate::domain::formula::functions::{self, ArgConstraint};
use crate::domain::formula::lexer::{self, Spanned, Token};
use crate::domain::formula::{limits, ErrorCode, FormulaError, Result};

/// Comprueba si un token es un operador de comparación.
///
/// Existe como función porque la consultan dos sitios que deben coincidir: el que decide
/// si hay una comparación que analizar, y el que detecta una SEGUNDA comparación para
/// rechazarla. Con las dos listas escritas por separado, añadir un operador dejaría la
/// detección de encadenamiento sin actualizar y `a <= b <= c` se aceptaría.
fn is_comparison(token: &Token) -> bool {
    matches!(
        token,
        Token::Lt | Token::Le | Token::Gt | Token::Ge | Token::Eq | Token::Ne
    )
}

/// Tope de anidamiento del ANALIZADOR, que NO es el de FR-046.
///
/// [`limits::MAX_DEPTH`] (16) es una regla del producto y se comprueba sobre el árbol ya
/// construido. Este es una barrera de seguridad de la pila y se comprueba mientras se
/// construye. Tenerlos separados importa porque **no miden lo mismo**: en el árbol los
/// paréntesis son transparentes, así que `((((1))))` tiene profundidad 1 y anidamiento 4.
/// Fundir los dos haría que una fórmula con paréntesis de más se rechazara por un límite
/// de producto que en realidad no incumple.
const MAX_PARSE_NESTING: usize = 64;

/// Tipo de una expresión, inferido durante el análisis.
///
/// El lenguaje tiene dos tipos y no hace conversiones implícitas. Que sean dos y no uno
/// es lo que permite rechazar `si(x, 1, 2) + 1` al GUARDAR: sin tipos, sumar un
/// condicional se descubriría al ejecutar, delante del lector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    /// Un valor decimal.
    Number,
    /// Una condición.
    Boolean,
}

impl Type {
    const fn describe(self) -> &'static str {
        match self {
            Self::Number => "un número",
            Self::Boolean => "una condición",
        }
    }
}

/// Palabras del lenguaje que NO son funciones: los operadores y las dos formas especiales.
///
/// Se distingue de [`unavailable_as_field_name`] porque el analizador necesita separar dos
/// casos que para la validación de definiciones son el mismo. Un nombre suelto que resulta
/// ser `y` es un error de sitio; uno que resulta ser `pot` es una función a la que le
/// faltan los argumentos. Los dos se rechazan, pero con correcciones distintas, y por eso
/// el analizador consulta la lista estrecha.
fn is_language_keyword(name: &str) -> bool {
    matches!(name, "y" | "o" | "no" | "si" | "presente")
}

/// Nombres que no pueden ser clave de un campo de entrada.
///
/// Es una función y no una lista suelta porque la consultan dos sitios con propósitos
/// distintos: el analizador, para dar un mensaje claro cuando alguien escribe `y` donde
/// iba un campo; y la validación de la definición (T089), para rechazar una calculadora
/// que declare un campo llamado `si` o `pot`. Una lista duplicada en ambos se
/// desincronizaría al añadir una palabra.
///
/// Incluye los nombres de función: declarar un campo `min` haría que `min` a secas fuera
/// ambiguo entre el campo y la función, y resolverlo por la forma de la expresión funciona
/// pero es una trampa para quien lea la fórmula después.
#[must_use]
pub fn unavailable_as_field_name(name: &str) -> bool {
    is_language_keyword(name) || Func::from_name(name).is_some()
}

/// Analiza una fórmula y devuelve su AST validado.
///
/// `expected` es el tipo que el contexto exige al resultado: un número para una salida,
/// una condición para una validación o un `cuando`. Se pasa explícitamente en lugar de
/// deducirse porque el contexto no está en el texto —`monto > 0` es una validación
/// correcta y una salida incorrecta— y adivinarlo convertiría un error del autor en una
/// interpretación silenciosa.
///
/// # Errores
///
/// Del análisis ([`ErrorCode::ExpresionMalFormada`], [`ErrorCode::FuncionDesconocida`],
/// [`ErrorCode::CampoInexistente`], [`ErrorCode::IndicadorDesconocido`]), de los límites
/// ([`ErrorCode::LimiteExcedido`]), de la forma de los argumentos
/// ([`ErrorCode::ExponenteNoEntero`]) y de los tipos ([`ErrorCode::TipoIncompatible`]).
pub fn parse(source: &str, schema: &Schema, expected: Type) -> Result<Expr> {
    let tokens = lexer::tokenize(source)?;
    if tokens.is_empty() {
        return Err(FormulaError::new(
            ErrorCode::ExpresionMalFormada,
            "la expresión está vacía".to_owned(),
        ));
    }

    let mut parser = Parser {
        tokens,
        position: 0,
        schema,
        nesting: 0,
        nodes: 0,
    };
    let expr = parser.parse_expression()?;

    // Un `)` de más, o cualquier token tras una expresión completa, es un error: sin esta
    // comprobación `1) + 2` se analizaría como `1` y el resto se descartaría en silencio.
    if let Some(extra) = parser.peek() {
        return Err(FormulaError::new(
            ErrorCode::ExpresionMalFormada,
            format!(
                "sobra {} (columna {}) después del final de la expresión",
                extra.token.describe(),
                extra.at
            ),
        ));
    }

    // El orden importa: primero se acota el árbol, y solo después se recorre con las
    // funciones recursivas de abajo.
    limits::check(&expr)?;
    check_arguments(&expr, schema)?;
    let actual = infer(&expr)?;
    if actual != expected {
        return Err(FormulaError::new(
            ErrorCode::TipoIncompatible,
            format!(
                "la expresión produce {} y aquí se espera {}",
                actual.describe(),
                expected.describe()
            ),
        ));
    }

    Ok(expr)
}

/// Estado del descenso recursivo.
struct Parser<'a> {
    tokens: Vec<Spanned>,
    position: usize,
    schema: &'a Schema,
    /// Anidamiento actual del analizador, para abortar antes de agotar la pila.
    nesting: usize,
    /// Nodos construidos hasta ahora, para no llegar a construir un árbol enorme.
    nodes: usize,
}

impl Parser<'_> {
    /// Token actual, sin consumirlo.
    fn peek(&self) -> Option<&Spanned> {
        self.tokens.get(self.position)
    }

    /// Consume y devuelve el token actual.
    fn advance(&mut self) -> Option<Spanned> {
        let token = self.tokens.get(self.position).cloned();
        if token.is_some() {
            self.position += 1;
        }
        token
    }

    /// Comprueba que el token actual es el esperado y lo consume.
    ///
    /// El mensaje nombra lo que se encontró —o avisa de que la fórmula terminó ahí—
    /// porque «se esperaba )» a secas, al final de una fórmula larga, deja al autor
    /// buscando el paréntesis que falta sin ninguna pista de dónde mirar.
    fn expect(&mut self, expected: &Token) -> Result<()> {
        match self.peek() {
            Some(found) if &found.token == expected => {
                self.position += 1;
                Ok(())
            }
            Some(found) => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "se esperaba {} y se encontró {} (columna {})",
                    expected.describe(),
                    found.token.describe(),
                    found.at
                ),
            )),
            None => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!("se esperaba {} y la expresión terminó", expected.describe()),
            )),
        }
    }

    /// Registra un nodo recién construido, aplicando el presupuesto.
    fn node(&mut self, expr: Expr) -> Result<Expr> {
        self.nodes += 1;
        if self.nodes > limits::MAX_NODES {
            return Err(FormulaError::new(
                ErrorCode::LimiteExcedido,
                format!(
                    "la fórmula pasa de {} nodos, que es el máximo admitido",
                    limits::MAX_NODES
                ),
            ));
        }
        Ok(expr)
    }

    /// Entra en un nivel de anidamiento, aplicando el tope de seguridad.
    fn enter(&mut self) -> Result<()> {
        self.nesting += 1;
        if self.nesting > MAX_PARSE_NESTING {
            return Err(FormulaError::new(
                ErrorCode::LimiteExcedido,
                format!("la fórmula anida más de {MAX_PARSE_NESTING} niveles"),
            ));
        }
        Ok(())
    }

    /// Sale del nivel de anidamiento actual.
    fn leave(&mut self) {
        self.nesting -= 1;
    }

    /// `expresión := o`
    fn parse_expression(&mut self) -> Result<Expr> {
        self.enter()?;
        let result = self.parse_or();
        self.leave();
        result
    }

    /// `o := y ( "o" y )*`
    fn parse_or(&mut self) -> Result<Expr> {
        let mut left = self.parse_and()?;
        while self.peek_is_keyword("o") {
            self.advance();
            let right = self.parse_and()?;
            left = self.node(Expr::Or {
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    /// `y := no ( "y" no )*`
    fn parse_and(&mut self) -> Result<Expr> {
        let mut left = self.parse_not()?;
        while self.peek_is_keyword("y") {
            self.advance();
            let right = self.parse_not()?;
            left = self.node(Expr::And {
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    /// `no := "no" no | comparación`
    fn parse_not(&mut self) -> Result<Expr> {
        if self.peek_is_keyword("no") {
            self.advance();
            self.enter()?;
            let operand = self.parse_not();
            self.leave();
            return self.node(Expr::Not {
                operand: Box::new(operand?),
            });
        }
        self.parse_comparison()
    }

    /// `comparación := aditiva ( (== | != | < | <= | > | >=) aditiva )?`
    ///
    /// NO es asociativa, y una segunda comparación se rechaza con un mensaje que dice qué
    /// hacer. Dejarla encadenar produciría `(a < b) < c`, una comparación entre una
    /// condición y un número: el verificador de tipos la rechazaría igual, pero con «tipo
    /// incompatible» en vez de con la instrucción que el autor necesita.
    fn parse_comparison(&mut self) -> Result<Expr> {
        let left = self.parse_additive()?;

        let Some(operator) = self.peek().map(|t| t.token.clone()) else {
            return Ok(left);
        };
        if !is_comparison(&operator) {
            return Ok(left);
        }
        self.advance();
        let right = self.parse_additive()?;

        if let Some(next) = self.peek() {
            if is_comparison(&next.token) {
                return Err(FormulaError::new(
                    ErrorCode::ExpresionMalFormada,
                    format!(
                        "las comparaciones no se encadenan; combínalas con «y» (columna {})",
                        next.at
                    ),
                ));
            }
        }

        let left = Box::new(left);
        let right = Box::new(right);
        let node = match operator {
            Token::Lt => Expr::Lt { left, right },
            Token::Le => Expr::Le { left, right },
            Token::Gt => Expr::Gt { left, right },
            Token::Ge => Expr::Ge { left, right },
            Token::Eq => Expr::Eq { left, right },
            _ => Expr::Ne { left, right },
        };
        self.node(node)
    }

    /// `aditiva := multiplicativa ( (+ | -) multiplicativa )*`
    fn parse_additive(&mut self) -> Result<Expr> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let subtract = match self.peek().map(|t| &t.token) {
                Some(Token::Plus) => false,
                Some(Token::Minus) => true,
                _ => return Ok(left),
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            let node = if subtract {
                Expr::Sub {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            } else {
                Expr::Add {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            };
            left = self.node(node)?;
        }
    }

    /// `multiplicativa := unaria ( (* | /) unaria )*`
    fn parse_multiplicative(&mut self) -> Result<Expr> {
        let mut left = self.parse_unary()?;
        loop {
            let divide = match self.peek().map(|t| &t.token) {
                Some(Token::Star) => false,
                Some(Token::Slash) => true,
                _ => return Ok(left),
            };
            self.advance();
            let right = self.parse_unary()?;
            let node = if divide {
                Expr::Div {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            } else {
                Expr::Mul {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            };
            left = self.node(node)?;
        }
    }

    /// `unaria := "-" unaria | primaria`
    ///
    /// El signo se trata aquí y no en el analizador léxico, para que `-5` y `- 5` sean la
    /// misma fórmula y produzcan el mismo árbol. Dos formas de escribir lo mismo con dos
    /// árboles distintos es exactamente lo que haría irreproducible un resultado guardado.
    fn parse_unary(&mut self) -> Result<Expr> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Minus)) {
            self.advance();
            self.enter()?;
            let operand = self.parse_unary();
            self.leave();
            return self.node(Expr::Neg {
                operand: Box::new(operand?),
            });
        }
        self.parse_primary()
    }

    /// `primaria := número | campo | @INDICADOR | "(" expresión ")" | llamada | si(…) | presente(…)`
    fn parse_primary(&mut self) -> Result<Expr> {
        let Some(found) = self.advance() else {
            return Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                "la expresión termina donde se esperaba un valor".to_owned(),
            ));
        };

        match found.token {
            Token::Number(value) => self.node(Expr::Num { value }),

            Token::LParen => {
                self.enter()?;
                let inner = self.parse_expression();
                self.leave();
                let inner = inner?;
                self.expect(&Token::RParen)?;
                Ok(inner)
            }

            Token::Indicator(name) => {
                if !self.schema.indicators.contains(&name) {
                    return Err(FormulaError::new(
                        ErrorCode::IndicadorDesconocido,
                        format!(
                            "el indicador @{name} no está en el catálogo{}",
                            self.known_indicators_hint()
                        ),
                    ));
                }
                self.node(Expr::Indicator { name })
            }

            Token::Ident(name) => self.parse_identifier(&name, found.at),

            other => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "se esperaba un valor y se encontró {} (columna {})",
                    other.describe(),
                    found.at
                ),
            )),
        }
    }

    /// Resuelve un identificador: condicional, `presente`, llamada o campo.
    ///
    /// El orden de las comprobaciones no es indiferente. Se mira primero el paréntesis
    /// —que distingue una llamada de un nombre suelto— y solo después si el nombre es un
    /// campo declarado, porque un campo que además se llamara como una función debe
    /// resolverse por la FORMA de la expresión y no por cuál de las dos listas se consultó
    /// antes.
    fn parse_identifier(&mut self, name: &str, at: usize) -> Result<Expr> {
        let followed_by_call = matches!(self.peek().map(|t| &t.token), Some(Token::LParen));

        match name {
            "si" => {
                if !followed_by_call {
                    return Err(FormulaError::new(
                        ErrorCode::ExpresionMalFormada,
                        format!(
                            "«si» necesita sus tres argumentos entre paréntesis (columna {at})"
                        ),
                    ));
                }
                self.parse_conditional()
            }
            "presente" => {
                if !followed_by_call {
                    return Err(FormulaError::new(
                        ErrorCode::ExpresionMalFormada,
                        "«presente» necesita el nombre de un campo entre paréntesis".to_owned(),
                    ));
                }
                self.parse_presence()
            }
            _ if followed_by_call => {
                let Some(func) = Func::from_name(name) else {
                    return Err(FormulaError::new(
                        ErrorCode::FuncionDesconocida,
                        format!("la función «{name}» no existe (columna {at})"),
                    ));
                };
                self.parse_call(func)
            }
            _ if self.schema.fields.contains_key(name) => self.node(Expr::Field {
                key: name.to_owned(),
            }),
            // Un nombre que no es campo ni función tiene tres causas distintas, y el orden
            // de estos brazos importa: si el primero consultara la lista ANCHA —la que
            // incluye los nombres de función—, el segundo sería inalcanzable y a quien
            // escribiera `pot` se le diría «es una palabra del lenguaje» en vez de «te
            // faltan los argumentos», que es lo que tiene que corregir.
            _ if is_language_keyword(name) => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "«{name}» es una palabra del lenguaje y no puede usarse como campo \
                     (columna {at})"
                ),
            )),
            _ if Func::from_name(name).is_some() => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!("la función «{name}» necesita sus argumentos entre paréntesis"),
            )),
            _ => Err(FormulaError::new(
                ErrorCode::CampoInexistente,
                format!(
                    "el campo «{name}» no está declarado entre las entradas{}",
                    self.known_fields_hint()
                ),
            )),
        }
    }

    /// `si(cond, entonces, si_no)`
    fn parse_conditional(&mut self) -> Result<Expr> {
        self.expect(&Token::LParen)?;
        self.enter()?;
        let parsed = (|| {
            let cond = self.parse_expression()?;
            self.expect(&Token::Comma)?;
            let then_branch = self.parse_expression()?;
            self.expect(&Token::Comma)?;
            let else_branch = self.parse_expression()?;
            Ok((cond, then_branch, else_branch))
        })();
        self.leave();
        let (cond, then_branch, else_branch) = parsed?;
        self.expect(&Token::RParen)?;

        self.node(Expr::If {
            cond: Box::new(cond),
            then_branch: Box::new(then_branch),
            else_branch: Box::new(else_branch),
        })
    }

    /// `presente(campo)`
    fn parse_presence(&mut self) -> Result<Expr> {
        self.expect(&Token::LParen)?;
        let Some(found) = self.advance() else {
            return Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                "presente(…) necesita el nombre de un campo".to_owned(),
            ));
        };
        let Token::Ident(key) = found.token else {
            return Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "presente(…) necesita el NOMBRE de un campo y se encontró {} (columna {})",
                    found.token.describe(),
                    found.at
                ),
            ));
        };
        if !self.schema.fields.contains_key(&key) {
            return Err(FormulaError::new(
                ErrorCode::CampoInexistente,
                format!(
                    "presente(«{key}») nombra un campo que no está declarado{}",
                    self.known_fields_hint()
                ),
            ));
        }
        self.expect(&Token::RParen)?;
        self.node(Expr::Present { key })
    }

    /// `nombre(argumento, …)` con la aridad de la tabla de funciones.
    fn parse_call(&mut self, func: Func) -> Result<Expr> {
        self.expect(&Token::LParen)?;
        self.enter()?;
        let parsed = (|| {
            let mut args = Vec::with_capacity(func.arity());
            if func.arity() > 0 {
                args.push(self.parse_expression()?);
                while matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                    self.advance();
                    args.push(self.parse_expression()?);
                }
            }
            Ok(args)
        })();
        self.leave();
        let args = parsed?;
        self.expect(&Token::RParen)?;

        if args.len() != func.arity() {
            return Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                format!(
                    "{}(…) necesita {} argumentos y recibió {}",
                    func.name(),
                    func.arity(),
                    args.len()
                ),
            ));
        }

        self.node(Expr::Call { func, args })
    }

    /// Pista con los indicadores conocidos, para no dejar al autor adivinando.
    fn known_indicators_hint(&self) -> String {
        if self.schema.indicators.is_empty() {
            return "; todavía no hay ninguno cargado".to_owned();
        }
        format!(
            "; los cargados son {}",
            self.schema
                .indicators
                .iter()
                .map(|name| format!("@{name}"))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    /// Pista con los campos declarados.
    fn known_fields_hint(&self) -> String {
        if self.schema.fields.is_empty() {
            return String::new();
        }
        format!(
            "; los declarados son {}",
            self.schema
                .fields
                .keys()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    /// Comprueba si el token actual es una palabra clave del lenguaje.
    ///
    /// Se compara como identificador y no como token propio porque `o` y `y` son nombres
    /// plausibles de campo. Reservarlos en el analizador léxico los volvería imposibles de
    /// usar en cualquier posición; aquí solo se reservan donde el lenguaje los necesita
    /// como operador, y `unavailable_as_field_name` cierra el caso restante.
    fn peek_is_keyword(&self, keyword: &str) -> bool {
        matches!(self.peek().map(|t| &t.token), Some(Token::Ident(name)) if name == keyword)
    }
}

/// Comprueba la forma de los argumentos que no son valores cualesquiera.
///
/// La hace este módulo y no [`super::functions`] porque comprobar un exponente exige
/// saber si el CAMPO referenciado es de tipo entero, y ese dato está en el esquema, que
/// solo el analizador tiene. Repartir esa comprobación entre los dos módulos dejaría dos
/// sitios donde olvidarla.
///
/// # Errores
///
/// [`ErrorCode::ExponenteNoEntero`] y [`ErrorCode::ExpresionMalFormada`].
fn check_arguments(expr: &Expr, schema: &Schema) -> Result<()> {
    if let Expr::Call { func, args } = expr {
        for (index, argument) in args.iter().enumerate() {
            check_argument_shape(*func, index, argument, schema)?;
        }
    }
    for child in expr.children() {
        check_arguments(child, schema)?;
    }
    Ok(())
}

/// Comprueba un argumento concreto contra la exigencia de su posición.
fn check_argument_shape(func: Func, index: usize, argument: &Expr, schema: &Schema) -> Result<()> {
    match func.arg_constraint(index) {
        ArgConstraint::Any => Ok(()),

        // Un campo de tipo ENTERO es la única expresión de la que se puede demostrar que
        // es entera, y es el caso que usan las siete semillas: `pot(base, meses)`,
        // `tasa_periodica(anual, 12)`. Los demás tipos se rechazan al guardar en vez de
        // al calcular, que es lo que pide D-15.
        ArgConstraint::Exponent | ArgConstraint::Periods => match argument {
            Expr::Num { value } if value.fract().is_zero() && !value.is_sign_negative() => Ok(()),
            Expr::Field { key } if is_integer_field(schema, key) => Ok(()),
            Expr::Field { key } => Err(FormulaError::new(
                ErrorCode::ExponenteNoEntero,
                format!(
                    "{}(…) necesita un entero en la posición {} y el campo «{key}» no es de \
                     tipo entero; decláralo como entero, o usa potd si el exponente puede \
                     tener decimales",
                    func.name(),
                    index + 1
                ),
            )),
            _ => Err(FormulaError::new(
                ErrorCode::ExponenteNoEntero,
                format!(
                    "{}(…) necesita un entero en la posición {}, y una expresión calculada no \
                     permite demostrar que lo sea; usa un número entero, un campo de tipo \
                     entero, o potd si el exponente puede tener decimales",
                    func.name(),
                    index + 1
                ),
            )),
        },

        // La escala se fija al GUARDAR y no se calcula: si dependiera de una entrada, el
        // mismo AST daría resultados con distinto número de decimales según los datos, y
        // el redondeo dejaría de ser una propiedad de la definición.
        ArgConstraint::Scale => match argument {
            Expr::Num { value } if value.fract().is_zero() && !value.is_sign_negative() => {
                let scale = value.to_u32().unwrap_or(u32::MAX);
                if scale > functions::MAX_SCALE {
                    return Err(FormulaError::new(
                        ErrorCode::LimiteExcedido,
                        format!(
                            "la escala de redondear no puede pasar de {}, no {scale}",
                            functions::MAX_SCALE
                        ),
                    ));
                }
                Ok(())
            }
            _ => Err(FormulaError::new(
                ErrorCode::ExpresionMalFormada,
                "el segundo argumento de redondear debe ser un número entero literal: la escala \
                 se fija al guardar la calculadora, no se calcula al ejecutarla"
                    .to_owned(),
            )),
        },
    }
}

/// Comprueba si un campo está declarado como entero.
///
/// La clave ya se comprobó declarada al analizar, así que un `false` aquí significa «está
/// declarado y no es entero», no «no existe».
fn is_integer_field(schema: &Schema, key: &str) -> bool {
    matches!(
        schema.fields.get(key),
        Some(crate::domain::formula::ast::InputKind::Entero)
    )
}

/// Infiere el tipo de una expresión.
///
/// Cada nodo se visita una sola vez —las comprobaciones de los hijos llaman a [`infer`]
/// sobre el subárbol que les toca, y ese subárbol no se vuelve a mirar—, así que el coste
/// es lineal en el número de nodos. Importa porque este recorrido corre en cada guardado.
///
/// # Errores
///
/// [`ErrorCode::TipoIncompatible`] en cuanto un operador recibe un tipo que no le
/// corresponde. Se comprueba al GUARDAR y no al ejecutar (D-15): un autor que escribe
/// `monto + (a > b)` debe enterarse mientras edita y no un lector tres semanas después.
fn infer(expr: &Expr) -> Result<Type> {
    match expr {
        Expr::Num { .. } | Expr::Field { .. } | Expr::Indicator { .. } => Ok(Type::Number),
        Expr::Present { .. } => Ok(Type::Boolean),

        Expr::Neg { operand } => require(operand, Type::Number).map(|()| Type::Number),

        Expr::Add { left, right }
        | Expr::Sub { left, right }
        | Expr::Mul { left, right }
        | Expr::Div { left, right } => {
            require(left, Type::Number)?;
            require(right, Type::Number)?;
            Ok(Type::Number)
        }

        Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right }
        | Expr::Eq { left, right }
        | Expr::Ne { left, right } => {
            require(left, Type::Number)?;
            require(right, Type::Number)?;
            Ok(Type::Boolean)
        }

        Expr::And { left, right } | Expr::Or { left, right } => {
            require(left, Type::Boolean)?;
            require(right, Type::Boolean)?;
            Ok(Type::Boolean)
        }

        Expr::Not { operand } => require(operand, Type::Boolean).map(|()| Type::Boolean),

        Expr::If {
            cond,
            then_branch,
            else_branch,
        } => {
            require(cond, Type::Boolean)?;
            let then_type = infer(then_branch)?;
            let else_type = infer(else_branch)?;
            if then_type != else_type {
                return Err(FormulaError::new(
                    ErrorCode::TipoIncompatible,
                    format!(
                        "las dos ramas del condicional deben producir lo mismo: una produce {} \
                         y la otra {}",
                        then_type.describe(),
                        else_type.describe()
                    ),
                ));
            }
            Ok(then_type)
        }

        // Todas las funciones de la tabla reciben y devuelven números; `presente` no está
        // aquí porque tiene variante propia y devuelve una condición.
        Expr::Call { args, .. } => {
            for argument in args {
                require(argument, Type::Number)?;
            }
            Ok(Type::Number)
        }
    }
}

/// Exige que una expresión tenga un tipo concreto.
fn require(expr: &Expr, expected: Type) -> Result<()> {
    let actual = infer(expr)?;
    if actual == expected {
        return Ok(());
    }
    Err(FormulaError::new(
        ErrorCode::TipoIncompatible,
        format!(
            "se esperaba {} y se encontró {}",
            expected.describe(),
            actual.describe()
        ),
    ))
}
