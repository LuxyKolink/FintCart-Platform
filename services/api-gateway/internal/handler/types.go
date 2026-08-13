// DTO del borde REST y utilidades de transporte del API Gateway.
//
// Principio IX regla 3 — «DTO ≠ tipo de dominio ≠ tipo de fila». Aquí solo hay lo
// primero. El Gateway no tiene dominio ni base de datos (plan.md N-01), así que estos
// structs se convierten directamente a mensajes proto en `mapping.go`.
//
// **Principio VIII, y es la razón de ser de este archivo**: todo monto, tasa,
// porcentaje o calificación se declara `string` y NUNCA `float64` ni un número JSON.
// El `json.Marshal` de un `float64` produce `1500000` o `1.5e+21` según el valor, y un
// consumidor JavaScript que lo lea con `JSON.parse` obtiene un `number` IEEE-754 que ya
// perdió centavos. La `string` decimal canónica (`^-?\d+(\.\d+)?$`, research D-10)
// atraviesa el borde sin que ningún parser la toque.
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// ── errores del borde ───────────────────────────────────────────────────────

// ErrorBody es el cuerpo de error del contrato (`components.schemas.Error`).
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// errBadRequest y errUnauthorized marcan fallos detectados en el propio borde,
// antes de llegar a ningún servicio interno.
var (
	errBadRequest   = errors.New("handler: petición inválida")
	errUnauthorized = errors.New("handler: no autenticado")
)

// ── DTO de identidad ────────────────────────────────────────────────────────

// RegisterRequest ≡ `POST /auth/register`.
type RegisterRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

// VerifyEmailRequest ≡ `POST /auth/verify-email`.
type VerifyEmailRequest struct {
	UserID            string `json:"user_id"`
	VerificationToken string `json:"verification_token"`
}

// ── DTO de OAuth2 (Principio VII) ───────────────────────────────────────────

// AuthorizeRequest ≡ `POST /oauth/authorize`.
//
// El endpoint de autorización es JSON y no una redirección de navegador. La desviación
// respecto de RFC 6749 §3.1 es forzada por la arquitectura y conviene tenerla escrita:
// el Principio II reserva TODA la superficie REST al Gateway, el Servidor de
// Autenticación solo habla gRPC, y por tanto no existe ningún componente que pueda
// servir la página de login del flujo estándar. La SPA es cliente de primera parte y
// recoge las credenciales ella misma.
//
// Consecuencia que hay que asumir: la contraseña pasa por el cliente, que es
// justamente lo que Authorization Code evita cuando el cliente es de terceros. PKCE
// sigue aportando —liga el código a la instancia concreta que lo pidió, de modo que
// interceptarlo no basta para canjearlo—, pero no sustituye a la separación de
// credenciales. Ver la nota de T055 en `tasks.md`.
type AuthorizeRequest struct {
	Email               string   `json:"email"`
	Password            string   `json:"password"`
	ClientID            string   `json:"client_id"`
	RedirectURI         string   `json:"redirect_uri"`
	CodeChallenge       string   `json:"code_challenge"`
	CodeChallengeMethod string   `json:"code_challenge_method"`
	Scopes              []string `json:"scopes"`
}

// AuthorizeResponse devuelve el authorization_code de un solo uso.
type AuthorizeResponse struct {
	Code        string `json:"code"`
	RedirectURI string `json:"redirect_uri"`
}

// TokenRequest ≡ `POST /oauth/token`, con los dos grants que el borde admite.
//
// Un único struct para los dos grants —y no dos endpoints— porque así lo define
// RFC 6749 §4.1.3 y §6: `grant_type` discrimina, y los campos que no aplican se
// ignoran. Cuál es obligatorio en cada caso lo comprueba el handler.
type TokenRequest struct {
	GrantType    string `json:"grant_type"`
	Code         string `json:"code,omitempty"`
	CodeVerifier string `json:"code_verifier,omitempty"`
	ClientID     string `json:"client_id,omitempty"`
	RedirectURI  string `json:"redirect_uri,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// TokenResponse ≡ la respuesta de `POST /oauth/token` (RFC 6749 §5.1).
//
// `ExpiresIn` es el ÚNICO número de todo el borde que se serializa como número JSON, y
// se puede porque son segundos enteros y no una cantidad de dinero: el Principio VIII
// habla de montos, tasas y calificaciones. Los nombres de campo son los del RFC y no los
// del proto para que cualquier librería OAuth2 estándar los entienda sin adaptador.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int32  `json:"expires_in"`
}

// SagaAccepted es la respuesta de un flujo asíncrono: el handle con el que consultar
// el estado.
type SagaAccepted struct {
	SagaID string `json:"saga_id"`
}

// ── DTO de aprendizaje ──────────────────────────────────────────────────────

// Article ≡ `components.schemas.Article`.
//
// `QuizIDs` no está en el OpenAPI original (se añadió aquí junto con el mapeo
// en `articleToDTO`): sin él, la SPA no tiene forma de enlazar «leer artículo»
// con «iniciar su cuestionario» (FR-011 → FR-012, escenario 2 de `spec.md`) —
// `learning.proto` ya lo expone (`Article.quiz_ids`), solo faltaba cruzar el borde.
type Article struct {
	ArticleID        string   `json:"article_id"`
	Title            string   `json:"title"`
	Category         string   `json:"category"`
	Body             string   `json:"body"`
	CurrentVersionNo int32    `json:"current_version_no"`
	QuizIDs          []string `json:"quiz_ids"`
}

// Quiz ≡ `GET /quizzes/{quizId}` (FR-009). `PassThreshold` es `string` decimal
// (Principio VIII): es el umbral de aprobación, no un entero de conteo.
type Quiz struct {
	QuizID        string     `json:"quiz_id"`
	ArticleID     string     `json:"article_id"`
	Title         string     `json:"title"`
	PassThreshold string     `json:"pass_threshold"`
	Questions     []Question `json:"questions"`
}

// Question ≡ una pregunta de `Quiz`. `Weight` es `string` decimal por la misma
// razón que `PassThreshold`; no lleva la opción correcta — calificar es de
// Aprendizaje, no del borde.
type Question struct {
	QuestionID string   `json:"question_id"`
	Prompt     string   `json:"prompt"`
	Options    []Option `json:"options"`
	Weight     string   `json:"weight"`
}

// Option ≡ una alternativa de respuesta. `Key` es lo que viaja de vuelta en
// `SubmitAttemptRequest.Answers` (question_id → option_key); `Text` es lo único
// que se muestra.
type Option struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

// QuizGradeResult ≡ `components.schemas.QuizGradeResult`.
//
// `Score` es `string` porque es una calificación (`NUMERIC(6,2)` en la base). Es el
// caso más fácil de estropear de todo el borde: un `float64` aquí compilaría, pasaría
// las pruebas con `85.5` y perdería precisión con `85.55`.
type QuizGradeResult struct {
	AttemptID   string `json:"attempt_id"`
	AttemptNo   int32  `json:"attempt_no"`
	Score       string `json:"score"`
	Passed      bool   `json:"passed"`
	PointsAfter int32  `json:"points_after"`
}

// ── DTO editoriales ─────────────────────────────────────────────────────────

// CreateDraftRequest ≡ `POST /editorial/articles` (FR-007).
//
// No lleva `editor_id`: el autor sale del token verificado. Si viniera en el cuerpo,
// cualquier editor podría crear un borrador a nombre de otro y `created_by` dejaría de
// ser confiable — y con él, el invariante `approved_by ≠ created_by` de FR-008.
type CreateDraftRequest struct {
	Title    string `json:"title"`
	Category string `json:"category"`
	Body     string `json:"body"`
}

// ArticleVersion ≡ la respuesta de creación de borrador.
type ArticleVersion struct {
	VersionID  string `json:"version_id"`
	ArticleID  string `json:"article_id"`
	VersionNo  int32  `json:"version_no"`
	State      string `json:"state"`
	CreatedBy  string `json:"created_by"`
	ApprovedBy string `json:"approved_by,omitempty"`
}

// OpAck es el acuse de una operación de comando sin recurso que devolver.
type OpAck struct {
	Success bool   `json:"success"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// ── DTO de aprendizaje (envío de cuestionario) ──────────────────────────────

// SubmitAttemptRequest ≡ `POST /quizzes/{quizId}/attempts`.
//
// `Answers` es `map[string]string` (pregunta → opción elegida) tal como lo declara el
// contrato gRPC. El Gateway no las interpreta: qué opción es correcta y cuánto pesa
// cada pregunta es dominio de Aprendizaje.
type SubmitAttemptRequest struct {
	Answers map[string]string `json:"answers"`
}

// ── DTO de simuladores ──────────────────────────────────────────────────────

// SimulationRequest ≡ `POST /simulators/{calcType}/run`.
//
// `Inputs` es `map[string]string`, no `map[string]float64`: son montos, tasas y plazos
// que van al Simulador tal cual. El Gateway no los interpreta ni los valida más allá de
// su presencia — el dueño de esas reglas es el Simulador (Principio VIII + IX).
type SimulationRequest struct {
	Currency string            `json:"currency"`
	Inputs   map[string]string `json:"inputs"`
}

// SimulationResult ≡ `components.schemas.SimulationResult`.
type SimulationResult struct {
	SimulationID string            `json:"simulation_id"`
	Result       map[string]string `json:"result"`
}

// SimulationHistoryEntry ≡ un elemento de `GET /simulators/history` (FR-022).
//
// `CalcType` sale como el nombre en minúsculas de la ruta (`ahorro`, `credito`, …) y no
// como el entero del enum: el número es un detalle del transporte gRPC, y publicarlo
// obligaría al cliente a mantener su propia tabla de equivalencias que se desincroniza
// en cuanto el enum crezca.
type SimulationHistoryEntry struct {
	SimulationID string            `json:"simulation_id"`
	CalcType     string            `json:"calc_type"`
	Currency     string            `json:"currency"`
	Inputs       map[string]string `json:"inputs"`
	Result       map[string]string `json:"result"`
	CreatedAt    string            `json:"created_at"`
}

// ── DTO de perfil ───────────────────────────────────────────────────────────

// Profile ≡ `GET /me/profile`.
type Profile struct {
	UserID        string            `json:"user_id"`
	Email         string            `json:"email"`
	DisplayName   string            `json:"display_name"`
	EmailVerified bool              `json:"email_verified"`
	AccountStatus string            `json:"account_status"`
	Preferences   map[string]string `json:"preferences"`
	Roles         []string          `json:"roles"`
}

// UpdateProfileRequest ≡ `PATCH /me/profile`.
//
// Los campos son PUNTEROS porque un PATCH tiene tres estados por campo y no dos:
// ausente («no lo toques»), presente con valor y presente vacío. Con `string` a secas,
// los dos primeros son indistinguibles —ambos llegan como `""`— y actualizar solo las
// preferencias borraría el nombre para mostrar.
//
// LIMITACIÓN DEL CONTRATO, y hay que conocerla: `users.v1.UpdateProfileRequest` no
// tiene máscara de campos, así que lo único que el Gateway puede transmitir es «vacío».
// La convención que queda establecida —y que el Servicio de Usuarios debe respetar al
// implementarse (US1)— es «campo vacío ⇒ no cambiar». El efecto práctico es que el
// nombre para mostrar no se puede vaciar por esta ruta, lo cual es correcto: es
// obligatorio.
type UpdateProfileRequest struct {
	DisplayName *string            `json:"display_name,omitempty"`
	Preferences *map[string]string `json:"preferences,omitempty"`
}

// Progress ≡ `components.schemas.Progress`.
type Progress struct {
	UserID string `json:"user_id"`
	Points int32  `json:"points"`
}

// InAppNotification ≡ `components.schemas.InAppNotification` más `payload`.
//
// Ver `inAppToDTO` en `mapping.go` para por qué se añade el payload y por qué se
// reemite como JSON anidado en lugar de como cadena.
type InAppNotification struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	ReadState string          `json:"read_state"`
	CreatedAt string          `json:"created_at"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// Page envuelve un listado paginado con su token de continuación.
type Page[T any] struct {
	Items         []T    `json:"items"`
	NextPageToken string `json:"next_page_token,omitempty"`
	TotalSize     int64  `json:"total_size"`
}

// ── serialización ───────────────────────────────────────────────────────────

// writeJSON escribe una respuesta JSON con su código.
//
// Fija el `Content-Type` ANTES de escribir el cuerpo: `net/http` lo deduce del primer
// `Write` si no está puesto, y para un JSON acierta por casualidad —hasta que el cuerpo
// empieza por un carácter que hace que la detección elija `text/plain`.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if body == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// La cabecera y el código ya salieron, así que no se puede cambiar la
		// respuesta. Lo único útil es no fingir que fue bien: el error se propaga por
		// el log del middleware, que aún tiene el contexto de la petición.
		_ = err
	}
}

// decodeJSON lee el cuerpo en `dst` rechazando lo que no encaje.
//
// `DisallowUnknownFields` es deliberado: un campo que el cliente cree estar enviando y
// el servidor ignora en silencio es un fallo que se descubre en producción («guardé mis
// preferencias y no se guardaron»). Rechazarlo lo convierte en un 400 inmediato y
// legible.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	// Tope de tamaño ANTES de decodificar. Sin él, `json.Decoder` leería en memoria
	// todo lo que el cliente quisiera enviar: un cuerpo de un gigabyte contra una ruta
	// pública sin autenticar tumba la réplica sin necesidad de credenciales.
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%w: cuerpo JSON ilegible: %w", errBadRequest, err)
	}

	// Un segundo valor JSON en el mismo cuerpo se rechaza. `{"a":1}{"b":2}` decodifica
	// el primero y descarta el resto en silencio, que es una forma sutil de que el
	// cliente crea haber enviado algo que el servidor nunca vio.
	if dec.More() {
		return fmt.Errorf("%w: el cuerpo contiene más de un valor JSON", errBadRequest)
	}
	return nil
}

// maxRequestBodyBytes acota el cuerpo de cualquier petición del borde.
//
// 1 MiB es holgado para el mayor cuerpo real del contrato —un borrador de artículo— y
// suficientemente pequeño para que no sirva de vector de agotamiento.
const maxRequestBodyBytes int64 = 1 << 20

// noStore prohíbe cachear la respuesta (RFC 6749 §5.1).
//
// Obligatorio en las respuestas de token: sin él, un proxy intermedio o el propio
// navegador pueden guardar en disco un `access_token` y servirlo después a otra
// petición o a otro usuario del mismo equipo.
func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}
