package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/fintcart/platform/services/api-gateway/internal/observability"
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
// Las rutas siguen `contracts/openapi/gateway.yaml`: **18 rutas y 19 operaciones**.
//
// Los dos números conviene desglosarlos porque el contrato, tal como estaba escrito,
// no los daba directamente. `paths:` declara 16 rutas y 17 operaciones —`/me/profile`
// admite GET y PATCH—. Las dos que faltaban hasta 18 son los endpoints OAuth2, que el
// esquema declaraba como `authorizationUrl`/`tokenUrl` en el host `auth.fintcart.co`,
// FUERA de `paths:`.
//
// Ese host no puede existir: el Principio II reserva toda la superficie REST al Gateway
// y el Servidor de Autenticación solo expone gRPC. Sin `/oauth/authorize` y
// `/oauth/token` atendidos aquí, la SPA no tiene forma de obtener un token y la
// plataforma no tiene login. T055 los incorpora y el OpenAPI se actualiza en
// consecuencia; ver la nota de T055–T059 en `tasks.md` y el encabezado OAuth2 de
// `auth.go`, donde se documenta la desviación respecto de RFC 6749 §3.1 que impone
// esta arquitectura.

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
	// Métricas y log van PRIMERO para que cuenten también las peticiones que un
	// middleware posterior rechaza: si fueran los últimos, un 429 o un 401 no
	// aparecería ni en el log de acceso ni en las métricas, y el tráfico rechazado
	// —justo el que hay que vigilar— sería invisible.
	//
	// Las métricas van DENTRO del router y no envolviéndolo por fuera: `chi` inyecta su
	// contexto de ruta al entrar, así que solo desde aquí se puede etiquetar la métrica
	// con el PATRÓN (`/catalog/articles/{articleId}`) en lugar de con la URL concreta.
	// Por fuera, ese contexto no existe y cada identificador de artículo crearía una
	// serie temporal nueva.
	r.Use(observability.HTTPMiddleware)
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
	// El rate limiting por IP va antes de la autenticación: verificar una firma JWT
	// cuesta CPU, así que limitar después dejaría abierta una vía de agotamiento con
	// tokens basura. El límite por USUARIO se aplica más abajo, dentro del grupo
	// autenticado, que es el primer punto donde existe una identidad; ver
	// [RateLimitByUser] para por qué hacen falta los dos.
	r.Use(RateLimitByIP(deps.Limiter, h.logger))

	// ── OAuth2 (públicas por definición: sirven para OBTENER el token) ──────
	//
	// Son las dos rutas más atacadas del sistema —relleno de credenciales contra
	// `/oauth/authorize`, canje de códigos robados contra `/oauth/token`— y las únicas
	// protegidas solo por el rate limiting por IP que ya aplica el middleware global.
	r.Route("/oauth", func(r chi.Router) {
		r.Post("/authorize", h.Authorize)
		r.Post("/token", h.Token)
	})

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
		r.Use(RateLimitByUser(deps.Limiter, h.logger))

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
