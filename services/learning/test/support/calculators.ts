/**
 * Doble del puerto `PublishedCalculators` (T151).
 *
 * Existe para que la regla —«un artículo no puede incrustar una calculadora que el lector no
 * podría ejecutar»— se pruebe **sin un Simulador al otro lado**, y también para poder comprobar lo
 * que NO se pregunta: que un documento sin calculadoras no cuesta ninguna llamada, y que una caída
 * del Simulador no se confunde con una calculadora no publicada. Las dos cosas son invisibles si el
 * doble solo devuelve listas.
 */
import type { PublishedCalculators } from '../../src/articles/published-calculators';

export class FakePublishedCalculators implements PublishedCalculators {
  /** Las preguntas recibidas, en orden: `['a', 'b']` significa que se preguntó por `a` y por `b`. */
  public readonly preguntas: string[][] = [];

  /**
   * @param publicadas Identificadores que el doble considera publicados. Lo que no esté aquí,
   *   «no está publicado» —igual que el Simulador, que no distingue «no existe» de «no la puedes
   *   ver»—.
   * @param falla Si se indica, el doble lanza este error en vez de contestar: es la caída del
   *   Simulador.
   */
  public constructor(
    private readonly publicadas: readonly string[] = [],
    private readonly falla: Error | null = null,
  ) {}

  public missing(ids: readonly string[]): Promise<readonly string[]> {
    this.preguntas.push([...ids]);
    if (this.falla !== null) {
      // El doble finge la CAÍDA del Simulador con un error de verdad, no con un valor
      // arbitrario: `throw 'algo'` no se puede distinguir de un fallo del propio código.
      return Promise.reject(this.falla);
    }
    return Promise.resolve(ids.filter((id) => !this.publicadas.includes(id)));
  }

  /** Cuántas veces se preguntó algo. Se usa para comprobar que no se pregunta de más. */
  public get llamadas(): number {
    return this.preguntas.length;
  }
}
