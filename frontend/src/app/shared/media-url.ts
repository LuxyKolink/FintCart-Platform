/**
 * La dirección de una imagen del cuerpo (FR-067, T130).
 *
 * Está en `shared/` porque la usan las dos pantallas que muestran la misma imagen: el
 * editor, al insertarla, y el lector, al dibujarla. Si cada una construyera su URL, el día
 * que la ruta cambiara una de las dos seguiría apuntando al sitio viejo y las imágenes se
 * verían en una pantalla y no en la otra — sin ningún error, solo huecos.
 *
 * El identificador es el SHA-256 del contenido, así que la URL es **inmutable**: el mismo
 * hash devuelve siempre los mismos bytes, y eso es lo que permite que el borde la sirva con
 * `Cache-Control: immutable` sin arriesgarse a servir una imagen vieja.
 */
import { environment } from '../../environments/environment';

/** Dirección pública de la imagen. Un identificador vacío da una URL que no carga nada. */
export function mediaImageUrl(imageId: string | undefined): string {
  return `${environment.apiBaseUrl}/media/images/${imageId ?? ''}`;
}
