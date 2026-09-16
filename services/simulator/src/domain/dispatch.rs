//! Despacho por tipo de cálculo (FR-019) y traducción del resultado a la forma del
//! contrato.
//!
//! Es la frontera entre el enum del `.proto` y las cinco funciones de
//! [`crate::calculators`]. Vive en `domain` y no en `grpc` a propósito: el despacho es
//! una regla del servicio —qué calculadoras existen— y no un detalle de transporte.
//! Con él aquí, una prueba puede ejercitar las cinco rutas sin levantar un servidor.

use std::collections::HashMap;

use rust_decimal::Decimal;

use crate::calculators::{ahorro, colombia, credito, inversion, presupuesto, Outcome};
use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;
use crate::pb::fintcart::simulator::v1::CalcType;

/// Valor de `simulations.calc_type` de una simulación hecha con una calculadora de USUARIO.
///
/// Coincide con el `CHECK` ampliado por la migración de D-26 y con
/// [`crate::pb::fintcart::simulator::v1::CalcType::Usuario`].
///
/// NO es una variante de [`Kind`], y la distinción importa: `Kind` es la lista de calculadoras
/// **nativas**, y su razón de ser es que [`compute`] elige con él una función del código nativo.
/// Una calculadora de usuario no tiene función nativa que elegir —lo que tiene es un AST—, así
/// que meterla en `Kind` obligaría a `compute` a contemplar un caso que no puede ejecutar, y un
/// brazo inalcanzable en un `match` es una invitación a que alguien lo rellene con lo que
/// parezca.
pub const CALC_TYPE_USUARIO: &str = "usuario";

/// Traduce el `calc_type` ALMACENADO al enum del contrato.
///
/// Existe porque el vocabulario de la COLUMNA es más ancho que el de [`Kind`]: guarda los cinco
/// tipos nativos y además `usuario`. El camino de la petición (`calc_type` → `Kind`) y el del
/// historial (columna → enum) son direcciones distintas y con reglas distintas, y por eso no
/// comparten función.
///
/// # Errores
///
/// [`Error::InvalidInput`] si la columna trae un valor que no corresponde a ningún tipo.
pub fn stored_to_proto(value: &str) -> Result<CalcType> {
    if value == CALC_TYPE_USUARIO {
        return Ok(CalcType::Usuario);
    }
    Ok(Kind::from_db(value)?.as_proto())
}

/// Las siete definiciones semilla y el tipo NATIVO que cada una reproduce (D-16).
///
/// Es la tabla que relaciona los dos vocabularios, y existe porque **no son el mismo**:
/// `colombia_especifica` era UNA calculadora nativa con un discriminador de texto, y D-16
/// la separó en tres definiciones. Las otras cuatro van una a una, y por eso el nombre de
/// la semilla y `Kind::as_db` coinciden en ellas — lo que hace tentador saltarse la tabla
/// para esas cuatro, y es justo lo que no hay que hacer: una regla partida en dos sitios
/// es una regla que se desincroniza en uno.
///
/// Que las siete sean ESTAS siete lo comprueba `seed_regression` contra `seeds::drafts()`,
/// que es la lista de verdad. Igual que `INDICATORS` frente a los indicadores sembrados:
/// la duplicación se admite porque hay una prueba que la hace imposible de divergir.
pub const SEEDS: [(&str, Kind); 7] = [
    ("ahorro", Kind::Ahorro),
    ("credito", Kind::Credito),
    ("presupuesto", Kind::Presupuesto),
    ("inversion", Kind::Inversion),
    ("ea_a_mv", Kind::ColombiaEspecifica),
    ("mv_a_ea", Kind::ColombiaEspecifica),
    ("gmf", Kind::ColombiaEspecifica),
];

/// Nombre de la semilla que reproduce una ejecución nativa.
///
/// Lo usa el camino de compatibilidad por `calc_type` para atribuir la simulación a la
/// definición que la explica (FR-050). El contrato ya lo dice así: «`calc_type` se mantiene
/// por compatibilidad y **se resuelve a la definición semilla correspondiente**».
///
/// El caso de `colombia_especifica` necesita las entradas y no solo el tipo, porque a las
/// tres semillas que salieron de ella las distingue el discriminador `operacion` — que es
/// exactamente el dato con el que la migración de T020 desambiguó el historial.
///
/// # Errores
///
/// [`Error::Storage`] con `RowNotFound` si un `colombia_especifica` llega sin un
/// `operacion` reconocible. No se inventa una recuperación —no hay nombre al que atribuir
/// la fila— por la misma razón que en `repo::seeds::definition_vigente`: se dice lo que
/// pasa. Es inalcanzable por construcción, porque
/// [`crate::calculators::colombia::compute`] valida `operacion` antes y ya habría fallado.
pub fn seed_name(kind: Kind, raw_inputs: &HashMap<String, String>) -> Result<&'static str> {
    if kind != Kind::ColombiaEspecifica {
        return Ok(kind.as_db());
    }

    let operacion = raw_inputs.get("operacion").map_or("", String::as_str);
    SEEDS
        .iter()
        .find(|(name, seed_kind)| *seed_kind == Kind::ColombiaEspecifica && *name == operacion)
        .map(|(name, _)| *name)
        .ok_or(Error::Storage(sqlx::Error::RowNotFound))
}

/// Tipo nativo al que corresponde una definición semilla, si corresponde a alguno.
///
/// La inversa de [`seed_name`] para el caso en que las entradas no hacen falta: dado el
/// NOMBRE de una semilla, qué calculadora nativa reproduce. Devuelve `None` para cualquier
/// otro nombre, incluidas las calculadoras de usuario.
#[must_use]
pub fn kind_of_seed(name: &str) -> Option<Kind> {
    SEEDS
        .iter()
        .find(|(seed, _)| *seed == name)
        .map(|(_, kind)| *kind)
}

/// `calc_type` con el que se registra una ejecución hecha por `calculator_id` (D-29).
///
/// ## Por qué no es `'usuario'` para todo lo que llega por identificador
///
/// D-26 justificó el sexto valor diciendo que significa «definida por el usuario», y eso es
/// cierto para una calculadora de un usuario. Pero las siete semillas también se ejecutan
/// por `calculator_id` —es el camino PREFERENTE del contrato, y el catálogo público las
/// ofrece—, y escribir `'usuario'` sobre ellas afirmaría que un administrador las definió
/// cuando las define el repositorio. La columna diría algo falso sobre siete calculadoras
/// que existen desde antes que la columna.
///
/// Así que una semilla se registra con el tipo nativo que reproduce —`gmf` como
/// `colombia_especifica`, igual que las 13.493 filas históricas que la migración de T020
/// atribuyó a esa misma semilla— y `'usuario'` queda para lo que de verdad no tiene
/// equivalente nativo.
///
/// # Errores
///
/// [`Error::Storage`] con `RowNotFound` si una fila marcada `is_builtin` tiene un nombre
/// que no es ninguna de las siete. Hoy es inalcanzable —solo `dev/seed` y
/// [`crate::repo::seeds`] crean semillas, y las dos escriben esos siete nombres—, y no se
/// elige un valor por defecto porque cualquier valor sería una afirmación falsa sobre la
/// procedencia de la fila.
pub fn stored_calc_type(is_builtin: bool, name: &str) -> Result<&'static str> {
    if !is_builtin {
        return Ok(CALC_TYPE_USUARIO);
    }
    kind_of_seed(name)
        .map(Kind::as_db)
        .ok_or(Error::Storage(sqlx::Error::RowNotFound))
}

/// Tipo de cálculo ya validado, con su nombre en la base de datos.
///
/// Existe como tipo propio y no como un `&str` suelto porque el CHECK
/// `simulations_calc_type_valid` acepta exactamente cinco cadenas: derivarlas de un
/// enum cerrado hace imposible insertar una sexta, y un `match` exhaustivo obliga a
/// decidir el nombre de cualquier calculadora que se añada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Proyección de ahorro con aportes mensuales.
    Ahorro,
    /// Amortización francesa de un crédito.
    Credito,
    /// Balance mensual de ingresos y gastos.
    Presupuesto,
    /// Valor futuro de una inversión con capitalización anual.
    Inversion,
    /// Convenciones del mercado colombiano (tasas E.A./M.V. y GMF).
    ColombiaEspecifica,
}

impl Kind {
    /// Nombre con el que el tipo se persiste en `simulations.calc_type`.
    ///
    /// Coincide exactamente con el CHECK de la migración. Que salga de aquí y no de un
    /// literal en la consulta es lo que impide que un `INSERT` escriba una variante que
    /// la base rechaza recién en tiempo de ejecución.
    #[must_use]
    pub const fn as_db(self) -> &'static str {
        match self {
            Self::Ahorro => "ahorro",
            Self::Credito => "credito",
            Self::Presupuesto => "presupuesto",
            Self::Inversion => "inversion",
            Self::ColombiaEspecifica => "colombia_especifica",
        }
    }

    /// Traduce el enum del contrato.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] para `CALC_TYPE_UNSPECIFIED` y para cualquier valor
    /// desconocido. Lo primero importa: en proto3 el cero es el valor por defecto, así
    /// que un cliente que OLVIDE el campo llega aquí indistinguible de uno que lo puso
    /// a cero. Elegir una calculadora por defecto para ese caso ejecutaría un cálculo
    /// que nadie pidió y lo guardaría en el historial del usuario.
    pub fn from_proto(value: CalcType) -> Result<Self> {
        match value {
            CalcType::Ahorro => Ok(Self::Ahorro),
            CalcType::Credito => Ok(Self::Credito),
            CalcType::Presupuesto => Ok(Self::Presupuesto),
            CalcType::Inversion => Ok(Self::Inversion),
            CalcType::ColombiaEspecifica => Ok(Self::ColombiaEspecifica),
            CalcType::Unspecified => Err(Error::InvalidInput(
                "calc_type es obligatorio: no hay calculadora por defecto".to_owned(),
            )),
            // `CALC_TYPE_USUARIO` describe lo que YA PASÓ —una simulación la produjo una
            // calculadora de un usuario— y por eso es un valor de respuesta. En una PETICIÓN
            // no identifica nada: la calculadora se pide con `calculator_id`, que es lo único
            // que dice CUÁL de las definidas por usuarios se quiere.
            //
            // El `match` obliga a decidirlo: sin este brazo el compilador no compila, que es
            // exactamente lo que se busca — que añadir un valor al enum no pase inadvertido.
            CalcType::Usuario => Err(Error::InvalidInput(
                "calc_type usuario no identifica ninguna calculadora: para ejecutar una \
                 definida por un usuario hay que enviar calculator_id"
                    .to_owned(),
            )),
        }
    }

    /// Traduce el nombre almacenado de vuelta al enum del contrato.
    ///
    /// Hace falta para el historial: las filas guardan el nombre, y `ListHistory`
    /// devuelve el enum.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si la fila trae un nombre que ya no existe. Es
    /// improbable —el CHECK lo impide— pero no imposible tras una migración, y un
    /// `unwrap` convertiría ese caso en una caída del servicio al listar.
    pub fn from_db(value: &str) -> Result<Self> {
        match value {
            "ahorro" => Ok(Self::Ahorro),
            "credito" => Ok(Self::Credito),
            "presupuesto" => Ok(Self::Presupuesto),
            "inversion" => Ok(Self::Inversion),
            "colombia_especifica" => Ok(Self::ColombiaEspecifica),
            other => Err(Error::InvalidInput(format!(
                "calc_type {other:?} almacenado no corresponde a ninguna calculadora"
            ))),
        }
    }

    /// Valor del enum del contrato, para la respuesta del historial.
    #[must_use]
    pub const fn as_proto(self) -> CalcType {
        match self {
            Self::Ahorro => CalcType::Ahorro,
            Self::Credito => CalcType::Credito,
            Self::Presupuesto => CalcType::Presupuesto,
            Self::Inversion => CalcType::Inversion,
            Self::ColombiaEspecifica => CalcType::ColombiaEspecifica,
        }
    }
}

/// Serializa un resultado a la forma del contrato: `map<string, string>` canónico.
///
/// Es el ÚNICO punto donde un `Decimal` se convierte en texto para el cliente, y por eso lo
/// comparten los dos caminos de ejecución —el nativo y el de definiciones—. Dos copias
/// divergirían en un formato que el `NUMERIC` de quien consuma no admitiría: una con
/// notación científica o con separador de miles rompería la columna del servicio que lea
/// el resultado (Principio VIII / D-10).
///
/// Genérica sobre la clave porque el código nativo produce `&'static str` —las claves están
/// cableadas— y una definición produce `String` —salen del AST—, y obligar a uno de los dos
/// a convertir antes de llamar aquí repartiría la decisión de formato otra vez.
pub fn to_contract<K: Into<String>>(
    outcome: impl IntoIterator<Item = (K, Decimal)>,
) -> HashMap<String, String> {
    outcome
        .into_iter()
        .map(|(key, value)| (key.into(), decimal_str::format(value)))
        .collect()
}

/// Ejecuta la calculadora NATIVA que corresponda (FR-019).
///
/// # Errores
///
/// Los de la calculadora elegida.
pub fn compute(
    kind: Kind,
    raw_inputs: &HashMap<String, String>,
) -> Result<HashMap<String, String>> {
    let inputs = Inputs::new(raw_inputs);
    let outcome: Outcome = match kind {
        Kind::Ahorro => ahorro::compute(&inputs)?,
        Kind::Credito => credito::compute(&inputs)?,
        Kind::Presupuesto => presupuesto::compute(&inputs)?,
        Kind::Inversion => inversion::compute(&inputs)?,
        Kind::ColombiaEspecifica => colombia::compute(&inputs)?,
    };

    Ok(to_contract(outcome))
}
