/**
 * El cliente del Simulador traduce bien los dos fallos que puede recibir (T151).
 *
 * La prueba vale por lo que distingue y no por lo que comprueba: `NOT_FOUND` ⇒ «no está
 * publicada», **cualquier otro fallo ⇒ `unavailable`**. Si los dos caminos se confundieran, con el
 * Simulador caído la respuesta al autor del artículo sería «tu calculadora no está publicada», y
 * eso le manda a arreglar una calculadora que está perfectamente.
 *
 * El doble es un `ClientGrpc` de mentira, que es lo único que hace falta: lo que se está probando
 * es la capa que decide, no el transporte —que probaría el propio `@nestjs/microservices`—.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';

import {
  SIMULATOR_GRPC,
  SimulatorCalculatorsService,
} from '../../src/simulator/simulator-calculators.service';

/** Un error de gRPC con su `code`, que es lo que mira la implementación. */
function errorGrpc(code: number): Error {
  const err = new Error(`fallo gRPC ${code}`) as Error & { code: number };
  err.code = code;
  return err;
}

/** Doble del cliente: devuelve lo que se le diga, por identificador. */
class FakeSimulator {
  public readonly pedidos: string[] = [];

  public constructor(
    private readonly respuestas: Readonly<Record<string, string>>,
    private readonly falla: Error | null = null,
  ) {}

  public getCalculator(request: { calculator_id: string }): {
    toPromise(): Promise<{ state?: string }>;
  } {
    this.pedidos.push(request.calculator_id);
    const error = this.falla;
    const estado = this.respuestas[request.calculator_id];
    return {
      toPromise: (): Promise<{ state?: string }> => {
        if (error !== null) {
          return Promise.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        if (estado === undefined) {
          // Igual que el Simulador: «no existe» y «no la puedes ver» son lo mismo.
          return Promise.reject(errorGrpc(GrpcStatus.NOT_FOUND));
        }
        return Promise.resolve({ state: estado });
      },
    };
  }
}

/** El cliente de Nest solo tiene que devolver el doble cuando se le pide el servicio. */
function servicio(doble: FakeSimulator): SimulatorCalculatorsService {
  const grpc = { getService: () => doble } as unknown as ClientGrpc;
  return new SimulatorCalculatorsService(grpc);
}

describe('SimulatorCalculatorsService — la traducción de errores (T151)', () => {
  it('acepta lo publicado y devuelve vacío', async () => {
    const doble = new FakeSimulator({ a: 'publicada' });
    await expect(servicio(doble).missing(['a'])).resolves.toEqual([]);
  });

  it('una calculadora privada cuenta como no publicada', async () => {
    // El Simulador responde `privada` a su propio dueño, así que el estado hay que mirarlo: una
    // calculadora privada no es ejecutable por quien lee el artículo.
    const doble = new FakeSimulator({ a: 'privada', b: 'en_revision' });
    await expect(servicio(doble).missing(['a', 'b'])).resolves.toEqual(['a', 'b']);
  });

  it('un identificador que no existe cuenta como no publicada', async () => {
    const doble = new FakeSimulator({});
    await expect(servicio(doble).missing(['desconocida'])).resolves.toEqual(['desconocida']);
  });

  it('pregunta una sola vez por identificador, conservando el orden', async () => {
    const doble = new FakeSimulator({ a: 'publicada', b: 'publicada' });
    await expect(servicio(doble).missing(['b', 'a', 'b'])).resolves.toEqual([]);
    expect(doble.pedidos).toEqual(['b', 'a']);
  });

  it('devuelve las que faltan en el orden en que se preguntaron', async () => {
    const doble = new FakeSimulator({ b: 'publicada' });
    await expect(servicio(doble).missing(['a', 'b', 'c'])).resolves.toEqual(['a', 'c']);
  });

  it('UNAVAILABLE no es «no está publicada»: sale como `unavailable`', async () => {
    const doble = new FakeSimulator({}, errorGrpc(GrpcStatus.UNAVAILABLE));
    const fallo = await servicio(doble)
      .missing(['a'])
      .catch((err: unknown) => err);

    // El código es lo que el borde traduce a 503 para poder reintentar. Confundirlo con un
    // rechazo convertiría una caída en un error de autoría.
    expect(fallo).toMatchObject({ code: 'unavailable' });
  });

  it('un fallo interno del Simulador tampoco es un «no está publicada»', async () => {
    const doble = new FakeSimulator({}, errorGrpc(GrpcStatus.INTERNAL));
    await expect(servicio(doble).missing(['a'])).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('un error que no es de gRPC —el socket cerrado— también es `unavailable`', async () => {
    // Un `Error` pelado es lo que lanza el canal cuando se cae la conexión: no tiene `code` de
    // gRPC, y tratarlo como «no está publicada» sería el mismo error de diagnóstico.
    const doble = new FakeSimulator({}, new Error('socket hang up'));
    await expect(servicio(doble).missing(['a'])).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('el token del cliente es una cadena estable', () => {
    // El token lo comparten el módulo y el proveedor; si cambiara de forma, la inyección
    // fallaría al arrancar el proceso y no en una prueba.
    expect(SIMULATOR_GRPC).toBe('SIMULATOR_GRPC');
  });
});
