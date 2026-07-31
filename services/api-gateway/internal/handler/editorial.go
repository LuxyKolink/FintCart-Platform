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
