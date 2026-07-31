package handler

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
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
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Users.GetProfile(r.Context(), &usersv1.UserRef{UserId: claims.UserID})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, profileToDTO(resp))
}

// UpdateProfile ≡ `PATCH /me/profile` (FR-029: derecho de rectificación).
//
// El cuerpo es PARCIAL: un `display_name` ausente significa «no lo cambies», no «ponlo
// en blanco». Los punteros de [UpdateProfileRequest] son los que distinguen los dos
// casos; ver allí la limitación del contrato gRPC, que no tiene máscara de campos.
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body UpdateProfileRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	if body.DisplayName == nil && body.Preferences == nil {
		// Un PATCH sin ningún campo es casi siempre un error del cliente —un nombre de
		// campo mal escrito que `DisallowUnknownFields` no llegó a ver porque el objeto
		// venía vacío—. Devolver 200 haría creer que se guardó algo.
		h.writeGRPCError(w, r, fmt.Errorf("%w: el cuerpo no trae ningún campo a modificar", errBadRequest))
		return
	}

	req := &usersv1.UpdateProfileRequest{UserId: claims.UserID}
	if body.DisplayName != nil {
		req.DisplayName = *body.DisplayName
	}
	if body.Preferences != nil {
		req.Preferences = *body.Preferences
	}

	resp, err := h.clients.Users.UpdateProfile(r.Context(), req)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, opToDTO(resp))
}

// ListNotifications ≡ `GET /me/notifications` (FR-023).
//
// La bandeja in-app la sirve el Servicio de Usuarios, no Notificación: Notificación es
// consumidor puro sin gRPC y no puede atender lecturas (plan.md N-03).
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Users.ListInAppNotifications(r.Context(), &usersv1.ListInAppRequest{
		UserId: claims.UserID,
		Page:   pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	items := make([]InAppNotification, 0, len(resp.GetItems()))
	for _, item := range resp.GetItems() {
		items = append(items, inAppToDTO(item))
	}
	writeJSON(w, http.StatusOK, pageOf(items, resp.GetPage()))
}

// MarkNotificationRead ≡ `POST /me/notifications/{id}/read`.
func (h *Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	if _, err := h.clients.Users.MarkNotificationRead(r.Context(), &usersv1.MarkReadRequest{
		// El usuario va junto al id de notificación para que Usuarios pueda comprobar la
		// propiedad. Sin él, un identificador ajeno permitiría marcar como leída la
		// notificación de otra persona.
		UserId:         claims.UserID,
		NotificationId: chi.URLParam(r, "id"),
	}); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteAccount ≡ `DELETE /me/account` (FR-030).
//
// Arranca la saga de anonimización en el Orquestador. No borra nada por sí mismo, y no
// podría: la supresión toca cuatro servicios y Auditoría debe conservar el registro con
// `actor_ref` opaco (FR-031), lo que solo una saga con pasos idempotentes puede
// coordinar (research D-08).
//
// Responde 202: la anonimización tiene un SLA de ≤ 15 días hábiles (SC-011), así que
// afirmar con un 204 que ya está hecha sería sencillamente falso.
func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Orchestrator.StartAccountAnonymization(r.Context(), &orchestratorv1.UserRef{
		UserId: claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusAccepted, SagaAccepted{SagaID: resp.GetSagaId()})
}
