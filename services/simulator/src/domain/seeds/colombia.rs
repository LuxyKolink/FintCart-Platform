//! Las tres semillas del contexto financiero colombiano: `ea_a_mv`, `mv_a_ea` y `gmf`
//! (T094; FR-019; research D-16).
//!
//! Eran UNA calculadora con un parámetro de texto `operacion` (`calculators::colombia`).
//! Separarlas es lo que elimina la última entrada de texto del sistema y deja el lenguaje de
//! fórmulas puramente numérico: un valor que no se puede comparar ni elevar no tiene sitio en
//! un motor aritmético, y mantenerlo «por si acaso» reabriría esa puerta.
//!
//! ## Por qué estas tres
//!
//! Las dos primeras porque en Colombia la Superintendencia Financiera obliga a publicar las
//! tasas en **Efectiva Anual**, mientras que las cuotas se liquidan sobre una nominal
//! periódica. Comparar una E.A. con una M.V. como si fueran la misma cifra es el error de
//! lectura más común de un crédito de consumo, y la diferencia no es menor: una E.A. del 24 %
//! equivale a un 1,809 % mensual, no al 2 % que sugiere dividir entre doce.
//!
//! La tercera porque el GMF grava cada retiro y casi nadie lo tiene en cuenta al proyectar.
//!
//! ## La única diferencia deliberada con el código nativo
//!
//! `gmf` **no** recibe la UVT como parámetro: la toma del indicador `@UVT` (FR-057). El código
//! nativo la pide en cada llamada (`colombia.rs:161`), lo que deja la calculadora
//! silenciosamente equivocada cada primero de enero si quien la invoca no actualiza el valor.
//! Con el indicador, la vigencia la administra la plataforma y una simulación guarda el
//! snapshot que usó (FR-058), de modo que sigue siendo reproducible.
//!
//! La guarda «el valor de la UVT debe ser mayor que cero» **sigue existiendo**, como regla del
//! autor sobre `@UVT`. Estuvo a punto de no estar: el razonamiento cómodo era que un indicador
//! no puede registrarse con valor no positivo y que, por tanto, el caso era inalcanzable. Es
//! falso —`financial_indicators_value_non_negative` admite el CERO (`data-model.md`) —, y sin
//! la regla un `@UVT` de cero daría `tope_exencion = 0` y ninguna exención a quien la pidió:
//! una cifra equivocada presentada como buena, que es justo lo que un rango declarado existe
//! para impedir.
//!
//! Ver la nota del módulo padre sobre los paréntesis en las sub-expresiones compartidas.

use uuid::Uuid;

use super::{entero_opcional, monto, regla, salida, tasa, Seed};
use crate::domain::definition::Draft;

/// Escala de una tasa: la de `NUMERIC(9,6)`.
const ESCALA_TASA: u32 = 6;

/// Escala de un importe monetario: la de `NUMERIC(19,2)`.
const ESCALA_MONETARIA: u32 = 2;

/// Tarifa del GMF: cuatro por mil.
///
/// Es un literal de la definición y no un campo porque es la tarifa vigente fijada por ley
/// (Estatuto Tributario, art. 872), no una convención de mercado. Si cambiara, cambia para
/// todos a la vez y con una fecha conocida — a diferencia de la UVT, que se actualiza cada año
/// y por eso sí viene del catálogo de indicadores.
///
/// Se escribe como macro y no como `const &str` porque [`concat!`] solo acepta literales: con
/// una constante habría que repetir el número en cada fórmula que lo usa, y dos copias de la
/// tarifa legal son una que se queda atrás.
macro_rules! tarifa_gmf {
    () => {
        "0.004"
    };
}

/// Exención del GMF en cuentas de ahorro: 350 UVT mensuales.
///
/// Sigue siendo un literal —es la ley, no un dato anual—, pero el valor de la UVT que
/// multiplica ya no está cableado aquí: ver la nota del módulo. Macro por la misma razón que
/// [`tarifa_gmf`].
macro_rules! exencion_uvt {
    () => {
        "350"
    };
}

/// Efectiva Anual → nominal Mes Vencido: `i = (1+EA)^(1/12) − 1`.
///
/// Reproduce `calculators::colombia::effective_to_nominal`. Es la **única** operación de todo
/// el simulador que no es exacta en decimal: una raíz duodécima no tiene, en general,
/// representación decimal finita, así que `rust_decimal` la resuelve con `exp(ln(x)/12)` y
/// arrastra el error de dos funciones trascendentes.
///
/// Por eso usa `potd` y no `pot`: no es una preferencia de estilo. `pot` **rechaza** el
/// exponente decimal, y con él esta calculadora no se podría escribir; forzarla a `pot`
/// exigiría un exponente entero, que es otra operación. Es la separación que D-16 señala como
/// condición para que FR-049 se mantenga cerrado.
#[must_use]
pub fn ea_a_mv(id: Uuid) -> Seed {
    // La tasa mensual entre paréntesis: se compone con ` * 12` para la nominal anual, y sin
    // ellos `potd(...) - 1 * 12` restaría doce en vez de multiplicar la tasa.
    macro_rules! mes_vencido {
        () => {
            "(potd(1 + tasa_ea, 1 / 12) - 1)"
        };
    }

    Seed {
        id,
        name: "ea_a_mv",
        description: "Convierte una tasa efectiva anual a nominal mes vencido.",
        draft: Draft {
            inputs: vec![tasa("tasa_ea", "Tasa efectiva anual")],
            validations: vec![regla(
                "tasa_ea > -1",
                "la tasa efectiva anual debe ser mayor que -100 %",
            )],
            outputs: vec![
                salida("tasa_mv", "Tasa mes vencido", mes_vencido!(), ESCALA_TASA),
                // La nominal anual es la mensual por doce, por definición de «nominal»: NO es
                // la efectiva de partida. Devolver las dos juntas es lo que hace visible la
                // diferencia que esta calculadora existe para explicar.
                salida(
                    "tasa_nominal_anual",
                    "Tasa nominal anual",
                    concat!(mes_vencido!(), " * 12"),
                    ESCALA_TASA,
                ),
            ],
        },
    }
}

/// Nominal Mes Vencido → Efectiva Anual: `EA = (1+i)^12 − 1`.
///
/// Reproduce `calculators::colombia::nominal_to_effective`. Este sentido SÍ es exacto: elevar
/// a un entero es multiplicación repetida, sin funciones trascendentes de por medio, y por eso
/// usa `pot`.
#[must_use]
pub fn mv_a_ea(id: Uuid) -> Seed {
    Seed {
        id,
        name: "mv_a_ea",
        description: "Convierte una tasa nominal mes vencido a efectiva anual.",
        draft: Draft {
            inputs: vec![tasa("tasa_mv", "Tasa mes vencido")],
            validations: vec![regla(
                "tasa_mv > -1",
                "la tasa mes vencido debe ser mayor que -100 %",
            )],
            outputs: vec![
                salida(
                    "tasa_ea",
                    "Tasa efectiva anual",
                    "pot(1 + tasa_mv, 12) - 1",
                    ESCALA_TASA,
                ),
                salida(
                    "tasa_nominal_anual",
                    "Tasa nominal anual",
                    "tasa_mv * 12",
                    ESCALA_TASA,
                ),
            ],
        },
    }
}

/// Gravamen a los Movimientos Financieros, el «4 × 1000».
///
/// Reproduce `calculators::colombia::financial_transaction_tax`, con la UVT tomada de
/// `@UVT` en lugar de recibida como parámetro (ver la nota del módulo).
///
/// ## Por qué la exención es una entrada y no un valor por defecto
///
/// La exención de 350 UVT **no es automática**: depende de que el titular haya marcado una
/// única cuenta de ahorros ante su banco. Aplicarla siempre haría que el simulador subestimara
/// el impuesto de quien no ha hecho ese trámite, que es justo el caso en el que la cifra
/// importa. El nativo la pedía como el texto `"si"`/`"no"`; aquí es un entero `1`/`0`, que es
/// lo que un lenguaje sin texto puede expresar, y su rango `[0, 1]` hace que un valor distinto
/// se rechace en vez de leerse como «no».
#[must_use]
pub fn gmf(id: Uuid) -> Seed {
    macro_rules! tope {
        () => {
            concat!("@UVT * ", exencion_uvt!())
        };
    }
    // El importe exento. `si(...)` y no `min(monto, tope) * exento`: el lenguaje no tiene
    // multiplicación por Booleano, y expresarlo como producto daría un exento distinto para
    // cualquier `exento` que no fuera 0 o 1 — que es exactamente lo que el rango impide.
    macro_rules! exento {
        () => {
            concat!("si(exento == 1, min(monto, ", tope!(), "), 0)")
        };
    }
    macro_rules! base {
        () => {
            concat!("(monto - ", exento!(), ")")
        };
    }
    // El gravamen YA redondeado, y esto no es cosmético: el nativo redondea el impuesto y
    // después lo RESTA del monto (`colombia.rs:200`), de modo que `neto_recibido` no es
    // `monto - base * 0.004` sin redondear. Escribirlo sin el redondeo interior daría una
    // cifra que difiere en un centavo en los casos en que el impuesto tiene más decimales de
    // los que se cobran, y esa diferencia no se ve en el resultado: se ve en el extracto.
    macro_rules! gravamen {
        () => {
            concat!("redondear_dinero(", base!(), " * ", tarifa_gmf!(), ")")
        };
    }

    Seed {
        id,
        name: "gmf",
        description: "Gravamen a los movimientos financieros (el «4 × 1000»).",
        draft: Draft {
            inputs: vec![
                monto("monto", "Monto del movimiento"),
                entero_opcional("exento", "Exención de 350 UVT", "1 = sí", 0, 1),
            ],
            validations: vec![
                regla(
                    "monto > 0",
                    "el monto del movimiento debe ser mayor que cero",
                ),
                // El mismo orden que el nativo: primero el monto, después la UVT.
                regla("@UVT > 0", "el valor de la UVT debe ser mayor que cero"),
            ],
            outputs: vec![
                salida("gravamen", "Gravamen", gravamen!(), ESCALA_MONETARIA),
                salida("base_gravable", "Base gravable", base!(), ESCALA_MONETARIA),
                salida("monto_exento", "Monto exento", exento!(), ESCALA_MONETARIA),
                salida(
                    "tope_exencion",
                    "Tope de exención",
                    tope!(),
                    ESCALA_MONETARIA,
                ),
                salida(
                    "neto_recibido",
                    "Neto recibido",
                    concat!("monto - ", gravamen!()),
                    ESCALA_MONETARIA,
                ),
            ],
        },
    }
}
