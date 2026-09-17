/**
 * Implementación del puerto `PublishedCalculators` por gRPC al Simulador (T151, D-25).
 *
 * ## Qué pregunta
 *
 * `GetCalculator` por cada identificador, y considera publicado lo que vuelve con
 * `state === 'publicada'`. Es la misma pregunta que ya hace el borde para pintar el catálogo
 * (FR-052), así que un artículo solo puede incrustar lo que el lector puede abrir.
 *
 * ## La decisión que da forma a este archivo: un fallo de red NO es un «no está publicada»
 *
 * Si el Simulador no responde, `getCalculator` rechaza. Tratar ese rechazo como «esa calculadora
 * no existe» haría que **la caída del Simulador se leyera como un error de quien escribe el
 * artículo** («tu calculadora no está publicada»), que es exactamente al revés: la calculadora
 * está perfectamente y lo que falta es con quién hablar. Por eso hay dos caminos separados:
 *
 *   · `NOT_FOUND` (o un estado distinto de `publicada`) ⇒ **falta**, y el documento se rechaza
 *     nombrando cuál;
 *   · cualquier otro fallo ⇒ `unavailable`, que el borde traduce a **503** para que se pueda
 *     reintentar, y el borrador queda intacto.
 *
 * La espera no se limita aquí: el plazo lo pone el transporte, y añadir un `Promise.race` con
 * temporizador propio dejaría la llamada viva por detrás ocupando un canal del cliente.
 *
 * ## Y por qué se pide el estado en vez de usar el catálogo
 *
 * `ListCalculators` con `only_published` devolvería la lista de publicadas y bastaría con mirar
 * si el identificador está dentro… pero esa lista llega **paginada**, y un catálogo que crezca por
 * encima de una página haría que una calculadora publicada pareciera no estarlo. Preguntar por el
 * identificador concreto no depende de cuántas haya.
 */
import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';

import { unavailable } from '../common/errors';
import { JsonLogger } from '../common/observability';
import type { PublishedCalculators } from '../articles/published-calculators';

/** Token del cliente gRPC. Vive aquí y no en el módulo para que el módulo no importe el servicio. */
export const SIMULATOR_GRPC = 'SIMULATOR_GRPC';

/** Puerto del cliente gRPC, escrito a mano: `keepCase` está activo (ver `simulator.module.ts`). */
interface SimulatorClient {
  getCalculator(request: {
    calculator_id: string;
    actor_id?: string;
  }): { toPromise(): Promise<{ state?: string }> };
}

/**
 * Estado del contrato que significa «cualquiera puede ejecutarla».
 *
 * Es una cadena del contrato y no un enumerado porque el contrato la define así (`state` en
 * `Calculator`). Compararla aquí tiene el riesgo de que un cambio en el Simulador deje esta
 * comprobación siempre falsa —y entonces TODO documento con una calculadora se rechazaría, que es
 * un fallo ruidoso y no silencioso—: la prueba de integración de T151 siembra una calculadora
 * publicada de verdad y comprueba que se acepta, que es lo que ata las dos cadenas.
 */
const PUBLICADA = 'publicada';

@Injectable()
export class SimulatorCalculatorsService implements PublishedCalculators {
  private readonly logger = new JsonLogger();
  private client: SimulatorClient | null = null;

  public constructor(private readonly grpc: ClientGrpc) {}

  /**
   * Los identificadores que no están publicados, sin repetir.
   *
   * Las preguntas van **en serie y no en paralelo**: son pocas —el vocabulario del documento
   * admite varias calculadoras, pero un artículo con veinte sería un documento raro— y una
   * ráfaga de llamadas simultáneas contra un servicio que ya está degradado es la forma de
   * convertirlo en una caída. Además, en serie el primer fallo corta y no se sigue preguntando
   * por calculadoras de un servicio que no contesta.
   */
  public async missing(ids: readonly string[]): Promise<readonly string[]> {
    const unicos = [...new Set(ids)];
    const faltantes: string[] = [];
    for (const id of unicos) {
      if (!(await this.estaPublicada(id))) {
        faltantes.push(id);
      }
    }
    return faltantes;
  }

  /** `true` solo si el Simulador dice que está publicada. */
  private async estaPublicada(calculatorId: string): Promise<boolean> {
    try {
      const respuesta = await this.getClient()
        .getCalculator({ calculator_id: calculatorId })
        .toPromise();
      return respuesta.state === PUBLICADA;
    } catch (err) {
      if (esNoEncontrado(err)) {
        return false;
      }
      // El detalle va DENTRO del mensaje y no como argumento: el registrador del servicio
      // convierte los argumentos variádicos con `String(...)` —son el contexto de Nest—, así que
      // un objeto acababa en el log como `[object Object]`, que es no tener log.
      this.logger.warn(
        `no se pudo comprobar el estado de la calculadora ${calculatorId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw unavailable('simulador', 'comprobar si una calculadora está publicada', err);
    }
  }

  /**
   * El cliente del contrato, creado en la PRIMERA pregunta.
   *
   * `ClientGrpc.getService` no se puede llamar en el constructor: el cliente de Nest todavía no
   * está conectado cuando se construye el proveedor, y pedir el servicio ahí falla al arrancar
   * el proceso —aunque nadie fuera a usar el Simulador—. Se pide la primera vez, que es cuando
   * ya está conectado.
   */
  private getClient(): SimulatorClient {
    this.client ??= this.grpc.getService<SimulatorClient>('SimulatorService');
    return this.client;
  }
}

/**
 * `true` si el error es el «no existe o no lo puedes ver» del Simulador.
 *
 * Se comprueba por `code`, que es un número del protocolo gRPC, y no por el mensaje: el texto lo
 * elige la implementación y cambia con el idioma y con la versión, así que decidir por el mensaje
 * haría que un cambio de redacción en Rust convirtiera un «no está publicada» en un 503.
 */
function esNoEncontrado(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === GrpcStatus.NOT_FOUND
  );
}
