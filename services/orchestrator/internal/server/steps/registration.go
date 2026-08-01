package steps

import (
	"context"
	"fmt"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de REGISTRO (research D-04).
//
// Secuencia: crear la credencial → crear el perfil → publicar `user.registered`
// (que dispara el email de verificación en Notificación).
//
// El orden no es indiferente. La credencial va primero porque es la que decide si
// el correo está libre: si el perfil fuera primero, un alta con un correo ya usado
// crearía el perfil, fallaría al crear la credencial y habría que deshacer el perfil
// — trabajo y una compensación de más para el caso MÁS común de fallo del registro.
//
// La compensación del último paso es `nil` a propósito: publicar un evento no se
// deshace. Por eso el evento se emite al FINAL, cuando ya no queda nada que pueda
// fallar; emitirlo antes obligaría a enviar un «ignora el correo anterior».
//
// Sobre el `user_id`: lo genera quien ARRANCA la saga y viaja en el payload
// (`server.StartRegistration`). No se genera aquí porque un reintento del primer
// paso produciría un identificador distinto y, con él, una segunda credencial que
// nadie compensaría. El contrato exige el `user_id` como ENTRADA de
// `CreateCredential` y de `CreateProfile`, de modo que alguien tiene que asignarlo
// antes de que exista ningún participante, y el Orquestador es el único que está en
// esa posición. Asignar un identificador opaco no es decidir nada de dominio.
func RegistrationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaRegistro,
		Steps: []Step{
			{
				Name: "auth.create_credential",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					email, err := st.String(payloadEmail)
					if err != nil {
						return nil, err
					}
					// La contraseña viaja FUERA del payload persistido. Ver
					// [State.Secrets]: guardarla en `saga_state.payload` la dejaría en
					// claro en PostgreSQL y en cada copia de seguridad.
					password, err := st.Secret(SecretPassword)
					if err != nil {
						return nil, err
					}

					if _, err := c.Auth.CreateCredential(ctx, &authv1.CreateCredentialRequest{
						UserId: userID, Email: email, Password: password,
					}); err != nil {
						return nil, fmt.Errorf("crear credencial de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: func(ctx context.Context, st *State) error {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return err
					}
					// No se BORRA la credencial: no existe un RPC de borrado, y con
					// razón — el correo debe quedar liberado sin que desaparezca el
					// rastro de que hubo un intento. `RevokeAndAnonymizeCredential` es
					// idempotente, así que repetir la compensación no es un problema.
					if _, err := c.Auth.RevokeAndAnonymizeCredential(ctx, &authv1.UserRef{
						UserId: userID,
					}); err != nil {
						return fmt.Errorf("anonimizar la credencial de %s: %w", userID, err)
					}
					return nil
				},
			},
			{
				Name: "users.create_profile",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					email, err := st.String(payloadEmail)
					if err != nil {
						return nil, err
					}
					// El nombre visible SÍ puede faltar: es opcional en el alta, y
					// exigirlo aquí convertiría en fallo de saga algo que Usuarios ya
					// decide. Se lee sin validar y el destinatario lo rechaza si no le
					// vale (Principio VI).
					displayName, _ := st.Payload[payloadDisplayName].(string)

					// El RPC es idempotente por `user_id` (D-04), así que un reintento
					// del paso no duplica el perfil.
					if _, err := c.Users.CreateProfile(ctx, &usersv1.CreateProfileRequest{
						UserId: userID, Email: email, DisplayName: displayName,
					}); err != nil {
						return nil, fmt.Errorf("crear perfil de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: func(ctx context.Context, st *State) error {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return err
					}
					if _, err := c.Users.AnonymizeProfile(ctx, &usersv1.UserRef{UserId: userID}); err != nil {
						return fmt.Errorf("anonimizar el perfil de %s: %w", userID, err)
					}
					return nil
				},
			},
			{
				// Emitir el token y emitir el evento son UN solo paso, no dos, y es la
				// única excepción a la regla de «un paso, una cosa» que sigue el resto
				// de sagas.
				//
				// La razón es que el token en claro no puede sobrevivir al paso que lo
				// pide. Partirlo en dos obligaría a llevarlo del primero al segundo, y
				// solo hay dos vías: el payload —que se escribe en PostgreSQL en cada
				// avance, dejando ahí lo que permite activar la cuenta— o los secretos,
				// que una saga reanudada ya no tiene, de modo que el segundo paso
				// fallaría y compensaría un registro correcto. Juntos, el token nace y
				// muere dentro de la misma función.
				Name: "auth.issue_verification_token_and_emit",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					email, err := st.String(payloadEmail)
					if err != nil {
						return nil, err
					}
					displayName, _ := st.Payload[payloadDisplayName].(string)

					// El token es la prueba de que quien verifique controla el buzón.
					// Lo genera y lo guarda Auth —hasheado—; aquí solo se transporta.
					token, err := c.Auth.IssueVerificationToken(ctx, &authv1.UserRef{UserId: userID})
					if err != nil {
						return nil, fmt.Errorf("emitir el token de verificación de %s: %w", userID, err)
					}

					// El paso no publica: DEVUELVE el evento y el motor lo escribe en el
					// outbox dentro de la transacción del avance (D-07). Un reintento del
					// paso emite un token nuevo que invalida al anterior, así que no
					// quedan dos enlaces vivos.
					//
					// El correo va en el payload y es la ÚNICA excepción a la regla de no
					// meter datos personales: Notificación necesita una dirección a la que
					// escribir, y este es el único evento del catálogo que produce un
					// correo dirigido a alguien que aún no tiene sesión. `actor_ref` sigue
					// siendo el UUID opaco, de modo que Auditoría —el otro consumidor—
					// conserva la traza aunque después se anonimice la cuenta (FR-031).
					//
					// El `user_id` se repite DENTRO del payload además de ir en
					// `actor_ref` porque `POST /auth/verify-email` lo exige junto al
					// token, así que el enlace del correo tiene que llevarlo y
					// Notificación solo lee el payload.
					//
					// Consecuencia asumida: el token en claro queda en la fila del outbox
					// hasta que se publica y se poda. Es transitorio y acotado, frente al
					// hash permanente de `auth_db`; ninguna de las dos copias es evitable
					// si el correo tiene que llevar un enlace.
					return []Event{{
						Type:       events.EventUserRegistered,
						RoutingKey: events.EventUserRegistered,
						ActorRef:   userID,
						Payload: map[string]any{
							eventKeyUserID:            userID,
							eventKeyEmail:             email,
							eventKeyDisplayName:       displayName,
							eventKeyVerificationToken: token.GetToken(),
							eventKeyVerificationExp:   token.GetExpiresAt(),
						},
					}}, nil
				},
				// Sin compensación: un evento publicado no se despublica. El token
				// tampoco se revoca — la compensación del paso 1 anonimiza la credencial,
				// y sobre una cuenta anonimizada ningún token activa nada.
				Compensate: nil,
			},
		},
	}
}
