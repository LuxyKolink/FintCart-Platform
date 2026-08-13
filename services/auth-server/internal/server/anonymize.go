package server

import (
	"context"
	"fmt"
)

// anonymizedEmailDomain compone el correo opaco que sustituye al real (FR-030).
//
// Incluye el `user_id`, igual que en el Servicio de Usuarios (ver el comentario
// equivalente en `services/users/internal/server/anonymize.go`): es lo que lo
// mantiene único entre credenciales anonimizadas sin necesitar una consulta extra
// ni un generador aleatorio. El dominio `.invalid` es el reservado por RFC 2606
// para direcciones que deliberadamente no deben resolver a nada.
const anonymizedEmailDomain = "anonimizado.fintcart.invalid"

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
func (s *Server) RevokeAndAnonymizeCredential(ctx context.Context, userID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}

	// PRIMERO se revoca, DESPUÉS se anonimiza — ver la nota de orden en el
	// comentario del paso de la saga (`orchestrator/.../steps/anonymization.go`).
	//
	// LIMITACIÓN CONOCIDA (anotada, no resuelta aquí): los access tokens YA
	// EMITIDOS no se pueden enumerar por usuario desde la blacklist, que está
	// indexada por `jti`. `InvalidateFamily` corta los refresh tokens —con lo que
	// ningún token NUEVO se emite tras esta llamada—, pero un access token vigente
	// sigue siendo válido hasta su propia expiración (minutos, no días, por
	// diseño). Resolverlo exigiría una marca de corte por usuario que
	// `Introspect` consultara además de la blacklist, y es un cambio que toca la
	// ruta caliente de cada petición autenticada de la plataforma — fuera del
	// alcance de esta historia.
	if err := s.tokens.InvalidateFamily(ctx, id); err != nil {
		return fmt.Errorf("invalidar sesiones antes de anonimizar: %w", err)
	}

	opaqueEmail := fmt.Sprintf("%s@%s", id, anonymizedEmailDomain)
	if err := s.store.AnonymizeCredential(ctx, id, opaqueEmail); err != nil {
		return fmt.Errorf("anonimizar credencial: %w", err)
	}
	return nil
}
