// Rutas de imágenes del artículo en el BORDE (T129, T130, FR-064…FR-067).
//
// El Gateway no valida imágenes: transporta bytes y comprueba lo que HTTP manda comprobar
// antes de gastar una llamada. La autoridad sobre qué es una imagen admitida está en
// Aprendizaje, que abre el contenido con `sharp` (T126) — y esa es la única comprobación que
// vale, porque el tipo declarado lo elige quien sube.
//
// Las dos comprobaciones de aquí existen para responder BIEN, no para sustituir a la de allí:
//
//   - **413 antes de leer**: con `http.MaxBytesReader` se corta el cuerpo en el tope, así que
//     una subida de 200 MB no se queda en memoria para acabar rechazada. Sin esto, el límite
//     del servicio llegaría cuando el borde ya hubiera cargado el archivo entero.
//   - **415 por el tipo declarado**: es el estado que corresponde cuando el cliente dice que
//     manda algo que no es una imagen admitida. El servicio lo repetiría, pero aquí se sabe
//     antes de mover bytes. Y si el archivo MIENTE sobre su tipo, aquello lo rechaza con 400
//     y su motivo — por eso las dos rutas no son la misma comprobación dos veces.
package handler

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
)

// maxImageBytes es el tope del cuerpo de una subida: 2 MB de imagen más un margen para las
// cabeceras del formulario multiparte. El tope del CONTENIDO lo impone el servicio y la base
// (`article_images_size_cap`); este es el del transporte.
const maxImageBytes = 2_097_152 + 8_192

// maxImageMemory es cuánto se guarda en memoria antes de pasar a disco. Por debajo del tope:
// un archivo que cabe en el límite se procesa sin tocar el disco.
const maxImageMemory = 1 << 20

// imageMimeAllowed son los tipos que el contrato admite. Espejo del `CHECK` de la tabla y de
// `ALLOWED_MIME_TYPES` en el servicio.
var imageMimeAllowed = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// UploadArticleImage ≡ `POST /editorial/articles/{articleId}/images` (FR-064, FR-066).
//
// Multiparte con el archivo en el campo `file`: es la forma que entiende cualquier cliente
// HTTP y la que permite mandar el tipo declarado junto a los bytes.
func (h *Handler) UploadArticleImage(w http.ResponseWriter, r *http.Request) {
	// Corta el cuerpo en el tope. A partir de aquí, leer más devuelve `ErrTooLarge` en vez de
	// seguir aceptando bytes: el límite se aplica DURANTE la lectura, no después.
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes)

	if err := r.ParseMultipartForm(maxImageMemory); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			h.writeGRPCError(w, r, fmt.Errorf("%w: la imagen pasa del tope de 2 MB", errImageTooLarge))
			return
		}
		h.writeGRPCError(w, r, fmt.Errorf("%w: el cuerpo no es un formulario multiparte válido", errBadRequest))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		h.writeGRPCError(w, r, fmt.Errorf("%w: falta el campo `file` con la imagen", errBadRequest))
		return
	}
	defer func() { _ = file.Close() }()

	if declared := declaredMime(header); !imageMimeAllowed[declared] {
		h.writeGRPCError(w, r, fmt.Errorf(
			"%w: el tipo declarado %q no está admitido (se admiten image/jpeg, image/png, image/webp)",
			errUnsupportedMedia, declared,
		))
		return
	}

	// `io.ReadAll` está acotado por el `MaxBytesReader` de arriba, así que no puede crecer
	// sin límite aunque el encabezado mienta sobre el tamaño.
	bytes, err := io.ReadAll(file)
	if err != nil {
		h.writeGRPCError(w, r, fmt.Errorf("%w: no se pudieron leer los bytes de la imagen", errBadRequest))
		return
	}

	// La ruta es autenticada, así que los claims existen: se comprueban de todos modos
	// porque `ClaimsFrom` devuelve `ok = false` en vez de un `UserID` vacío, y continuar con
	// la cadena vacía llegaría al SQL como «el usuario cuyo id es ""».
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Learning.UploadArticleImage(r.Context(), &learningv1.UploadArticleImageRequest{
		ArticleId:  chi.URLParam(r, "articleId"),
		MimeType:   declaredMime(header),
		Bytes:      bytes,
		UploadedBy: claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, imageToDTO(resp))
}

// GetArticleImage ≡ `GET /media/images/{imageId}` (FR-067, T130).
//
// ES PÚBLICA, y conviene dejar escrito por qué, porque es una decisión y no un descuido: el
// `<img src>` del lector **no puede mandar cabecera `Authorization`**, así que una ruta
// autenticada haría que ninguna imagen se viera nunca. El identificador es el SHA-256 del
// contenido —256 bits que no se adivinan— y solo lo conoce quien tiene el documento que lo
// referencia, así que el conocimiento del hash ES el permiso. La alternativa canónica serían
// URLs firmadas, que exigen infraestructura que esta enmienda no añade (D-13).
//
// La respuesta es CACHEABLE PARA SIEMPRE porque el identificador ES el hash del contenido:
// los mismos 256 bits no pueden devolver bytes distintos. Es la única situación en la que
// `immutable` no es una apuesta.
func (h *Handler) GetArticleImage(w http.ResponseWriter, r *http.Request) {
	imageID := chi.URLParam(r, "imageId")

	resp, err := h.clients.Learning.GetArticleImage(r.Context(), &learningv1.ArticleImageRef{
		ImageId: imageID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	// El `ETag` es el propio identificador, entrecomillado como manda HTTP. No se calcula
	// otro: recalcular un hash de unos bytes que YA son un hash sería hacer dos veces el
	// mismo trabajo para obtener el mismo valor.
	etag := `"` + imageID + `"`

	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", resp.GetImage().GetMimeType())
	w.Header().Set("Content-Length", strconv.Itoa(len(resp.GetBytes())))
	w.Header().Set("ETag", etag)
	// `public`: puede cachearlo también un intermediario, porque el contenido no depende de
	// quién pregunta. `immutable`: el navegador no debe revalidar ni al recargar.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(resp.GetBytes())
}

// declaredMime lee el tipo que el cliente declara para la parte del archivo.
//
// Se prefiere el de la parte a la cabecera general del formulario: `multipart` permite un
// `Content-Type` por parte, y es el que corresponde al archivo. Si no viene, se usa el
// general; y si tampoco, la cadena vacía, que Aprendizaje trata como «el cliente no declara
// nada» y resuelve mirando los bytes.
func declaredMime(header *multipart.FileHeader) string {
	if ct := header.Header.Get("Content-Type"); ct != "" {
		return strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	}
	return ""
}

func imageToDTO(image *learningv1.ArticleImage) ArticleImage {
	byteSize, _ := strconv.ParseInt(image.GetByteSize(), 10, 64)
	return ArticleImage{
		ImageID:   image.GetImageId(),
		ArticleID: image.GetArticleId(),
		MimeType:  image.GetMimeType(),
		ByteSize:  byteSize,
		Width:     image.GetWidth(),
		Height:    image.GetHeight(),
	}
}
