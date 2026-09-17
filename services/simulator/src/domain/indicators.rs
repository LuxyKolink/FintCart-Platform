//! Indicadores usados por una ejecución, en la forma que se persiste (T102; FR-057,
//! FR-058; research D-22).
//!
//! ## Qué es un snapshot y por qué existe
//!
//! FR-058 pide que una simulación siga siendo explicable después de que los indicadores
//! cambien. Sin snapshot, reabrir en 2027 una simulación de 2026 que usó `@UVT` mostraría
//! un resultado que ya no se puede reconstruir: el valor que la produjo se habría
//! sustituido por el del año siguiente, y nada en la fila diría cuál era. Es el mismo
//! motivo por el que la simulación guarda también la versión de la definición (FR-050).
//!
//! ## Por qué graba los indicadores REFERENCIADOS y no los evaluados
//!
//! El evaluador es perezoso (`si(cond, a, b)` solo evalúa la rama que toma, y `y`/`o`
//! cortocircuitan), así que una definición puede referenciar `@UVT` y no llegar a leerlo
//! nunca. Averiguar cuáles se leyeron DE VERDAD exigiría instrumentar el evaluador, y el
//! error de las dos opciones no cuesta lo mismo:
//!
//!   · Grabar de más deja en la fila un valor que no influyó en el resultado. El
//!     resultado sigue siendo reproducible —todo lo que pudo influir está ahí— y lo
//!     único que sobra es un dato que no era causal.
//!   · Grabar de menos rompe FR-058: si el día de mañana la condición cambia de rama, la
//!     fila ya no se explica.
//!
//! Se elige el error barato, que además es el único que no deja la fila mintiendo sobre
//! su propia reproducibilidad.
//!
//! ## Por qué los valores salen como CADENA
//!
//! Por el Principio VIII y por el CHECK `simulations_indicators_snapshot_no_json_numbers`:
//! un número dentro de un JSONB se almacena como `numeric`, pero al deserializarlo la
//! mayoría de los caminos pasan por `f64`. Guardando la cadena decimal canónica, el valor
//! que sale es byte a byte el que entró — la misma convención que ya usan `inputs` y
//! `result` (ver la nota de [`crate::repo::simulations`]).

use std::collections::HashMap;

use rust_decimal::Decimal;

use crate::domain::decimal_str;

/// Valores de indicador resueltos para una ejecución concreta.
///
/// No lleva la fecha: la columna `indicators_snapshot` es `{nombre: valor}` y nada más
/// (data-model.md §2.4). La fecha con la que se resolvió no se pierde por ello — está en
/// `simulations.created_at`, que es el instante en que la resolución ocurrió.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    values: HashMap<String, Decimal>,
}

impl Snapshot {
    /// Envuelve los valores ya resueltos.
    ///
    /// Los construye quien consulta —la capa de aplicación, con el repositorio de
    /// indicadores—, porque este módulo no consulta nada: es dominio puro y tiene que
    /// poder ejercitarse sin base de datos.
    #[must_use]
    pub fn new(values: HashMap<String, Decimal>) -> Self {
        Self { values }
    }

    /// El snapshot de una ejecución que no usó ningún indicador.
    ///
    /// Es el caso del camino de compatibilidad por `calc_type`: las cinco calculadoras
    /// nativas llevan sus constantes cableadas en el código —`gmf` recibe la UVT como
    /// ENTRADA, no la lee de `financial_indicators`—, así que un mapa vacío es la verdad
    /// sobre ellas y no un marcador de «pendiente». La migración de T020 registra lo
    /// mismo en las filas históricas, y por la misma razón.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// Los valores, para construir el [`crate::domain::formula::eval::Scope`].
    #[must_use]
    pub fn values(&self) -> &HashMap<String, Decimal> {
        &self.values
    }

    /// Verdadero si la ejecución no usó ningún indicador.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Forma almacenable: `{nombre: cadena decimal canónica}`.
    ///
    /// La conversión a texto ocurre AQUÍ y solo aquí, igual que
    /// [`crate::domain::dispatch::compute`] la hace para `result`: un solo punto donde un
    /// valor se convierte en texto, y ninguno puede inventarse un formato propio —uno con
    /// notación científica rompería el `NUMERIC` de quien consuma la columna—.
    #[must_use]
    pub fn to_stored(&self) -> HashMap<String, String> {
        self.values
            .iter()
            .map(|(name, value)| (name.clone(), decimal_str::format(*value)))
            .collect()
    }

    /// Los mismos valores separados por nombre y texto, para el contrato.
    ///
    /// Devuelve el mapa de `ComputeResponse.indicators_used` y el de
    /// `ListHistoryResponse.Entry.indicators_used`, que son el mismo `map<string,string>`
    /// porque los dos llevan la marca de `[decimal]` en el `.proto`.
    #[must_use]
    pub fn into_stored(self) -> HashMap<String, String> {
        self.to_stored()
    }
}

/// Días de antelación con que se avisa del vencimiento de un indicador (FR-061).
///
/// Treinta, y no configurable en esta versión: `spec.md` §Aclaraciones lo fija «alineado con
/// el período de gracia por coherencia operativa». Se elige en el servidor y no en el cliente
/// a propósito — si lo eligiera quien pregunta, la alerta que recibe el administrador
/// dependería de quién la pidiera, y el mismo indicador estaría a la vez por vencer y no.
///
/// El barrido del Orquestador (T105) no decide nada: pregunta el estado y publica lo que
/// recibe, así que la ventana vive de un solo lado.
pub const CALENDAR_ALERT_WINDOW_DAYS: i64 = 30;

/// ¿Es `name` un nombre de indicador admisible?
///
/// La regla es `^[A-Z][A-Z0-9_]*$`, y se escribe aquí una sola vez porque tiene un consumidor
/// que no puede compartirla y otro que no debe:
///
/// · El **`CHECK financial_indicators_name_format`** la impone en la base y está escrito en SQL.
///   Es el que manda: si esta función dijera otra cosa, el `INSERT` fallaría con una violación
///   de restricción en vez de con un mensaje.
/// · El **lexer** ([`crate::domain::formula::lexer`]) aplica la misma regla mientras escanea
///   `@NOMBRE`, pero además necesita saber dónde termina el nombre, así que no puede ser una
///   llamada a un `bool`. Una prueba ata las dos (`los_nombres_admisibles_son_los_que_el_lexer_reconoce`).
/// · El **alta de indicadores** (T104) la comprueba para dar un mensaje que se entienda antes
///   de tocar la base.
///
/// El nombre no es cosmético: es el identificador con el que una fórmula referencia el valor
/// ([`crate::domain::formula::lexer::Token::Indicator`]), así que un nombre que no case con
/// esta forma sería un indicador **invisible** —existiría en la tabla y ninguna fórmula podría
/// leerlo—. Por eso se rechaza `@uvt` en minúsculas con un mensaje propio en lugar de dejar
/// que falle al resolver: el problema es cómo se escribió, no un dato que falte.
#[must_use]
pub fn is_valid_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    match bytes.next() {
        Some(primera) if primera.is_ascii_uppercase() => {}
        _ => return false,
    }
    bytes.all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valores() -> HashMap<String, Decimal> {
        HashMap::from([
            ("UVT".to_owned(), Decimal::new(50000, 0)),
            ("IPC".to_owned(), Decimal::new(5, 2)),
        ])
    }

    #[test]
    fn el_snapshot_vacio_es_el_de_una_ejecucion_sin_indicadores() {
        assert!(Snapshot::none().is_empty());
        assert!(Snapshot::none().to_stored().is_empty());
    }

    #[test]
    fn los_valores_salen_como_cadena_decimal_canonica() {
        let almacenable = Snapshot::new(valores()).to_stored();

        // Ninguno lleva notación científica ni separador de miles, que es lo que el
        // `NUMERIC` de quien consuma la columna no admitiría.
        assert_eq!(almacenable.get("UVT").map(String::as_str), Some("50000"));
        assert_eq!(almacenable.get("IPC").map(String::as_str), Some("0.05"));
    }

    #[test]
    fn los_valores_vuelven_intactos_al_ambito_de_evaluacion() {
        let snapshot = Snapshot::new(valores());
        assert_eq!(snapshot.values().get("UVT"), Some(&Decimal::new(50000, 0)));
    }

    /// El valor sobrevive la ida y vuelta por texto canónico, venga de donde venga.
    ///
    /// La columna devuelve `NUMERIC(20,6)` con ceros a la derecha —`50000.000000`—, y
    /// [`decimal_str::format`] los recorta. Lo que se comprueba es que lo que se recorta
    /// es la FORMA y no el valor: un redondeo silencioso aquí sería una pérdida de
    /// precisión del Principio VIII escondida en una función de formateo.
    #[test]
    fn el_valor_sobrevive_la_ida_y_vuelta_por_texto() {
        let tres_medios = HashMap::from([("IPC".to_owned(), Decimal::new(15, 1))]);
        let texto = Snapshot::new(tres_medios).to_stored();

        let leido = texto.get("IPC").expect("IPC");
        assert_eq!(
            leido, "1.5",
            "sin ceros a la derecha y sin notación científica"
        );

        let vuelto = decimal_str::parse_numeric(leido, 20, 6).expect("decimal canónico");
        assert_eq!(vuelto, Decimal::new(15, 1));
    }

    #[test]
    fn los_nombres_admisibles_son_los_que_el_lexer_reconoce() {
        // El lexer NO delega en `is_valid_name` porque tiene que averiguar además dónde
        // termina el nombre (`@UVT-2` son dos tokens), pero la regla que aplica es la
        // misma y estos casos lo fijan: si una de las dos se quedara atrás, la fórmula
        // aceptaría un `@nombre` que después no se puede registrar, o al revés.
        for (nombre, admisible) in [
            ("UVT", true),
            ("TASA_USURA", true),
            ("IPC_1", true),
            ("SMMLV2026", true),
            ("uvt", false),
            ("Uvt", false),
            ("_UVT", false),
            ("1UVT", false),
            ("UVT ", false),
            ("", false),
        ] {
            let tokens = crate::domain::formula::lexer::tokenize(&format!("@{nombre}"));
            let unico = matches!(
                tokens.as_deref(),
                Ok([una]) if matches!(&una.token, crate::domain::formula::lexer::Token::Indicator(n) if n == nombre)
            );
            assert_eq!(
                unico, admisible,
                "el lexer y `is_valid_name` discrepan sobre {nombre:?}"
            );
            assert_eq!(is_valid_name(nombre), admisible, "regla sobre {nombre:?}");
        }
    }
}
