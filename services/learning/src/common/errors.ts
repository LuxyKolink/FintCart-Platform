/**
 * Convención de errores del Servicio de Aprendizaje (Principio XI regla 6:
 * «errores envueltos con causa preservada»).
 *
 * La regla tiene dos mitades y las dos importan:
 *
 * 1. **La causa se preserva.** Todo error que envuelve otro usa la opción `cause`
 *    del constructor de `Error` (ES2022), nunca una interpolación del mensaje. Un
 *    `error: duplicate key value violates unique constraint "articles_slug_key"`
 *    convertido en `` `no se pudo guardar: ${err.message}` `` pierde el `code` de
 *    PostgreSQL, el nombre de la constraint y el stack, que es justo lo que hace
 *    falta para depurar.
 * 2. **El error del driver NO cruza la frontera.** La capa gRPC razona sobre las
 *    clases de este archivo, no sobre los errores de `pg`. Así el dominio no queda
 *    acoplado al driver y el mapeo a códigos de estado tiene un solo lugar.
 *
 * En TypeScript hay una tentación extra que no existe en Go: `throw` acepta
 * cualquier valor, así que nada impide lanzar un string. Por eso todo lo de aquí
 * hereda de `Error` — un `catch` que reciba un string no tiene `stack`, y sin stack
 * el error es prácticamente inútil.
 */

/** Motivo por el que una operación de dominio falló. */
export type ErrorCode =
  /** Entrada inutilizable: campo obligatorio ausente, identificador mal formado. */
  | 'invalid_argument'
  /** El recurso pedido no existe. */
  | 'not_found'
  /** La operación choca con el estado actual (clave duplicada, transición inválida). */
  | 'conflict'
  /** La operación no está permitida para quien la pide (FR-008). */
  | 'forbidden'
  /** Fallo de la capa de persistencia. */
  | 'storage'
  /** Método de esqueleto todavía sin cuerpo. */
  | 'not_implemented';

/**
 * Error de dominio del servicio.
 *
 * Lleva un `code` discriminante en lugar de una jerarquía de subclases por caso. El
 * motivo es práctico: `instanceof` deja de funcionar cuando el error cruza un
 * `structuredClone`, un worker o la serialización de un test runner, mientras que
 * comparar un campo siempre funciona. La capa gRPC hace `switch (err.code)`.
 */
export class DomainError extends Error {
  public readonly code: ErrorCode;

  /**
   * @param code Motivo discriminante.
   * @param message Mensaje para el log. NO se devuelve al cliente tal cual: la capa
   *   de transporte sanea lo que sale, porque aquí puede haber nombres de tabla o
   *   fragmentos de SQL.
   * @param cause Error original, si lo hay. Se conserva para que el stack completo
   *   siga disponible.
   */
  public constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DomainError';
    this.code = code;
  }
}

/** Atajo para `invalid_argument`. */
export function invalidArgument(message: string, cause?: unknown): DomainError {
  return new DomainError('invalid_argument', message, cause);
}

/** Atajo para `not_found`. */
export function notFound(message: string, cause?: unknown): DomainError {
  return new DomainError('not_found', message, cause);
}

/** Atajo para `conflict`. */
export function conflict(message: string, cause?: unknown): DomainError {
  return new DomainError('conflict', message, cause);
}

/** Atajo para `forbidden`. */
export function forbidden(message: string, cause?: unknown): DomainError {
  return new DomainError('forbidden', message, cause);
}

/**
 * Atajo para `not_implemented`.
 *
 * Explícito a propósito: un método de esqueleto que devolviera `undefined` o una
 * lista vacía se vería igual que un resultado legítimo, y el fallo aparecería como
 * «el catálogo está vacío» en lugar de como un error.
 */
export function notImplemented(what: string): DomainError {
  return new DomainError('not_implemented', `${what}: no implementado`);
}

/**
 * Envuelve un error de la capa de persistencia conservando la causa.
 *
 * `operation` describe lo que se intentaba hacer, no dónde estaba el `throw`: al leer
 * un log lo que hace falta es saber qué se estaba haciendo.
 */
export function storageError(operation: string, cause: unknown): DomainError {
  return new DomainError('storage', `fallo de persistencia al ${operation}`, cause);
}

/**
 * `true` si `err` es un [[DomainError]] con el código indicado.
 *
 * Comprueba la forma del objeto y no `instanceof`, por la razón explicada en
 * [[DomainError]]: dos copias del módulo (por ejemplo, una del build y otra del test
 * runner) producen dos clases distintas y `instanceof` falla aunque el error sea el
 * correcto.
 */
export function hasCode(err: unknown, code: ErrorCode): boolean {
  // `'code' in err` ya estrecha el tipo, así que no hace falta un `as`.
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

/**
 * Extrae un mensaje legible de un `unknown` capturado.
 *
 * Existe porque `catch (e)` da `unknown` bajo `useUnknownInCatchVariables`, y la
 * alternativa —`(e as Error).message`— produce `undefined` en tiempo de ejecución
 * cuando alguien lanzó un string, justo en el momento en que más falta hace el
 * mensaje.
 */
export function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
