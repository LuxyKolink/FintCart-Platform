package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
)

// Router: el mapa completo de la superficie REST del sistema (Principio II).
//
// Este archivo hace ENRUTAMIENTO y nada más. No decodifica cuerpos, no llama a
// servicios y no decide reglas: solo asocia método + ruta con un handler y le pone
// delante los middlewares que le corresponden.
//
// El valor de tenerlo separado y monótono es que la política de acceso de todo el
// sistema se lee de un tirón: qué es público, qué exige token y qué exige rol. Ese
// listado repartido por diez archivos es donde se cuela una ruta editorial sin
// comprobación de rol.
//
// Las rutas siguen `contracts/openapi/gateway.yaml` — 16 rutas, 17 operaciones.
//
// SALVEDAD PENDIENTE (no la resuelve T028): el esquema OpenAPI declara los endpoints
// OAuth2 `authorizationUrl`/`tokenUrl` en el host `auth.fintcart.co`, fuera de
// `paths:`. Pero el Principio II reserva REST para el Gateway y el Servidor de
// Autenticación solo expone gRPC, así que esos dos endpoints tienen que atenderse
// AQUÍ. Sin ellos la SPA no puede completar el flujo Authorization Code + PKCE.
// Añadirlos es un cambio de contrato, así que se deja señalado para T055 en lugar de
// inventar superficie.

// Deps son las dependencias transversales del router.
//
// Se agrupan en un struct en lugar de pasarse como cinco parámetros porque la lista
// crece con cada middleware, y una firma de cinco interfaces del mismo tipo invita a
// intercambiar dos argumentos sin que el compilador lo note.
type Deps struct {
	Verifier    TokenVerifier
	Blacklist   BlacklistChecker
	Limiter     Limiter
	CORSOrigins []string
}

// Routes construye el router completo.
func (h *Handler) Routes(deps Deps) http.Handler {
	r := chi.NewRouter()

	// Middlewares globales, en orden de aplicación.
	//
	// El log va PRIMERO para que registre también las peticiones que un middleware
	// posterior rechaza: si fuera el último, un 429 o un 401 no aparecería en el log de
	// acceso y las métricas de tráfico rechazado no existirían.
	r.Use(AccessLog(h.logger))
	r.Use(cors.Handler(cors.Options{
		// Lista explícita de orígenes, nunca `*`. Con comodín, el navegador no permite
		// enviar credenciales, y además cualquier sitio podría invocar la API con el
		// token de un usuario que tenga la sesión abierta.
		AllowedOrigins:   deps.CORSOrigins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	// El rate limiting va antes de la autenticación: verificar una firma JWT cuesta
	// CPU, así que limitar después dejaría abierta una vía de agotamiento con tokens
	// basura. Como consecuencia, las rutas públicas se limitan por IP (ver `clientIP`).
	r.Use(RateLimit(deps.Limiter, h.logger))

	// ── Identidad (públicas: no hay token todavía) ──────────────────────────
	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", h.Register)
		r.Post("/verify-email", h.VerifyEmail)
		// `logout` SÍ exige token: revocar una sesión requiere saber cuál.
		r.With(Authenticate(deps.Verifier, deps.Blacklist, h.logger)).Post("/logout", h.Logout)
	})

	// ── Rutas autenticadas ─────────────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(Authenticate(deps.Verifier, deps.Blacklist, h.logger))

		// Catálogo y cuestionarios: cualquier usuario autenticado.
		r.Get("/catalog/articles", h.ListArticles)
		r.Get("/catalog/articles/{articleId}", h.GetArticle)
		r.Post("/quizzes/{quizId}/attempts", h.SubmitQuizAttempt)

		// Simuladores.
		r.Post("/simulators/{calcType}/run", h.RunSimulation)
		r.Get("/simulators/history", h.SimulationHistory)

		// Perfil propio. No llevan `{userId}` a propósito: el usuario sale del token y
		// no de la URL, de modo que no existe la posibilidad de pedir el perfil de otro
		// cambiando un identificador.
		r.Get("/me/profile", h.GetProfile)
		r.Patch("/me/profile", h.UpdateProfile)
		r.Get("/me/progress", h.GetProgress)
		r.Get("/me/notifications", h.ListNotifications)
		r.Post("/me/notifications/{id}/read", h.MarkNotificationRead)
		r.Delete("/me/account", h.DeleteAccount)

		// ── Editorial: exige rol ───────────────────────────────────────────
		//
		// Crear y enviar a revisión lo puede hacer un editor; PUBLICAR está reservado al
		// coordinador editorial (FR-008). Que sean dos grupos y no uno es la diferencia
		// entre que un editor pueda publicar su propio artículo o no — y ese invariante
		// concreto lo refuerza además Aprendizaje sobre `article_versions`
		// (`approved_by ≠ created_by`), porque el Gateway no tiene el dato para
		// comprobarlo.
		r.Group(func(r chi.Router) {
			r.Use(RequireRole(RoleEditor, RoleCoordinadorEditoria))
			r.Post("/editorial/articles", h.CreateDraft)
			r.Post("/editorial/versions/{versionId}/submit", h.SubmitForReview)
		})
		r.Group(func(r chi.Router) {
			r.Use(RequireRole(RoleCoordinadorEditoria))
			r.Post("/editorial/versions/{versionId}/publish", h.ApproveAndPublish)
		})
	})

	return r
}
