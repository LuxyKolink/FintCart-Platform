package handler

import (
	"net/http"

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
	if err := decodeJSON(r, &body); err != nil {
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

// VerifyEmail ≡ `POST /auth/verify-email`. Arranca la saga de verificación (FR-002).
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var body VerifyEmailRequest
	if err := decodeJSON(r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Orchestrator.StartEmailVerification(r.Context(), &orchestratorv1.EmailVerificationRequest{
		UserId:            body.UserID,
		VerificationToken: body.VerificationToken,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusAccepted, SagaAccepted{SagaID: resp.GetSagaId()})
}

// Logout ≡ `POST /auth/logout`. Revoca la sesión con efecto inmediato (FR-004).
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	// T055 lo implementa con `h.clients.Auth.Revoke`, tomando el token del encabezado
	// `Authorization` y no del cuerpo: el cliente no debería tener que reenviar en el
	// cuerpo un token que ya está enviando en la cabecera, y aceptarlo por las dos vías
	// permitiría revocar un token distinto del que autentica la petición.
	h.writeGRPCError(w, r, errNotImplemented)
}
