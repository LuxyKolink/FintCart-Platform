package handler

import (
	"net/http"

	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
)

// Rutas del propio usuario: `/me/*`.
//
// Ninguna lleva el identificador en la URL, y es una decisión de seguridad, no de
// estética: el usuario se toma SIEMPRE del token verificado. Con `/users/{userId}/profile`
// existiría la posibilidad de pedir el perfil de otro y todo dependería de recordar la
// comprobación en cada handler; con `/me/profile` esa clase de fallo no se puede
// escribir.

// GetProgress ≡ `GET /me/progress` (FR-014).
//
// Es el proxy más simple del borde y sirve de patrón para los demás: sacar el usuario
// del token, una llamada gRPC, convertir con `mapping.go`, responder.
func (h *Handler) GetProgress(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Users.GetProgress(r.Context(), &usersv1.UserRef{UserId: claims.UserID})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, progressToDTO(resp))
}

// GetProfile ≡ `GET /me/profile` (FR-017, FR-029: derecho de consulta).
func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	// T059: `h.clients.Users.GetProfile` + `profileToDTO`.
	h.writeGRPCError(w, r, errNotImplemented)
}

// UpdateProfile ≡ `PATCH /me/profile` (FR-029: derecho de rectificación).
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	// T059: decodificar `UpdateProfileRequest` y llamar a `Users.UpdateProfile`.
	//
	// Es un PATCH, así que el cuerpo es parcial: un `display_name` ausente significa
	// «no lo cambies», no «ponlo en blanco». Distinguir los dos casos exige punteros o
	// un mapa de campos presentes, y confundirlos borraría el nombre de cualquiera que
	// actualice solo sus preferencias.
	h.writeGRPCError(w, r, errNotImplemented)
}

// ListNotifications ≡ `GET /me/notifications` (FR-023).
//
// La bandeja in-app la sirve el Servicio de Usuarios, no Notificación: Notificación es
// consumidor puro sin gRPC y no puede atender lecturas (plan.md N-03).
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	// T059: `Users.ListInAppNotifications` + `inAppToDTO`, propagando `page_token` y
	// `page_size` desde la query string al `PageRequest` del contrato.
	h.writeGRPCError(w, r, errNotImplemented)
}

// MarkNotificationRead ≡ `POST /me/notifications/{id}/read`.
func (h *Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	// T059: `Users.MarkNotificationRead` con el `{id}` de la ruta y el usuario del
	// token. El usuario DEBE salir del token también aquí: sin eso, un id de
	// notificación ajeno permitiría marcar como leída la de otra persona.
	h.writeGRPCError(w, r, errNotImplemented)
}

// DeleteAccount ≡ `DELETE /me/account` (FR-030).
//
// Arranca la saga de anonimización en el Orquestador. No borra nada por sí mismo, y no
// podría: la supresión toca cuatro servicios y Auditoría debe conservar el registro con
// `actor_ref` opaco (FR-031), lo que solo una saga con pasos idempotentes puede
// coordinar (research D-08).
func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	// T164: `Orchestrator.StartAccountAnonymization`, respondiendo 202 con el `saga_id`.
	h.writeGRPCError(w, r, errNotImplemented)
}
