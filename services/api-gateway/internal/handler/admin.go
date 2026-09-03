package handler

import (
	"net/http"
	"regexp"
	"strconv"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
)

// Rutas de administración del catálogo: `/admin/categories[/{categoryId}]`
// (feature 002, US1 — FR-032…FR-035) y la lista pública `/catalog/categories`.
//
// El acceso ya lo decidió el router: el grupo `/admin/**` lleva `RequireRole(
// RoleAdministrator)` delante (T030, FR-081) y `/catalog/categories` es público.
// Lo único que queda aquí es traducir DTO ⇄ proto y, en los tres comandos, sacar
// el ACTOR del token verificado — igual que hace la capa editorial: que la
// autorización la compruebe el borde no sirve de nada si quien llega a Aprendizaje
// puede elegir un `actor_id` que no es el suyo.
//
// El rechazo por artículos publicados (FR-035) se traduce aparte, a un 409 con
// `published_count`: Aprendizaje lo devuelve como `FAILED_PRECONDITION` con el
// recuento en el mensaje (el único canal que deja su frontera gRPC) y el mapeo
// genérico de `httpFromGRPC` lo convertiría en un 400 genérico. Ver
// `deactivateCategory` y `publishedCountFrom`.

// listCategories ≡ GET /catalog/categories (público) y GET /admin/categories.
//
// La ÚNICA diferencia entre las dos es qué categorías entran: el público solo ve
// las activas (un desplegable de alta no debe ofrecer categorías desactivadas),
// mientras que la pantalla de administración muestra también las desactivadas
// para poder reactivar el orden sin perder de vista lo que ya no se ofrece.
func (h *Handler) listCategories(w http.ResponseWriter, r *http.Request, includeInactive bool) {
	resp, err := h.clients.Learning.ListCategories(r.Context(), &learningv1.ListCategoriesRequest{
		IncludeInactive: includeInactive,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, categoriesToDTO(resp.GetItems()))
}

// ListActiveCategories ≡ `GET /catalog/categories`.
func (h *Handler) ListActiveCategories(w http.ResponseWriter, r *http.Request) {
	h.listCategories(w, r, false)
}

// ListAllCategories ≡ `GET /admin/categories`.
func (h *Handler) ListAllCategories(w http.ResponseWriter, r *http.Request) {
	h.listCategories(w, r, true)
}

// CreateCategory ≡ `POST /admin/categories` (FR-033).
func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body CategoryInput
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.CreateCategory(r.Context(), &learningv1.CreateCategoryRequest{
		Name:        body.Name,
		Slug:        body.Slug,
		Description: body.Description,
		Position:    body.Position,
		ActorId:     claims.UserID,
	})
	if err != nil {
		// Nombre o posición ya en uso entre las activas (FR-032): un conflicto con
		// el estado actual, 409 — no un 400 de petición mal formada.
		if conflictFromCategory(w, err) {
			return
		}
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, categoryToDTO(resp))
}

// UpdateCategory ≡ `PATCH /admin/categories/{categoryId}` (FR-033).
func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body CategoryInput
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Learning.UpdateCategory(r.Context(), &learningv1.UpdateCategoryRequest{
		CategoryId:  chi.URLParam(r, "categoryId"),
		Name:        body.Name,
		Description: body.Description,
		Position:    body.Position,
		ActorId:     claims.UserID,
	})
	if err != nil {
		if conflictFromCategory(w, err) {
			return
		}
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, categoryToDTO(resp))
}

// DeactivateCategory ≡ `DELETE /admin/categories/{categoryId}` (FR-035).
//
// La desactivación es LÓGICA y nunca un borrado físico: las categorías viven en
// rutas históricas y en artículos ya publicados, así que se retiran del
// desplegable pero no desaparecen. Un `DELETE` repetido sobre una ya inactiva es
// un no-op y también responde 204.
func (h *Handler) DeactivateCategory(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	_, err := h.clients.Learning.DeactivateCategory(r.Context(), &learningv1.CategoryRef{
		CategoryId: chi.URLParam(r, "categoryId"),
		ActorId:    claims.UserID,
	})
	if err != nil {
		// El rechazo de FR-035 lleva el recuento de artículos publicados: sin él, el
		// mensaje al administrador diría solo «no se puede», no cuántos hay que
		// reasignar primero.
		if published, ok := publishedCountFrom(err); ok {
			noun := "artículos publicados"
			if published == 1 {
				noun = "artículo publicado"
			}
			writeJSON(w, http.StatusConflict, CategoryConflict{
				Code:           "category_in_use",
				Message:        "no se puede desactivar la categoría: tiene " + strconv.Itoa(published) + " " + noun,
				PublishedCount: published,
			})
			return
		}
		if conflictFromCategory(w, err) {
			return
		}
		h.writeGRPCError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// conflictFromCategory responde un conflicto del catálogo como 409.
//
// Aprendizaje traduce TODO su `DomainError` de tipo `conflict` a
// `FAILED_PRECONDITION` (`rpc-errors.ts`), y para el catálogo un conflicto es
// siempre «nombre, slug o posición ya en uso» o «tiene artículos publicados» —
// estados que la petición no puede arreglar reenviándola, por eso 409 y no 400.
// Devuelve si escribió la respuesta, para que el llamador no siga.
func conflictFromCategory(w http.ResponseWriter, err error) bool {
	if status.Code(err) != codes.FailedPrecondition {
		return false
	}
	writeError(w, http.StatusConflict, "conflict", "conflicto con el estado actual")
	return true
}

// publishedCountFrom extrae el recuento que Aprendizaje incrusta en el mensaje del
// `FAILED_PRECONDITION` de desactivar una categoría con artículos publicados.
//
// El recuento viaja en el mensaje porque es el ÚNICO canal que cruza la frontera
// gRPC (así lo documenta `categories.repository.ts`, T057). Se ancla al final del
// mensaje —«…: tiene N artículo(s) publicado(s)»— porque el nombre de la
// categoría, que va antes, es texto libre y podría contener la misma frase.
var publishedCountPattern = regexp.MustCompile(`(\d+)\s+art[ií]culo(?:s)?\s+publicado(?:s)?$`)

func publishedCountFrom(err error) (int, bool) {
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.FailedPrecondition {
		return 0, false
	}
	match := publishedCountPattern.FindStringSubmatch(st.Message())
	if len(match) != 2 {
		return 0, false
	}
	count, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, false
	}
	return count, true
}
