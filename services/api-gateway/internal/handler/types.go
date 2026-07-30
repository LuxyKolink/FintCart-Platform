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

// SagaAccepted es la respuesta de un flujo asíncrono: el handle con el que consultar
// el estado.
type SagaAccepted struct {
	SagaID string `json:"saga_id"`
}

// ── DTO de aprendizaje ──────────────────────────────────────────────────────

// Article ≡ `components.schemas.Article`.
type Article struct {
	ArticleID        string `json:"article_id"`
	Title            string `json:"title"`
	Category         string `json:"category"`
	Body             string `json:"body"`
	CurrentVersionNo int32  `json:"current_version_no"`
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
type UpdateProfileRequest struct {
	DisplayName string            `json:"display_name"`
	Preferences map[string]string `json:"preferences"`
}

// Progress ≡ `components.schemas.Progress`.
type Progress struct {
	UserID string `json:"user_id"`
	Points int32  `json:"points"`
}

// InAppNotification ≡ `components.schemas.InAppNotification`.
type InAppNotification struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	ReadState string `json:"read_state"`
	CreatedAt string `json:"created_at"`
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
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%w: cuerpo JSON ilegible: %w", errBadRequest, err)
	}
	return nil
}
