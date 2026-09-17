/**
 * El cuerpo de un artículo no puede estar vacío (T131, FR-063).
 *
 * La regla es la del servidor —«un documento sin bloques no tiene nada que publicar»— y se
 * comprueba aquí por un motivo concreto y no por duplicar validaciones: sin esto, guardar un
 * borrador en blanco gasta un viaje de red para recibir un 400, y el mensaje que llega habla
 * del documento entero en vez de señalar el campo que está vacío en la pantalla.
 *
 * Lo que NO comprueba: el vocabulario. Un nodo desconocido, una imagen sin `alt` o un enlace
 * con un esquema raro los rechaza el servidor, que es quien guarda y quien tiene el
 * vocabulario completo. Repetirlo aquí sería mantener dos listas de reglas que se separan, y
 * la que se quedara corta sería la que decide. La única excepción es el esquema de un enlace,
 * que sí se comprueba en el cliente al insertarlo —porque ahí evita escribir algo que no se
 * podrá guardar—.
 */
import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { bodyDocHasBlocks, parseBodyDoc } from '../../../shared/body-doc';

export const bodyDocValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const doc = parseBodyDoc(control.value);
  return doc !== null && bodyDocHasBlocks(doc) ? null : { bodyDocEmpty: true };
};
