// Mapeo explícito de la capa de aplicación (Principio IX regla 3).
//
// Este archivo cubre las DOS fronteras que toca `server`:
//
//	fila (storer)      → dominio    ·  *FromRow / *FromRows
//	dominio            → fila       ·  *ToRow
//	respuesta gRPC ajena → dominio  ·  los adaptadores del final del archivo
//
// La conversión ocurre aquí y solo aquí. La regla parece burocrática hasta que se
// mira lo que evita: si cada método construyera su propio `Profile` a partir de
// una fila, un campo nuevo en el esquema se propagaría por copia-pega a cinco
// sitios y se olvidaría en el sexto. Con un único convertidor, el compilador
// señala un solo lugar.
//
// La frontera proto ↔ dominio NO está aquí: vive en `internal/handler/mapping.go`,
// porque los tipos proto son transporte.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"

	commonv1 "github.com/fintcart/platform/services/users/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/users/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/users/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/users/internal/storer"
)

// ── fila → dominio ──────────────────────────────────────────────────────────

// Claves reservadas del mapa de preferencias del contrato.
//
// `UpdateProfileRequest.preferences` y `Profile.preferences` son un
// `map<string, string>` genérico porque el contrato no puede anticipar cada
// preferencia futura, pero la tabla `preferences` SÍ tiene columnas tipadas para
// las tres que ya existen (`locale`, `notif_inapp`, `notif_email`). Estas tres
// claves son el puente: lo que llega con uno de estos nombres se guarda en su
// columna; cualquier otra clave cae en `payload` (JSONB), extensible sin migración.
const (
	prefKeyLocale     = "locale"
	prefKeyNotifInApp = "notif_inapp"
	prefKeyNotifEmail = "notif_email"
)

// preferencesFromRow aplana la fila de preferencias en el mapa del contrato.
func preferencesFromRow(row storer.PreferencesRow) map[string]string {
	out := map[string]string{
		prefKeyLocale:     row.Locale,
		prefKeyNotifInApp: strconv.FormatBool(row.NotifInApp),
		prefKeyNotifEmail: strconv.FormatBool(row.NotifEmail),
	}
	if len(row.Payload) > 0 {
		var extra map[string]string
		// Un payload ilegible no debe tumbar la lectura del perfil: se ignora y el
		// usuario ve sus tres preferencias tipadas igualmente. `UpdateProfile` es
		// quien garantiza que lo que se ESCRIBE siempre es JSON válido; esto es
		// solo defensa ante una fila que alguna vía futura dejara corrupta.
		_ = json.Unmarshal(row.Payload, &extra)
		for k, v := range extra {
			out[k] = v
		}
	}
	return out
}

// preferencesToRow combina la fila ACTUAL con las preferencias entrantes.
//
// Recibe la fila actual y no parte de cero porque el contrato no distingue «no
// mandaste esta preferencia» de «bórrala»: un `UpdateProfile` que solo cambia el
// idioma no debe apagar sin querer las notificaciones por correo. Fusionar sobre
// lo existente es lo que hace que actualizar una preferencia deje intactas las
// demás.
func preferencesToRow(userID uuid.UUID, current storer.PreferencesRow, prefs map[string]string) (storer.PreferencesRow, error) {
	row := current
	row.UserID = userID

	extra := map[string]string{}
	if len(current.Payload) > 0 {
		_ = json.Unmarshal(current.Payload, &extra)
	}

	for k, v := range prefs {
		switch k {
		case prefKeyLocale:
			row.Locale = v
		case prefKeyNotifInApp:
			b, err := strconv.ParseBool(v)
			if err != nil {
				return storer.PreferencesRow{}, fmt.Errorf("%w: %q no es booleano", ErrInvalidArgument, prefKeyNotifInApp)
			}
			row.NotifInApp = b
		case prefKeyNotifEmail:
			b, err := strconv.ParseBool(v)
			if err != nil {
				return storer.PreferencesRow{}, fmt.Errorf("%w: %q no es booleano", ErrInvalidArgument, prefKeyNotifEmail)
			}
			row.NotifEmail = b
		default:
			extra[k] = v
		}
	}

	payload, err := json.Marshal(extra)
	if err != nil {
		return storer.PreferencesRow{}, fmt.Errorf("serializar preferencias adicionales: %w", err)
	}
	row.Payload = payload
	return row, nil
}

// profileFromRows ensambla la vista completa del perfil (FR-017).
func profileFromRows(p storer.ProfileRow, prefs storer.PreferencesRow, roles []storer.RoleRow) Profile {
	names := make([]string, 0, len(roles))
	for _, r := range roles {
		names = append(names, r.Role)
	}
	return Profile{
		UserID:        p.ID.String(),
		Email:         p.Email,
		DisplayName:   p.DisplayName,
		EmailVerified: p.EmailVerified,
		AccountStatus: p.AccountStatus,
		Preferences:   preferencesFromRow(prefs),
		Roles:         names,
	}
}

func authContextFromRows(p storer.ProfileRow, roles []storer.RoleRow) AuthContext {
	names := make([]string, 0, len(roles))
	for _, r := range roles {
		names = append(names, r.Role)
	}
	return AuthContext{
		UserID:        p.ID.String(),
		Roles:         names,
		AccountStatus: p.AccountStatus,
		EmailVerified: p.EmailVerified,
	}
}

func progressFromRow(p storer.ProgressRow) Progress {
	return Progress{UserID: p.UserID.String(), Points: p.Points}
}

// inAppPageFromRows convierte las filas de la bandeja en la vista de dominio.
//
// `CreatedAt` pasa de `time.Time` a `string` RFC-3339 porque así lo declara el
// contrato (`ListInAppResponse.Item.created_at`). Serializar la marca temporal en
// UTC y no en la zona del servidor es intencionado: dos réplicas en zonas
// distintas devolverían la misma notificación con horas distintas.
func inAppPageFromRows(rows []storer.InAppNotificationRow, total int64) InAppPage {
	items := make([]InAppNotification, 0, len(rows))
	for _, r := range rows {
		items = append(items, InAppNotification{
			ID:          r.ID.String(),
			Type:        r.Type,
			PayloadJSON: string(r.Payload),
			ReadState:   r.ReadState,
			CreatedAt:   r.CreatedAt.UTC().Format(rfc3339Millis),
		})
	}
	return InAppPage{Items: items, Total: total}
}

// Formato de marca temporal del contrato: RFC-3339 en UTC con milisegundos.
//
// Se fija el número de decimales en lugar de usar `time.RFC3339Nano`, que los
// recorta variablemente: un cliente que ordene por la cadena vería
// `...:05.1Z` antes que `...:05.05Z`, que es el orden inverso al real.
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

// ── respuesta gRPC ajena → dominio ──────────────────────────────────────────
//
// Adaptadores de los puertos salientes de `report.go` (plan.md N-02). Están en
// `mapping.go` porque es exactamente lo que hacen: convertir la respuesta de un
// contrato ajeno en el escalar que el dominio necesita. `cmd/users/main.go` los
// construye con los clientes gRPC ya conectados y los inyecta en [New].

// LearningAttemptCounter cuenta intentos preguntando a `LearningService`.
type LearningAttemptCounter struct {
	client learningv1.LearningServiceClient
}

// NewLearningAttemptCounter envuelve un cliente gRPC de Aprendizaje.
func NewLearningAttemptCounter(client learningv1.LearningServiceClient) *LearningAttemptCounter {
	return &LearningAttemptCounter{client: client}
}

// CountAttempts pide la página más pequeña posible y lee solo el total.
//
// `PageSize: 1` en lugar de 0 es deliberado: un tamaño de página cero suele
// interpretarse como «el que quieras» y podría devolver el historial completo de
// intentos de un usuario para acabar descartándolo. Pedir una sola fila deja
// claro que lo único que interesa es `total_size`.
//
// `QuizId` se deja vacío para contar los intentos de TODOS los cuestionarios;
// `ListAttemptsRequest.quiz_id` no declara ese significado en el contrato, y es una
// ambigüedad que hay que fijar antes de implementar T160 (ver las notas de la
// tarea).
func (a *LearningAttemptCounter) CountAttempts(ctx context.Context, userID string) (int64, error) {
	resp, err := a.client.ListAttempts(ctx, &learningv1.ListAttemptsRequest{
		UserId: userID,
		Page:   &commonv1.PageRequest{PageSize: 1},
	})
	if err != nil {
		return 0, fmt.Errorf("contar intentos de cuestionario del usuario %s: %w", userID, err)
	}
	return resp.GetPage().GetTotalSize(), nil
}

// SimulatorRunCounter cuenta simulaciones preguntando a `SimulatorService`.
type SimulatorRunCounter struct {
	client simulatorv1.SimulatorServiceClient
}

// NewSimulatorRunCounter envuelve un cliente gRPC del Simulador.
func NewSimulatorRunCounter(client simulatorv1.SimulatorServiceClient) *SimulatorRunCounter {
	return &SimulatorRunCounter{client: client}
}

func (a *SimulatorRunCounter) CountSimulations(ctx context.Context, userID string) (int64, error) {
	resp, err := a.client.ListHistory(ctx, &simulatorv1.ListHistoryRequest{
		UserId: userID,
		Page:   &commonv1.PageRequest{PageSize: 1},
	})
	if err != nil {
		return 0, fmt.Errorf("contar simulaciones del usuario %s: %w", userID, err)
	}
	return resp.GetPage().GetTotalSize(), nil
}

// Los adaptadores satisfacen los puertos: si el contrato de Aprendizaje o del
// Simulador cambia de forma incompatible, esto falla al compilar y no en
// producción.
var (
	_ AttemptCounter    = (*LearningAttemptCounter)(nil)
	_ SimulationCounter = (*SimulatorRunCounter)(nil)
)
