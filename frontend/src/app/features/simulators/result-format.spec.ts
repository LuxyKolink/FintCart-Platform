import { formatMoney, formatRate } from './result-format';

/**
 * T048 / FR-109 / Principio VIII: ninguna cifra pasa por una conversión que altere su
 * precisión.
 *
 * ESTOS CASOS NO SON HIPOTÉTICOS. `Number` de JavaScript es un IEEE-754 de doble
 * precisión: representa exactamente los enteros hasta 2^53 − 1 (9 007 199 254 740 991) y a
 * partir de ahí redondea en silencio. Un monto en pesos de 18 dígitos —que cabe de sobra en
 * `NUMERIC(19,2)`— deja de ser el mismo número al pasar por `Number` y volver, sin ningún
 * error de por medio. Por eso el formateo se hace con `decimal.js` sobre la cadena canónica
 * y el agrupado de miles con una expresión regular sobre el texto, no con
 * `toLocaleString()`.
 *
 * La regla de lint del proyecto (`@typescript-eslint/no-restricted-types` y
 * `no-restricted-globals` para `Number`/`parseFloat`) ya prohíbe el atajo en
 * `features/simulators/**`; estas pruebas comprueban el RESULTADO, que es lo que la regla
 * protege.
 */
describe('result-format', () => {
  describe('formatMoney', () => {
    it('groups thousands without losing the cents', () => {
      expect(formatMoney('1234567.89')).toBe('$1,234,567.89');
      expect(formatMoney('1500000')).toBe('$1,500,000.00');
      expect(formatMoney('0')).toBe('$0.00');
    });

    it('keeps a negative amount negative', () => {
      expect(formatMoney('-2500.5')).toBe('-$2,500.50');
    });

    it('does not lose precision above Number.MAX_SAFE_INTEGER', () => {
      // 9 007 199 254 740 993 es 2^53 + 1: el primer entero que un `double` NO puede
      // representar. Si esta cifra pasara por `Number`, se convertiría en …992.
      expect(formatMoney('9007199254740993.01')).toBe('$9,007,199,254,740,993.01');
      expect(formatMoney('12345678901234567.89')).toBe('$12,345,678,901,234,567.89');
    });

    it('rejects a value with more decimals than the column instead of rounding it', () => {
      // `NUMERIC(19,2)`: tres decimales significativos no caben. Redondear aquí sería
      // esconder un error del emisor, que es peor que fallar.
      expect(() => formatMoney('10.005')).toThrow();
    });

    it('rejects a value that is not canonical decimal notation', () => {
      expect(() => formatMoney('1,500.00')).toThrow();
      expect(() => formatMoney('1.5e3')).toThrow();
      expect(() => formatMoney('')).toThrow();
    });
  });

  describe('formatRate', () => {
    it('turns a fraction into a percentage without rounding it', () => {
      expect(formatRate('0.12')).toBe('12%');
      expect(formatRate('0.005')).toBe('0.5%');
      expect(formatRate('0.123456')).toBe('12.3456%');
    });

    it('keeps the sign', () => {
      expect(formatRate('-0.015')).toBe('-1.5%');
    });
  });
});
