package handler

import (
	"net/http"
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

// CreateDraft ≡ `POST /editorial/articles` (FR-007).
func (h *Handler) CreateDraft(w http.ResponseWriter, r *http.Request) {
	// T059: `Learning.CreateDraft` con el autor tomado del token —nunca del cuerpo—
	// para que `created_by` no sea falsificable por quien envía la petición.
	h.writeGRPCError(w, r, errNotImplemented)
}

// SubmitForReview ≡ `POST /editorial/versions/{versionId}/submit` (FR-007).
func (h *Handler) SubmitForReview(w http.ResponseWriter, r *http.Request) {
	// T059: `Learning.SubmitForReview` con el `{versionId}` de la ruta.
	h.writeGRPCError(w, r, errNotImplemented)
}

// ApproveAndPublish ≡ `POST /editorial/versions/{versionId}/publish` (FR-008).
func (h *Handler) ApproveAndPublish(w http.ResponseWriter, r *http.Request) {
	// T059: `Learning.ApproveAndPublish`, pasando quién aprueba desde el token para que
	// Aprendizaje pueda aplicar `approved_by ≠ created_by`. Si el aprobador viniera del
	// cuerpo, el invariante de FR-008 se podría eludir enviando otro identificador.
	h.writeGRPCError(w, r, errNotImplemented)
}
