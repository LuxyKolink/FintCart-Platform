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

/**
 * Documento de bloques → texto plano: la dirección de VUELTA (T131).
 *
 * Existe porque el lector de la fase 001 —y cualquier consumidor anterior a D-14— solo
 * entiende texto, y **el texto ya no se guarda en ningún sitio**: `article_versions.body`
 * dejó de existir en T135, así que la única forma de darle texto a ese lector es derivarlo
 * aquí. Mientras hubo columna, este archivo servía para rellenarla; ahora sirve para lo
 * mismo que la dirección de ida —que el cuerpo se pueda leer—, y el motivo no cambió:
 * guardar el texto junto al documento dejaría dos versiones del mismo cuerpo que pueden
 * contradecirse, y entonces habría que decidir cuál gana cada vez que se lean.
 *
 * Las reglas de qué es una línea son las de un lector de texto, no las del formato:
 *
 *   - Un párrafo, un encabezado y cada elemento de una lista son una línea, y las líneas
 *     se separan con una línea en blanco — la misma unidad que `plainTextToBodyDoc`
 *     reconoce, para que el viaje de ida y vuelta no cambie el número de párrafos.
 *   - Los nodos de texto de un mismo párrafo se CONCATENAN: `«hola »` + `«mundo»` con
 *     negrita en el segundo es un párrafo, no dos.
 *   - Una imagen y una calculadora no aportan texto. Ni el `alt` ni el pie entran aquí:
 *     describen la imagen, no son el cuerpo del artículo, y meterlos haría que el texto
 *     de respaldo dijera algo que nadie escribió. Un artículo que solo lleva una imagen
 *     queda con texto vacío, y eso es correcto: su cuerpo son sus bloques.
 */
export function bodyDocToPlainText(doc: BodyDocNode): string {
  return (doc.contenido ?? []).flatMap(lineasDe).join('\n\n');
}

/** Las líneas de un bloque. Una lista aporta una por elemento. */
function lineasDe(nodo: BodyDocNode): string[] {
  switch (nodo.tipo) {
    case 'texto':
      return nodo.texto === undefined ? [] : [nodo.texto];
    case 'imagen':
    case 'calculadora':
      return [];
    case 'parrafo':
    case 'encabezado': {
      const linea = textoDe(nodo).trim();
      return linea === '' ? [] : [linea];
    }
    default:
      // `doc`, `lista` e `item_lista` no son texto: se bajan a sus hijos.
      return (nodo.contenido ?? []).flatMap(lineasDe);
  }
}

/** El texto de un nodo, concatenando sus nodos de texto y sin mirar las marcas. */
function textoDe(nodo: BodyDocNode): string {
  if (nodo.tipo === 'texto') {
    return nodo.texto ?? '';
  }
  if (nodo.tipo === 'imagen' || nodo.tipo === 'calculadora') {
    return '';
  }
  return (nodo.contenido ?? []).map(textoDe).join('');
}
