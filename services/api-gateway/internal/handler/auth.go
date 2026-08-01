package handler

import (
	"fmt"
	"net/http"

	authv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/auth/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
)

// Rutas de identidad: `/auth/*`.
//
// El registro y la verificación NO van al Servidor de Autenticación directamente:
// van al ORQUESTADOR, porque los dos flujos cruzan dos servicios —credencial en Auth
// y perfil en Usuarios— y la consistencia multi-servicio solo se consigue por saga
// (Principio VI, research D-04). Llamar a Auth y a Usuarios desde aquí, uno detrás de
// otro, es exactamente el patrón que la constitución prohíbe: sin compensación, un
// fallo en el segundo deja una credencial sin perfil para siempre.

// Register ≡ `POST /auth/register`. Arranca la saga de registro.
//
// Devuelve 202 y no 201: la saga puede no haber terminado cuando la respuesta sale, así
// que no hay un recurso creado que anunciar. El cliente recibe el `saga_id` y consulta
// el estado si le interesa.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body RegisterRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Orchestrator.StartRegistration(r.Context(), &orchestratorv1.StartRegistrationRequest{
		Email:       body.Email,
		Password:    body.Password,
		DisplayName: body.DisplayName,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusAccepted, SagaAccepted{SagaID: resp.GetSagaId()})
}

// VerifyEmail ≡ `POST /auth/verify-email`. Ejecuta la saga de verificación (FR-002).
//
// Responde 200 y no 202, al contrario que el registro, porque esta saga corre EN
// LÍNEA: el primer paso es el que comprueba el token, así que para cuando se escribe
// la respuesta la cuenta ya está activa o el enlace ya se rechazó. Un 202 aquí sería
// engañoso en el único caso que importa — el usuario cerraría la pestaña convencido
// de haber verificado una cuenta que quedó pendiente por un token caducado.
//
// El token no se valida en el borde: el Gateway no tiene con qué compararlo, y
// cualquier comprobación previa aquí sería una regla de identidad fuera de su dueño.
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var body VerifyEmailRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Orchestrator.StartEmailVerification(r.Context(), &orchestratorv1.EmailVerificationRequest{
		UserId:            body.UserID,
		VerificationToken: body.VerificationToken,
	})
	if err != nil {
		// Un token inválido o caducado llega como `InvalidArgument` y sale como 400,
		// que es lo que declara el contrato.
		h.writeGRPCError(w, r, err)
		return
	}

	// La respuesta no debe quedar en la caché de ningún proxy: lleva el `saga_id` de
	// una operación de identidad y la petición que la produjo llevaba el token.
	noStore(w)
	writeJSON(w, http.StatusOK, SagaAccepted{SagaID: resp.GetSagaId()})
}

// Logout ≡ `POST /auth/logout`. Revoca la sesión con efecto inmediato (FR-004).
//
// El token se toma del encabezado `Authorization` y NO del cuerpo. Aceptarlo por las dos
// vías permitiría revocar un token distinto del que autentica la petición: bastaría
// autenticarse con el propio y enviar en el cuerpo el de otra persona.
//
// Responde 204 aunque Auth informe de que el token ya estaba revocado. Un segundo
// «cerrar sesión» —o el reintento de una red inestable— no puede acabar en error: el
// efecto buscado ya se cumplió (RFC 7009 §2.2).
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	raw, err := bearerToken(r)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	if _, err := h.clients.Auth.Revoke(r.Context(), &authv1.RevokeRequest{
		Token:         raw,
		TokenTypeHint: "access_token",
	}); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	// El navegador debe olvidar cualquier copia cacheada de la sesión que acaba de morir.
	noStore(w)
	w.WriteHeader(http.StatusNoContent)
}

// ── OAuth2: los dos endpoints que el borde DEBE servir (Principio VII) ──────
//
// `contracts/openapi/gateway.yaml` declara `authorizationUrl` y `tokenUrl` en el host
// `auth.fintcart.co`, fuera de `paths:`. Ese host no puede existir: el Principio II
// reserva toda la superficie REST al Gateway y el Servidor de Autenticación solo expone
// gRPC. Sin estos dos endpoints aquí, la SPA no tiene forma de obtener un token y la
// plataforma entera queda sin login. Ver la nota de T055 en `tasks.md`.

// Authorize ≡ `POST /oauth/authorize`.
//
// Valida credenciales y emite un authorization_code ligado al `code_challenge` (PKCE,
// RFC 7636). Son DOS llamadas a Auth y no una porque el contrato gRPC las separa, y la
// separación es correcta: `ValidateCredentials` responde «quién eres» y
// `IssueAuthorizationCode` «con qué cliente y para qué alcances».
func (h *Handler) Authorize(w http.ResponseWriter, r *http.Request) {
	var body AuthorizeRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	// PKCE con `plain` se rechaza en el BORDE, además de en Auth. El método `plain`
	// transmite el verificador tal cual, así que quien intercepte la petición de
	// autorización puede canjear el código: anula por completo la protección.
	if body.CodeChallengeMethod != challengeMethodS256 {
		h.writeGRPCError(w, r, fmt.Errorf("%w: code_challenge_method debe ser S256", errBadRequest))
		return
	}
	if body.CodeChallenge == "" || body.ClientID == "" || body.RedirectURI == "" {
		h.writeGRPCError(w, r, fmt.Errorf("%w: faltan parámetros de PKCE o de cliente", errBadRequest))
		return
	}

	validation, err := h.clients.Auth.ValidateCredentials(r.Context(), &authv1.ValidateCredentialsRequest{
		Email:    body.Email,
		Password: body.Password,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	if !validation.GetValid() {
		// Mensaje único para «no existe» y «contraseña incorrecta». Distinguirlos
		// convertiría este endpoint en un enumerador de cuentas registradas.
		noStore(w)
		writeError(w, http.StatusUnauthorized, "invalid_grant", "credenciales inválidas")
		return
	}
	if !validation.GetEmailVerified() {
		// Aquí SÍ se distingue, y a propósito: la cuenta ya se ha probado que es del
		// solicitante, así que no se filtra nada, y sin este mensaje el usuario no tendría
		// forma de saber que le falta confirmar el correo (FR-002).
		noStore(w)
		writeError(w, http.StatusForbidden, "email_unverified", "falta verificar el correo electrónico")
		return
	}

	code, err := h.clients.Auth.IssueAuthorizationCode(r.Context(), &authv1.IssueAuthCodeRequest{
		UserId:              validation.GetUserId(),
		ClientId:            body.ClientID,
		RedirectUri:         body.RedirectURI,
		CodeChallenge:       body.CodeChallenge,
		CodeChallengeMethod: body.CodeChallengeMethod,
		Scopes:              body.Scopes,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	noStore(w)
	writeJSON(w, http.StatusOK, AuthorizeResponse{Code: code.GetCode(), RedirectURI: body.RedirectURI})
}

// Grants que el borde admite en `POST /oauth/token`.
const (
	challengeMethodS256    = "S256"
	grantAuthorizationCode = "authorization_code"
	grantRefreshToken      = "refresh_token"
	grantClientCredentials = "client_credentials"
)

// Token ≡ `POST /oauth/token` (RFC 6749 §4.1.3 y §6).
func (h *Handler) Token(w http.ResponseWriter, r *http.Request) {
	var body TokenRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	// `no-store` se pone ANTES de cualquier rama para que también cubra las respuestas
	// de error: un 400 de este endpoint lleva en el cuerpo pistas sobre un canje fallido
	// que tampoco interesa que queden en la caché de un proxy.
	noStore(w)

	var (
		tokens *authv1.TokenResponse
		err    error
	)
	switch body.GrantType {
	case grantAuthorizationCode:
		if body.Code == "" || body.CodeVerifier == "" {
			h.writeGRPCError(w, r, fmt.Errorf("%w: faltan code o code_verifier", errBadRequest))
			return
		}
		tokens, err = h.clients.Auth.ExchangeCode(r.Context(), &authv1.ExchangeCodeRequest{
			Code:         body.Code,
			CodeVerifier: body.CodeVerifier,
			ClientId:     body.ClientID,
			RedirectUri:  body.RedirectURI,
		})

	case grantRefreshToken:
		if body.RefreshToken == "" {
			h.writeGRPCError(w, r, fmt.Errorf("%w: falta refresh_token", errBadRequest))
			return
		}
		tokens, err = h.clients.Auth.RefreshToken(r.Context(), &authv1.RefreshTokenRequest{
			RefreshToken: body.RefreshToken,
		})

	case grantClientCredentials:
		// El grant M2M existe en la capa de aplicación de Auth
		// (`server.ClientCredentialsToken`, T052) pero NO está expuesto en
		// `contracts/proto/fintcart/auth/v1/auth.proto`, así que el Gateway no tiene por
		// dónde invocarlo. Se responde con el código exacto del RFC en lugar de un 500
		// para que el consumidor sepa que el grant no está disponible, no que algo se
		// rompió. Queda anotado como hueco de contrato en las notas de T055–T059.
		writeError(w, http.StatusBadRequest, "unsupported_grant_type",
			"el grant client_credentials no se expone en el borde")
		return

	default:
		writeError(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type no soportado")
		return
	}

	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, TokenResponse{
		AccessToken:  tokens.GetAccessToken(),
		RefreshToken: tokens.GetRefreshToken(),
		TokenType:    tokens.GetTokenType(),
		ExpiresIn:    tokens.GetExpiresIn(),
	})
}
