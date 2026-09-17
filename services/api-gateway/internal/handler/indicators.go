package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
)

// Indicadores financieros anuales: `/admin/indicators[/{indicatorId}]`,
// `/admin/indicators/status` e `/indicators/current` (feature 002, US4 —
// FR-055…FR-062, T107).
//
// El acceso ya lo decidió el router: las tres primeras rutas van en el grupo
// `/admin/**` con `RequireRole(RoleAdministrator)` delante (FR-081) y
// `/indicators/current` está en el grupo autenticado, porque la advertencia de
// FR-062 la ve cualquier usuario antes de ejecutar una calculadora.
//
// Lo único que queda aquí es traducir DTO ⇄ proto y sacar el ACTOR del token
// verificado: quien carga la cifra queda registrado (FR-060), así que el
// `actor_id` no puede venir del cuerpo — si viniera, cualquiera podría cargar el
// UVT «como si» fuera otra persona.
//
// ## El 409 por solapamiento lleva las vigencias que chocan
//
// FR-059 lo impide en la base y el estado `ALREADY_EXISTS` ya se traduce a 409 en
// `httpFromGRPC`. Lo que ese mapeo NO puede dar es con QUÉ se solapa: el mensaje
// del servicio no cruza (es la política de `httpFromGRPC`, y protege de nombres de
// host y detalle del driver). Así que el conflicto se traduce aparte —igual que
// `deactivateCategory` hace con `published_count`— consultando las vigencias de ese
// nombre y devolviéndolas en el cuerpo. Sin eso, el mensaje al administrador sería
// «conflicto con el estado actual», y quien carga el UVT de 2027 necesita ver cuál
// de las dos cifras sobra.

// todayISO es el día con el que se pregunta qué está vigente (FR-062).
//
// En UTC y no en la zona del servidor ni en la de quien pregunta: el Simulador
// resuelve los indicadores con `Utc::now().date_naive()`, así que una fecha calculada
// en otra zona preguntaría por un día distinto del que después se resolvería al
// ejecutar. En el cambio de año esa diferencia es la que haría que el borde dijera que
// todo está en orden mientras el cálculo no encuentra el valor del año nuevo.
func todayISO() string {
	return time.Now().UTC().Format("2006-01-02")
}

// ListIndicators ≡ `GET /admin/indicators`.
//
// Sin `on_date` devuelve TODAS las vigencias —el histórico, que es lo que necesita
// la pantalla de administración para ver qué hay cargado—; con `on_date`, la que
// rige ese día. La distinción importa: «qué está vigente hoy» y «qué hay cargado»
// son dos preguntas distintas y la segunda es la que detecta un hueco.
func (h *Handler) ListIndicators(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Simulator.ListIndicators(r.Context(), &simulatorv1.ListIndicatorsRequest{
		Name:   r.URL.Query().Get("name"),
		OnDate: r.URL.Query().Get("on_date"),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, indicatorsToDTO(resp.GetItems()))
}

// CurrentIndicators ≡ `GET /indicators/current` (FR-062).
//
// Devuelve los valores vigentes HOY y, además, los nombres conocidos que se
// quedaron sin vigencia. Las dos listas van juntas y no en dos peticiones porque
// quien las usa es el ejecutor de una calculadora, que necesita las dos cosas para
// decidir si advierte antes de ejecutar: con dos llamadas, una calculadora que
// depende de `@UVT` podría ejecutarse con la advertencia sin resolver si la segunda
// petición llegó tarde.
//
// `missing_names` son los nombres YA registrados que hoy no tienen vigencia, no los
// indicadores que «faltan» según una lista ideal: de un indicador que nadie ha
// cargado nunca no se puede decir que le falte vigencia.
func (h *Handler) CurrentIndicators(w http.ResponseWriter, r *http.Request) {
	// `on_date` vacío ⇒ todas las vigencias; con la fecha de hoy, la vigente.
	today := todayISO()

	resp, err := h.clients.Simulator.ListIndicators(r.Context(), &simulatorv1.ListIndicatorsRequest{
		OnDate: today,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	cal, err := h.clients.Simulator.GetIndicatorCalendarStatus(
		r.Context(),
		&commonv1.PageRequest{},
	)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, CurrentIndicators{
		Indicators:   indicatorsToDTO(resp.GetItems()),
		MissingNames: listaNoNula(cal.GetMissingNames()),
	})
}

// CreateIndicator ≡ `POST /admin/indicators` (FR-060).
func (h *Handler) CreateIndicator(w http.ResponseWriter, r *http.Request) {
	h.upsertIndicator(w, r, "")
}

// UpdateIndicator ≡ `PUT /admin/indicators/{indicatorId}` (FR-060).
//
// Es una CORRECCIÓN de la vigencia existente y no una versión nueva: un indicador
// es una cifra oficial que se transcribe, y corregir una errata no crea otra
// vigencia. Lo que hace segura la corrección es que las simulaciones ya ejecutadas
// guardaron el valor con el que calcularon (FR-058).
func (h *Handler) UpdateIndicator(w http.ResponseWriter, r *http.Request) {
	h.upsertIndicator(w, r, chi.URLParam(r, "indicatorId"))
}

// IndicatorCalendarStatus ≡ `GET /admin/indicators/status` (FR-061).
//
// Es la vista del administrador: además de lo que está sin vigencia, incluye lo que
// está POR VENCER dentro de la ventana de aviso. Ese aviso lo publica el
// Orquestador en su barrido (research D-23), así que esta ruta sirve para que la
// pantalla pueda mostrar el mismo estado que se está avisando por correo, y para
// que quien opera pueda comprobarlo sin esperar al barrido.
func (h *Handler) IndicatorCalendarStatus(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Simulator.GetIndicatorCalendarStatus(
		r.Context(),
		&commonv1.PageRequest{},
	)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, calendarStatusToDTO(resp))
}

// upsertIndicator comparte el camino de alta y de corrección.
//
// `indicatorID` vacío significa crear. El `actor_id` sale SIEMPRE de las marcas del
// token y nunca del cuerpo (FR-060).
func (h *Handler) upsertIndicator(w http.ResponseWriter, r *http.Request, indicatorID string) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body IndicatorInput
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	resp, err := h.clients.Simulator.UpsertIndicator(r.Context(), &simulatorv1.UpsertIndicatorRequest{
		IndicatorId: indicatorID,
		Name:        body.Name,
		Value:       body.Value,
		ValidFrom:   body.ValidFrom,
		ValidTo:     body.ValidTo,
		ActorId:     claims.UserID,
	})
	if err != nil {
		if h.indicatorConflict(w, r, body.Name, err) {
			return
		}
		h.writeGRPCError(w, r, err)
		return
	}

	code := http.StatusOK
	if indicatorID == "" {
		code = http.StatusCreated
	}
	writeJSON(w, code, indicatorToDTO(resp))
}

// indicatorConflict escribe el 409 con las vigencias que se solapan (FR-059).
//
// Devuelve `true` si el error era un solapamiento y ya se ha respondido. Consulta
// las vigencias del nombre implicado: no se puede saber cuál choca sin preguntar por
// él, y el mensaje del servicio no cruza la frontera.
//
// Si esa consulta fallara, se responde el 409 SIN la lista: el conflicto ya está
// determinado y perderlo para añadir contexto sería peor que dar el contexto a
// medias.
func (h *Handler) indicatorConflict(
	w http.ResponseWriter,
	r *http.Request,
	name string,
	err error,
) bool {
	if status.Code(err) != codes.AlreadyExists {
		return false
	}

	existing := []Indicator{}
	if name != "" {
		if resp, listErr := h.clients.Simulator.ListIndicators(
			r.Context(),
			&simulatorv1.ListIndicatorsRequest{Name: name},
		); listErr == nil {
			existing = indicatorsToDTO(resp.GetItems())
		}
	}

	writeJSON(w, http.StatusConflict, IndicatorConflict{
		Code:     "conflict",
		Message:  "ya existe una vigencia de " + name + " que se solapa con esas fechas",
		Existing: existing,
	})
	return true
}
