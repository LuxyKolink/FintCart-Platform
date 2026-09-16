import { formatScore, formatScoreOutOf, isGoodScore } from './format-decimal';

/**
 * T040 / FR-109 / Principio VIII: la calificación que se muestra en el progreso y en la
 * bandeja conserva su precisión decimal.
 *
 * Estas pruebas existen porque el modo de fallo es SILENCIOSO: pasar la cadena por
 * `Number` y volver a mostrarla «funciona» para casi todos los valores y solo se nota
 * en los que tienen decimales significativos. Por eso los casos de abajo llevan
 * decimales a propósito.
 */
describe('format-decimal', () => {
  describe('formatScore', () => {
    it('keeps significant decimals instead of rounding to an integer', () => {
      expect(formatScore('85.15')).toBe('85.15');
      expect(formatScore('66.67')).toBe('66.67');
      expect(formatScore('0.01')).toBe('0.01');
    });

    it('drops trailing zeros without changing the value', () => {
      expect(formatScore('100.00')).toBe('100');
      expect(formatScore('85.50')).toBe('85.5');
    });

    it('keeps a negative value negative', () => {
      expect(formatScore('-0.5')).toBe('-0.5');
    });

    it('returns the raw string rather than throwing on a value outside the contract', () => {
      // `parseScore` rechaza más de dos decimales (escala de `NUMERIC(6,2)`) y la
      // notación no canónica. Preferimos enseñar el dato raro a dejar la pantalla en
      // blanco por un valor que no controlamos.
      expect(formatScore('85.125')).toBe('85.125');
      expect(formatScore('1e3')).toBe('1e3');
      expect(formatScore('')).toBe('');
    });
  });

  describe('formatScoreOutOf', () => {
    it('appends the denominator without touching the value', () => {
      expect(formatScoreOutOf('66.67')).toBe('66.67 de 100');
      expect(formatScoreOutOf('66.67', '70')).toBe('66.67 de 70');
    });
  });

  describe('isGoodScore', () => {
    it('compares in decimal, not in binary floating point', () => {
      expect(isGoodScore('80')).toBeTrue();
      expect(isGoodScore('80.01')).toBeTrue();
      expect(isGoodScore('79.99')).toBeFalse();
    });

    it('says no when the value is not comparable', () => {
      expect(isGoodScore('sin puntaje')).toBeFalse();
    });
  });
});
