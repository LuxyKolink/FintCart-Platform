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
// Las rutas siguen `contracts/openapi/gateway.yaml`: **31 rutas y 34 operaciones**.
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
//
// La ruta 19 es `GET /quizzes/{quizId}`: `learning.proto` ya exponía `GetQuiz` por
// gRPC, pero ningún handler del Gateway lo servía por REST. Sin ella la SPA no tiene
// forma de pedir las preguntas de un cuestionario antes de responderlo — solo existía
// el POST que califica respuestas ya dadas. La añade la implementación de T105.
//
// Las rutas 20, 21 y 22 son `PATCH /me/password`, `GET /me/data` y `GET /me/report`
// (T137/T145/T148, FR-005/FR-029/FR-018): ninguna estaba en el OpenAPI original.
// `ChangePassword` no tenía ni siquiera RPC en `auth.proto` hasta esta implementación
// (ver la nota de `ChangePasswordRequest` allí); la vista completa de datos
// personales que exige el derecho de acceso de la Ley 1581 no tenía dónde vivir —no
// es un simple proxy de un único RPC, sino la combinación de perfil, progreso,
// cuestionarios y simulaciones en una sola respuesta (ver `me.go::GetPersonalData`)—;
// y `UsersService.GetActivityReport` tenía RPC y capa de aplicación (T135) pero
// ningún handler REST lo servía todavía.
//
// Las rutas 23–28 son el resto del flujo editorial que T055–T059 dejó sin exponer
// (US4, T157–T166): `POST /editorial/articles/{articleId}/versions` (nueva versión de
// un artículo existente, FR-013), `PATCH /editorial/versions/{versionId}` (editar un
// borrador propio), `POST /editorial/versions/{versionId}/archive`,
// `GET /editorial/versions` (historial/bandeja de revisión/borradores propios, según
// filtros) y `POST /editorial/quizzes` + `PUT /editorial/quizzes/{quizId}` (FR-009).
// Ninguna estaba en el contrato original: `CreateDraft`/`UpdateDraft` no llevaban
// `article_id`, y `ListVersions`/`UpsertQuiz` no existían como RPC hasta esta
// implementación (ver el comentario de esos mensajes en `learning.proto`).
//
// Las rutas 29–31 son el catálogo administrable de categorías (feature 002, US1,
// T057): `GET /catalog/categories` (PÚBLICA — no exige token: la lista de
// categorías activas alimenta el desplegable del editor y el filtro del catálogo
// antes del login), `GET|POST /admin/categories` y `PATCH|DELETE
// /admin/categories/{categoryId}` (rol `administrador`, T030). Ninguna estaba en
// el OpenAPI original; el delta de contratos las incorpora (`gateway-delta.yaml`).

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

	// ── Catálogo de categorías (PÚBLICO, feature 002 US1) ───────────────────
	//
	// Es la ÚNICA ruta de `/catalog/*` que no exige token (delta del contrato): solo
	// devuelve nombre, identificador y orden de las categorías activas —nada sensible—
	// y la necesita el desplegable del editor y el filtro del catálogo incluso antes de
	// iniciar sesión. El resto del catálogo sí vive dentro del grupo autenticado.
	r.Get("/catalog/categories", h.ListActiveCategories)

	// Imágenes del cuerpo de un artículo (FR-067, T130). PÚBLICA, y es una decisión
	// razonada: el `<img src>` del lector no puede mandar cabecera `Authorization`, así
	// que una ruta autenticada haría que ninguna imagen se viera. El identificador es el
	// SHA-256 del contenido —256 bits que no se adivinan— y solo lo conoce quien tiene el
	// documento que lo referencia: saber el hash ES el permiso. La alternativa canónica
	// son URLs firmadas, que exigen infraestructura que esta enmienda no añade (D-13).
	r.Get("/media/images/{imageId}", h.GetArticleImage)

	// Catálogo público de calculadoras (FR-052). Pública por la misma razón que el de
	// categorías: la ve quien todavía no ha entrado, y solo devuelve publicadas.
	r.Get("/calculators", h.ListCalculators)

	// ── Rutas autenticadas ─────────────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(Authenticate(deps.Verifier, deps.Blacklist, h.logger))
		r.Use(RateLimitByUser(deps.Limiter, h.logger))

		// Catálogo y cuestionarios: cualquier usuario autenticado.
		r.Get("/catalog/articles", h.ListArticles)
		r.Get("/catalog/articles/{articleId}", h.GetArticle)
		r.Get("/quizzes/{quizId}", h.GetQuiz)
		r.Post("/quizzes/{quizId}/session", h.StartQuizSession)
		r.Post("/quizzes/{quizId}/attempts", h.SubmitQuizAttempt)

		// Simuladores.
		r.Post("/simulators/{calcType}/run", h.RunSimulation)
		r.Get("/simulators/history", h.SimulationHistory)

		// Constructor de calculadoras (FR-043…FR-046, FR-051).
		//
		// `/calculators/validate` va ANTES que `/calculators/{calculatorId}` a propósito:
		// chi resuelve por patrón y el segmento literal tiene que registrarse primero, o
		// «validate» se leería como un identificador de calculadora y la validación en vivo
		// del constructor respondería 404.
		r.Get("/me/calculators", h.ListMyCalculators)
		r.Post("/calculators/validate", h.ValidateDefinition)
		r.Post("/calculators", h.CreateCalculator)
		r.Get("/calculators/{calculatorId}", h.GetCalculator)
		r.Put("/calculators/{calculatorId}", h.UpdateCalculator)
		r.Delete("/calculators/{calculatorId}", h.DeleteCalculator)
		r.Post("/calculators/{calculatorId}/run", h.RunCalculator)

		// Perfil propio. No llevan `{userId}` a propósito: el usuario sale del token y
		// no de la URL, de modo que no existe la posibilidad de pedir el perfil de otro
		// cambiando un identificador.
		r.Get("/me/profile", h.GetProfile)
		r.Patch("/me/profile", h.UpdateProfile)
		r.Get("/me/progress", h.GetProgress)
		r.Get("/me/report", h.GetActivityReport)
		r.Get("/me/notifications", h.ListNotifications)
		r.Post("/me/notifications/{id}/read", h.MarkNotificationRead)
		r.Delete("/me/account", h.DeleteAccount)
		r.Patch("/me/password", h.ChangePassword)
		r.Get("/me/data", h.GetPersonalData)

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
			r.Post("/editorial/articles/{articleId}/versions", h.CreateVersion)
			r.Patch("/editorial/versions/{versionId}", h.UpdateDraft)
			r.Post("/editorial/versions/{versionId}/submit", h.SubmitForReview)
			r.Post("/editorial/versions/{versionId}/archive", h.ArchiveVersion)
			// Subida de una imagen del cuerpo (FR-064, T129). Va con el rol de editor
			// porque es él quien escribe los artículos; el ámbito de propiedad lo
			// impone Aprendizaje contra `article_images.article_id`.
			r.Post("/editorial/articles/{articleId}/images", h.UploadArticleImage)
			// Bandeja de revisión, historial de versiones y borradores propios
			// (FR-013): las tres vistas comparten ruta y se distinguen por los
			// parámetros de consulta (`state`, `article_id`, `editor_id`). No exige
			// SOLO coordinador porque un editor también necesita ver sus propios
			// borradores.
			r.Get("/editorial/versions", h.ListVersions)
			r.Post("/editorial/quizzes", h.CreateQuiz)
			r.Put("/editorial/quizzes/{quizId}", h.UpdateQuiz)
		})
		r.Group(func(r chi.Router) {
			r.Use(RequireRole(RoleCoordinadorEditoria))
			r.Post("/editorial/versions/{versionId}/publish", h.ApproveAndPublish)
		})

		// ── Administración: exige rol `administrador` (FR-080, FR-081) ──────
		//
		// El rol NO lo hereda nadie: ni un `coordinador_editorial` administra el
		// catálogo ni un `administrador` aprueba contenido editorial (FR-082). Que
		// ambas familias de grupos usen `RequireRole` con roles disjuntos es la
		// garantía de que la separación se mantiene aunque un día el mismo usuario
		// acumule los dos roles.
		r.Group(func(r chi.Router) {
			r.Use(RequireRole(RoleAdministrator))
			r.Get("/admin/categories", h.ListAllCategories)
			r.Post("/admin/categories", h.CreateCategory)
			r.Patch("/admin/categories/{categoryId}", h.UpdateCategory)
			r.Delete("/admin/categories/{categoryId}", h.DeactivateCategory)

			// Indicadores financieros anuales (FR-055…FR-061, T107). El procedimiento
			// es del administrador: es él quien transcribe las cifras oficiales de cada
			// año, y una vigencia mal cargada afecta a TODAS las calculadoras que
			// referencian ese indicador, no solo a las de quien la cargó.
			//
			// `/admin/indicators/status` va declarada ANTES que `/admin/indicators/{...}`
			// por el mismo motivo que `/calculators/validate`: chi resuelve por el patrón
			// más específico, pero declararlas juntas deja ver que «status» es una palabra
			// reservada de esta familia y que un identificador no puede llamarse así.
			r.Get("/admin/indicators", h.ListIndicators)
			r.Get("/admin/indicators/status", h.IndicatorCalendarStatus)
			r.Post("/admin/indicators", h.CreateIndicator)
			r.Put("/admin/indicators/{indicatorId}", h.UpdateIndicator)
		})

		// ── Indicadores vigentes: cualquier usuario autenticado (FR-062) ─────
		//
		// Va FUERA del grupo de administración a propósito: la advertencia de FR-062 la
		// ve quien va a ejecutar una calculadora, que no tiene por qué ser
		// administrador. Lo que se expone son los valores vigentes —cifras oficiales
		// publicadas— y los nombres que se quedaron sin vigencia, que es justo lo que
		// hace falta para saber si un resultado puede estar desactualizado.
		r.Get("/indicators/current", h.CurrentIndicators)
	})

	return r
}
