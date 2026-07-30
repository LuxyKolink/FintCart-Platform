package handler

import (
	"net/http"
)

// Rutas de aprendizaje: `/catalog/*` y `/quizzes/*`.

// ListArticles ≡ `GET /catalog/articles` (FR-010, SC-009: ≥ 5 categorías temáticas).
func (h *Handler) ListArticles(w http.ResponseWriter, r *http.Request) {
	// T059: `Learning.ListPublished` con el filtro de categoría y la paginación de la
	// query string. Solo devuelve versiones PUBLICADAS: un borrador visible en el
	// catálogo sería una fuga de contenido editorial sin aprobar (FR-008).
	h.writeGRPCError(w, r, errNotImplemented)
}

// GetArticle ≡ `GET /catalog/articles/{articleId}` (FR-010).
func (h *Handler) GetArticle(w http.ResponseWriter, r *http.Request) {
	// T059: `Learning.GetArticle` + `articleToDTO`. El propio RPC incrementa los
	// agregados de `article_stats` (research D-06); el Gateway no cuenta nada, porque
	// contar lecturas es del dominio de Aprendizaje.
	h.writeGRPCError(w, r, errNotImplemented)
}

// SubmitQuizAttempt ≡ `POST /quizzes/{quizId}/attempts` (FR-012, FR-016).
//
// Va al ORQUESTADOR, no a Aprendizaje: calificar toca dos servicios —el intento en
// Aprendizaje y el progreso en Usuarios— más dos eventos, así que es una saga
// (research D-07). Llamar a `Learning.GradeAndStoreAttempt` desde aquí y luego a
// `Users.ApplyQuizScore` dejaría, ante un fallo del segundo, un intento calificado que
// nunca suma puntos y a nadie encargado de arreglarlo.
//
// La respuesta lleva `score` como `string` decimal (`quizGradeToDTO`), nunca como número
// JSON (Principio VIII).
func (h *Handler) SubmitQuizAttempt(w http.ResponseWriter, r *http.Request) {
	// T059: decodificar las respuestas y llamar a `Orchestrator.StartQuizGrading`. Es
	// una saga SÍNCRONA: el usuario está esperando su nota, así que se devuelve el
	// resultado y no un `saga_id`.
	h.writeGRPCError(w, r, errNotImplemented)
}
