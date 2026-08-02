//! Calculadoras específicas del CONTEXTO FINANCIERO COLOMBIANO (FR-019).
//!
//! Es la única de las cinco con varios modos, y el plural de FR-019 —«calculadoras
//! específicas»— es justamente eso: lo que distingue al mercado colombiano no es una
//! fórmula sino un conjunto de convenciones locales que no tienen equivalente
//! genérico. Se selecciona con el parámetro `operacion`.
//!
//! ## Modos
//!
//! | `operacion` | qué responde                                                  |
//! |-------------|---------------------------------------------------------------|
//! | `ea_a_mv`   | pasa una tasa Efectiva Anual a nominal Mes Vencido            |
//! | `mv_a_ea`   | el camino inverso                                             |
//! | `gmf`       | Gravamen a los Movimientos Financieros, el «4 × 1000»         |
//!
//! ## Por qué estas tres
//!
//! Las dos primeras porque en Colombia la Superintendencia Financiera obliga a
//! publicar las tasas en **Efectiva Anual**, mientras que las cuotas se liquidan sobre
//! una nominal periódica. Comparar una E.A. con una M.V. como si fueran la misma cifra
//! es el error de lectura más común de un crédito de consumo, y la diferencia no es
//! menor: una E.A. del 24 % equivale a un 1,809 % mensual, no al 2 % que sugiere
//! dividir entre doce.
//!
//! La tercera porque el GMF grava cada retiro y casi nadie lo tiene en cuenta al
//! proyectar. Su exención se define en **UVT**, una unidad que cambia cada año, así
//! que el valor de la UVT entra como parámetro: incrustarlo dejaría la calculadora
//! silenciosamente equivocada cada primero de enero.

use rust_decimal::{Decimal, MathematicalOps};

use crate::calculators::{annuity, Outcome};
use crate::domain::currency::round_money;
use crate::domain::decimal_str;
use crate::domain::error::{Error, Result};
use crate::domain::inputs::Inputs;

/// Meses del año.
const MONTHS_PER_YEAR: u32 = 12;

/// Escala de las tasas, la de `NUMERIC(9,6)`.
const RATE_SCALE: u32 = 6;

/// Tarifa del GMF: cuatro por mil.
///
/// Es una constante y no un parámetro porque es la tarifa vigente fijada por ley
/// (Estatuto Tributario, art. 872), no una convención de mercado. Si cambiara, cambia
/// para todos a la vez y con una fecha conocida — que es distinto de la UVT, cuyo
/// valor se actualiza cada año y por eso sí se pide.
const GMF_RATE_PER_MILLE: Decimal = Decimal::from_parts(4, 0, 0, false, 3);

/// Exención del GMF en cuentas de ahorro: 350 UVT mensuales.
const GMF_EXEMPT_UVT: i64 = 350;

/// Despacha al modo pedido.
///
/// # Errores
///
/// [`Error::InvalidInput`] si falta `operacion`, si el modo no existe o si el modo
/// elegido rechaza sus parámetros; [`Error::Decimal`] si un valor no es canónico.
pub fn compute(inputs: &Inputs) -> Result<Outcome> {
    match inputs.text("operacion")? {
        "ea_a_mv" => effective_to_nominal(inputs),
        "mv_a_ea" => nominal_to_effective(inputs),
        "gmf" => financial_transaction_tax(inputs),
        other => Err(Error::InvalidInput(format!(
            "operacion {other:?} no existe; las admitidas son ea_a_mv, mv_a_ea y gmf"
        ))),
    }
}

/// Efectiva Anual → nominal Mes Vencido: `i = (1+EA)^(1/12) − 1`.
///
/// ## Sobre la precisión de la raíz duodécima
///
/// Es la ÚNICA operación de todo el simulador que no es exacta en decimal. Una raíz
/// duodécima no tiene, en general, representación decimal finita, así que
/// `rust_decimal` la resuelve con `exp(ln(x)/12)` y arrastra el error de dos funciones
/// trascendentes.
///
/// Eso obliga a ser explícito en lugar de fingir exactitud: el resultado se redondea a
/// la escala de la columna de tasas (seis decimales, half-even) y ahí sí es estable.
/// Es la precisión con la que se publican las tasas en Colombia, de modo que el límite
/// del cálculo coincide con el del dato que se está modelando. La prueba de borde
/// correspondiente fija la ida y vuelta `EA → MV → EA` en vez de una constante mágica,
/// que es lo honesto cuando el valor intermedio no es exacto.
///
/// # Errores
///
/// [`Error::InvalidInput`] si la tasa no es mayor que -100 % o si la raíz no es
/// calculable; [`Error::Decimal`] si el valor no es canónico.
fn effective_to_nominal(inputs: &Inputs) -> Result<Outcome> {
    let effective = inputs.rate("tasa_ea")?;
    if effective <= Decimal::NEGATIVE_ONE {
        return Err(Error::InvalidInput(
            "la tasa efectiva anual debe ser mayor que -100 %".to_owned(),
        ));
    }

    let base = Decimal::ONE + effective;
    let exponent = Decimal::ONE
        .checked_div(Decimal::from(MONTHS_PER_YEAR))
        .ok_or_else(|| Error::InvalidInput("exponente no representable".to_owned()))?;
    let monthly = base
        .checked_powd(exponent)
        .ok_or_else(|| Error::InvalidInput("la raíz duodécima no es calculable".to_owned()))?
        - Decimal::ONE;

    // La nominal anual es la mensual por doce, por definición de «nominal»: NO es la
    // efectiva de partida, y devolver las dos juntas es lo que hace visible la
    // diferencia que esta calculadora existe para explicar.
    let nominal_annual = monthly * Decimal::from(MONTHS_PER_YEAR);

    Ok(vec![
        ("tasa_mv", decimal_str::round_half_even(monthly, RATE_SCALE)),
        (
            "tasa_nominal_anual",
            decimal_str::round_half_even(nominal_annual, RATE_SCALE),
        ),
    ])
}

/// Nominal Mes Vencido → Efectiva Anual: `EA = (1+i)^12 − 1`.
///
/// Este sentido SÍ es exacto: elevar a un entero es multiplicación repetida, sin
/// funciones trascendentes de por medio.
///
/// # Errores
///
/// [`Error::InvalidInput`] si la tasa mensual no es mayor que -100 % o si desborda;
/// [`Error::Decimal`] si el valor no es canónico.
fn nominal_to_effective(inputs: &Inputs) -> Result<Outcome> {
    let monthly = inputs.rate("tasa_mv")?;
    if monthly <= Decimal::NEGATIVE_ONE {
        return Err(Error::InvalidInput(
            "la tasa mes vencido debe ser mayor que -100 %".to_owned(),
        ));
    }

    let effective = annuity::growth_factor(monthly, MONTHS_PER_YEAR)? - Decimal::ONE;
    let nominal_annual = monthly * Decimal::from(MONTHS_PER_YEAR);

    Ok(vec![
        (
            "tasa_ea",
            decimal_str::round_half_even(effective, RATE_SCALE),
        ),
        (
            "tasa_nominal_anual",
            decimal_str::round_half_even(nominal_annual, RATE_SCALE),
        ),
    ])
}

/// Gravamen a los Movimientos Financieros, el «4 × 1000».
///
/// ## Parámetros
///
/// | clave        | tipo  | obligatorio | significado                          |
/// | `monto`      | monto | sí          | valor del retiro o traslado          |
/// | `valor_uvt`  | monto | sí          | UVT del año en curso                 |
/// | `exento`     | texto | no          | `"si"` aplica la exención de 350 UVT |
///
/// La exención es OPCIONAL y hay que pedirla explícitamente porque no es automática:
/// depende de que el titular haya marcado una única cuenta de ahorros ante su banco.
/// Aplicarla por defecto haría que el simulador subestimara el impuesto de quien no ha
/// hecho ese trámite, que es precisamente el caso en el que la cifra importa.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el monto o la UVT no son positivos; [`Error::Decimal`]
/// si un valor no es canónico.
fn financial_transaction_tax(inputs: &Inputs) -> Result<Outcome> {
    let amount = inputs.money("monto")?;
    let uvt = inputs.money("valor_uvt")?;

    if amount <= Decimal::ZERO {
        return Err(Error::InvalidInput(
            "el monto del movimiento debe ser mayor que cero".to_owned(),
        ));
    }
    if uvt <= Decimal::ZERO {
        return Err(Error::InvalidInput(
            "el valor de la UVT debe ser mayor que cero".to_owned(),
        ));
    }

    let exempt_cap = uvt * Decimal::from(GMF_EXEMPT_UVT);
    let exempt_amount = if inputs
        .text("exento")
        .unwrap_or("no")
        .eq_ignore_ascii_case("si")
    {
        amount.min(exempt_cap)
    } else {
        Decimal::ZERO
    };

    let taxable = amount - exempt_amount;
    let tax = round_money(taxable * GMF_RATE_PER_MILLE);

    Ok(vec![
        ("gravamen", tax),
        ("base_gravable", round_money(taxable)),
        ("monto_exento", round_money(exempt_amount)),
        ("tope_exencion", round_money(exempt_cap)),
        ("neto_recibido", round_money(amount - tax)),
    ])
}
