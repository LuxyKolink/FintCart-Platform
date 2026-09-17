// Barrido del calendario de indicadores (T105, FR-061; research D-23).
//
// ## Por qué el barrido vive AQUÍ y no en el Simulador
//
// El Simulador es quien SABE qué está sin vigencia —es el dueño de los indicadores y el
// único que los lee al calcular—, pero **no es productor de RabbitMQ**: el Principio V
// limita la producción a Usuarios, Aprendizaje, Orquestador y Autenticación. Es el mismo
// reparto que D-03 resolvió para la auditoría de simulaciones: el que sabe publica a través
// del que puede, y el Orquestador es el que puede.
//
// La consecuencia práctica de ese reparto es que el aviso tiene una latencia: no se emite
// en el instante en que un administrador carga una vigencia, sino en el siguiente barrido.
// Es aceptable porque lo que se avisa es un vencimiento con treinta días de antelación, y
// porque lo contrario —que el Simulador publicara— exigiría darle un productor por un solo
// evento.
//
// ## Por qué cada aviso se publica UNA vez
//
// El barrido vuelve a pasar cada pocos minutos, y el estado que consulta es el mismo
// mientras dure el problema. Publicar sin más produciría un correo por barrido: con un
// intervalo de cinco minutos, doscientas ochenta y ocho cartas al día sobre el mismo dato.
// Y el daño no sería solo el ruido —una alerta que se repite sin que nada haya cambiado es
// la que enseña a ignorarla, y con ella se pierde el aviso que sí importa.
//
// El identificador del evento es **determinista**: `(tipo, clase, indicador, fecha)` pasado
// por SHA-1 con el espacio de nombres de UUID (RFC 4122 §4.3). Dos barridos del mismo día
// sobre el mismo indicador producen el MISMO `event_id`, y el `ON CONFLICT (id) DO NOTHING`
// del outbox descarta el segundo. Al día siguiente el identificador cambia y el aviso se
// vuelve a emitir, que es lo que hace que el problema siga siendo visible sin ser
// machacón.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/common/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Namespace de los identificadores deterministas de los avisos.
//
// Es el UUID de nombre de la plataforma y no `uuid.NameSpaceOID` a secas: los dos son
// válidos, pero el propio permite reconocer de un vistazo qué generó un identificador que
// aparezca en un log sin tener que saber de qué catálogo de nombres salió.
var alertNamespace = uuid.MustParse("6f8a5f2e-0f5e-4f2c-9a7a-2b9a5c3d1e4f")

// Clases de aviso. Forman parte del identificador determinista, así que cambiarlas
// reemitiría todos los avisos de ese día — y por eso son constantes con nombre.
const (
	alertKindMissing  = "sin_vigencia"
	alertKindExpiring = "por_vencer"
)

// IndicadoresAlertados informa de lo que el barrido hizo, para el log y las pruebas.
type IndicadoresAlertados struct {
	// Publicados son los avisos nuevos encolados en este barrido.
	Publicados int
	// Repetidos son los que ya estaban encolados (mismo día, mismo indicador).
	Repetidos int
	// Indicadores es lo que el Simulador reportó, encolado o no.
	Indicadores int
}

// Sweeper consulta el calendario de indicadores y encola los avisos que falten.
type Sweeper struct {
	simulator simulatorv1.SimulatorServiceClient
	store     storer.Storer
	// alertEmail es el buzón que recibe el aviso.
	//
	// Es una dirección de DESPLIEGUE y no la de una persona: el aviso es del procedimiento
	// anual —«carga las cifras de este año»— y le corresponde a quien opera la plataforma,
	// no a la cuenta con la que alguien entró a cargarlas. Pedirla por configuración evita
	// además que el Orquestador tenga que consultar Usuarios por el correo de sus
	// administradores, que sería una dependencia nueva para un solo aviso.
	alertEmail string
	logger     *slog.Logger
	// now se inyecta para poder fijar el día en las pruebas: el identificador determinista
	// depende de la fecha, así que una prueba que usara el reloj real cambiaría de
	// identificador a medianoche y fallaría una vez cada mil años, por el motivo equivocado.
	now func() time.Time
}

// NewSweeper construye el barrido.
//
// Un `alertEmail` vacío NO es un error de arranque: en un despliegue sin dirección
// configurada el barrido sigue consultando el estado —quien mire el log verá que hay
// indicadores sin vigencia— y no publica nada. Se avisa una vez por barrido con un `warn`
// en lugar de fallar, porque tumbar el Orquestador entero —que es quien mueve las sagas—
// por una dirección de correo que falta sería un remedio peor que la enfermedad.
func NewSweeper(
	simulator simulatorv1.SimulatorServiceClient,
	store storer.Storer,
	alertEmail string,
	logger *slog.Logger,
) *Sweeper {
	return &Sweeper{
		simulator:  simulator,
		store:      store,
		alertEmail: alertEmail,
		logger:     logger,
		now:        time.Now,
	}
}

// SweepIndicators consulta el estado del calendario y encola los avisos que falten.
func (s *Sweeper) SweepIndicators(ctx context.Context) (IndicadoresAlertados, error) {
	var resumen IndicadoresAlertados

	// El contrato pide un `PageRequest` porque el RPC se declaró con el mismo envoltorio
	// que los listados, y el Simulador documenta por qué no lo usa: la respuesta es un
	// ESTADO, no una página. Se manda vacío.
	resp, err := s.simulator.GetIndicatorCalendarStatus(
		ctx, &commonv1.PageRequest{})
	if err != nil {
		// Un Simulador caído no se convierte en una falla del Orquestador: el barrido
		// vuelve a pasar y el aviso se emitirá cuando responda. Se distingue el
		// `Unimplemented` porque significa otra cosa —la versión desplegada del
		// Simulador todavía no tiene los RPC de indicadores— y conviene que se lea así en
		// el log en lugar de como una caída.
		if status.Code(err) == codes.Unimplemented {
			return resumen, fmt.Errorf("el Simulador no expone el estado del calendario (¿versión anterior?): %w", err)
		}
		return resumen, fmt.Errorf("consultar el estado del calendario: %w", err)
	}

	avisos := alertasDe(resp)
	resumen.Indicadores = len(avisos)

	if len(avisos) == 0 {
		return resumen, nil
	}

	if s.alertEmail == "" {
		s.logger.WarnContext(ctx,
			"hay indicadores sin vigencia o por vencer y no hay buzón configurado para el aviso",
			slog.Int("indicadores", len(avisos)))
		return resumen, nil
	}

	paraEncolar, err := s.encolar(ctx, avisos)
	if err != nil {
		return resumen, err
	}
	resumen.Publicados = paraEncolar.Publicados
	resumen.Repetidos = paraEncolar.Repetidos
	return resumen, nil
}

// alerta es un indicador a avisar, ya clasificado.
type alerta struct {
	kind          string
	name          string
	validTo       string
	daysRemaining int32
}

// alertasDe traduce la respuesta del Simulador a la lista de avisos.
//
// El orden es el que devuelve el Simulador —nombres sin vigencia primero, ordenados
// alfabéticamente, y después los que vencen por fecha— y se conserva para que el correo
// salga igual en cada barrido: un listado que cambiara de orden entre barridos haría
// parecer que el aviso cambió cuando no cambió nada.
func alertasDe(resp *simulatorv1.IndicatorCalendarStatus) []alerta {
	alertas := make([]alerta, 0, len(resp.GetMissingNames())+len(resp.GetExpiring()))

	for _, name := range resp.GetMissingNames() {
		alertas = append(alertas, alerta{kind: alertKindMissing, name: name})
	}
	for _, expiring := range resp.GetExpiring() {
		alertas = append(alertas, alerta{
			kind:          alertKindExpiring,
			name:          expiring.GetName(),
			validTo:       expiring.GetValidTo(),
			daysRemaining: expiring.GetDaysRemaining(),
		})
	}

	return alertas
}

// encolar escribe un evento por aviso y cuenta cuántos eran nuevos.
func (s *Sweeper) encolar(ctx context.Context, avisos []alerta) (IndicadoresAlertados, error) {
	var resumen IndicadoresAlertados
	hoy := s.now().UTC().Format("2006-01-02")
	occurredAt := s.now().UTC().Format(time.RFC3339)

	for _, aviso := range avisos {
		eventID := alertEventID(aviso, hoy)

		body, err := json.Marshal(events.Envelope{
			EventID:    eventID.String(),
			EventType:  events.EventIndicatorCalendarAlert,
			OccurredAt: occurredAt,
			// El indicador NO es una persona: el `actor_ref` del sobre es opaco y aquí no
			// hay titular al que señalar. Se usa el identificador nulo y no el del
			// administrador que cargó la cifra —quien recibe el aviso no es
			// necesariamente quien la cargó—, y los avisos del sistema con `actor_ref`
			// nulo son un caso que Auditoría ya tiene que saber tratar.
			ActorRef: uuid.Nil.String(),
			// El payload lleva el buzón porque es el único canal que tiene el servicio de
			// Notificación para saber a quién escribe: no conoce a los administradores ni
			// tiene por qué. Es el mismo formato que ya usa `user.registered`.
			//
			// `valid_to` y `days_remaining` viajan con nombre de columna aunque en los
			// avisos sin vigencia no apliquen: un payload con campos que aparecen y
			// desaparecen obligaría a la plantilla a distinguir «no viene» de «viene
			// vacío», y la distinción no aporta nada aquí.
			Payload: map[string]any{
				"email":          s.alertEmail,
				"kind":           aviso.kind,
				"name":           aviso.name,
				"valid_to":       aviso.validTo,
				"days_remaining": int(aviso.daysRemaining),
				"as_of":          hoy,
			},
		})
		if err != nil {
			return resumen, fmt.Errorf("envolver el aviso de %s: %w", aviso.name, err)
		}

		nuevo, err := s.store.InsertStandaloneEvent(ctx, storer.OutboxRow{
			ID:         eventID,
			EventType:  events.EventIndicatorCalendarAlert,
			RoutingKey: events.EventIndicatorCalendarAlert,
			Payload:    body,
		})
		if err != nil {
			return resumen, err
		}
		if nuevo {
			resumen.Publicados++
		} else {
			resumen.Repetidos++
		}
	}

	return resumen, nil
}

// alertEventID deriva el identificador del aviso de forma determinista (RFC 4122 §4.3).
//
// Entran las cuatro cosas que hacen que un aviso sea DISTINTO de otro: qué se avisa, si es
// una falta de vigencia o un vencimiento próximo, de qué indicador, y de qué día. Dos
// barridos del mismo día producen el mismo identificador —y por tanto un solo correo—, y al
// día siguiente cambia, de modo que el problema se recuerda sin repetirse.
func alertEventID(aviso alerta, day string) uuid.UUID {
	return uuid.NewSHA1(alertNamespace, []byte(
		fmt.Sprintf("%s|%s|%s|%s", events.EventIndicatorCalendarAlert, aviso.kind, aviso.name, day)))
}
