package server

import (
	"context"
	"fmt"
	"time"
)

// Verificación de correo (FR-002).
//
// El token de verificación es la ÚNICA prueba de que quien activa una cuenta
// controla el buzón al que se envió el correo. Sin él, `ActivateCredential` bastaba
// con conocer el `user_id` —que viaja en el `actor_ref` de cada evento de
// auditoría—, de modo que registrarse con la dirección de otra persona y activarla
// uno mismo era trivial y el correo de verificación no comprobaba nada.
//
// Auth es el dueño del token y no podría ser otro: es quien tiene el estado
// `login_status` que el token desbloquea. Generarlo en el Orquestador sería una
// regla de dominio en el servicio que el Principio VI deja sin dominio, y en el
// Gateway no hay dónde guardarlo (Principio IX: borde sin base de datos).

// VerificationTokenTTL es la vida del enlace de verificación.
//
// Veinticuatro horas es un compromiso entre dos fallos reales: más corto castiga al
// usuario que abre el correo al día siguiente —y le obliga a pedir un reenvío por
// algo que hizo bien—, y más largo mantiene utilizable un enlace que quedó en un
// buzón que la persona ya no controla.
const VerificationTokenTTL = 24 * time.Hour

// VerificationToken es un token de verificación recién emitido.
//
// `Token` es el valor EN CLARO y existe solo durante esta respuesta: en `auth_db`
// queda su hash, así que no hay forma de volver a consultarlo. Quien lo pierda tiene
// que reemitir.
type VerificationToken struct {
	Token     string
	ExpiresAt time.Time
}

// IssueVerificationToken emite —o reemite— el token de verificación de correo.
//
// Cada llamada SUSTITUYE al token anterior, y esa es la propiedad que hace correcto
// el reenvío: si se acumularan, el enlace de un correo antiguo seguiría activando la
// cuenta después de que el usuario pidiera uno nuevo, y pedir un reenvío por haber
// perdido el primero no cerraría nada.
//
// Falla con [ErrConflict] si la cuenta no está pendiente de verificar. Los dos casos
// que eso cubre son distintos entre sí pero comparten respuesta: en una cuenta ya
// activa no hay nada que verificar, y en una anonimizada emitir un token sería
// abrirle una vía de regreso que FR-030 cierra de forma permanente.
func (s *Server) IssueVerificationToken(ctx context.Context, userID string) (VerificationToken, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return VerificationToken{}, err
	}

	token, err := randomSecret()
	if err != nil {
		return VerificationToken{}, fmt.Errorf("generar el token de verificación: %w", err)
	}

	// UTC explícito: la caducidad viaja en el correo y acaba comparándose contra el
	// `now()` de PostgreSQL. Una hora local aquí desplazaría la validez del enlace
	// tantas horas como diga la zona del contenedor.
	expiresAt := time.Now().UTC().Add(VerificationTokenTTL)
	if err := s.store.SetVerificationToken(ctx, id, sha256Hex(token), expiresAt); err != nil {
		return VerificationToken{}, fmt.Errorf("guardar el token de verificación de %s: %w", id, err)
	}

	return VerificationToken{Token: token, ExpiresAt: expiresAt}, nil
}

// ActivateCredential cierra la saga de verificación de correo (FR-002).
//
// El token se comprueba dentro del UPDATE, no aquí: ver
// [storer.Storer.ActivateCredential]. Esta función solo lo convierte en el hash con
// el que se guardó, para que el valor en claro no llegue nunca a la capa de
// persistencia ni a una consulta que pudiera acabar en un log de SQL lento.
func (s *Server) ActivateCredential(ctx context.Context, userID, verificationToken string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if verificationToken == "" {
		// Se corta antes de consultar. Con la cadena vacía el hash sería un valor
		// perfectamente válido que ninguna fila tiene, así que el resultado sería el
		// mismo; pararlo aquí evita gastar una escritura por cada petición sin token.
		return fmt.Errorf("%w: falta el token de verificación", ErrVerificationTokenInvalid)
	}

	if err := s.store.ActivateCredential(ctx, id, sha256Hex(verificationToken)); err != nil {
		return fmt.Errorf("activar credencial: %w", err)
	}
	return nil
}
