/**
 * Texto plano → documento de bloques (T124, FR-069).
 *
 * Mientras la superficie de redacción no envíe un documento estructurado (el editor
 * llega con T131), todo cuerpo que entra al sistema sigue siendo texto plano, y este
 * archivo lo convierte en el documento que `article_versions.body_doc` espera. Así la
 * columna no queda a medias: **toda versión nueva nace con su documento**, y el día
 * que el editor mande bloques de verdad habrá una sola ruta que ya funciona.
 *
 * La regla es la misma que aplica la migración `20260902111500` a las 79 versiones que
 * ya existían, y tiene que ser la misma: un párrafo es lo que queda entre dos líneas en
 * blanco. Si divergieran, el contenido viejo y el nuevo se leerían distinto según cuándo
 * se escribieron — que es la forma más silenciosa de corromper un histórico.
 *
 * **No se puede compartir el código** entre las dos: la migración es SQL, ejecutada una
 * vez por `golang-migrate`, y este archivo corre en el servicio. La duplicación es un
 * hecho, no un descuido; lo que se hace para que no se separen es fijar la regla con las
 * mismas entradas a los dos lados (`test/articles/plain-text.spec.ts` aquí, y la guarda
 * de la propia migración contra los cuerpos reales allí).
 *
 * Lo que **no** hace: no interpreta marcas, ni convierte Markdown, ni adivina negritas.
 * Un `**texto**` en el cuerpo llega al artículo tal cual, porque el texto plano de 001
 * nunca tuvo formato y suponer que sí lo tenía inventaría contenido.
 */
import type { BodyDocNode } from './body-doc';

/**
 * Convierte texto plano en documento: un párrafo por bloque separado por una línea en
 * blanco, con el texto del párrafo en un único nodo `texto`.
 *
 * Los espacios de los extremos de cada párrafo se recortan y las líneas en blanco
 * desaparecen: son separadores, no contenido. Un texto vacío o en blanco produce un
 * documento válido y vacío, que es la respuesta correcta para un borrador en blanco.
 */
export function plainTextToBodyDoc(text: string): BodyDocNode {
  const parrafos = text
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n+/u)
    .map((parrafo) => parrafo.trim())
    .filter((parrafo) => parrafo !== '')
    .map((parrafo) => ({
      tipo: 'parrafo',
      contenido: [{ tipo: 'texto', texto: parrafo }],
    }));

  return { tipo: 'doc', contenido: parrafos };
}
