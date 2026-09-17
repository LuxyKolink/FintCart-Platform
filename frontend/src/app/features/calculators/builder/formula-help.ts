/**
 * Ayuda contextual del lenguaje de fórmulas en el constructor (T160, D-16).
 *
 * ## De dónde sale este texto
 *
 * De `services/simulator/src/domain/formula/functions.rs`, donde vive `Function::help()` —el
 * método que documenta cada función **junto a la función**, decidido así para que el texto que
 * explica `pot` no pueda discrepar del código que implementa `pot`—. Ese texto no llega al cliente
 * por ningún endpoint (el contrato no expone el catálogo de funciones), así que el constructor
 * necesita su propia frase.
 *
 * ## Y por eso hay una barrera
 *
 * Una frase copiada a mano en otro lenguaje es exactamente el tipo de dato que se desincroniza en
 * silencio: alguien renombra `potd`, o decide que `pot` también acepte exponentes fraccionarios, y
 * la ayuda del constructor sigue diciendo lo de antes —una ayuda que miente es peor que no
 * tenerla, porque el autor confía en ella—. `scripts/formula-help.mjs` compara las dos y falla si
 * discrepan; corre en `npm run lint` junto a las otras dos barreras del proyecto.
 *
 * ## Qué es lo que no puede divergir
 *
 * Cuatro afirmaciones, que son las que tienen consecuencia para quien escribe una fórmula:
 *
 *   1. que `pot` quiere el exponente **entero**;
 *   2. que `pot` es **exacta**;
 *   3. que `potd` acepta un exponente **decimal**;
 *   4. que `potd` es **aproximada** y que, pudiendo, se use `pot`.
 *
 * D-16 lo dejó escrito: fundir las dos en una perdería en silencio la exactitud del Principio VIII,
 * porque `x^(1/12)` no tiene representación decimal finita y una sola función tendría que elegir
 * entre rechazar la mitad de los casos o degradar todos.
 */
export interface FormulaHelp {
  /** Nombre exacto con el que se escribe en una fórmula. */
  readonly name: string;
  /** Cómo se escribe, con sus argumentos. */
  readonly signature: string;
  /** Cuándo usarla, en una frase. */
  readonly when: string;
  /** Lo que cuesta usarla mal. */
  readonly caveat?: string;
}

export const FORMULA_HELP: readonly FormulaHelp[] = [
  {
    name: 'pot',
    signature: 'pot(base, n)',
    when: 'Para elevar a una potencia con exponente ENTERO: meses, cuotas, períodos.',
    caveat: 'Es exacta. Si el exponente lleva decimales, rechaza el cálculo en vez de redondearlo.',
  },
  {
    name: 'potd',
    signature: 'potd(base, x)',
    when: 'Solo cuando el exponente sea DECIMAL y no haya forma de evitarlo: una raíz, un ajuste.',
    caveat:
      'Es aproximada: no toda potencia decimal tiene representación exacta. Si puedes usar pot, usa pot.',
  },
];
