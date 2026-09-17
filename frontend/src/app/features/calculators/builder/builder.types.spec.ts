import { Calculator, DefinitionIssue } from '../calculator.types';
import {
  CalculatorDraft,
  describeIssue,
  draftFrom,
  emptyDraft,
  issueControlPath,
  issueRowIndex,
  toDefinition,
  toWriteBody,
} from './builder.types';

/**
 * Modelo del constructor visual (T097, FR-043…FR-046).
 *
 * Se prueba aparte del componente porque estas son las reglas del borrador —qué se manda, qué se
 * omite, dónde cae un problema— y no el cableado de Angular. Tres de ellas tienen consecuencia
 * fuera de la pantalla:
 *
 *   · **Los campos vacíos se omiten**, porque «sin cota» y «cota vacía» son cosas distintas en el
 *     contrato y mandar la cadena vacía obligaría al Simulador a adivinar cuál de las dos es.
 *   · **Las cotas viajan como cadenas**, sin pasar por `number`: `Number('100000000000000000000')`
 *     deja de ser el número que el autor escribió (Principio VIII).
 *   · **`location` se traduce a la ruta del control** —`inputs[1].key` → `inputs.1.key`—, que es
 *     lo que permite resaltar el campo exacto que el servidor señala.
 */
describe('builder.types', () => {
  const calculadora: Calculator = {
    calculator_id: 'c1',
    name: 'Ahorro con aportes',
    description: 'Cuánto tendré si guardo esto cada mes',
    is_builtin: false,
    state: 'privada',
    version: 1,
    definition: {
      inputs: [
        {
          key: 'deposito',
          label: 'Depósito inicial',
          type: 'monto',
          unit: 'COP',
          min_value: '0',
          default_value: '0',
          required: true,
        },
        { key: 'meses', label: 'Meses', type: 'entero', unit: 'meses', required: true },
      ],
      validations: [{ expression: 'meses > 0', message: 'El plazo tiene que ser positivo' }],
      outputs: [{ key: 'saldo', label: 'Saldo final', expression: 'deposito * meses', scale: 2 }],
    },
    indicators_used: [],
  };

  describe('borrador', () => {
    it('empieza con una fila de entradas y una de resultados para poder escribir', () => {
      const draft = emptyDraft();
      expect(draft.inputs.length).toBe(1);
      expect(draft.outputs.length).toBe(1);
      // Sin reglas: son opcionales, y una fila vacía obligaría a borrarla cada vez.
      expect(draft.validations.length).toBe(0);
    });

    it('copia la calculadora guardada, incluidas sus cotas y su valor por defecto', () => {
      const draft = draftFrom(calculadora);
      expect(draft.name).toBe('Ahorro con aportes');
      expect(draft.inputs[0].min_value).toBe('0');
      expect(draft.inputs[0].default_value).toBe('0');
      expect(draft.inputs[1].type).toBe('entero');
      expect(draft.outputs[0].scale).toBe('2');
      // Una cota ausente se representa con cadena vacía, que es «sin cota» en el contrato.
      expect(draft.inputs[1].min_value).toBe('');
      expect(draft.inputs[1].max_value).toBe('');
    });

    it('la ida y vuelta no cambia nada (FR-043)', () => {
      // La propiedad que importa al editar: abrir una calculadora y guardarla sin tocar nada no
      // puede cambiar lo que hay guardado. Es la misma que sostiene el editor de artículos.
      const vuelta = toDefinition(draftFrom(calculadora));
      expect(vuelta).toEqual(calculadora.definition);
    });
  });

  describe('lo que se manda al guardar', () => {
    it('omite los campos que el autor no declaró', () => {
      const body = toWriteBody(draftFrom(calculadora));
      expect(body.definition.inputs[1]).toEqual({
        key: 'meses',
        label: 'Meses',
        type: 'entero',
        unit: 'meses',
        required: true,
      });
      expect('min_value' in body.definition.inputs[1]).toBeFalse();
      expect('max_value' in body.definition.inputs[1]).toBeFalse();
      expect('default_value' in body.definition.inputs[1]).toBeFalse();
      // Y lo mismo con el `when` de una salida: solo viaja si existe.
      expect('when' in body.definition.outputs[0]).toBeFalse();
    });

    it('las cotas viajan como CADENAS, sin pasar por number (Principio VIII)', () => {
      const draft: CalculatorDraft = {
        ...emptyDraft(),
        inputs: [
          {
            key: 'monto',
            label: 'Monto',
            type: 'monto',
            unit: 'COP',
            // Veintiún dígitos: un `number` lo redondearía en silencio y la cota que se guardaría
            // no sería la que el autor escribió.
            max_value: '100000000000000000000',
            min_value: '0.000000000000000001',
            default_value: '',
            required: true,
          },
        ],
      };

      const campo = toWriteBody(draft).definition.inputs[0];
      expect(campo.max_value).toBe('100000000000000000000');
      expect(campo.min_value).toBe('0.000000000000000001');
      expect(typeof campo.max_value).toBe('string');
    });

    it('recorta los espacios de los bordes y no convierte los números de la escala', () => {
      const draft: CalculatorDraft = {
        ...emptyDraft(),
        name: '  Con espacios  ',
        description: '  Una descripción  ',
        outputs: [
          { key: ' saldo ', label: ' Saldo ', expression: ' monto * 2 ', scale: ' 2 ', when: ' ' },
        ],
      };

      const body = toWriteBody(draft);
      expect(body.name).toBe('Con espacios');
      expect(body.description).toBe('Una descripción');
      expect(body.definition.outputs[0].key).toBe('saldo');
      expect(body.definition.outputs[0].expression).toBe('monto * 2');
      // La escala sí es un número: es un recuento de decimales, no una cifra (y el contrato la
      // declara `int32`).
      expect(body.definition.outputs[0].scale).toBe(2);
      expect('when' in body.definition.outputs[0]).toBeFalse();
    });

    it('la escala vacía se manda como cero y el problema lo dice el servidor', () => {
      // No se inventa aquí un mensaje: quien tiene el vocabulario de los errores es el contrato,
      // y un cero es la lectura literal de «ningún decimal».
      const draft: CalculatorDraft = {
        ...emptyDraft(),
        outputs: [{ key: 'saldo', label: 'Saldo', expression: 'monto', scale: '', when: '' }],
      };
      expect(toWriteBody(draft).definition.outputs[0].scale).toBe(0);
    });
  });

  describe('ubicaciones de los problemas (FR-046)', () => {
    it('traduce la ubicación del contrato a la ruta del control', () => {
      expect(issueControlPath('inputs[1].key')).toBe('inputs.1.key');
      expect(issueControlPath('validations[0].message')).toBe('validations.0.message');
      expect(issueControlPath('outputs[2].expression')).toBe('outputs.2.expression');
    });

    it('deja sin traducir lo que no es una fila, para no marcar un campo al azar', () => {
      for (const location of ['definition', 'inputs', 'outputs[0]', 'otra_cosa[0].key', '']) {
        expect(issueControlPath(location)).withContext(location).toBeNull();
      }
    });

    it('el texto de un problema lleva la ubicación delante: la misma clave puede repetirse', () => {
      const issue: DefinitionIssue = {
        location: 'outputs[1].key',
        code: 'clave_duplicada',
        message: 'ya hay otra salida con esa clave',
      };
      expect(describeIssue(issue)).toBe('outputs[1].key: ya hay otra salida con esa clave');
      // Sin ubicación se dice «definición» en lugar de dejar el hueco vacío.
      expect(describeIssue({ location: '', code: 'x', message: 'algo' })).toBe('definición: algo');
    });

    it('la fila señalada se puede sacar de la ubicación', () => {
      expect(issueRowIndex({ location: 'inputs[3].min_value', code: 'x', message: 'y' })).toBe(3);
      expect(issueRowIndex({ location: 'inputs', code: 'x', message: 'y' })).toBe(-1);
    });
  });
});
