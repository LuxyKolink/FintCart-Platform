package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
)

// Rutas editoriales: `/editorial/*` (FR-007, FR-008).
//
// Son las únicas rutas con control de ROL en el router (`routes.go`): crear y enviar a
// revisión exige `editor` o `coordinador_editorial`; publicar exige
// `coordinador_editorial`.
//
// Ese control es necesario pero NO suficiente para FR-008. La regla completa es «un
// editor no publica su propio artículo», y el Gateway no puede comprobarla: no sabe
// quién creó la versión. El invariante lo refuerza Aprendizaje sobre `article_versions`
// (`approved_by ≠ created_by`), que es donde vive el dato. Duplicar aquí una versión
// aproximada de la regla daría una falsa sensación de cobertura y podría discrepar de la
// real.
//
// Lo que sí es responsabilidad de este archivo, y aparece en los tres handlers, es que
// el ACTOR salga siempre del token verificado y jamás del cuerpo o de la query string.
// Esa es la pieza sin la cual el invariante de Aprendizaje no sirve de nada: comprobar
// `approved_by ≠ created_by` sobre un `approved_by` que el atacante eligió no comprueba
// nada.

// CreateDraft ≡ `POST /editorial/articles` (FR-007).
func (h *Handler) CreateDraft(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body CreateDraftRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.CreateDraft(r.Context(), &learningv1.CreateDraftRequest{
		Title:    body.Title,
		Category: body.Category,
		Body:     body.Body,
		EditorId: claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, versionToDTO(resp))
}

// SubmitForReview ≡ `POST /editorial/versions/{versionId}/submit` (FR-007).
func (h *Handler) SubmitForReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Learning.SubmitForReview(r.Context(), &learningv1.VersionRef{
		VersionId: chi.URLParam(r, "versionId"),
		ActorId:   claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, opToDTO(resp))
}

// ApproveAndPublish ≡ `POST /editorial/versions/{versionId}/publish` (FR-008).
func (h *Handler) ApproveAndPublish(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Learning.ApproveAndPublish(r.Context(), &learningv1.ApprovePublishRequest{
		VersionId: chi.URLParam(r, "versionId"),
		// Quien aprueba viene del token para que Aprendizaje pueda aplicar
		// `approved_by ≠ created_by` sobre un dato que el solicitante no eligió.
		CoordinatorId: claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, opToDTO(resp))
}

// CreateVersion ≡ `POST /editorial/articles/{articleId}/versions` (FR-013).
//
// Es `CreateDraft` con `article_id` relleno desde la URL: `learning.proto` documenta
// que en ese caso `title`/`category` se ignoran (viven en `articles`, no por versión).
// Ruta propia y no un campo opcional en `POST /editorial/articles` porque las dos
// operaciones tienen identificadores de recurso distintos en la URL — una crea, la otra
// versiona uno que ya existe — y REST los distingue por la ruta, no por el cuerpo.
func (h *Handler) CreateVersion(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body UpdateDraftRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.CreateDraft(r.Context(), &learningv1.CreateDraftRequest{
		Body:      body.Body,
		EditorId:  claims.UserID,
		ArticleId: chi.URLParam(r, "articleId"),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, versionToDTO(resp))
}

// UpdateDraft ≡ `PATCH /editorial/versions/{versionId}` (FR-007).
func (h *Handler) UpdateDraft(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body UpdateDraftRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.UpdateDraft(r.Context(), &learningv1.UpdateDraftRequest{
		VersionId: chi.URLParam(r, "versionId"),
		Body:      body.Body,
		EditorId:  claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, versionToDTO(resp))
}

// ArchiveVersion ≡ `POST /editorial/versions/{versionId}/archive`.
func (h *Handler) ArchiveVersion(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Learning.Archive(r.Context(), &learningv1.VersionRef{
		VersionId: chi.URLParam(r, "versionId"),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, opToDTO(resp))
}

// ListVersions ≡ `GET /editorial/versions` (FR-013).
//
// Una sola ruta sirve tres vistas distintas según qué filtros llegan rellenos:
// historial de un artículo (`article_id`), bandeja de revisión del coordinador
// (`state=en_revision`) y borradores propios de un editor (`editor_id`) — la misma
// consulta que ya resuelve `LearningService.ListVersions`.
func (h *Handler) ListVersions(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Learning.ListVersions(r.Context(), &learningv1.ListVersionsRequest{
		ArticleId: r.URL.Query().Get("article_id"),
		State:     r.URL.Query().Get("state"),
		EditorId:  r.URL.Query().Get("editor_id"),
		Page:      pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	items := make([]ArticleVersion, 0, len(resp.GetItems()))
	for _, v := range resp.GetItems() {
		items = append(items, versionToDTO(v))
	}
	writeJSON(w, http.StatusOK, pageOf(items, resp.GetPage()))
}

// CreateQuiz ≡ `POST /editorial/quizzes` (FR-009, T162).
func (h *Handler) CreateQuiz(w http.ResponseWriter, r *http.Request) {
	var body UpsertQuizRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.UpsertQuiz(r.Context(), &learningv1.UpsertQuizRequest{
		ArticleId:     body.ArticleID,
		Title:         body.Title,
		PassThreshold: body.PassThreshold,
		Questions:     questionInputsToProto(body.Questions),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, quizToDTO(resp))
}

// UpdateQuiz ≡ `PUT /editorial/quizzes/{quizId}` (FR-009, T162).
//
// `ArticleID` del cuerpo se ignora: `Aprendizaje` conserva el `article_id` original de
// un cuestionario existente (ver el comentario de `UpsertQuizRequest` en el `.proto`).
func (h *Handler) UpdateQuiz(w http.ResponseWriter, r *http.Request) {
	var body UpsertQuizRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.UpsertQuiz(r.Context(), &learningv1.UpsertQuizRequest{
		QuizId:        chi.URLParam(r, "quizId"),
		Title:         body.Title,
		PassThreshold: body.PassThreshold,
		Questions:     questionInputsToProto(body.Questions),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, quizToDTO(resp))
}
