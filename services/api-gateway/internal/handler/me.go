package handler

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	authv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
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

// GetActivityReport ≡ `GET /me/report` (FR-018).
func (h *Handler) GetActivityReport(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Users.GetActivityReport(r.Context(), &usersv1.UserRef{UserId: claims.UserID})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, activityReportToDTO(resp))
}

// ChangePassword ≡ `PATCH /me/password` (FR-005).
//
// El usuario sale del token, igual que en el resto de `/me/*`: aceptar un
// `user_id` en el cuerpo abriría la puerta a que alguien cambiara la
// contraseña de otra persona conociendo su identificador.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body ChangePasswordRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	if _, err := h.clients.Auth.ChangePassword(r.Context(), &authv1.ChangePasswordRequest{
		UserId:          claims.UserID,
		CurrentPassword: body.CurrentPassword,
		NewPassword:     body.NewPassword,
	}); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	// La respuesta lleva la confirmación de que las sesiones abiertas se
	// invalidaron (FR-005): no debe quedar cacheada, igual que cualquier otra
	// respuesta de identidad.
	noStore(w)
	writeJSON(w, http.StatusOK, OpAck{Success: true})
}

// GetPersonalData ≡ `GET /me/data` (FR-029: derecho de acceso, Ley 1581).
//
// Combina cuatro llamadas gRPC — nunca una lectura cruzada de base de datos
// (Principio III) — porque el titular del dato tiene derecho a verlo TODO en
// un solo ejercicio del derecho, no artículo por artículo en cuatro pantallas
// distintas. Los historiales se acotan a una página razonable
// ([maxPageSize]): es una vista de consulta, no una exportación masiva —quien
// necesite más allá de eso ya tiene `GET /quizzes/{quizId}` (vía Aprendizaje)
// y `GET /simulators/history` paginados por su cuenta.
func (h *Handler) GetPersonalData(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}
	ctx := r.Context()
	page := &commonv1.PageRequest{PageSize: maxPageSize}

	profile, err := h.clients.Users.GetProfile(ctx, &usersv1.UserRef{UserId: claims.UserID})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	progress, err := h.clients.Users.GetProgress(ctx, &usersv1.UserRef{UserId: claims.UserID})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	// `QuizId` vacío pide TODOS los cuestionarios, igual que hace
	// `Users.GetActivityReport` internamente para contarlos.
	attempts, err := h.clients.Learning.ListAttempts(ctx, &learningv1.ListAttemptsRequest{
		UserId: claims.UserID, Page: page,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	history, err := h.clients.Simulator.ListHistory(ctx, &simulatorv1.ListHistoryRequest{
		UserId: claims.UserID, Page: page,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	attemptItems := make([]QuizAttempt, 0, len(attempts.GetItems()))
	for _, a := range attempts.GetItems() {
		attemptItems = append(attemptItems, attemptToDTO(a))
	}
	historyItems := make([]SimulationHistoryEntry, 0, len(history.GetItems()))
	for _, entry := range history.GetItems() {
		historyItems = append(historyItems, historyEntryToDTO(entry))
	}

	writeJSON(w, http.StatusOK, PersonalData{
		Profile:      profileToDTO(profile),
		Progress:     progressToDTO(progress),
		QuizAttempts: pageOf(attemptItems, attempts.GetPage()),
		Simulations:  pageOf(historyItems, history.GetPage()),
	})
}
