import {
  coversToday,
  describeValidTo,
  normalizeIndicatorValue,
  todayIso,
  validateIndicatorName,
  validateIndicatorValue,
  validateValidity,
} from './indicator-form';

/**
 * Reglas del formulario de indicadores (T108, FR-056).
 *
 * ## Qué se fija aquí y por qué importa
 *
 * Estos casos son los MISMOS que rechaza el Simulador (`services/simulator/tests/indicators.rs`
 * y la columna `NUMERIC(20,6)`), y se escriben dos veces por una razón concreta: el borde
 * responde «petición inválida» a cualquier entrada que rechace el servicio —su mapeo de
 * errores está saneado a propósito— así que sin esta comprobación el administrador perdería
 * el formulario sin saber qué corregir.
 *
 * El riesgo de tener dos copias es que se separen: la de aquí aceptaría algo que la de allá
 * rechaza, y el formulario fallaría igual que si no existiera. Por eso cada regla está citada
 * con su equivalente en el servidor, y los límites se prueban por los dos lados.
 */
describe('reglas del valor de un indicador', () => {
  it('acepta una cifra entera', () => {
    expect(validateIndicatorValue('49799')).toBeNull();
  });

  it('acepta una tasa con decimales', () => {
    expect(validateIndicatorValue('0.05')).toBeNull();
    expect(validateIndicatorValue('0.250000')).toBeNull();
  });

  it('acepta el cero', () => {
    // El `CHECK` de la tabla admite el cero (`value >= 0`), y un indicador en cero es un
    // dato legítimo aunque inútil: el rango declarado de una fórmula decide si sirve.
    expect(validateIndicatorValue('0')).toBeNull();
  });

  it('rechaza la cifra vacía', () => {
    expect(validateIndicatorValue('')).not.toBeNull();
    expect(validateIndicatorValue('   ')).not.toBeNull();
  });

  it('rechaza un valor negativo', () => {
    const mensaje = validateIndicatorValue('-1');
    expect(mensaje).toContain('negativo');
  });

  it('rechaza el separador de miles y la coma decimal', () => {
    // «49.799» es cuarenta y nueve mil setecientos noventa y nueve para quien lo escribe en
    // Colombia, y cuarenta y nueve con setecientos noventa y nueve milésimas para el motor.
    // Aceptarlo sería guardar una cifra distinta de la que se quiso escribir.
    expect(validateIndicatorValue('49.799')).toBeNull(); // es un decimal válido…
    expect(validateIndicatorValue('49,799')).not.toBeNull();
  });

  it('rechaza la notación científica', () => {
    expect(validateIndicatorValue('1e5')).not.toBeNull();
  });

  it('rechaza más de seis decimales', () => {
    expect(validateIndicatorValue('0.123456')).toBeNull();
    expect(validateIndicatorValue('0.1234567')).not.toBeNull();
  });

  it('los ceros a la derecha no cuentan como decimales', () => {
    // La escala se mide sobre los decimales SIGNIFICATIVOS, igual que
    // `decimal_str::parse_numeric`: `1.500000` tiene un decimal, no seis. Rechazarlo
    // castigaría a quien pega una cifra con el ancho fijo de una hoja de cálculo.
    expect(validateIndicatorValue('1.500000')).toBeNull();
    expect(validateIndicatorValue('1.5000001')).not.toBeNull();
  });

  it('rechaza una cifra que no cabe en la columna', () => {
    // `NUMERIC(20,6)` admite 14 dígitos enteros.
    expect(validateIndicatorValue('99999999999999')).toBeNull();
    expect(validateIndicatorValue('100000000000000')).not.toBeNull();
  });
});

describe('forma canónica del valor', () => {
  it('quita los ceros sobrantes', () => {
    expect(normalizeIndicatorValue('0.050000')).toBe('0.05');
    expect(normalizeIndicatorValue('  49799  ')).toBe('49799');
  });

  it('no pierde precisión al normalizar', () => {
    // El valor no se redondea a ningún ancho: `0.123456` sale con sus seis decimales.
    expect(normalizeIndicatorValue('0.123456')).toBe('0.123456');
  });

  it('no produce notación científica', () => {
    // La columna es `NUMERIC` y rechazaría `1e+5`; el rango admitido mantiene la cifra
    // fuera del exponente, y esto lo fija.
    expect(normalizeIndicatorValue('99999999999999')).toBe('99999999999999');
  });
});

describe('reglas de la vigencia', () => {
  it('acepta un año completo', () => {
    expect(validateValidity('2026-01-01', '2027-01-01')).toBeNull();
  });

  it('rechaza una vigencia que no cubre ningún día', () => {
    // El fin es EXCLUSIVO: empezar y terminar el mismo día no cubre ese día. Sin esta
    // comprobación el `CHECK` de la tabla lo rechazaría igual, pero con un mensaje sobre
    // un rango vacío.
    const mensaje = validateValidity('2026-01-01', '2026-01-01');
    expect(mensaje).toContain('exclusivo');
  });

  it('rechaza una vigencia al revés', () => {
    expect(validateValidity('2027-01-01', '2026-01-01')).not.toBeNull();
  });

  it('rechaza una fecha ausente', () => {
    expect(validateValidity('', '2027-01-01')).not.toBeNull();
    expect(validateValidity('2026-01-01', '')).not.toBeNull();
  });
});

describe('nombre del indicador', () => {
  it('acepta los nombres que las fórmulas pueden referenciar', () => {
    for (const nombre of ['UVT', 'TASA_USURA', 'SMMLV2026', 'IPC_1']) {
      expect(validateIndicatorName(nombre)).toBeNull();
    }
  });

  it('rechaza lo que ninguna fórmula podría leer', () => {
    // Un nombre en minúsculas no puede existir en la tabla: `@uvt` nunca resolvería. El
    // mensaje tiene que decir la forma, no solo que está mal.
    for (const nombre of ['uvt', 'Uvt', '_UVT', '1UVT', 'UVT USURA', '']) {
      expect(validateIndicatorName(nombre)).not.toBeNull();
    }
  });
});

describe('presentación de la vigencia', () => {
  it('dice «sin fecha de fin» cuando el contrato manda la cadena vacía', () => {
    expect(describeValidTo('')).toBe('sin fecha de fin');
    expect(describeValidTo('2027-01-01')).toBe('2027-01-01');
  });

  it('la vigencia en curso incluye el primer día y excluye el último', () => {
    const hoy = '2026-06-15';
    expect(coversToday('2026-01-01', '2027-01-01', hoy)).toBe(true);
    expect(coversToday('2026-06-15', '2026-07-01', hoy)).toBe(true);
    expect(coversToday('2025-01-01', '2026-01-01', hoy)).toBe(false);
    expect(coversToday('2026-06-15', '2026-06-15', hoy)).toBe(false);
  });

  it('una vigencia sin fecha de fin cubre cualquier día posterior', () => {
    expect(coversToday('2026-01-01', '', '2030-01-01')).toBe(true);
  });

  it('hoy se escribe como fecha ISO, sin horas', () => {
    // La comparación de fechas es de texto y funciona porque las dos partes son ISO; una
    // fecha con hora (`2026-06-15T05:00:00Z`) haría que la comparación dependiera del
    // formato y fallara justo en el día del cambio.
    expect(todayIso(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-15');
  });
});
