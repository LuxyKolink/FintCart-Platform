//! Tabla de funciones del lenguaje (T083, D-15).
//!
//! ## `pot` y `potd` son DOS funciones, y esa es la decisión que sostiene FR-049
//!
//! Fundirlas en una sola «potencia» que decida por su argumento si usa la vía exacta o
//! la aproximada parece más cómodo y **perdería en silencio la exactitud del Principio
//! VIII**. Elevar a un entero es multiplicación repetida: exacta en decimal, sin una
//! sola operación trascendente. Elevar a un exponente decimal no tiene representación
//! finita en general —`(1.02)^(1/12)` no la tiene— y obliga a pasar por `exp` y `ln`.
//!
//! La diferencia no es teórica, y el código nativo que estas funciones reproducen la
//! documenta con una cifra: para un plazo de 240 meses, hacer la potencia por logaritmos
//! desvía el resultado «hasta los pesos» (`annuity.rs:26`). Una sola función «potencia»
//! que eligiera sola acabaría usando la vía aproximada donde el código usa la exacta, y
//! **los resultados históricos cambiarían sin que ninguna prueba de las otras cuatro
//! calculadoras lo notara**. Por eso son dos nombres y elige el autor: `pot` donde el
//! exponente es entero, `potd` donde es decimal y la aproximación es inevitable.
//!
//! ## Las primitivas financieras NO se reimplementan aquí
//!
//! `cuota`, `vf_serie` y `tasa_periodica` delegan en [`crate::domain::annuity`],
//! que es el módulo que ya usan las cinco calculadoras nativas. Reimplementar las
//! fórmulas en este archivo crearía dos definiciones de la misma cuota, y la suite de
//! regresión de las semillas (T092) compararía el motor contra sí mismo en lugar de
//! contra el código vigente — que es justo lo que tiene que detectar.
//!
//! ## Este módulo NO valida los argumentos
//!
//! Declara qué exige cada posición ([`ArgConstraint`]) y aplica la operación. Quien
//! comprueba es el analizador, porque hacerlo requiere el ESQUEMA —saber si el campo del
//! exponente es de tipo entero— y el esquema vive en el análisis, no aquí. Repartir esa
//! comprobación entre los dos módulos dejaría dos sitios donde olvidarla.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, MathematicalOps};

use crate::domain::annuity;
use crate::domain::currency::round_money;
use crate::domain::decimal_str;
use crate::domain::error::{Error, Result as DomainResult};
use crate::domain::formula::ast::Func;
use crate::domain::inputs::MAX_PERIODS;

/// Escala máxima que admite el redondeo de `rust_decimal`.
///
/// `Decimal` representa como mucho 28 decimales, así que una escala mayor no significa
/// nada. Se declara aquí para poder rechazarla con un mensaje en vez de dejarla llegar a
/// una función que puede entrar en pánico.
pub const MAX_SCALE: u32 = 28;

/// Tope del exponente de `pot`.
///
/// Es el mismo [`MAX_PERIODS`] que acota los plazos de las calculadoras nativas, y la
/// razón es la misma: no es una regla de negocio sino una barrera de **coste acotado**.
/// `checked_powu` multiplica de una en una, así que `pot(1, 1000000000)` no desbordaría
/// —uno elevado a cualquier cosa es uno— y daría mil millones de multiplicaciones. Sin
/// este tope, la promesa de D-15 («coste acotado por construcción») sería falsa para una
/// fórmula perfectamente aceptable al guardar.
pub const MAX_EXPONENT: u32 = MAX_PERIODS;

/// Qué se exige a un argumento, además de ser un número.
///
/// Existe porque dos funciones del lenguaje tienen argumentos que **no son valores
/// cualesquiera** sino parámetros de forma: `pot` eleva a un entero y `redondear` recibe
/// una escala. Declararlo aquí, junto a la función, es lo que hace que el analizador no
/// tenga que llevar su propia lista de excepciones —lista que se desincronizaría en
/// cuanto se añadiera una función.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgConstraint {
    /// Un valor decimal cualquiera.
    Any,
    /// Un exponente: entero, no negativo y acotado por [`MAX_EXPONENT`].
    Exponent,
    /// Un número de periodos: entero, mayor que cero y acotado por [`MAX_PERIODS`].
    Periods,
    /// Una escala de redondeo: entero entre 0 y [`MAX_SCALE`].
    Scale,
}

impl Func {
    /// Traduce el nombre escrito en la fórmula.
    ///
    /// Devuelve `None` para un nombre desconocido en lugar de un error, porque quien
    /// llama distingue dos casos que aquí se ven iguales: un nombre que no es función
    /// **y** no es campo declarado produce `funcion_desconocida`, mientras que uno que sí
    /// es campo se analiza como variable. Ver `parser::primary`.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "pot" => Some(Self::Pot),
            "potd" => Some(Self::Potd),
            "redondear" => Some(Self::Redondear),
            "redondear_dinero" => Some(Self::RedondearDinero),
            "min" => Some(Self::Min),
            "max" => Some(Self::Max),
            "abs" => Some(Self::Abs),
            "cuota" => Some(Self::Cuota),
            "vf_serie" => Some(Self::VfSerie),
            "tasa_periodica" => Some(Self::TasaPeriodica),
            _ => None,
        }
    }

    /// Nombre con el que se escribe en una fórmula.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Pot => "pot",
            Self::Potd => "potd",
            Self::Redondear => "redondear",
            Self::RedondearDinero => "redondear_dinero",
            Self::Min => "min",
            Self::Max => "max",
            Self::Abs => "abs",
            Self::Cuota => "cuota",
            Self::VfSerie => "vf_serie",
            Self::TasaPeriodica => "tasa_periodica",
        }
    }

    /// Número de argumentos que recibe.
    ///
    /// Todas las funciones del lenguaje tienen aridad FIJA, y por eso se declara como un
    /// número y no como un rango. Una función variádica obligaría a decidir en tiempo de
    /// ejecución qué significa cada argumento, y el lenguaje no necesita ninguna.
    #[must_use]
    pub const fn arity(self) -> usize {
        match self {
            // `redondear(x, escala)` y `tasa_periodica(anual, m)` reciben DOS argumentos: la
            // escala y el número de periodos son el SEGUNDO, no un tercero. Es fácil
            // confundirlas con `cuota`/`vf_serie`, que sí llevan tres, y equivocarse hace
            // que toda fórmula que las use falle al guardar por aridad.
            Self::Pot
            | Self::Potd
            | Self::Min
            | Self::Max
            | Self::Redondear
            | Self::TasaPeriodica => 2,
            Self::Cuota | Self::VfSerie => 3,
            Self::RedondearDinero | Self::Abs => 1,
        }
    }

    /// Exigencia adicional de un argumento, por su índice (base 0).
    ///
    /// Los índices coinciden con la documentación de D-15: `pot(base, n)`,
    /// `cuota(capital, i, n)`, `vf_serie(aporte, i, n)`, `tasa_periodica(anual, m)`.
    #[must_use]
    pub const fn arg_constraint(self, index: usize) -> ArgConstraint {
        match (self, index) {
            (Self::Pot, 1) => ArgConstraint::Exponent,
            (Self::Cuota, 2) | (Self::VfSerie, 2) | (Self::TasaPeriodica, 1) => {
                ArgConstraint::Periods
            }
            (Self::Redondear, 1) => ArgConstraint::Scale,
            _ => ArgConstraint::Any,
        }
    }

    /// Descripción breve, para la ayuda contextual del constructor (T160).
    ///
    /// Vive junto a la función y no en el frontend para que no puedan discrepar: el texto
    /// que explica `pot` se escribe donde se define `pot`.
    #[must_use]
    pub const fn help(self) -> &'static str {
        match self {
            Self::Pot => "pot(base, n) — base elevada a n, con n ENTERO. Exacta.",
            Self::Potd => {
                "potd(base, x) — base elevada a x, con x decimal. APROXIMADA: \
                 usa pot si el exponente es entero."
            }
            Self::Redondear => "redondear(x, escala) — redondeo bancario (half-even).",
            Self::RedondearDinero => {
                "redondear_dinero(x) — redondeo bancario a la escala monetaria (2)."
            }
            Self::Min => "min(a, b) — el menor de los dos.",
            Self::Max => "max(a, b) — el mayor de los dos.",
            Self::Abs => "abs(x) — valor absoluto.",
            Self::Cuota => "cuota(capital, i, n) — cuota nivelada de amortización francesa.",
            Self::VfSerie => "vf_serie(aporte, i, n) — valor futuro de aportes iguales.",
            Self::TasaPeriodica => "tasa_periodica(anual, m) — división nominal anual / m.",
        }
    }

    /// Convierte un argumento ya evaluado al entero que exige su posición.
    ///
    /// ## Por qué se vuelve a comprobar lo que el analizador ya comprobó
    ///
    /// El analizador demostró que la EXPRESIÓN es entera: un literal sin parte
    /// fraccionaria o un campo declarado de tipo entero. Pero el tipo declarado es una
    /// promesa sobre el dato, no sobre lo que llega: un campo de tipo entero puede recibir
    /// `"12.5"` —el contrato lo transporta como texto y nada lo impide antes de aquí—. Con
    /// `to_u32().unwrap()`, el servicio entraría en pánico y el usuario vería un fallo
    /// interno en lugar del parámetro que envió mal.
    ///
    /// Los topes son los de [`ArgConstraint`], que a su vez son barreras de coste y no
    /// reglas de negocio: `pot` admite cero —`x^0` es uno y es una operación legítima—,
    /// mientras que un número de periodos igual a cero dividiría por cero dentro de las
    /// primitivas de anualidad.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si el valor no es entero, es negativo, o excede el tope de
    /// su posición.
    pub fn integer_argument(self, index: usize, value: Decimal) -> DomainResult<u32> {
        let constraint = self.arg_constraint(index);
        let (minimum, maximum) = match constraint {
            ArgConstraint::Exponent => (0, MAX_EXPONENT),
            ArgConstraint::Periods => (1, MAX_PERIODS),
            ArgConstraint::Scale => (0, MAX_SCALE),
            ArgConstraint::Any => {
                return Err(Error::InvalidInput(format!(
                    "{}(…) no tiene un argumento entero en la posición {}",
                    self.name(),
                    index + 1
                )))
            }
        };

        if !value.fract().is_zero() {
            return Err(Error::InvalidInput(format!(
                "{}(…) necesita un número entero en la posición {} y recibió {}",
                self.name(),
                index + 1,
                decimal_str::format(value)
            )));
        }

        let converted = value.to_u32().ok_or_else(|| {
            Error::InvalidInput(format!(
                "{}(…) recibió un valor fuera de rango en la posición {}: {}",
                self.name(),
                index + 1,
                decimal_str::format(value)
            ))
        })?;

        if converted < minimum || converted > maximum {
            return Err(Error::InvalidInput(format!(
                "{}(…) recibió {converted} en la posición {} y el rango admitido es \
                 {minimum}..={maximum}",
                self.name(),
                index + 1
            )));
        }

        Ok(converted)
    }
}

/// Aplica una función a sus argumentos ya evaluados.
///
/// # Errores
///
/// [`Error::InvalidInput`] cuando la operación no es representable —división por cero
/// dentro de las primitivas de anualidad, desbordamiento de la mantisa, exponente que no
/// cabe en un entero—. Ningún camino entra en pánico: todas las operaciones usan las
/// variantes `checked_*` de [`Decimal`], que devuelven `None` en lugar de saturar o de
/// abortar (T076).
pub fn apply(func: Func, args: &[Decimal]) -> DomainResult<Decimal> {
    // La aridad la garantiza el analizador al construir el nodo, así que un desajuste aquí
    // solo puede venir de un AST leído de la base. Se comprueba igualmente porque los
    // índices de abajo entrarían en pánico, y un árbol persistido por otra versión del
    // código no es un escenario hipotético.
    if args.len() != func.arity() {
        return Err(Error::InvalidInput(format!(
            "{}(…) recibió {} argumentos y necesita {}",
            func.name(),
            args.len(),
            func.arity()
        )));
    }

    match func {
        Func::Pot => {
            let exponent = func.integer_argument(1, args[1])?;
            args[0].checked_powu(u64::from(exponent)).ok_or_else(|| {
                Error::InvalidInput(format!(
                    "pot({}, {exponent}) desborda la precisión disponible",
                    decimal_str::format(args[0])
                ))
            })
        }
        // El exponente de `potd` no se acota: `checked_powd` resuelve por `exp`/`ln`, que
        // es coste constante, así que un exponente enorme no puede alargar el cálculo —
        // simplemente desborda y devuelve `None`.
        Func::Potd => args[0].checked_powd(args[1]).ok_or_else(|| {
            Error::InvalidInput(format!(
                "potd({}, {}) no es representable",
                decimal_str::format(args[0]),
                decimal_str::format(args[1])
            ))
        }),
        Func::Redondear => {
            let scale = func.integer_argument(1, args[1])?;
            Ok(decimal_str::round_half_even(args[0], scale))
        }
        Func::RedondearDinero => Ok(round_money(args[0])),
        Func::Min => Ok(args[0].min(args[1])),
        Func::Max => Ok(args[0].max(args[1])),
        // `Decimal` no expone `checked_abs`, y `abs()` puede desbordar en el extremo de su
        // mantisa. Se niega con `checked_sub` sobre cero, que es el mismo cálculo y sí
        // informa del desbordamiento en vez de entrar en pánico.
        Func::Abs => {
            if args[0].is_sign_negative() {
                Decimal::ZERO.checked_sub(args[0]).ok_or_else(|| {
                    Error::InvalidInput(format!(
                        "abs({}) desborda la precisión disponible",
                        decimal_str::format(args[0])
                    ))
                })
            } else {
                Ok(args[0])
            }
        }
        Func::Cuota => annuity::level_payment(args[0], args[1], func.integer_argument(2, args[2])?),
        Func::VfSerie => {
            annuity::future_value_of_series(args[0], args[1], func.integer_argument(2, args[2])?)
        }
        Func::TasaPeriodica => annuity::periodic_rate(args[0], func.integer_argument(1, args[1])?),
    }
}
