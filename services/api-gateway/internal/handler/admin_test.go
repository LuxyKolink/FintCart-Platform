package handler_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Pruebas del catálogo administrable de categorías (feature 002 US1, T057): las
// cinco rutas nuevas y el `409` con `published_count` de FR-035. La autorización
// ya la cubren `middleware_test.go`; aquí se comprueba el mapeo DTO ⇄ proto.

// TestCatalogCategoriesIsPublicAndShowsOnlyActive fija la excepción de
// `/catalog/categories`: lista pública de categorías ACTIVAS, sin token.
func TestCatalogCategoriesIsPublicAndShowsOnlyActive(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.learning.categories = &learningv1.ListCategoriesResponse{
		Items: []*learningv1.Category{
			{CategoryId: "cat-1", Name: "Ahorro", Slug: "ahorro", Position: 1, Active: true},
		},
	}

	rec := h.do(t, http.MethodGet, "/catalog/categories", "", false)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"name":"Ahorro"`)
	require.Equal(t, false, h.learning.lastListCat.GetIncludeInactive(),
		"la lista pública nunca pide las categorías desactivadas")
}

// TestAdminCategoriesListIncludesInactive: la pantalla de administración SÍ ve las
// desactivadas, para poder reordenar sin perder de vista lo que ya no se ofrece.
func TestAdminCategoriesListIncludesInactive(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.learning.categories = &learningv1.ListCategoriesResponse{
		Items: []*learningv1.Category{
			{CategoryId: "cat-2", Name: "Crédito (legado)", Slug: "credito", Position: 2, Active: false},
		},
	}

	rec := h.do(t, http.MethodGet, "/admin/categories", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, true, h.learning.lastListCat.GetIncludeInactive())
	require.Contains(t, rec.Body.String(), `"active":false`)
}

// TestCreateCategorySendsActorFromTheToken: el administrador sale del token, nunca
// del cuerpo.
func TestCreateCategorySendsActorFromTheToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))

	rec := h.do(t, http.MethodPost, "/admin/categories",
		`{"name":"Ahorro","description":"metas de ahorro","position":3}`, true)
	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, testUserID, h.learning.lastCreateCat.GetActorId())
	require.Equal(t, "Ahorro", h.learning.lastCreateCat.GetName())
	require.Equal(t, "", h.learning.lastCreateCat.GetSlug(),
		"slug vacío: Aprendizaje lo deriva del nombre")
	require.Equal(t, int32(3), h.learning.lastCreateCat.GetPosition())
	require.Contains(t, rec.Body.String(), `"category_id":"cat-nueva"`)
}

// TestCategoryConflictsAre409: nombre, slug o posición ya en uso es un conflicto
// con el estado actual — no una petición mal formada.
func TestCategoryConflictsAre409(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.learning.createCatErr = status.Error(codes.FailedPrecondition,
		"ya existe una categoría activa con el nombre «Ahorro»")

	rec := h.do(t, http.MethodPost, "/admin/categories", `{"name":"Ahorro"}`, true)
	require.Equal(t, http.StatusConflict, rec.Code)
	require.Equal(t, "conflict", decode[handler.ErrorBody](t, rec).Code)
}

// TestUpdateCategorySendsTheIdFromTheURL: el `category_id` se toma de la ruta y el
// actor del token.
func TestUpdateCategorySendsTheIdFromTheURL(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))

	rec := h.do(t, http.MethodPatch, "/admin/categories/cat-1",
		`{"name":"Ahorro e inversión","description":"juntas","position":1}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "cat-1", h.learning.lastUpdateCat.GetCategoryId())
	require.Equal(t, testUserID, h.learning.lastUpdateCat.GetActorId())
	require.Equal(t, "Ahorro e inversión", h.learning.lastUpdateCat.GetName())
	require.Equal(t, int32(1), h.learning.lastUpdateCat.GetPosition())
}

// TestDeactivateCategorySucceedsWithNoContent: la desactivación es un comando sin
// recurso que devolver, así que responde 204 (delta del contrato), con el actor
// del token.
func TestDeactivateCategorySucceedsWithNoContent(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))

	rec := h.do(t, http.MethodDelete, "/admin/categories/cat-1", "", true)
	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, "cat-1", h.learning.lastDeactivate.GetCategoryId())
	require.Equal(t, testUserID, h.learning.lastDeactivate.GetActorId())
}

// TestDeactivateCategoryConflictReportsPublishedCount es la traducción de FR-035:
// Aprendizaje la devuelve como `FAILED_PRECONDITION` con el recuento en el
// mensaje, y el borde la responde como 409 con `published_count` — el mensaje al
// administrador tiene que decir CUÁNTOS artículos hay que reasignar.
func TestDeactivateCategoryConflictReportsPublishedCount(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.learning.deactivateCatErr = status.Error(codes.FailedPrecondition,
		"no se puede desactivar la categoría «Ahorro»: tiene 3 artículos publicados")

	rec := h.do(t, http.MethodDelete, "/admin/categories/cat-1", "", true)
	require.Equal(t, http.StatusConflict, rec.Code)

	body := decode[handler.CategoryConflict](t, rec)
	require.Equal(t, "category_in_use", body.Code)
	require.Equal(t, 3, body.PublishedCount)
	require.Contains(t, rec.Body.String(), `"published_count":3`)
}

// TestDeactivateCategoryConflictWithASinglePublishedArticle: el singular no se
// escapa del recuento.
func TestDeactivateCategoryConflictWithASinglePublishedArticle(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.learning.deactivateCatErr = status.Error(codes.FailedPrecondition,
		"no se puede desactivar la categoría «Ahorro»: tiene 1 artículo publicado")

	rec := h.do(t, http.MethodDelete, "/admin/categories/cat-1", "", true)
	require.Equal(t, http.StatusConflict, rec.Code)
	require.Equal(t, 1, decode[handler.CategoryConflict](t, rec).PublishedCount)
}

// TestEditorialCreateDraftForwardsCategoryID cubre la cara de ESCRITURA de FR-034:
// un borrador nuevo se clasifica por `category_id` (del desplegable del editor,
// T059), no por el nombre libre.
func TestEditorialCreateDraftForwardsCategoryID(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleEditor))

	rec := h.do(t, http.MethodPost, "/editorial/articles",
		`{"title":"Cómo ahorrar","category_id":"cat-1","body":"b"}`, true)
	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, "cat-1", h.learning.lastDraft.GetCategoryId())
	require.Equal(t, testUserID, h.learning.lastDraft.GetEditorId())
}

// TestCatalogArticlesForwardsTheCategoryFilter: el filtro del catálogo público
// (T060) viaja por `category_id`, no por el nombre visible.
func TestCatalogArticlesForwardsTheCategoryFilter(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.learning.articles = &learningv1.ListPublishedResponse{Page: &commonv1.PageResponse{}}

	rec := h.do(t, http.MethodGet, "/catalog/articles?category_id=cat-1", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "cat-1", h.learning.lastListPub.GetCategoryId())
	require.Equal(t, "", h.learning.lastListPub.GetCategory())
}
