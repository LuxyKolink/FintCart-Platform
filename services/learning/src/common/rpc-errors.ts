/**
 * Traducción de errores de dominio al estado gRPC — UN solo sitio.
 *
 * Repartida por los controladores, cada uno acabaría eligiendo su propio código para
 * el mismo `not_found`, y un cliente que reintenta según el código recibiría respuestas
 * incoherentes para el mismo fallo. `LearningController` (001) y `CategoriesController`
 * (002) comparten estas dos funciones.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';

import { DecimalStrError } from './decimal-str';
import { DomainError } from './errors';

/**
 * Traduce el error de dominio al código de estado de gRPC.
 *
 * `DecimalStrError` se traduce aparte porque no es un `DomainError`: lo lanza la
 * frontera decimal cuando un valor almacenado o recibido no respeta la forma canónica.
 * Un `scale`/`range` es un dato que no cabe —culpa del emisor, `INVALID_ARGUMENT`—
 * mientras que un formato roto en un valor que salió de la base es corrupción de datos
 * y merece `INTERNAL`: el cliente no puede hacer nada al respecto.
 */
export function codeOf(err: unknown): GrpcStatus {
  if (err instanceof DecimalStrError) {
    return err.code === 'scale' || err.code === 'range'
      ? GrpcStatus.INVALID_ARGUMENT
      : GrpcStatus.INTERNAL;
  }

  if (!(err instanceof DomainError)) {
    return GrpcStatus.INTERNAL;
  }

  switch (err.code) {
    case 'invalid_argument':
      return GrpcStatus.INVALID_ARGUMENT;
    case 'not_found':
      return GrpcStatus.NOT_FOUND;
    case 'conflict':
      return GrpcStatus.FAILED_PRECONDITION;
    case 'forbidden':
      return GrpcStatus.PERMISSION_DENIED;
    case 'not_implemented':
      return GrpcStatus.UNIMPLEMENTED;
    case 'storage':
      return GrpcStatus.INTERNAL;
  }
}

/**
 * Mensaje que SÍ puede ver el cliente.
 *
 * Un `storage` devuelve un texto fijo: su mensaje lleva la causa del driver, y ahí
 * aparecen nombres de constraint, de tabla y a veces valores de la fila que provocó el
 * conflicto. El detalle queda en el log, que es donde hace falta.
 */
export function clientMessage(err: unknown): string {
  if (err instanceof DomainError && err.code !== 'storage') {
    return err.message;
  }
  if (err instanceof DecimalStrError && (err.code === 'scale' || err.code === 'range')) {
    return err.message;
  }
  return 'error interno';
}
