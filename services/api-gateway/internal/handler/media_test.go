package handler_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Subida y lectura de imágenes en el BORDE (T129, T130, FR-064…FR-067).
//
// Lo que se comprueba aquí es la POLÍTICA DEL BORDE, que es lo único que el Gateway decide:
// los estados 413 y 415 —que HTTP define para «no cabe» y «no lo atiendo»—, que la subida
// exija rol de editor, y que la lectura sea pública y cacheable para siempre. **La validez de
// la imagen no se comprueba aquí**: eso es de Aprendizaje, que abre los bytes con `sharp`, y
// estas pruebas usan un doble del cliente gRPC a propósito para no confundir las dos cosas.
//
// La lectura se prueba SIN credenciales y no por comodidad: es la propiedad que hace que las
// imágenes se vean, porque el `<img src>` del lector no puede mandar `Authorization`.

const testImageID = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678abcdef0123456789abcdef01"

// subida construye un cuerpo multiparte con el archivo y el tipo declarado.
//
// Se usa `CreatePart` con la cabecera explícita y NO `CreateFormFile`: el segundo fija
// `application/octet-stream` y no deja cambiarlo, así que una prueba que quisiera variar el
// tipo declarado estaría midiendo siempre el mismo valor. La cabecera de la parte es
// justamente lo que un cliente real controla, y es lo que el borde mira para el 415.
func subida(t *testing.T, contenido []byte, declarado string) (*bytes.Buffer, string) {
	t.Helper()
	var cuerpo bytes.Buffer
	escritor := multipart.NewWriter(&cuerpo)

	cabecera := textproto.MIMEHeader{}
	cabecera.Set("Content-Disposition", `form-data; name="file"; filename="foto.png"`)
	if declarado == "" {
		cabecera.Set("Content-Type", "application/octet-stream")
	} else {
		cabecera.Set("Content-Type", declarado)
	}
	parte, err := escritor.CreatePart(cabecera)
	require.NoError(t, err)
	_, err = parte.Write(contenido)
	require.NoError(t, err)
	require.NoError(t, escritor.Close())

	return &cuerpo, escritor.FormDataContentType()
}

func (h *harness) doMultipart(
	t *testing.T,
	target string,
	cuerpo *bytes.Buffer,
	contentType string,
	authenticated bool,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, cuerpo)
	req.Header.Set("Content-Type", contentType)
	if authenticated {
		req.Header.Set("Authorization", "Bearer token-de-prueba")
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func TestUploadArticleImageExigeRolDeEditor(t *testing.T) {
	t.Parallel()
	// Un usuario final no escribe artículos: el rol lo exige el borde (FR-081) y el
	// ámbito de propiedad lo impone Aprendizaje contra `article_images.article_id`.
	h := newHarness(t)
	cuerpo, tipo := subida(t, []byte("bytes"), "image/png")

	rec := h.doMultipart(t, "/editorial/articles/"+testArticleID+"/images", cuerpo, tipo, true)

	require.Equal(t, http.StatusForbidden, rec.Code)
}

func TestUploadArticleImageRechazaElTipoDeclaradoNoAdmitido(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleEditor))
	cuerpo, tipo := subida(t, []byte("%PDF-1.7"), "application/pdf")

	rec := h.doMultipart(t, "/editorial/articles/"+testArticleID+"/images", cuerpo, tipo, true)

	// 415 es el estado que corresponde a «el tipo que declaras no lo atiendo». Devolver 400
	// dejaría al cliente sin saber si el problema es el tipo o cualquier otra cosa.
	require.Equal(t, http.StatusUnsupportedMediaType, rec.Code)
	require.Contains(t, decode[handler.ErrorBody](t, rec).Code, "unsupported_media_type")
	// Y el mensaje dice CUÁLES se admiten: sin eso, quien sube no sabe qué hacer.
	require.Contains(t, decode[handler.ErrorBody](t, rec).Message, "image/png")
}

func TestUploadArticleImageRechazaElCuerpoQueNoCabe(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleEditor))
	// 3 MB: por encima del tope de 2 MB más el margen del formulario.
	cuerpo, tipo := subida(t, bytes.Repeat([]byte{0x41}, 3*1024*1024), "image/png")

	rec := h.doMultipart(t, "/editorial/articles/"+testArticleID+"/images", cuerpo, tipo, true)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	require.Equal(t, "payload_too_large", decode[handler.ErrorBody](t, rec).Code)
}

func TestUploadArticleImageRechazaUnCuerpoSinArchivo(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleEditor))
	var cuerpo bytes.Buffer
	escritor := multipart.NewWriter(&cuerpo)
	require.NoError(t, escritor.WriteField("otra_cosa", "x"))
	require.NoError(t, escritor.Close())

	rec := h.doMultipart(t, "/editorial/articles/"+testArticleID+"/images", &cuerpo, escritor.FormDataContentType(), true)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, decode[handler.ErrorBody](t, rec).Message, "file")
}

func TestUploadArticleImageDevuelveLaImagenCreada(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleEditor))
	// El doble de Aprendizaje responde con una imagen: lo que se comprueba es el mapeo y el
	// estado, no la validez del archivo —que es de allí—.
	h.learning.uploadImage = &learningv1.ArticleImage{
		ImageId:   testImageID,
		ArticleId: testArticleID,
		MimeType:  "image/png",
		ByteSize:  "2048",
		Width:     640,
		Height:    480,
	}
	cuerpo, tipo := subida(t, []byte("bytes-de-una-imagen"), "image/png")

	rec := h.doMultipart(t, "/editorial/articles/"+testArticleID+"/images", cuerpo, tipo, true)

	require.Equal(t, http.StatusCreated, rec.Code)
	imagen := decode[handler.ArticleImage](t, rec)
	require.Equal(t, testImageID, imagen.ImageID)
	require.Equal(t, int64(2048), imagen.ByteSize)
	require.Equal(t, int32(640), imagen.Width)
	// Lo que el borde le manda a Aprendizaje: los bytes tal cual y quién sube, tomado de los
	// claims verificados y no de la petición —que es lo que impide que un cliente suba una
	// imagen «como si fuera» otro.
	require.Equal(t, []byte("bytes-de-una-imagen"), h.learning.lastUpload.GetBytes())
	require.Equal(t, "image/png", h.learning.lastUpload.GetMimeType())
	require.Equal(t, testUserID, h.learning.lastUpload.GetUploadedBy())
	require.Equal(t, testArticleID, h.learning.lastUpload.GetArticleId())
}

func TestGetArticleImageEsPublicaYCacheableParaSiempre(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.learning.image = &learningv1.GetArticleImageResponse{
		Image: &learningv1.ArticleImage{ImageId: testImageID, MimeType: "image/webp", ByteSize: "4"},
		Bytes: []byte{0x01, 0x02, 0x03, 0x04},
	}

	// SIN token: es lo que permite que `<img src>` funcione.
	rec := h.do(t, http.MethodGet, "/media/images/"+testImageID, "", false)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "image/webp", rec.Header().Get("Content-Type"))
	// El `ETag` ES el identificador, porque el identificador ES el hash del contenido.
	require.Equal(t, strconv.Quote(testImageID), rec.Header().Get("ETag"))
	// `immutable` solo es honesto porque el hash del contenido no puede devolver otros bytes.
	require.Equal(t, "public, max-age=31536000, immutable", rec.Header().Get("Cache-Control"))
	require.Equal(t, []byte{0x01, 0x02, 0x03, 0x04}, rec.Body.Bytes())
}

func TestGetArticleImageResponde304SinCuerpo(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.learning.image = &learningv1.GetArticleImageResponse{
		Image: &learningv1.ArticleImage{ImageId: testImageID, MimeType: "image/png"},
		Bytes: []byte{0x01, 0x02},
	}

	req := httptest.NewRequest(http.MethodGet, "/media/images/"+testImageID, nil)
	req.Header.Set("If-None-Match", strconv.Quote(testImageID))
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotModified, rec.Code)
	require.Empty(t, rec.Body.Bytes())
	require.Equal(t, strconv.Quote(testImageID), rec.Header().Get("ETag"))
}
