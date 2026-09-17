// Mapeo REST ↔ gRPC del borde (Principio IX regla 3 y Principio VIII).
//
// Es el único archivo del Gateway donde un mensaje proto se convierte en un DTO JSON y
// al revés. Dos reglas gobiernan todo lo de aquí:
//
//  1. **Los decimales pasan como `string`, sin tocarlos.** No se parsean, no se
//     reformatean y no se redondean. El Gateway no es dueño de ningún monto: cambiar
//     `"85.50"` por `"85.5"` —o peor, por `85.5`— haría que el valor que ve el usuario
//     y el que quedó auditado pudieran no coincidir (Principio VIII, research D-10).
//  2. **Los códigos gRPC se traducen a HTTP en un solo sitio.** Repartir ese
//     `switch` por los handlers garantiza que dos rutas devuelvan códigos distintos
//     para el mismo fallo.
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
)

// ── proto → DTO ─────────────────────────────────────────────────────────────
//
// Obsérvese que en NINGUNA de estas funciones aparece un `strconv.ParseFloat`, un
// `decimal.NewFromString` ni un reformateo. `score`, `inputs` y `result` se copian
// tal cual llegan. Es la regla 1 del encabezado y es lo único que garantiza que el
// valor que ve el usuario sea byte a byte el que quedó auditado.

func progressToDTO(p *usersv1.ProgressView) Progress {
	return Progress{UserID: p.GetUserId(), Points: p.GetPoints()}
}

func activityReportToDTO(r *usersv1.ActivityReport) ActivityReport {
	return ActivityReport{
		UserID:           r.GetUserId(),
		Points:           r.GetPoints(),
		ArticlesViewed:   r.GetArticlesViewed(),
		QuizzesAttempted: r.GetQuizzesAttempted(),
		SimulationsRun:   r.GetSimulationsRun(),
	}
}

func profileToDTO(p *usersv1.Profile) Profile {
	return Profile{
		UserID:        p.GetUserId(),
		Email:         p.GetEmail(),
		DisplayName:   p.GetDisplayName(),
		EmailVerified: p.GetEmailVerified(),
		AccountStatus: p.GetAccountStatus(),
		Preferences:   p.GetPreferences(),
		Roles:         listaNoNula(p.GetRoles()),
	}
}

// listaNoNula convierte un `nil` en una lista vacía al construir una respuesta.
//
// POR QUÉ EXISTE, y no es cosmética: en Go una rebanada `nil` se serializa como `null`, y
// `[]` y `null` NO son lo mismo para quien consume el JSON. El contrato documenta estos
// campos como arreglos, así que un `null` rompe dos cosas a la vez: el tipo prometido y, en
// el cliente, cualquier `campo.length` — que en una plantilla de Angular es un error que
// tumba la pantalla ENTERA, no solo el dato.
//
// No es hipotético: un artículo sin cuestionario devolvía `quiz_ids: null` y el lector se
// quedaba en blanco —sin cuerpo, sin título, sin nada— porque la plantilla consultaba
// `.length` sobre ese `null`. Y una página sin resultados devolvía `items: null`, con lo que
// la pantalla de «no hay nada» era justo la que no se dibujaba.
func listaNoNula[T any](lista []T) []T {
	if lista == nil {
		return []T{}
	}
	return lista
}

func articleToDTO(a *learningv1.Article) Article {
	return Article{
		ArticleID:        a.GetArticleId(),
		Title:            a.GetTitle(),
		Category:         a.GetCategory(),
		CategoryID:       a.GetCategoryId(),
		Body:             a.GetBody(),
		BodyDoc:          rawJSON(a.GetBodyDoc()),
		CurrentVersionNo: a.GetCurrentVersionNo(),
		QuizIDs:          listaNoNula(a.GetQuizIds()),
	}
}

// categoryToDTO copia la categoría sin interpretarla. `Slug` y `Position` viajan
// tal cual: el Gateway no es dueño del catálogo, solo lo expone (Principio IX).
func categoryToDTO(c *learningv1.Category) Category {
	return Category{
		CategoryID:  c.GetCategoryId(),
		Name:        c.GetName(),
		Slug:        c.GetSlug(),
		Description: c.GetDescription(),
		Position:    c.GetPosition(),
		Active:      c.GetActive(),
	}
}

// categoriesToDTO construye el catálogo desde una respuesta `ListCategories`.
//
// `items` se normaliza a un slice vacío (nunca `null`), igual que hace `pageOf`:
// un `"categories": null` haría fallar a cualquier cliente que lo itere.
func categoriesToDTO(items []*learningv1.Category) CategoryCatalog {
	catalog := CategoryCatalog{Categories: []Category{}}
	for _, c := range items {
		catalog.Categories = append(catalog.Categories, categoryToDTO(c))
	}
	return catalog
}

// quizSessionToDTO copia la sesión sin interpretarla. `pass_threshold` y `weight`
// salen como `string` decimal sin tocarse (Principio VIII), igual que en `quizToDTO`.
func quizSessionToDTO(s *learningv1.QuizSession) QuizSession {
	questions := make([]Question, 0, len(s.GetQuestions()))
	for _, question := range s.GetQuestions() {
		options := make([]Option, 0, len(question.GetOptions()))
		for _, opt := range question.GetOptions() {
			options = append(options, Option{Key: opt.GetKey(), Text: opt.GetText()})
		}
		questions = append(questions, Question{
			QuestionID: question.GetQuestionId(),
			Prompt:     question.GetPrompt(),
			Options:    options,
			Weight:     question.GetWeight(),
		})
	}
	return QuizSession{
		SessionID:     s.GetSessionId(),
		QuizID:        s.GetQuizId(),
		Title:         s.GetTitle(),
		PassThreshold: s.GetPassThreshold(),
		ExpiresAt:     s.GetExpiresAt(),
		Questions:     questions,
	}
}

func quizToDTO(q *learningv1.Quiz) Quiz {
	questions := make([]Question, 0, len(q.GetQuestions()))
	for _, question := range q.GetQuestions() {
		options := make([]Option, 0, len(question.GetOptions()))
		for _, opt := range question.GetOptions() {
			options = append(options, Option{Key: opt.GetKey(), Text: opt.GetText()})
		}
		questions = append(questions, Question{
			QuestionID: question.GetQuestionId(),
			Prompt:     question.GetPrompt(),
			Options:    options,
			Weight:     question.GetWeight(),
		})
	}
	return Quiz{
		QuizID:           q.GetQuizId(),
		ArticleID:        q.GetArticleId(),
		Title:            q.GetTitle(),
		PassThreshold:    q.GetPassThreshold(),
		QuestionsToServe: q.GetQuestionsToServe(),
		Questions:        questions,
	}
}

// rawJSON convierte el documento de bloques —que viaja como texto JSON en el proto— en
// un `json.RawMessage` para que el borde lo emita como documento y no como cadena.
//
// La cadena vacía (versión anterior al documento de bloques) sale como `nil`, que con
// `omitempty` desaparece del JSON: el cliente ve que no hay documento, en vez de un
// documento vacío que diría «esta versión tiene un cuerpo sin bloques». La distinción
// importa porque las dos cosas no son lo mismo para quien lee.
//
// Si el texto no fuera JSON válido se descarta en vez de reventar la respuesta: un
// documento mal formado en la base es un fallo de la capa de escritura —que lo valida al
// guardar—, y tumbar la LECTURA por eso convertiría un dato malo en una pantalla en
// blanco. Se pierde el documento y el cliente cae a `body`, que sigue estando.
func rawJSON(doc string) json.RawMessage {
	if doc == "" || !json.Valid([]byte(doc)) {
		return nil
	}
	return json.RawMessage(doc)
}

// bodyDocJSON es la dirección de ENTRADA del documento de bloques (T131): el cuerpo REST
// llega como objeto y en el proto el campo es una cadena que contiene JSON.
//
// Acepta las dos formas a propósito. El proto declara una cadena —decisión documentada en
// `learning.proto`: el borde transporta el documento sin interpretarlo—, así que un cliente
// que copie el proto manda una cadena con JSON dentro y otro que copie el OpenAPI manda el
// objeto; si aquí solo se aceptara una, la otra fallaría con un error sobre JSON en vez de
// sobre el documento. Con la cadena se DESENVUELVE el nivel de comillas: pasarla tal cual
// metería `"{\"tipo\":…}"` en el campo del proto y Aprendizaje lo rechazaría por no ser
// JSON legible, con un mensaje que no diría por qué.
//
// Lo que NO hace: no valida el documento. El vocabulario cerrado se comprueba en
// Aprendizaje, en un solo sitio (D-14); aquí solo se decide de qué forma viaja.
func bodyDocJSON(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}

	var texto string
	if err := json.Unmarshal(raw, &texto); err == nil {
		// Venía como cadena: se devuelve su contenido si a su vez es JSON, y vacío si no,
		// para no mandar basura que Aprendizaje rechazaría con un error peor.
		if texto == "" || !json.Valid([]byte(texto)) {
			return ""
		}
		return texto
	}

	if !json.Valid(raw) {
		return ""
	}
	return string(raw)
}

func versionToDTO(v *learningv1.ArticleVersion) ArticleVersion {
	return ArticleVersion{
		VersionID:   v.GetVersionId(),
		ArticleID:   v.GetArticleId(),
		VersionNo:   v.GetVersionNo(),
		State:       v.GetState(),
		CreatedBy:   v.GetCreatedBy(),
		ApprovedBy:  v.GetApprovedBy(),
		CreatedAt:   v.GetCreatedAt(),
		PublishedAt: v.GetPublishedAt(),
		Body:        v.GetBody(),
		BodyDoc:     rawJSON(v.GetBodyDoc()),
	}
}

// questionInputsToProto ≡ `QuestionInput` (DTO, con `correct_key`) → `QuestionInput`
// (proto). A diferencia del resto de este archivo, aquí SÍ cruza una clave correcta:
// quien manda un `UpsertQuizRequest` es quien la escribió, y `GetQuiz`/`quizToDTO`
// —la ruta de LECTURA— sigue sin devolverla nunca.
func questionInputsToProto(items []QuestionInput) []*learningv1.QuestionInput {
	out := make([]*learningv1.QuestionInput, 0, len(items))
	for _, q := range items {
		out = append(out, &learningv1.QuestionInput{
			Prompt:     q.Prompt,
			Options:    q.Options,
			CorrectKey: q.CorrectKey,
			Weight:     q.Weight,
		})
	}
	return out
}

// defaultQuestionsToServe es el defecto de FR-037: si el editor no envía el campo,
// cada intento sirve 5 preguntas. Vive en el borde porque es un defecto de la
// superficie REST (un cuerpo que no trae el campo), no una regla de Aprendizaje.
const defaultQuestionsToServe int32 = 5

// questionsToServeOr resuelve el campo ausente al defecto. Un `0` es «ausente» en un
// `int32` de JSON sin puntero; un valor negativo SÍ se deja pasar para que Aprendizaje
// lo rechace como `invalid_argument` (FR-037) en lugar de normalizarlo en silencio.
func questionsToServeOr(n int32) int32 {
	if n == 0 {
		return defaultQuestionsToServe
	}
	return n
}

// quizGradeToDTO copia `score` SIN tocarlo (Principio VIII).
func quizGradeToDTO(g *orchestratorv1.QuizGradingResult) QuizGradeResult {
	return QuizGradeResult{
		AttemptID:   g.GetAttemptId(),
		AttemptNo:   g.GetAttemptNo(),
		Score:       g.GetScore(),
		Passed:      g.GetPassed(),
		PointsAfter: g.GetPointsAfter(),
	}
}

func simulationToDTO(s *orchestratorv1.SimulationResult) SimulationResult {
	// La procedencia se reenvía tal cual (FR-050, FR-058): la versión de la definición con la
	// que se calculó y los valores de indicador que se usaron ese día. El borde no los
	// interpreta ni los reformatea —son cadenas decimales— y los normaliza a mapa vacío para que
	// el cliente no tenga que distinguir «sin indicadores» de «campo ausente», igual que hace el
	// historial.
	return SimulationResult{
		SimulationID:      s.GetSimulationId(),
		Result:            s.GetResult(),
		CalculatorVersion: s.GetCalculatorVersion(),
		IndicatorsUsed:    emptyMapIfNil(s.GetIndicatorsUsed()),
	}
}

func historyEntryToDTO(e *simulatorv1.ListHistoryResponse_Entry) SimulationHistoryEntry {
	return SimulationHistoryEntry{
		SimulationID:      e.GetSimulationId(),
		CalcType:          calcTypePathName(e.GetCalcType()),
		Currency:          e.GetCurrency(),
		Inputs:            e.GetInputs(),
		Result:            e.GetResult(),
		CreatedAt:         e.GetCreatedAt(),
		CalculatorID:      e.GetCalculatorId(),
		CalculatorVersion: e.GetCalculatorVersion(),
		// Un mapa vacío es `{}` y nunca `null`, por el mismo motivo que las listas de
		// `listaNoNula`: el cliente que recorre la procedencia no tiene que distinguir
		// «sin indicadores» de «campo ausente».
		IndicatorsUsed: emptyMapIfNil(e.GetIndicatorsUsed()),
	}
}

// emptyMapIfNil normaliza un mapa nil a uno vacío.
//
// `json.Marshal` de un mapa nil produce `null`, y `Object.entries(null)` falla en el
// cliente. Es el mismo caso que cubre `listaNoNula` para los slices, con un mapa.
func emptyMapIfNil[K comparable, V any](m map[K]V) map[K]V {
	if m == nil {
		return map[K]V{}
	}
	return m
}

// inAppToDTO convierte un elemento de la bandeja (FR-023).
//
// `payload_json` se reemite como JSON anidado y no como una cadena con JSON dentro:
// obligar al cliente a un segundo `JSON.parse` es una fuente conocida de errores. Se
// valida antes de incrustarlo — un payload corrupto haría inválida TODA la respuesta,
// convirtiendo un dato malo en una página en blanco, así que en ese caso se omite.
//
// El campo extiende `components.schemas.InAppNotification` del OpenAPI, que solo
// declara id/type/read_state/created_at. Se añade porque una bandeja que muestra el
// tipo pero no el contenido no cumple FR-023; queda anotado para la revisión del
// contrato.
func inAppToDTO(item *usersv1.ListInAppResponse_Item) InAppNotification {
	dto := InAppNotification{
		ID:        item.GetId(),
		Type:      item.GetType(),
		ReadState: item.GetReadState(),
		CreatedAt: item.GetCreatedAt(),
	}
	if raw := item.GetPayloadJson(); raw != "" && json.Valid([]byte(raw)) {
		dto.Payload = json.RawMessage(raw)
	}
	return dto
}

// attemptToDTO copia `score` SIN tocarlo (Principio VIII), igual que `quizGradeToDTO`.
func attemptToDTO(a *learningv1.ListAttemptsResponse_Attempt) QuizAttempt {
	return QuizAttempt{
		AttemptID: a.GetAttemptId(),
		AttemptNo: a.GetAttemptNo(),
		Score:     a.GetScore(),
		CreatedAt: a.GetCreatedAt(),
	}
}

func opToDTO(op *commonv1.OpResult) OpAck {
	return OpAck{Success: op.GetSuccess(), Code: op.GetCode(), Message: op.GetMessage()}
}

// ── traducción del enum de cálculo ──────────────────────────────────────────

// calcTypeByPath traduce el segmento `{calcType}` de la URL al enum del contrato.
//
// La tabla es explícita en lugar de derivarse del nombre del enum. Derivarla
// —quitar el prefijo `CALC_TYPE_` y pasar a minúsculas— acoplaría la URL PÚBLICA al
// nombre interno del símbolo: renombrar un valor del enum cambiaría en silencio una
// ruta que ya está en producción.
var calcTypeByPath = map[string]simulatorv1.CalcType{
	"ahorro":              simulatorv1.CalcType_CALC_TYPE_AHORRO,
	"credito":             simulatorv1.CalcType_CALC_TYPE_CREDITO,
	"presupuesto":         simulatorv1.CalcType_CALC_TYPE_PRESUPUESTO,
	"inversion":           simulatorv1.CalcType_CALC_TYPE_INVERSION,
	"colombia_especifica": simulatorv1.CalcType_CALC_TYPE_COLOMBIA_ESPECIFICA,
}

// calcTypeFromPath resuelve el tipo de cálculo o falla con 400.
//
// Un valor desconocido DEBE ser un error del borde. Si se dejara pasar como el valor
// cero del enum, el Simulador recibiría `CALC_TYPE_UNSPECIFIED` y, en el mejor de los
// casos, devolvería un error confuso; en el peor, alguna implementación futura lo
// interpretaría como «el primero de la lista» y el usuario obtendría el resultado de
// una calculadora que no pidió.
func calcTypeFromPath(segment string) (simulatorv1.CalcType, error) {
	calcType, ok := calcTypeByPath[segment]
	if !ok {
		return simulatorv1.CalcType_CALC_TYPE_UNSPECIFIED,
			fmt.Errorf("%w: tipo de cálculo desconocido: %q", errBadRequest, segment)
	}
	return calcType, nil
}

// calcTypePathName es la inversa, para las respuestas del historial.
func calcTypePathName(calcType simulatorv1.CalcType) string {
	for name, value := range calcTypeByPath {
		if value == calcType {
			return name
		}
	}
	return ""
}

// ── paginación ──────────────────────────────────────────────────────────────

// defaultPageSize y maxPageSize acotan los listados.
//
// El tope existe para que el tamaño de página no sea un vector de amplificación: sin
// él, `?page_size=1000000` haría que una petición barata para el cliente costara una
// consulta enorme al servicio interno.
const (
	defaultPageSize int32 = 20
	maxPageSize     int32 = 100
)

// pageRequestFrom traduce `?page_size=&page_token=` al `PageRequest` del contrato.
//
// Un `page_size` ilegible o fuera de rango se AJUSTA en silencio en lugar de dar 400:
// la paginación es un detalle de presentación y rechazar la petición entera por un
// parámetro cosmético empeora la experiencia sin proteger nada. La contrapartida —que
// el cliente reciba una página de tamaño distinto al pedido— es visible en la propia
// respuesta.
func pageRequestFrom(r *http.Request) *commonv1.PageRequest {
	size := defaultPageSize
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 32); err == nil && parsed > 0 {
			size = min(int32(parsed), maxPageSize)
		}
	}
	return &commonv1.PageRequest{
		PageSize:  size,
		PageToken: r.URL.Query().Get("page_token"),
	}
}

// pageOf arma la envoltura paginada de una respuesta.
//
// `items` se normaliza a un slice vacío y nunca se deja en `nil`: `json.Marshal` de un
// slice nil produce `null`, y un cliente que haga `data.items.map(...)` sobre `null`
// falla. Una lista vacía es `[]`.
func pageOf[T any](items []T, page *commonv1.PageResponse) Page[T] {
	if items == nil {
		items = []T{}
	}
	return Page[T]{
		Items:         items,
		NextPageToken: page.GetNextPageToken(),
		TotalSize:     page.GetTotalSize(),
	}
}

// ── error → respuesta HTTP ──────────────────────────────────────────────────

// writeGRPCError traduce el error de un servicio interno a una respuesta del borde.
//
// El mensaje que sale es fijo por código y NUNCA el del error: el `status.Message()` de
// un servicio interno puede contener nombres de host, de tabla o el detalle del driver
// —y el borde es exactamente la frontera donde eso no debe cruzar. El error completo va
// al log, que sí tiene el contexto de la petición.
func (h *Handler) writeGRPCError(w http.ResponseWriter, r *http.Request, err error) {
	// Los fallos detectados en el propio borde, antes de llamar a nadie.
	switch {
	case errors.Is(err, errBadRequest):
		// El detalle SÍ sale, al contrario que en el camino de abajo, y la diferencia no
		// es un descuido: este error lo redacta el borde a partir de la entrada del
		// cliente, así que no puede llevar dentro nombres de host, de tabla ni detalle del
		// driver —que es de lo que protege el mensaje fijo de `httpFromGRPC`—. Aplanarlo
		// aquí no protegía de nada y además lo hacía invisible: esta rama retorna ANTES
		// del bloque de log, de modo que el detalle no quedaba ni en el registro.
		//
		// Los mensajes se componen con `fmt.Errorf("%w: …", errBadRequest, …)` y el valor
		// del cliente va con `%q`, que escapa lo que haga falta: reflejar la entrada de
		// quien llama es seguro y es justo lo que necesita para corregirla.
		h.logEdgeError(r, err)
		writeError(w, http.StatusBadRequest, "bad_request", edgeMessage(err))
		return
	case errors.Is(err, errUnauthorized):
		writeError(w, http.StatusUnauthorized, "unauthenticated", "no autenticado")
		return
	case errors.Is(err, errImageTooLarge):
		// El detalle sale igual que en `errBadRequest` y por el mismo motivo: lo redacta el
		// borde a partir de la entrada del cliente, así que no lleva nombres de host ni
		// detalle del driver. Quien sube una foto de 4 MB necesita saber el tope.
		h.logEdgeError(r, err)
		writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", edgeMessage(err))
		return
	case errors.Is(err, errUnsupportedMedia):
		h.logEdgeError(r, err)
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", edgeMessage(err))
		return
	}

	code := status.Code(err)
	httpStatus, errCode, message := httpFromGRPC(code)

	// Un error de la familia «la petición no vale» (400) SÍ lleva su mensaje al cliente.
	//
	// ## Por qué el mensaje genérico era un defecto y no una precaución
	//
	// `httpFromGRPC` devuelve textos fijos para no filtrar detalle interno, y ese criterio es
	// correcto para un 5xx: el cliente no puede hacer nada con «pq: relation … does not exist» y
	// ahí sí hay algo que proteger. En un 4xx no lo es, y se comprobó con una ejecución real: una
	// calculadora con la regla `monto > 1000` y el mensaje «El monto tiene que superar 1000»
	// respondía `{"code":"bad_request","message":"petición inválida"}` — el autor había escrito
	// exactamente lo que había que decirle al usuario, FR-044 y FR-045 exigen decir **qué campo y
	// por qué**, y el borde lo tiraba a la basura para poner una frase que no informa de nada.
	//
	// Los servicios ya sanean lo suyo por su cuenta: cada uno mapea sus fallos técnicos a
	// `Internal` con un texto fijo («error interno», «fallo de persistencia»), así que lo que
	// viaja en un `InvalidArgument` es, por construcción, texto escrito para quien llama. Ese es
	// el reparto de responsabilidades: el servicio decide QUÉ se puede contar, el borde decide el
	// CÓDIGO.
	//
	// ## Por qué solo esta familia
	//
	// 401, 403, 404, 409 y 429 conservan su texto fijo. Sus mensajes genéricos sí informan —«no
	// autenticado», «acceso denegado», «recurso no encontrado»— y varias pantallas ya escriben su
	// propia versión para ellos; pasarlos tal cual pondría delante del usuario el prefijo interno
	// de cada servicio («simulador: no encontrado»). La familia 400 es distinta: su texto genérico
	// no dice nada y no hay otro sitio del que sacar el motivo.
	if httpStatus == http.StatusBadRequest {
		if st, ok := status.FromError(err); ok && st.Message() != "" {
			message = st.Message()
		}
	}

	// Un 5xx se registra como error y un 4xx como advertencia: el primero es un
	// problema nuestro y debe alertar, el segundo es un cliente equivocado y no.
	level := slog.LevelWarn
	if httpStatus >= http.StatusInternalServerError {
		level = slog.LevelError
	}
	h.logger.LogAttrs(r.Context(), level, "error de servicio interno",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("grpc_code", code.String()),
		slog.String("error", err.Error()),
	)

	writeError(w, httpStatus, errCode, message)
}

// edgeMessage extrae el detalle de un error compuesto por el propio borde.
//
// Los errores del borde se escriben `fmt.Errorf("%w: …", errBadRequest, …)`, así que su
// texto lleva dentro el del centinela. Se quita ESA aparición y se conserva todo lo demás:
// el prefijo que añade un envoltorio —`definitionFromDTO` compone
// `inputs[1].type: <el error del tipo>`— es contexto útil, y quedarse solo con lo que sigue
// al centinela lo perdería.
//
// El resultado de un envoltorio anidado es `inputs[1].type: tipo de entrada desconocido:
// "porcentaje"`: se lee entero y nombra el campo. Lo que desaparece es «handler: petición
// inválida», que no le dice nada al cliente y nombra un paquete que no es asunto suyo.
//
// Cae al texto genérico cuando no queda nada —un `errBadRequest` desnudo—, porque una
// cadena vacía en el cuerpo del error es peor que un mensaje que al menos dice que la
// petición no valía.
func edgeMessage(err error) string {
	const centinela = "handler: petición inválida"
	detalle := strings.Replace(err.Error(), centinela+": ", "", 1)
	if detalle == "" || detalle == centinela {
		return "petición inválida"
	}
	return detalle
}

// logEdgeError registra un rechazo del borde.
//
// Va a `warn` y no a `error`: un 400 es un cliente equivocado y no un problema nuestro, que
// es el mismo criterio que usa el camino de los servicios internos. Se registra porque un
// rechazo sin rastro es lo que hace imposible responder a «¿por qué me da 400?».
func (h *Handler) logEdgeError(r *http.Request, err error) {
	h.logger.LogAttrs(r.Context(), slog.LevelWarn, "petición rechazada en el borde",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("error", err.Error()),
	)
}

// httpFromGRPC es la tabla de traducción de códigos.
//
// `Unavailable` → 503 y `DeadlineExceeded` → 504 son los dos que más importan: los dos
// significan «vuelve a intentarlo», y colapsarlos en un 500 haría que un cliente bien
// escrito no reintentara cuando debería.
func httpFromGRPC(code codes.Code) (int, string, string) {
	switch code {
	case codes.OK:
		return http.StatusOK, "", ""
	case codes.InvalidArgument, codes.OutOfRange, codes.FailedPrecondition:
		return http.StatusBadRequest, "bad_request", "petición inválida"
	case codes.Unauthenticated:
		return http.StatusUnauthorized, "unauthenticated", "no autenticado"
	case codes.PermissionDenied:
		return http.StatusForbidden, "forbidden", "acceso denegado"
	case codes.NotFound:
		return http.StatusNotFound, "not_found", "recurso no encontrado"
	case codes.AlreadyExists, codes.Aborted:
		return http.StatusConflict, "conflict", "conflicto con el estado actual"
	case codes.ResourceExhausted:
		return http.StatusTooManyRequests, "rate_limited", "demasiadas peticiones"
	case codes.Unimplemented:
		return http.StatusNotImplemented, "not_implemented", "operación no disponible"
	case codes.Unavailable:
		return http.StatusServiceUnavailable, "unavailable", "servicio no disponible"
	case codes.DeadlineExceeded:
		return http.StatusGatewayTimeout, "timeout", "el servicio no respondió a tiempo"
	default:
		return http.StatusInternalServerError, "internal", "error interno"
	}
}

// ── constructor de calculadoras ─────────────────────────────────────────────

// inputTypeByPath es el vocabulario del borde para el tipo de una entrada.
//
// Es la misma tabla que `calcTypeByPath` y por la misma razón: el entero del enum es un
// detalle del transporte gRPC. Va como mapa y no como `switch` para que la inversa
// —`inputTypePathName`— se recorra sola y las dos direcciones no puedan desincronizarse.
var inputTypeByPath = map[string]simulatorv1.InputType{
	"monto":  simulatorv1.InputType_INPUT_TYPE_MONTO,
	"tasa":   simulatorv1.InputType_INPUT_TYPE_TASA,
	"entero": simulatorv1.InputType_INPUT_TYPE_ENTERO,
}

// inputTypeFromPath resuelve el tipo de una entrada o falla con 400.
//
// Un tipo desconocido es un error del BORDE y no se deja pasar como el valor cero del
// enum: `INPUT_TYPE_UNSPECIFIED` llegaría al Simulador y allí significaría «el cliente
// olvidó el campo», que es un diagnóstico distinto y peor que «el cliente escribió un
// tipo que no existe».
func inputTypeFromPath(name string) (simulatorv1.InputType, error) {
	kind, ok := inputTypeByPath[name]
	if !ok {
		return simulatorv1.InputType_INPUT_TYPE_UNSPECIFIED,
			fmt.Errorf("%w: tipo de entrada desconocido: %q", errBadRequest, name)
	}
	return kind, nil
}

// inputTypePathName es la inversa, para las respuestas.
func inputTypePathName(kind simulatorv1.InputType) string {
	for name, value := range inputTypeByPath {
		if value == kind {
			return name
		}
	}
	return ""
}

func calculatorToDTO(c *simulatorv1.Calculator) Calculator {
	return Calculator{
		CalculatorID:    c.GetCalculatorId(),
		OwnerID:         c.GetOwnerId(),
		Name:            c.GetName(),
		Description:     c.GetDescription(),
		IsBuiltin:       c.GetIsBuiltin(),
		State:           c.GetState(),
		ApprovedBy:      c.GetApprovedBy(),
		RejectionReason: c.GetRejectionReason(),
		Version:         c.GetVersion(),
		Definition:      definitionToDTO(c.GetDefinition()),
		IndicatorsUsed:  listaNoNula(c.GetIndicatorsUsed()),
	}
}

func calculatorsToDTO(items []*simulatorv1.Calculator) []Calculator {
	out := make([]Calculator, 0, len(items))
	for _, c := range items {
		out = append(out, calculatorToDTO(c))
	}
	return out
}

func definitionToDTO(d *simulatorv1.CalculatorDefinition) CalculatorDef {
	if d == nil {
		return CalculatorDef{}
	}

	inputs := make([]CalculatorInput, 0, len(d.GetInputs()))
	for _, in := range d.GetInputs() {
		inputs = append(inputs, CalculatorInput{
			Key:          in.GetKey(),
			Label:        in.GetLabel(),
			Type:         inputTypePathName(in.GetType()),
			Unit:         in.GetUnit(),
			MinValue:     in.GetMinValue(),
			MaxValue:     in.GetMaxValue(),
			DefaultValue: in.GetDefaultValue(),
			Required:     in.GetRequired(),
		})
	}

	validations := make([]CalculatorRule, 0, len(d.GetValidations()))
	for _, v := range d.GetValidations() {
		validations = append(validations, CalculatorRule{
			Expression: v.GetExpression(),
			Message:    v.GetMessage(),
		})
	}

	outputs := make([]CalculatorResult, 0, len(d.GetOutputs()))
	for _, o := range d.GetOutputs() {
		outputs = append(outputs, CalculatorResult{
			Key:        o.GetKey(),
			Label:      o.GetLabel(),
			Expression: o.GetExpression(),
			Scale:      o.GetScale(),
			When:       o.GetWhen(),
		})
	}

	return CalculatorDef{Inputs: inputs, Validations: validations, Outputs: outputs}
}

// definitionFromDTO traduce la definición que envía el constructor.
//
// Los escalares van tal cual y NO se reinterpretan: `min_value` es una cadena decimal y
// el Gateway no la convierte a `float64` para «comprobarla». El Simulador la analiza con
// `decimal_str`, y duplicar esa validación aquí rompería el Principio VIII en el borde
// —que es exactamente donde el comentario de `RunSimulation` dice que no debe romperse—.
//
// # Errores
//
// `errBadRequest` si un tipo de entrada no está en el vocabulario. El error se compone
// con `location` —`inputs[1].type`— porque un «tipo desconocido» a secas, con veinte
// entradas declaradas, obliga a buscarlas a ojo. **Hoy esa ubicación no llega al cliente**:
// `writeGRPCError` aplana los errores del borde al texto fijo de `errBadRequest`. Se
// compone igualmente porque es la información correcta y porque el día que el borde deje de
// aplanar sus propios errores —ver la nota de `TestAnUnknownInputTypeIsRejectedAtTheEdge`—
// no habrá que volver a este sitio.
func definitionFromDTO(d CalculatorDef) (*simulatorv1.CalculatorDefinition, error) {
	inputs := make([]*simulatorv1.CalculatorInput, 0, len(d.Inputs))
	for i, in := range d.Inputs {
		kind, err := inputTypeFromPath(in.Type)
		if err != nil {
			return nil, fmt.Errorf("inputs[%d].type: %w", i, err)
		}
		inputs = append(inputs, &simulatorv1.CalculatorInput{
			Key:          in.Key,
			Label:        in.Label,
			Type:         kind,
			Unit:         in.Unit,
			MinValue:     in.MinValue,
			MaxValue:     in.MaxValue,
			DefaultValue: in.DefaultValue,
			Required:     in.Required,
		})
	}

	validations := make([]*simulatorv1.CalculatorValidation, 0, len(d.Validations))
	for _, v := range d.Validations {
		validations = append(validations, &simulatorv1.CalculatorValidation{
			Expression: v.Expression,
			Message:    v.Message,
		})
	}

	outputs := make([]*simulatorv1.CalculatorOutput, 0, len(d.Outputs))
	for _, o := range d.Outputs {
		outputs = append(outputs, &simulatorv1.CalculatorOutput{
			Key:        o.Key,
			Label:      o.Label,
			Expression: o.Expression,
			Scale:      o.Scale,
			When:       o.When,
		})
	}

	return &simulatorv1.CalculatorDefinition{
		Inputs:      inputs,
		Validations: validations,
		Outputs:     outputs,
	}, nil
}

// issuesToDTO copia los problemas del análisis sin reinterpretarlos.
//
// Ni `location` ni `code` se traducen: el vocabulario de códigos lo definió el contrato
// (`campo_inexistente`, `limite_excedido`, …) y es el mismo que el constructor visual usa
// para decidir dónde poner el resaltado. Traducirlo aquí obligaría al cliente a mantener
// dos tablas y al borde a conocer el significado de cada código, que es una decisión de
// dominio y no de representación.
func issuesToDTO(errors []*simulatorv1.DefinitionError) []DefinitionIssue {
	out := make([]DefinitionIssue, 0, len(errors))
	for _, e := range errors {
		out = append(out, DefinitionIssue{
			Location: e.GetLocation(),
			Code:     e.GetCode(),
			Message:  e.GetMessage(),
		})
	}
	return out
}

// ── indicadores financieros (T107) ──────────────────────────────────────────

func indicatorToDTO(i *simulatorv1.Indicator) Indicator {
	return Indicator{
		IndicatorID:  i.GetIndicatorId(),
		Name:         i.GetName(),
		Value:        i.GetValue(),
		ValidFrom:    i.GetValidFrom(),
		ValidTo:      i.GetValidTo(),
		RegisteredBy: i.GetRegisteredBy(),
	}
}

func indicatorsToDTO(items []*simulatorv1.Indicator) []Indicator {
	out := make([]Indicator, 0, len(items))
	for _, i := range items {
		out = append(out, indicatorToDTO(i))
	}
	return out
}

func calendarStatusToDTO(s *simulatorv1.IndicatorCalendarStatus) CalendarStatus {
	expiring := make([]ExpiringIndicator, 0, len(s.GetExpiring()))
	for _, e := range s.GetExpiring() {
		expiring = append(expiring, ExpiringIndicator{
			Name:          e.GetName(),
			ValidTo:       e.GetValidTo(),
			DaysRemaining: e.GetDaysRemaining(),
		})
	}

	return CalendarStatus{
		MissingNames: listaNoNula(s.GetMissingNames()),
		Expiring:     expiring,
	}
}
