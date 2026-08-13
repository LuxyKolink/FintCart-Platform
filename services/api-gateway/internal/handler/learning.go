package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
)

// Rutas de aprendizaje: `/catalog/*` y `/quizzes/*`.

// ListArticles ≡ `GET /catalog/articles` (FR-010, SC-009: ≥ 5 categorías temáticas).
//
// `ListPublished` solo devuelve versiones PUBLICADAS. El filtro está en el nombre del
// RPC y no en un parámetro que el Gateway pudiera olvidar: un borrador visible en el
// catálogo sería una fuga de contenido editorial sin aprobar (FR-008).
func (h *Handler) ListArticles(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Learning.ListPublished(r.Context(), &learningv1.ListPublishedRequest{
		Category: r.URL.Query().Get("category"),
		Page:     pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	items := make([]Article, 0, len(resp.GetItems()))
	for _, a := range resp.GetItems() {
		items = append(items, articleToDTO(a))
	}
	writeJSON(w, http.StatusOK, pageOf(items, resp.GetPage()))
}

// GetArticle ≡ `GET /catalog/articles/{articleId}` (FR-011).
//
// El propio RPC incrementa los agregados de `article_stats` (research D-06); el Gateway
// no cuenta nada, porque contar lecturas es del dominio de Aprendizaje.
func (h *Handler) GetArticle(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Learning.GetArticle(r.Context(), &learningv1.ArticleRef{
		ArticleId: chi.URLParam(r, "articleId"),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, articleToDTO(resp))
}

// GetQuiz ≡ `GET /quizzes/{quizId}` (FR-009).
//
// Faltaba: `learning.proto` ya exponía `GetQuiz` por gRPC, pero ningún handler del
// Gateway lo enrutaba (ver la nota en `routes.go`). Sin este endpoint la SPA no
// tiene forma de mostrar las preguntas antes de que el usuario responda.
func (h *Handler) GetQuiz(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Learning.GetQuiz(r.Context(), &learningv1.QuizRef{
		QuizId: chi.URLParam(r, "quizId"),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, quizToDTO(resp))
}

// SubmitQuizAttempt ≡ `POST /quizzes/{quizId}/attempts` (FR-012, FR-016).
//
// Va al ORQUESTADOR, no a Aprendizaje: calificar toca dos servicios —el intento en
// Aprendizaje y el progreso en Usuarios— más dos eventos, así que es una saga
// (research D-07). Llamar a `Learning.GradeAndStoreAttempt` desde aquí y luego a
// `Users.ApplyQuizScore` dejaría, ante un fallo del segundo, un intento calificado que
// nunca suma puntos y a nadie encargado de arreglarlo.
//
// Es una saga SÍNCRONA —se devuelve el resultado y no un `saga_id`— porque el usuario
// está esperando su nota delante de la pantalla.
//
// La respuesta lleva `score` como `string` decimal, nunca como número JSON
// (Principio VIII); ver `quizGradeToDTO`.
func (h *Handler) SubmitQuizAttempt(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body SubmitAttemptRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Orchestrator.StartQuizGrading(r.Context(), &orchestratorv1.QuizGradingRequest{
		// El usuario sale del TOKEN. Si viniera del cuerpo, cualquiera podría acumular
		// puntos de progreso en la cuenta de otra persona.
		UserId:  claims.UserID,
		QuizId:  chi.URLParam(r, "quizId"),
		Answers: body.Answers,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, quizGradeToDTO(resp))
}
