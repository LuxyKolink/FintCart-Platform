import { CalcType } from './simulators.types';

/**
 * Metadatos de formulario y resultado de las cinco calculadoras — espejo de los
 * comentarios de cabecera de `services/simulator/src/calculators/*.rs`, que son la
 * única fuente de verdad de qué clave espera cada parámetro y qué clave devuelve cada
 * resultado (el contrato gRPC los transporta como `map<string, string>` sin nombrarlos
 * por campo). Si un nombre de clave cambia allá, tiene que cambiar aquí.
 */

export type FieldKind = 'money' | 'rate' | 'periods' | 'select';
export type ResultKind = 'money' | 'rate' | 'text';

export interface FieldConfig {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  help?: string;
  /** Solo para `kind: 'rate'`: rechaza tasas negativas (p. ej. ahorro, crédito). */
  forbidNegative?: boolean;
  /** Solo para `kind: 'rate'`: límite inferior estricto, p. ej. `'-1'` (> -100 %). */
  floorExclusive?: string;
  /** Solo para `kind: 'money'`: exige un valor mayor que cero, no solo `>= 0`. */
  strictlyPositive?: boolean;
  /** Solo para `kind: 'select'`. */
  options?: { value: string; label: string }[];
}

export interface ResultFieldConfig {
  key: string;
  label: string;
  kind: ResultKind;
  /** Solo aparece en el resultado si se envió el parámetro que lo origina (p. ej. `valor_futuro_real`). */
  optional?: boolean;
}

export interface CalculatorMode {
  /** `''` para las calculadoras de un solo modo; el valor de `operacion` para colombia_especifica. */
  value: string;
  label: string;
  fields: FieldConfig[];
  resultFields: ResultFieldConfig[];
  /**
   * Regla «al menos uno de estos campos debe ser > 0» (ahorro: depósito inicial o
   * aporte mensual). El Simulador la aplica en `ahorro.rs`; se repite aquí para no
   * dejar que el usuario descubra el rechazo solo tras enviar el formulario.
   */
  atLeastOneOf?: string[];
}

export interface CalculatorDefinition {
  calcType: CalcType;
  label: string;
  description: string;
  modes: CalculatorMode[];
}

const TASA_HELP = 'Como fracción, no como porcentaje: 12 % anual se escribe 0.12.';

export const CALCULATORS: CalculatorDefinition[] = [
  {
    calcType: 'ahorro',
    label: 'Ahorro',
    description: 'Proyecta cuánto tendrás si guardas un monto cada mes durante un plazo.',
    modes: [
      {
        value: '',
        label: '',
        fields: [
          { key: 'deposito_inicial', label: 'Depósito inicial', kind: 'money', required: false, help: 'Lo que ya tienes ahorrado hoy (opcional).' },
          { key: 'aporte_mensual', label: 'Aporte mensual', kind: 'money', required: false, help: 'Lo que aportarás al final de cada mes (opcional).' },
          { key: 'tasa_anual', label: 'Tasa anual', kind: 'rate', required: true, forbidNegative: true, help: TASA_HELP },
          { key: 'meses', label: 'Plazo (meses)', kind: 'periods', required: true },
        ],
        atLeastOneOf: ['deposito_inicial', 'aporte_mensual'],
        resultFields: [
          { key: 'monto_final', label: 'Monto final', kind: 'money' },
          { key: 'total_aportado', label: 'Total aportado', kind: 'money' },
          { key: 'interes_ganado', label: 'Interés ganado', kind: 'money' },
          { key: 'tasa_mensual', label: 'Tasa mensual equivalente', kind: 'rate' },
        ],
      },
    ],
  },
  {
    calcType: 'credito',
    label: 'Crédito',
    description: 'Calcula la cuota mensual y el costo total de un crédito por amortización francesa.',
    modes: [
      {
        value: '',
        label: '',
        fields: [
          { key: 'monto', label: 'Monto del crédito', kind: 'money', required: true, strictlyPositive: true },
          { key: 'tasa_anual', label: 'Tasa anual', kind: 'rate', required: true, forbidNegative: true, help: TASA_HELP },
          { key: 'meses', label: 'Número de cuotas', kind: 'periods', required: true },
        ],
        resultFields: [
          { key: 'cuota_mensual', label: 'Cuota mensual', kind: 'money' },
          { key: 'total_pagado', label: 'Total pagado', kind: 'money' },
          { key: 'interes_total', label: 'Interés total', kind: 'money' },
          { key: 'tasa_mensual', label: 'Tasa mensual equivalente', kind: 'rate' },
        ],
      },
    ],
  },
  {
    calcType: 'presupuesto',
    label: 'Presupuesto',
    description: 'Calcula el balance mensual y la fracción del ingreso que queda disponible.',
    modes: [
      {
        value: '',
        label: '',
        fields: [
          { key: 'ingreso_mensual', label: 'Ingreso mensual', kind: 'money', required: true, strictlyPositive: true },
          { key: 'gastos_fijos', label: 'Gastos fijos', kind: 'money', required: false, help: 'Arriendo, servicios, cuotas (opcional).' },
          { key: 'gastos_variables', label: 'Gastos variables', kind: 'money', required: false, help: 'Mercado, transporte, ocio (opcional).' },
        ],
        resultFields: [
          { key: 'gasto_total', label: 'Gasto total', kind: 'money' },
          { key: 'balance', label: 'Balance', kind: 'money' },
          { key: 'tasa_ahorro', label: 'Fracción del ingreso disponible', kind: 'rate' },
        ],
      },
    ],
  },
  {
    calcType: 'inversion',
    label: 'Inversión',
    description: 'Proyecta el valor futuro de una inversión con capitalización anual.',
    modes: [
      {
        value: '',
        label: '',
        fields: [
          { key: 'capital', label: 'Capital inicial', kind: 'money', required: true, strictlyPositive: true },
          { key: 'tasa_anual', label: 'Rendimiento anual', kind: 'rate', required: true, floorExclusive: '-1', help: TASA_HELP },
          { key: 'anios', label: 'Horizonte (años)', kind: 'periods', required: true },
          { key: 'aporte_anual', label: 'Aporte anual', kind: 'money', required: false, help: 'Aporte al final de cada año (opcional).' },
          { key: 'inflacion_anual', label: 'Inflación anual', kind: 'rate', required: false, floorExclusive: '-1', help: 'Opcional — si se indica, se añade el valor futuro real (descontado por inflación).' },
        ],
        resultFields: [
          { key: 'valor_futuro', label: 'Valor futuro', kind: 'money' },
          { key: 'capital_invertido', label: 'Capital invertido', kind: 'money' },
          { key: 'rendimiento', label: 'Rendimiento', kind: 'money' },
          { key: 'valor_futuro_real', label: 'Valor futuro real (descontada la inflación)', kind: 'money', optional: true },
        ],
      },
    ],
  },
  {
    calcType: 'colombia_especifica',
    label: 'Colombia — tasas y GMF',
    description: 'Conversión Efectiva Anual ↔ Mes Vencido y cálculo del Gravamen a los Movimientos Financieros (4×1000).',
    modes: [
      {
        value: 'ea_a_mv',
        label: 'Efectiva Anual → Mes Vencido',
        fields: [{ key: 'tasa_ea', label: 'Tasa Efectiva Anual', kind: 'rate', required: true, floorExclusive: '-1', help: TASA_HELP }],
        resultFields: [
          { key: 'tasa_mv', label: 'Tasa Mes Vencido', kind: 'rate' },
          { key: 'tasa_nominal_anual', label: 'Tasa nominal anual', kind: 'rate' },
        ],
      },
      {
        value: 'mv_a_ea',
        label: 'Mes Vencido → Efectiva Anual',
        fields: [{ key: 'tasa_mv', label: 'Tasa Mes Vencido', kind: 'rate', required: true, floorExclusive: '-1', help: TASA_HELP }],
        resultFields: [
          { key: 'tasa_ea', label: 'Tasa Efectiva Anual', kind: 'rate' },
          { key: 'tasa_nominal_anual', label: 'Tasa nominal anual', kind: 'rate' },
        ],
      },
      {
        value: 'gmf',
        label: 'Gravamen a los Movimientos Financieros (4×1000)',
        fields: [
          { key: 'monto', label: 'Valor del retiro o traslado', kind: 'money', required: true, strictlyPositive: true },
          { key: 'valor_uvt', label: 'Valor de la UVT vigente', kind: 'money', required: true, strictlyPositive: true },
          {
            key: 'exento',
            label: '¿Cuenta con exención (cuenta de ahorro única)?',
            kind: 'select',
            required: false,
            options: [
              { value: 'no', label: 'No' },
              { value: 'si', label: 'Sí, tengo cuenta de ahorros marcada como exenta' },
            ],
          },
        ],
        resultFields: [
          { key: 'gravamen', label: 'Gravamen (4×1000)', kind: 'money' },
          { key: 'base_gravable', label: 'Base gravable', kind: 'money' },
          { key: 'monto_exento', label: 'Monto exento', kind: 'money' },
          { key: 'tope_exencion', label: 'Tope de exención', kind: 'money' },
          { key: 'neto_recibido', label: 'Neto recibido', kind: 'money' },
        ],
      },
    ],
  },
];

export function calculatorFor(calcType: CalcType): CalculatorDefinition | undefined {
  return CALCULATORS.find((c) => c.calcType === calcType);
}
