import { formatIndicatorValue, indicatorUnit } from './indicator-format';

/**
 * Presentación del valor de un indicador (T108, Principio VIII, nota N-15).
 *
 * Lo que se fija aquí son dos cosas distintas y las dos importan:
 *
 * 1. **La cifra sembrada se lee como dinero o como tasa.** `1600000` sin símbolo ni agrupado
 *    no es una cifra: es un identificador de aspecto numérico. La prueba es el símbolo y el
 *    separador de miles, no el color ni la tipografía.
 * 2. **Un nombre desconocido NO se formatea.** El borde acepta cualquier `@NOMBRE`, y la
 *    unidad de un indicador que esta pantalla no conoce no se puede afirmar. La prueba fija
 *    el valor tal como llega porque hay una prueba de extremo a extremo
 *    (`e2e/indicadores-admin.spec.ts`) que espera `0.123456` dentro de `.fc-num`: inventarle
 *    unidad a un nombre desconocido rompería la pantalla además de mentir sobre el dato.
 */
describe('unidad del indicador', () => {
  it('reconoce los montos sembrados', () => {
    expect(indicatorUnit('SMMLV')).toBe('money');
    expect(indicatorUnit('UVT')).toBe('money');
    expect(indicatorUnit('UVR')).toBe('money');
  });

  it('reconoce las tasas por nombre y por prefijo', () => {
    expect(indicatorUnit('IPC')).toBe('rate');
    expect(indicatorUnit('TASA_USURA')).toBe('rate');
    expect(indicatorUnit('TASA_EA')).toBe('rate');
  });

  it('no adivina la unidad de un nombre que no conoce', () => {
    expect(indicatorUnit('ZZE21800000000')).toBe('unknown');
    expect(indicatorUnit('SALARIO_INTEGRAL')).toBe('unknown');
  });
});

describe('formato del valor de un indicador', () => {
  it('escribe el salario mínimo como monto, con símbolo y agrupado', () => {
    expect(formatIndicatorValue('SMMLV', '1600000')).toBe('$1.600.000,00');
  });

  it('escribe la UVT con dos decimales', () => {
    expect(formatIndicatorValue('UVT', '50000')).toBe('$50.000,00');
  });

  it('no rellena de ceros lo que ya viene con seis decimales', () => {
    expect(formatIndicatorValue('SMMLV', '1600000.000000')).toBe('$1.600.000,00');
  });

  it('escribe una fracción como porcentaje', () => {
    expect(formatIndicatorValue('IPC', '0.05')).toBe('5 %');
    expect(formatIndicatorValue('TASA_USURA', '0.25')).toBe('25 %');
  });

  it('deja intacto el valor de un indicador que no conoce', () => {
    expect(formatIndicatorValue('ZZE21800000000', '0.123456')).toBe('0.123456');
  });

  it('degrada a la cadena cuando el valor no cabe en la escala del formateador', () => {
    // Un monto con siete decimales no se redondea para que quepa: se muestra tal como está.
    expect(formatIndicatorValue('SMMLV', '1600000.1234567')).toBe('1600000.1234567');
  });
});
