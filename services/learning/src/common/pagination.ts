/**
 * Paginación de los listados de solo lectura (`common.v1.PageRequest`).
 *
 * El contrato define el cursor como un `page_token` OPACO. Aquí se implementa como el
 * desplazamiento en decimal, y esa decisión tiene una consecuencia que conviene tener
 * presente: con `OFFSET`, insertar una fila entre dos páginas desplaza el resto y un
 * elemento puede repetirse o saltarse. Un cursor por clave (`WHERE id > $ultimo`) no
 * tiene ese problema.
 *
 * Se elige `OFFSET` de todas formas porque los listados que lo usan —catálogo
 * publicado, historial de intentos— se ordenan por campos estables y crecen por el
 * extremo que el usuario no está mirando. Que el token sea opaco en el contrato es
 * justo lo que permite cambiar a un cursor por clave más adelante sin tocar a ningún
 * cliente.
 */
import type { Count } from './counts';
import { invalidArgument } from './errors';

/** Tamaño de página por defecto cuando el cliente no pide uno. */
export const DEFAULT_PAGE_SIZE: Count = 20;

/**
 * Techo del tamaño de página.
 *
 * Sin él, `page_size = 1000000` convierte una consulta de catálogo en una descarga de
 * la tabla entera, y basta un cliente descuidado para tumbar la base.
 */
export const MAX_PAGE_SIZE: Count = 100;

/** Ventana resuelta a partir de un `PageRequest`. */
export interface Page {
  readonly limit: Count;
  readonly offset: Count;
}

/** Petición de página tal como llega del contrato. */
export interface PageRequestLike {
  readonly page_size?: Count;
  readonly page_token?: string;
}

/**
 * Traduce un `PageRequest` en `LIMIT`/`OFFSET`.
 *
 * Un token ilegible es un `invalid_argument` y no un desplazamiento cero: caer al
 * principio de la lista en silencio haría que un cliente con un cursor corrupto
 * recorriera la primera página para siempre creyendo que avanza.
 *
 * @throws {DomainError} `invalid_argument` si el token no es un entero no negativo.
 */
export function resolvePage(request: PageRequestLike | undefined): Page {
  const requested = request?.page_size ?? 0;
  const limit = requested <= 0 ? DEFAULT_PAGE_SIZE : Math.min(requested, MAX_PAGE_SIZE);

  const token = request?.page_token ?? '';
  if (token === '') {
    return { limit, offset: 0 };
  }

  if (!/^\d+$/.test(token)) {
    throw invalidArgument(`page_token no válido: ${JSON.stringify(token)}`);
  }
  return { limit, offset: Number.parseInt(token, 10) };
}

/**
 * Token de la página SIGUIENTE, o cadena vacía si esta era la última.
 *
 * La cadena vacía es la señal de fin del contrato. Devolver siempre un token
 * obligaría al cliente a pedir una página más para descubrir que ya no hay nada, y ese
 * viaje de más se paga en cada recorrido completo del catálogo.
 */
export function nextPageToken(page: Page, returned: Count, total: Count): string {
  const consumed = page.offset + returned;
  return consumed >= total ? '' : String(consumed);
}
