package server

import (
	"context"
	"fmt"
)

// anonymizedEmailDomain y anonymizedDisplayName son los valores opacos con los
// que FR-030 sustituye los datos personales.
//
// El correo opaco INCLUYE el `user_id`: es lo que lo mantiene único entre cuentas
// anonimizadas sin necesitar una consulta extra ni un generador aleatorio. El
// dominio `.invalid` es el reservado por RFC 2606 para direcciones que
// deliberadamente no deben resolver a nada — no es un descuido si algún día se le
// intenta enviar un correo, es la garantía de que no puede llegar.
const (
	anonymizedEmailDomain = "anonimizado.fintcart.invalid"
	anonymizedDisplayName = "Usuario anonimizado"
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
func (s *Server) AnonymizeProfile(ctx context.Context, userID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}

	opaqueEmail := fmt.Sprintf("%s@%s", id, anonymizedEmailDomain)
	if err := s.store.AnonymizeProfile(ctx, id, opaqueEmail, anonymizedDisplayName); err != nil {
		return fmt.Errorf("anonimizar perfil: %w", err)
	}
	return nil
}
