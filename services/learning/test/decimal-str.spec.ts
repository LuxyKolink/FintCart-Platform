/**
 * Pruebas del tipo lógico `DecimalString` (T023).
 *
 * Cubren montos extremos, escala máxima, notación científica rechazada y
 * overflow, más la propiedad que motiva el Principio VIII: la aritmética debe
 * ser exacta justo donde `number` (IEEE-754) falla.
 */
import Decimal from 'decimal.js';

import {
  DecimalStrError,
  format,
  formatFixed,
  parse,
  parseMoney,
  parseRate,
  parseScore,
  roundHalfEven,
} from '../src/common/decimal-str';

/** Comprueba que la llamada lanza un DecimalStrError con el `code` esperado. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DecimalStrError);
    expect((e as DecimalStrError).code).toBe(code);
    return;
  }
  throw new Error(`se esperaba un DecimalStrError con code "${code}", no lanzó nada`);
}

describe('parse', () => {
  it('acepta la forma canónica', () => {
    for (const s of [
      '0',
      '-0',
      '5',
      '123',
      '0.5',
      '-0.5',
      '1500000.00',
      '-1500000.00',
      '0.000000000000000001',
      '9'.repeat(40), // sin límite de precisión: parse solo valida sintaxis
    ]) {
      expect(() => parse(s)).not.toThrow();
    }
  });

  it('rechaza la cadena vacía', () => {
    expectCode(() => parse(''), 'empty');
  });

  it.each([
    ['notación científica', '1.5e3'],
    ['notación científica en mayúscula', '1.5E3'],
    ['notación científica sin punto', '1e5'],
    ['exponente negativo', '1.5e-3'],
    ['separador de miles', '1,500.00'],
    ['formato europeo', '1.500,00'],
    ['signo positivo explícito', '+1.5'],
    ['sin parte entera', '.5'],
    ['sin parte decimal', '5.'],
    ['espacio inicial', ' 1.5'],
    ['espacio final', '1.5 '],
    ['espacio interno', '1 500'],
    ['doble signo', '--1'],
    ['doble punto', '1.2.3'],
    ['hexadecimal', '0x10'],
    ['texto', 'abc'],
    ['infinito', 'Infinity'],
    ['NaN', 'NaN'],
    ['solo signo', '-'],
    ['guion bajo', '1_000'],
    ['símbolo de moneda', '$1500'],
    ['porcentaje', '5%'],
    ['signo al final', '1.5-'],
  ])('rechaza %s', (_nombre, entrada) => {
    expectCode(() => parse(entrada), 'syntax');
  });
});

describe('parseMoney — NUMERIC(19,2)', () => {
  it.each([
    ['cero', '0'],
    ['monto típico COP', '1500000.00'],
    ['máximo representable', '99999999999999999.99'],
    ['máximo negativo', '-99999999999999999.99'],
    ['los ceros de relleno no cuentan como escala', '1.500'],
  ])('acepta %s', (_nombre, entrada) => {
    expect(() => parseMoney(entrada)).not.toThrow();
  });

  it.each([
    ['un entero más que el máximo', '100000000000000000.00'],
    ['negativo fuera de rango', '-100000000000000000.00'],
  ])('rechaza por rango: %s', (_nombre, entrada) => {
    expectCode(() => parseMoney(entrada), 'range');
  });

  it.each([
    ['tres decimales significativos', '1.001'],
    ['escala absurda', '0.000000000000000001'],
  ])('rechaza por escala: %s', (_nombre, entrada) => {
    expectCode(() => parseMoney(entrada), 'scale');
  });
});

describe('parseRate y parseScore', () => {
  it('respetan NUMERIC(9,6) para tasas', () => {
    expect(() => parseRate('999.999999')).not.toThrow();
    expectCode(() => parseRate('1000.0'), 'range');
    expectCode(() => parseRate('0.0000001'), 'scale');
  });

  it('respetan NUMERIC(6,2) para calificaciones', () => {
    expect(() => parseScore('100.00')).not.toThrow();
    expectCode(() => parseScore('10000.00'), 'range');
  });
});

describe('format', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'], // el cero negativo no es canónico en la salida
    ['5', '5'],
    ['1500000.00', '1500000'],
    ['1.500', '1.5'],
    ['-0.50', '-0.5'],
    ['100', '100'], // no se tocan los ceros de la parte entera
    ['0.010', '0.01'],
  ])('canoniza %s → %s y es idempotente', (entrada, esperado) => {
    const salida = format(parse(entrada));
    expect(salida).toBe(esperado);
    // La salida canónica vuelve a parsearse y serializarse igual.
    expect(format(parse(salida))).toBe(salida);
  });

  it('nunca usa notación científica', () => {
    // decimal.js pasa a exponencial en toString() a partir de 1e21; el contrato
    // no admite esa forma, así que format debe seguir siendo canónico.
    for (const s of [
      '1000000000000000000',
      '1000000000000000000000000',
      '0.000000000000000001',
      '-1000000000000000000000000',
    ]) {
      const salida = format(parse(s));
      expect(salida).not.toMatch(/[eE]/);
      expect(() => parse(salida)).not.toThrow();
    }
  });
});

describe('formatFixed', () => {
  it('rellena con ceros hasta la escala pedida', () => {
    expect(formatFixed(parse('1.5'), 2)).toBe('1.50');
    expect(formatFixed(parse('0'), 2)).toBe('0.00');
  });

  it('falla en lugar de redondear en silencio', () => {
    // Una pérdida de precisión silenciosa es justo lo que el Principio VIII evita.
    expectCode(() => formatFixed(parse('1.005'), 2), 'scale');
  });
});

describe('roundHalfEven', () => {
  it.each([
    // El empate se resuelve hacia el dígito par, no siempre hacia arriba.
    ['0.125', 2, '0.12'],
    ['0.135', 2, '0.14'],
    ['2.5', 0, '2'],
    ['3.5', 0, '4'],
    ['-2.5', 0, '-2'],
    ['-0.125', 2, '-0.12'],
    // Sin empate se redondea normalmente.
    ['0.126', 2, '0.13'],
    ['0.124', 2, '0.12'],
  ])('redondea %s a %i decimales → %s', (entrada, escala, esperado) => {
    expect(format(roundHalfEven(parse(entrada), escala))).toBe(esperado);
  });
});

describe('Principio VIII', () => {
  it('es exacto donde IEEE-754 falla', () => {
    // 0.1 + 0.2 !== 0.3 con `number`.
    expect(format(parse('0.1').plus(parse('0.2')))).toBe('0.3');
    // Se deja constancia del comportamiento que se está evitando.
    expect(0.1 + 0.2).not.toBe(0.3);

    // Un monto grande en COP más un centavo: con `number` el centavo se pierde
    // por falta de dígitos significativos.
    expect(format(parse('99999999999999.99').plus(parse('0.01')))).toBe(
      '100000000000000',
    );

    // Diez veces 0.1 debe ser exactamente 1.
    let acc = new Decimal(0);
    for (let i = 0; i < 10; i += 1) {
      acc = acc.plus(parse('0.1'));
    }
    expect(format(acc)).toBe('1');
  });
});
