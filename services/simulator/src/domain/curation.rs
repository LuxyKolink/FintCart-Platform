//! Curaduría de calculadoras: los estados y las transiciones entre ellos (T113; FR-051…FR-054).
//!
//! ## Qué vive aquí y qué no
//!
//! Aquí viven las REGLAS —qué transición es posible, quién puede hacerla, qué estado resulta— y
//! no su ejecución: estas funciones son puras, no tocan PostgreSQL y no saben que existe un
//! repositorio. Quien las llama es [`crate::repo::calculators`], que además las vuelve a
//! comprobar dentro de la transacción y con la fila bloqueada.
//!
//! Escribirlas aquí y no dentro del `UPDATE` tiene un motivo concreto: **la regla se puede
//! probar exhaustivamente sin una base**, y eso es lo que permite afirmar que no existe ninguna
//! combinación de estado y actor por la que una calculadora llegue al catálogo sin aprobación.
//!
//! ## Las dos versiones de una calculadora
//!
//! Una calculadora tiene una versión VIGENTE —lo último que escribió su autor— y, si está
//! publicada, una versión APROBADA. Son distintas en cuanto el autor edita algo publicado, y
//! mantenerlas separadas es lo que hace cierta FR-052: editar no cambia lo que ve el mundo
//! hasta que un coordinador aprueba la versión nueva (SC-018).
//!
//! De ahí que [`Situacion`] lleve las dos: sin `published_version` no se puede distinguir «una
//! calculadora publicada que nadie ha tocado» de «una publicada con un borrador encima», y esa
//! diferencia es la que decide si un rechazo devuelve la calculadora al catálogo o la deja
//! privada.

use uuid::Uuid;

use crate::domain::error::{Error, Result};

/// Estado de curaduría de una calculadora.
///
/// ## `publicada` no significa «sin borrador»
///
/// Significa que hay una versión aprobada y viva en el catálogo. Puede convivir con un borrador
/// sin aprobar encima —el autor editó una calculadora publicada—, y por eso el estado por sí
/// solo no dice qué versión se sirve: eso lo decide la vista de lectura, comparando `version`
/// con `published_version`.
///
/// ## Por qué el vocabulario de la columna vive en el dominio
///
/// Los valores coinciden con el `CHECK calculators_state_valid`, y salen de [`State::as_db`] y
/// no de literales sueltos. Son un concepto del negocio —la visibilidad de una calculadora—, no
/// un detalle de almacenamiento: la capa de persistencia los traduce, que es lo que hace una
/// capa de persistencia.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Visible y ejecutable solo por su autor (FR-051).
    Privada,
    /// Propuesta al catálogo, esperando curaduría (FR-052).
    EnRevision,
    /// Con una versión aprobada y viva en el catálogo.
    Publicada,
}

impl State {
    /// Nombre con el que el estado se persiste.
    #[must_use]
    pub const fn as_db(self) -> &'static str {
        match self {
            Self::Privada => "privada",
            Self::EnRevision => "en_revision",
            Self::Publicada => "publicada",
        }
    }

    /// Traduce el estado almacenado.
    ///
    /// # Errores
    ///
    /// [`Error::InvalidInput`] si la fila trae un estado que ya no existe. Es improbable —el
    /// `CHECK` lo impide— pero no imposible tras una migración, y tratarlo como `Privada`
    /// escondería una calculadora publicada sin decir nada.
    pub fn from_db(value: &str) -> Result<Self> {
        match value {
            "privada" => Ok(Self::Privada),
            "en_revision" => Ok(Self::EnRevision),
            "publicada" => Ok(Self::Publicada),
            other => Err(Error::InvalidInput(format!(
                "estado {other:?} almacenado no corresponde a ninguna calculadora"
            ))),
        }
    }
}

/// Todo lo que hace falta saber de una calculadora para decidir una transición.
///
/// Es un agregado de lectura y no la fila entera: quién puede hacer qué depende de estas cinco
/// cosas y de nada más. Traerlas juntas —en lugar de pasar cinco argumentos sueltos a cada
/// función— es lo que hace imposible que una transición se escriba mirando el estado y se olvide
/// del autor, que es justo la comprobación de FR-053.
#[derive(Debug, Clone, Copy)]
pub struct Situacion {
    /// Estado actual.
    pub state: State,
    /// Verdadero en las siete semillas de D-16, que no tienen autor y no pasan por curaduría.
    pub is_builtin: bool,
    /// Autor. `None` en las semillas y en las calculadoras cuyo autor se anonimizó (FR-077).
    pub owner_id: Option<Uuid>,
    /// Versión vigente, que es el borrador del autor.
    pub version: i32,
    /// Última versión aprobada, si alguna vez hubo una.
    pub published_version: Option<i32>,
}

impl Situacion {
    /// ¿Queda algún cambio sin aprobar?
    ///
    /// Falso cuando lo publicado es lo vigente. Una calculadora que nunca se publicó **sí** tiene
    /// algo que proponer aunque `published_version` sea nulo: proponerla por primera vez es su
    /// cambio.
    #[must_use]
    pub fn tiene_cambios_sin_aprobar(&self) -> bool {
        self.published_version != Some(self.version)
    }
}

/// Estado resultante de editar la definición.
///
/// ## Una edición durante la revisión RETIRA la propuesta
///
/// Si el autor edita mientras su calculadora está en revisión, vuelve a `privada`. El motivo no
/// es conservador por gusto: el coordinador está leyendo **una versión concreta**, y si la
/// propuesta siguiera viva lo que aprobaría sería la versión siguiente —que nadie ha leído—
/// porque la aprobación publica la versión vigente en el momento de aprobar. Retirar la
/// propuesta obliga a proponerla otra vez, y con ella a que alguien mire lo que cambió.
///
/// Editar una calculadora PUBLICADA no cambia el estado: la versión aprobada sigue viva en el
/// catálogo y el borrador espera (FR-052).
#[must_use]
pub const fn after_edit(state: State) -> State {
    match state {
        State::EnRevision => State::Privada,
        State::Publicada | State::Privada => state,
    }
}

/// Estado resultante de proponer una calculadora para publicación (FR-052).
///
/// # Errores
///
/// [`Error::InvalidInput`] con el motivo por el que la propuesta no tiene sentido. El mensaje se
/// le enseña al autor tal cual, así que explica qué falta en lugar de decir que la operación «no
/// es válida».
pub fn submit(situation: &Situacion, actor: Uuid) -> Result<State> {
    if situation.is_builtin {
        return Err(Error::InvalidInput(
            "las calculadoras de la plataforma ya están publicadas y no se proponen".to_owned(),
        ));
    }
    if situation.owner_id != Some(actor) {
        // Lo mismo que en `get`: no se distingue «no existe» de «no es tuya», porque
        // distinguirlo convertiría este RPC en un oráculo sobre las calculadoras ajenas.
        return Err(Error::NotFound);
    }
    match situation.state {
        State::EnRevision => Err(Error::InvalidInput(
            "la calculadora ya está en revisión: un coordinador la está mirando".to_owned(),
        )),
        State::Privada | State::Publicada if !situation.tiene_cambios_sin_aprobar() => {
            Err(Error::InvalidInput(
                "no hay nada que proponer: la calculadora no ha cambiado desde que se \
                 aprobó. Edítala y vuelve a proponerla"
                    .to_owned(),
            ))
        }
        State::Privada | State::Publicada => Ok(State::EnRevision),
    }
}

/// Estado resultante de aprobar una calculadora propuesta (FR-053).
///
/// # Errores
///
/// [`Error::InvalidInput`] si no está en revisión, si quien aprueba es su autor —FR-053, que la
/// base también impone con `calculators_approver_differs_from_owner`— o si es una semilla.
pub fn approve(situation: &Situacion, coordinator: Uuid) -> Result<State> {
    if situation.is_builtin {
        return Err(Error::InvalidInput(
            "las calculadoras de la plataforma no pasan por curaduría".to_owned(),
        ));
    }
    if situation.state != State::EnRevision {
        return Err(Error::InvalidInput(
            "solo se puede aprobar una calculadora propuesta para publicación".to_owned(),
        ));
    }
    if situation.owner_id == Some(coordinator) {
        // `PermissionDenied` y no `InvalidInput`: la petición está bien formada y el actor
        // identificado; lo que falla es que esa persona no puede hacerlo. El borde traduce este
        // error a 403 y aquel a 400, y un 400 diría que el problema es cómo se escribió.
        return Err(Error::PermissionDenied(
            "nadie aprueba su propia calculadora: la aprobación tiene que hacerla otro \
             coordinador (FR-053)"
                .to_owned(),
        ));
    }
    Ok(State::Publicada)
}

/// Estado resultante de rechazar una calculadora propuesta (FR-054).
///
/// ## Vuelve al catálogo si ya estaba en él
///
/// Una calculadora publicada cuyo borrador se rechaza sigue publicada **con su versión
/// aprobada**: el rechazo se lleva el borrador, no la publicación. Devolverla a `privada`
/// retiraría del catálogo una versión que un coordinador distinto ya aprobó y que puede estar
/// citada por un artículo, y eso convertiría un rechazo —una decisión editorial sobre un cambio—
/// en una retirada de contenido que nadie pidió.
///
/// Si nunca se publicó, el rechazo la deja `privada`, que es donde estaba.
pub fn reject(situation: &Situacion, coordinator: Uuid) -> Result<State> {
    if situation.is_builtin {
        return Err(Error::InvalidInput(
            "las calculadoras de la plataforma no pasan por curaduría".to_owned(),
        ));
    }
    if situation.state != State::EnRevision {
        return Err(Error::InvalidInput(
            "solo se puede rechazar una calculadora propuesta para publicación".to_owned(),
        ));
    }
    if situation.owner_id == Some(coordinator) {
        return Err(Error::PermissionDenied(
            "nadie revisa su propia calculadora: la revisión tiene que hacerla otro \
             coordinador (FR-053)"
                .to_owned(),
        ));
    }
    Ok(if situation.published_version.is_some() {
        State::Publicada
    } else {
        State::Privada
    })
}

/// Valida y normaliza el motivo de un rechazo (FR-054).
///
/// Se recorta y se devuelve el valor normalizado, en lugar de comprobar y devolver nada: el
/// motivo se guarda tal cual se le enseña al autor, así que un motivo con espacios alrededor
/// sería un dato distinto del que se leyó. El tope coincide con
/// `calculators_rejection_reason_bounded`.
///
/// # Errores
///
/// [`Error::InvalidInput`] si el motivo está vacío o pasa del tope.
pub fn normalize_reason(raw: &str) -> Result<String> {
    let reason = raw.trim();
    if reason.is_empty() {
        return Err(Error::InvalidInput(
            "el rechazo necesita un motivo: es lo que el autor va a leer para poder \
             corregirla (FR-054)"
                .to_owned(),
        ));
    }
    // Se cuenta en `chars` y no en bytes: el tope es para que el texto se pueda leer, y una `ñ`
    // ocupa dos bytes pero un solo sitio en la pantalla.
    let length = reason.chars().count();
    if length > MAX_REASON_CHARS {
        return Err(Error::InvalidInput(format!(
            "el motivo no puede pasar de {MAX_REASON_CHARS} caracteres y tiene {length}"
        )));
    }
    Ok(reason.to_owned())
}

/// Tope del motivo de rechazo, en caracteres.
pub const MAX_REASON_CHARS: usize = 1000;

#[cfg(test)]
mod tests {
    use super::*;

    /// Desempaqueta el lado bueno de un `Result`.
    ///
    /// `Error` no implementa `PartialEq` —lleva dentro el error de `sqlx`, que no lo implementa—,
    /// así que comparar `Ok(esperado)` con el resultado no compila. Desempaquetar el valor es
    /// además lo que hace que el mensaje de un fallo diga qué error salió.
    fn exito<T>(result: std::result::Result<T, Error>) -> T {
        result.unwrap_or_else(|err| panic!("se esperaba éxito y salió: {err:?}"))
    }

    const AUTOR: Uuid = Uuid::from_u128(1);
    const COORDINADOR: Uuid = Uuid::from_u128(2);

    fn situacion(state: State) -> Situacion {
        Situacion {
            state,
            is_builtin: false,
            owner_id: Some(AUTOR),
            version: 2,
            published_version: None,
        }
    }

    #[test]
    fn una_calculadora_nueva_se_propone_y_queda_en_revision() {
        let nueva = Situacion {
            state: State::Privada,
            version: 1,
            published_version: None,
            ..situacion(State::Privada)
        };

        assert_eq!(exito(submit(&nueva, AUTOR)), State::EnRevision);
    }

    #[test]
    fn nadie_aprueba_su_propia_calculadora() {
        // FR-053. Es la comprobación que la base también impone, y las dos tienen que coincidir:
        // si la de aquí desapareciera, el error pasaría de «nadie aprueba lo suyo» a una
        // violación de restricción del driver.
        let en_revision = situacion(State::EnRevision);

        let err = approve(&en_revision, AUTOR).unwrap_err();
        assert!(
            matches!(&err, Error::PermissionDenied(msg) if msg.contains("su propia calculadora")),
            "el error tiene que explicar que la aprobación es de otro: {err:?}"
        );
    }

    #[test]
    fn un_coordinador_distinto_aprueba() {
        assert_eq!(
            exito(approve(&situacion(State::EnRevision), COORDINADOR)),
            State::Publicada
        );
    }

    #[test]
    fn no_se_aprueba_ni_se_rechaza_lo_que_no_esta_en_revision() {
        // Ninguna combinación fuera de `en_revision` puede acabar en `publicada`. Es la
        // propiedad que SC-018 pide, y se comprueba exhaustivamente y no caso a caso: un
        // `match` futuro que olvidara un estado pasaría inadvertido en una prueba enumerada a
        // mano.
        for state in [State::Privada, State::Publicada] {
            for situacion in [
                situacion(state),
                Situacion {
                    published_version: Some(1),
                    ..situacion(state)
                },
            ] {
                assert!(approve(&situacion, COORDINADOR).is_err(), "{situacion:?}");
                assert!(reject(&situacion, COORDINADOR).is_err(), "{situacion:?}");
            }
        }
    }

    #[test]
    fn el_rechazo_de_un_borrador_devuelve_al_catalogo_si_ya_estaba() {
        // El rechazo se lleva el borrador, no la publicación: retirar del catálogo una versión
        // que otro coordinador aprobó sería una retirada de contenido que nadie pidió.
        let publicada_con_borrador = Situacion {
            state: State::EnRevision,
            version: 3,
            published_version: Some(2),
            ..situacion(State::EnRevision)
        };

        assert_eq!(
            exito(reject(&publicada_con_borrador, COORDINADOR)),
            State::Publicada
        );
    }

    #[test]
    fn el_rechazo_de_una_primera_propuesta_la_deja_privada() {
        let primera = Situacion {
            state: State::EnRevision,
            published_version: None,
            ..situacion(State::EnRevision)
        };

        assert_eq!(exito(reject(&primera, COORDINADOR)), State::Privada);
    }

    #[test]
    fn nadie_revisa_su_propia_calculadora() {
        let err = reject(&situacion(State::EnRevision), AUTOR).unwrap_err();
        assert!(
            matches!(&err, Error::PermissionDenied(msg) if msg.contains("su propia calculadora")),
            "el mensaje tiene que decir por qué no puede: {err:?}"
        );
    }

    #[test]
    fn editar_durante_la_revision_retira_la_propuesta() {
        assert_eq!(after_edit(State::EnRevision), State::Privada);
    }

    #[test]
    fn editar_una_publicada_no_la_despublica() {
        // FR-052: el catálogo sigue sirviendo la versión aprobada.
        assert_eq!(after_edit(State::Publicada), State::Publicada);
        assert_eq!(after_edit(State::Privada), State::Privada);
    }

    #[test]
    fn una_calculadora_de_la_plataforma_no_pasa_por_curaduria() {
        let semilla = Situacion {
            state: State::EnRevision,
            is_builtin: true,
            owner_id: None,
            ..situacion(State::EnRevision)
        };

        assert!(submit(&semilla, AUTOR).is_err());
        assert!(approve(&semilla, COORDINADOR).is_err());
        assert!(reject(&semilla, COORDINADOR).is_err());
    }

    #[test]
    fn proponer_lo_ajeno_no_confirma_que_exista() {
        // El mismo `NotFound` que devuelve `get` para una calculadora privada ajena: si dijera
        // «no es tuya», el RPC sería un oráculo sobre lo que existe.
        let ajena = Situacion {
            owner_id: Some(Uuid::from_u128(9)),
            ..situacion(State::Privada)
        };

        assert!(matches!(submit(&ajena, AUTOR), Err(Error::NotFound)));
    }

    #[test]
    fn no_se_propone_lo_que_ya_esta_aprobado() {
        let al_dia = Situacion {
            state: State::Publicada,
            version: 4,
            published_version: Some(4),
            ..situacion(State::Publicada)
        };

        let err = submit(&al_dia, AUTOR).unwrap_err();
        assert!(
            matches!(&err, Error::InvalidInput(msg) if msg.contains("no ha cambiado")),
            "el autor tiene que poder entender qué le falta: {err:?}"
        );
    }

    #[test]
    fn se_propone_una_publicada_con_cambios_sin_aprobar() {
        let con_borrador = Situacion {
            state: State::Publicada,
            version: 4,
            published_version: Some(3),
            ..situacion(State::Publicada)
        };

        assert_eq!(exito(submit(&con_borrador, AUTOR)), State::EnRevision);
    }

    #[test]
    fn el_motivo_del_rechazo_se_recorta_y_tiene_tope() {
        assert_eq!(
            exito(normalize_reason("  falta el IVA  ")),
            "falta el IVA".to_owned()
        );
        assert!(normalize_reason("   ").is_err());
        assert!(normalize_reason("").is_err());
        assert!(normalize_reason(&"a".repeat(MAX_REASON_CHARS)).is_ok());
        assert!(normalize_reason(&"a".repeat(MAX_REASON_CHARS + 1)).is_err());
    }

    #[test]
    fn el_toque_del_motivo_se_cuenta_en_caracteres_y_no_en_bytes() {
        // `ñ` ocupa dos bytes en UTF-8. Un tope contado en bytes rechazaría un motivo en
        // castellano de la mitad de largo que uno en inglés, y el límite es para que el texto se
        // pueda leer, no para racionar bytes.
        let con_tildes = "ñ".repeat(MAX_REASON_CHARS);
        assert_eq!(con_tildes.len(), MAX_REASON_CHARS * 2);

        assert!(normalize_reason(&con_tildes).is_ok());
    }

    #[test]
    fn el_vocabulario_del_estado_es_el_de_la_columna() {
        // Si esto deja de coincidir con el `CHECK`, el fallo tiene que aparecer aquí y no en un
        // `INSERT` en producción.
        for state in [State::Privada, State::EnRevision, State::Publicada] {
            assert_eq!(exito(State::from_db(state.as_db())), state);
        }
        assert!(State::from_db("archivada").is_err());
    }
}
