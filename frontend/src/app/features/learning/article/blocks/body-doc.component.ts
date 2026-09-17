import { NgTemplateOutlet } from '@angular/common';
import { Component, input, signal } from '@angular/core';

import {
  isSafeHref,
  type BodyDocMark,
  type BodyDocNode,
} from '../../../../shared/body-doc';
import { mediaImageUrl } from '../../../../shared/media-url';
import { headingTag } from './body-doc';
import { EmbeddedCalculatorComponent } from './embedded-calculator.component';

/**
 * Renderiza un documento de bloques **por componente**, sin `innerHTML` ni
 * `bypassSecurityTrust*` (FR-068, nota N-08).
 *
 * Es la pieza que justifica todo el vocabulario cerrado del servidor: no hay ni un punto
 * del recorrido donde el contenido se interprete como marcado. Cada tipo de nodo tiene
 * su rama en el `@switch` y emite elementos de Angular normales, así que la única
 * superficie que existe es la que está escrita aquí — y lo que no está escrito no puede
 * inyectarse, porque no hay ningún analizador de HTML en el camino que pueda equivocarse.
 *
 * RECURSIÓN EN UNA SOLA PLANTILLA, y por qué. Angular no deja que un componente
 * independiente se importe a sí mismo, y un componente por nivel obligaría a un anidamiento
 * fijo. Se usa un `<ng-template>` que se invoca a sí mismo con `ngTemplateOutlet` y que
 * lleva en el contexto si está dibujando contenido **en línea** (dentro de un párrafo o un
 * titular) o **en bloque** (hijos de la raíz o de un elemento de lista). Con una sola
 * plantilla no hay dos listas de tipos que puedan divergir, y el contexto explica por qué
 * el mismo nodo se dibuja distinto según dónde esté: un `texto` es un `<span>` dentro de un
 * párrafo, y un `parrafo` nunca cuelga de otro párrafo — eso lo garantiza el servidor.
 *
 * LO QUE NO SE PUEDE EJECUTAR TODAVÍA se dice en la pantalla en vez de disimularse:
 *
 * - La imagen se carga de `GET /media/images/{id}` (T130, verificado: se pinta). Si no
 *   carga —el archivo se purgó, o la red falla— se muestra su **texto alternativo** como
 *   pie visible. Es la degradación correcta y no un parche: es exactamente lo que debe
 *   verse cuando una imagen no está disponible (FR-072), y un hueco en blanco sería peor,
 *   porque el lector no sabría qué falta.
 * - La calculadora se dibuja como una referencia con su enlace al simulador. T153 la
 *   convierte en un bloque ejecutable **en el lector**, por la misma ruta de ejecución que
 *   el simulador, para que la simulación quede en el historial y en la auditoría. Hasta
 *   entonces, un enlace honesto es mejor que un formulario que no puede guardar nada.
 *
 * Lo que NO hace: no valida el documento (eso es del servidor y del intérprete
 * `parseBodyDoc`) y no completa lo que falta. Si un `alt` no viene, no se inventa a partir
 * del pie de foto ni del nombre del archivo.
 */
@Component({
  selector: 'fc-body-doc',
  standalone: true,
  imports: [NgTemplateOutlet, EmbeddedCalculatorComponent],
  templateUrl: './body-doc.component.html',
  styleUrl: './body-doc.component.css',
})
export class BodyDocComponent {
  /** La raíz del documento: un nodo `doc`. */
  public readonly doc = input.required<BodyDocNode>();

  protected headingTag = headingTag;

  /**
   * El `href` del enlace de un nodo de texto, o `null` si no hay uno pulsable.
   *
   * Devuelve `null` —y el texto se dibuja sin enlace— cuando el esquema no está admitido.
   * El servidor ya lo valida al guardar; aquí se vuelve a comprobar porque una garantía
   * que solo vive en el otro extremo del cable no protege a esta pantalla si algún día el
   * otro extremo cambia o si el documento se guardó antes de que existiera el validador.
   */
  protected linkOf(node: BodyDocNode): string | null {
    const enlace = (node.marcas ?? []).find((marca) => marca.tipo === 'enlace');
    return enlace !== undefined && isSafeHref(enlace.href) ? enlace.href : null;
  }

  protected hasMark(node: BodyDocNode, tipo: string): boolean {
    return (node.marcas ?? []).some((marca: BodyDocMark) => marca.tipo === tipo);
  }

  /**
   * Dirección de la imagen (T130). El identificador es el SHA-256 del contenido, así que
   * la URL es inmutable: el mismo hash devuelve siempre los mismos bytes.
   */
  protected imageSrc(node: BodyDocNode): string {
    return mediaImageUrl(node.image_id);
  }

  /** El texto que se muestra cuando la imagen no se puede cargar. Es su `alt`, no un invento. */
  protected imageFallback(node: BodyDocNode): string {
    return node.alt ?? 'Imagen sin descripción';
  }

  /**
   * Imágenes que no se pudieron cargar, por su identificador.
   *
   * Es una señal y no un `Set` suelto porque el error de carga llega DESPUÉS del primer
   * renderizado: con un conjunto normal, la plantilla se quedaría mostrando el `<img>`
   * roto y el texto alternativo no aparecería nunca —el guion de la degradación existiría
   * y no se ejecutaría—. El conjunto se reemplaza en vez de mutarse para que la señal
   * notifique el cambio.
   */
  private readonly imagenesRotas = signal<ReadonlySet<string>>(new Set<string>());

  protected isBroken(node: BodyDocNode): boolean {
    return this.imagenesRotas().has(node.image_id ?? '');
  }

  protected onImageError(node: BodyDocNode): void {
    const actuales = this.imagenesRotas();
    const siguiente = new Set(actuales);
    siguiente.add(node.image_id ?? '');
    this.imagenesRotas.set(siguiente);
  }

  /** Los hijos en línea de un párrafo o titular, ya filtrados por el intérprete. */
  protected inlineChildren(node: BodyDocNode): readonly BodyDocNode[] {
    return node.contenido ?? [];
  }

  /** Los hijos en bloque de la raíz o de un elemento de lista. */
  protected blockChildren(node: BodyDocNode): readonly BodyDocNode[] {
    return node.contenido ?? [];
  }
}
