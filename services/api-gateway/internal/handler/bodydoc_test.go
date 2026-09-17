package handler

import (
	"encoding/json"
	"strconv"
	"testing"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
)

// El documento de bloques cruza el borde (FR-063, research D-14).
//
// Estas pruebas fijan la DECISIÓN DE FORMA, que es lo único que el Gateway decide aquí:
// en el proto el documento viaja como texto JSON —para que el vocabulario cerrado se
// valide en un solo sitio, en Aprendizaje— y en la salida REST tiene que salir como
// documento y no como una cadena escapada. Si saliera como cadena, el lector recibiría
// un texto que tendría que volver a analizar, con lo que el borde habría convertido un
// árbol en una cadena para que el cliente lo vuelva a convertir en árbol.
func TestRawJSON(t *testing.T) {
	t.Run("un documento válido se emite como documento", func(t *testing.T) {
		doc := `{"tipo":"doc","contenido":[{"tipo":"parrafo"}]}`
		raw := rawJSON(doc)
		if raw == nil {
			t.Fatal("un documento válido no debería descartarse")
		}
		if got := string(raw); got != doc {
			t.Fatalf("el documento cambió al pasar por el borde: %s", got)
		}
		// Y al serializar la respuesta sale SIN comillas alrededor: es un objeto.
		out, err := json.Marshal(struct {
			BodyDoc json.RawMessage `json:"body_doc"`
		}{raw})
		if err != nil {
			t.Fatalf("serializar: %v", err)
		}
		if want := `{"body_doc":` + doc + `}`; string(out) != want {
			t.Fatalf("el JSON de salida no lleva el documento como objeto:\n got %s\nwant %s", out, want)
		}
	})

	t.Run("la cadena vacía se descarta, no se convierte en documento vacío", func(t *testing.T) {
		// Distinguir «no hay documento» de «documento vacío» importa: el proto usa la
		// cadena vacía para la versión anterior al documento de bloques, y un documento
		// vacío diría «esta versión tiene un cuerpo sin bloques», que es otra cosa.
		if raw := rawJSON(""); raw != nil {
			t.Fatalf("la cadena vacía debería descartarse, llegó %q", raw)
		}
	})

	t.Run("un documento mal formado se descarta en vez de tumbar la lectura", func(t *testing.T) {
		// Un documento inválido en la base es un fallo de la capa de escritura, que lo
		// valida al guardar. Convertirlo en un 500 al LEER transformaría un dato malo en
		// una pantalla en blanco, que es peor para quien lo sufre.
		for _, malo := range []string{"{", "no es json", `{"tipo":}`, "[1,2"} {
			if raw := rawJSON(malo); raw != nil {
				t.Fatalf("%q debería descartarse, llegó %q", malo, raw)
			}
		}
	})
}

func TestArticleToDTOIncluyeElDocumento(t *testing.T) {
	doc := `{"tipo":"doc","contenido":[{"tipo":"parrafo","contenido":[{"tipo":"texto","texto":"Hola"}]}]}`
	article := &learningv1.Article{
		ArticleId: "11111111-1111-4111-8111-111111111111",
		Title:     "Ahorro",
		Body:      "Hola",
		BodyDoc:   doc,
	}

	dto := articleToDTO(article)
	if got := string(dto.BodyDoc); got != doc {
		t.Fatalf("el artículo perdió el documento: %q", got)
	}
	if dto.Body != "Hola" {
		t.Fatalf("el cuerpo de texto sigue siendo la fuente de respaldo y no debe perderse: %q", dto.Body)
	}
}

func TestArticleToDTOParaUnaVersionSinDocumento(t *testing.T) {
	// Una versión publicada antes de que existiera la columna: `body` sigue estando y
	// `body_doc` tiene que quedar ausente del JSON para que el cliente sepa que tiene
	// que caer al texto.
	article := &learningv1.Article{ArticleId: "11111111-1111-4111-8111-111111111111", Body: "Solo texto"}
	dto := articleToDTO(article)

	if dto.BodyDoc != nil {
		t.Fatalf("sin documento, `body_doc` debería quedar ausente, llegó %q", dto.BodyDoc)
	}
	out, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("serializar: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(out, &decoded); err != nil {
		t.Fatalf("deserializar: %v", err)
	}
	if _, present := decoded["body_doc"]; present {
		t.Fatal("`body_doc` no debería aparecer cuando no hay documento")
	}
	if decoded["body"] != "Solo texto" {
		t.Fatalf("el cuerpo de texto debería seguir viajando: %v", decoded["body"])
	}
}

func TestVersionToDTOIncluyeElDocumento(t *testing.T) {
	doc := `{"tipo":"doc","contenido":[]}`
	version := &learningv1.ArticleVersion{
		VersionId: "22222222-2222-4222-8222-222222222222",
		Body:      "",
		BodyDoc:   doc,
	}

	if got := string(versionToDTO(version).BodyDoc); got != doc {
		t.Fatalf("la versión perdió el documento: %q", got)
	}
}

// La dirección de ENTRADA del documento (T131): el editor manda bloques y el borde decide
// solo de qué forma viajan.
func TestBodyDocJSON(t *testing.T) {
	t.Run("un objeto pasa tal cual", func(t *testing.T) {
		doc := `{"tipo":"doc","contenido":[{"tipo":"parrafo"}]}`
		if got := bodyDocJSON(json.RawMessage(doc)); got != doc {
			t.Fatalf("el objeto cambió al pasar por el borde: %s", got)
		}
	})

	t.Run("una cadena con JSON dentro se DESENVUELVE", func(t *testing.T) {
		// Es la forma que sugiere el proto, donde el campo es una cadena. Sin desenvolver
		// el nivel de comillas, en el campo llegaría `"{\"tipo\":…}"` y Aprendizaje lo
		// rechazaría «por no ser JSON legible» sin decir por qué.
		doc := `{"tipo":"doc","contenido":[]}`
		if got := bodyDocJSON(json.RawMessage(strconv.Quote(doc))); got != doc {
			t.Fatalf("la cadena no se desenvolvió: %q", got)
		}
	})

	t.Run("sin documento, la cadena vacía del proto", func(t *testing.T) {
		for _, ausente := range []json.RawMessage{nil, {}, json.RawMessage(`null`), json.RawMessage(`""`)} {
			if got := bodyDocJSON(ausente); got != "" {
				t.Fatalf("«no lo mandaron» debe llegar como cadena vacía, llegó %q", got)
			}
		}
	})

	t.Run("una cadena con basura dentro no se manda", func(t *testing.T) {
		// Mandarla haría que Aprendizaje fallara con «body_doc no es JSON legible», que es
		// un mensaje sobre el análisis y no sobre el documento. Vacío significa «no hay
		// documento» y el cuerpo heredado sigue funcionando.
		for _, basura := range []string{"{no es json}", "no es json", `{"tipo":}`} {
			if got := bodyDocJSON(json.RawMessage(strconv.Quote(basura))); got != "" {
				t.Fatalf("%q no debería mandarse, llegó %q", basura, got)
			}
		}
	})
}

// TestListaNoNula: una lista vacía tiene que salir como `[]`, no como `null`.
//
// La diferencia no es estética. `null` rompe a la vez el tipo que documenta el contrato y
// cualquier `campo.length` de quien lo consuma — y en una plantilla de Angular ese error no
// deja ese dato sin pintar: deja la pantalla entera en blanco. Se descubrió con un artículo
// SIN cuestionario, cuyo `quiz_ids: null` borraba el artículo completo del lector.
func TestListaNoNula(t *testing.T) {
	t.Parallel()

	if got := listaNoNula[string](nil); got == nil || len(got) != 0 {
		t.Fatalf("una lista nula tiene que salir como lista vacía, salió %#v", got)
	}
	// Y una lista con contenido se devuelve igual: la normalización no copia ni reordena.
	original := []string{"a", "b"}
	if got := listaNoNula(original); len(got) != 2 || got[0] != "a" {
		t.Fatalf("la lista con contenido cambió: %#v", got)
	}
}
