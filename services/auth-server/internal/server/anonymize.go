package server

import (
	"context"
)

// Paso de la saga de anonimización que le corresponde a este servicio (FR-030).

// RevokeAndAnonymizeCredential revoca las sesiones del usuario y deja la
// credencial inutilizable.
//
// El ORDEN importa y es la parte interesante del paso: primero se revoca, después
// se anonimiza. Al revés, entre la anonimización y la revocación quedaría una
// ventana con la cuenta ya borrada y una sesión todavía válida, capaz de operar en
// nombre de alguien que formalmente ya no existe.
//
// Es idempotente: repetirlo sobre una credencial ya anonimizada no es un error. La
// saga puede reintentar el paso y no hay compensación posible para un dato personal
// ya destruido, así que está diseñado para no necesitarla.
func (s *Server) RevokeAndAnonymizeCredential(_ context.Context, userID string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	// T162 implementa:
	//   1. Borrar los refresh tokens del usuario en Redis.
	//   2. `store.AnonymizeCredential` con un correo opaco único y un hash
	//      imposible de satisfacer (no una cadena vacía: un hash vacío podría
	//      hacer que un verificador mal escrito aceptara cualquier contraseña).
	//
	// Los access tokens ya emitidos NO se pueden enumerar por usuario desde la
	// blacklist, que está indexada por `jti`. Es una limitación real del diseño y
	// hay que resolverla explícitamente en T162 — la opción habitual es una marca
	// por usuario con la fecha de corte que la introspección consulte.
	return ErrNotImplemented
}
