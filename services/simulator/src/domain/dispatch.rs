//! Despacho por tipo de cálculo (FR-019) y traducción del resultado a la forma del
//! contrato.
//!
//! Es la frontera entre el enum del `.proto` y las cinco funciones de
//! [`crate::calculators`]. Vive en `domain` y no en `grpc` a propósito: el despacho es
//! una regla del servicio —qué calculadoras existen— y no un detalle de transporte.
//! Con él aquí, una prueba puede ejercitar las cinco rutas sin levantar un servidor.

use std::collections::HashMap;

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

/// Ejecuta la calculadora que corresponda y devuelve el resultado ya en la forma del
/// contrato: `map<string, string>` con decimales canónicas.
///
/// La serialización ocurre AQUÍ y no dentro de cada calculadora, que devuelve
/// [`rust_decimal::Decimal`]. Así hay un solo punto donde un valor se convierte en
/// texto, y ninguna calculadora puede inventarse un formato propio —una con notación
/// científica o con separador de miles rompería el `NUMERIC` de quien la consuma
/// (Principio VIII / D-10).
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

    Ok(outcome
        .into_iter()
        .map(|(key, value)| (key.to_owned(), decimal_str::format(value)))
        .collect())
}
