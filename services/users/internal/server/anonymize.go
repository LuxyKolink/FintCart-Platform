package server

import (
	"context"
)

// Anonimización de la cuenta (FR-030): paso de la saga de anonimización
// coordinada por el Orquestador.

// AnonymizeProfile sustituye los datos personales del perfil por valores opacos.
//
// Anonimiza en lugar de borrar, y la diferencia es sustantiva: el progreso, los
// agregados de lectura y el log de auditoría deben sobrevivir —el `audit_log` es
// append-only por diseño (FR-025/FR-031)—, así que la fila del perfil sigue
// existiendo con `account_status = 'anonymized'` y sin datos identificables.
//
// Es idempotente: repetir la anonimización de una cuenta ya anonimizada no es un
// error. La saga puede reintentar el paso y no hay compensación posible para un
// dato personal ya destruido, así que el paso está diseñado para no necesitarla.
func (s *Server) AnonymizeProfile(_ context.Context, userID string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	// T161 implementa la generación de los valores opacos y la llamada a
	// `store.AnonymizeProfile`. El correo opaco debe seguir siendo único entre
	// cuentas anonimizadas: el índice único parcial de `profiles` solo cubre las
	// activas, pero dos filas anonimizadas con el mismo correo harían imposible
	// distinguirlas en una auditoría posterior.
	return ErrNotImplemented
}
