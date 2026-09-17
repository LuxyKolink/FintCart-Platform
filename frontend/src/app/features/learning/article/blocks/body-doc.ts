/**
 * El encabezado, visto desde el lector (FR-063, SC-030).
 *
 * El vocabulario del documento —tipos, vocabulario cerrado, análisis de lo que llega y la
 * lista blanca de esquemas de enlace— vive en `shared/body-doc.ts`, porque lo comparten el
 * lector y el editor. Aquí queda lo único que es del LECTOR: cómo se traduce un nivel a la
 * etiqueta que se dibuja.
 *
 * Lo que este archivo NO hace: no renderiza nada (eso es el componente), no decide estilos,
 * y no completa lo que falta. Un `alt` ausente no se sustituye por el pie de foto ni por el
 * nombre del archivo.
 */

/** Los niveles de encabezado que un artículo puede tener: el `h1` es de la pantalla. */
export function headingTag(nivel: number | undefined): 'h2' | 'h3' | 'h4' {
  if (nivel === 3) {
    return 'h3';
  }
  if (nivel === 4) {
    return 'h4';
  }
  return 'h2';
}
