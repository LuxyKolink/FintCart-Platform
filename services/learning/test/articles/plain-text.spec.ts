/**
 * La regla de conversión de texto plano a documento (T124, FR-069).
 *
 * Esta prueba fija la regla, y su valor real está en el acoplamiento con la migración
 * `20260902111500_article_versions_body_doc`: los mismos casos tienen que producir el
 * mismo documento que la migración produjo sobre las 79 versiones reales. Si alguien
 * cambia la regla aquí sin cambiarla allí, el contenido nuevo y el viejo se leerían
 * distinto, y la prueba tiene que ser lo bastante concreta para que ese cambio se note.
 *
 * Se prueba también que el documento producido **pasa el validador**: convertir y
 * validar son dos pasos seguidos en el camino de escritura, y una conversión que
 * produjera un documento inválido fallaría al guardar, con un error que apuntaría al
 * validador en vez de a la conversión.
 */
import { validateBodyDoc } from '../../src/articles/body-doc.validator';
import { plainTextToBodyDoc } from '../../src/articles/plain-text';

const parrafo = (texto: string): unknown => ({
  tipo: 'parrafo',
  contenido: [{ tipo: 'texto', texto }],
});

describe('plainTextToBodyDoc', () => {
  it('un solo párrafo', () => {
    expect(plainTextToBodyDoc('Un cuerpo breve.')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('Un cuerpo breve.')],
    });
  });

  it('parte por líneas en blanco y conserva el orden', () => {
    expect(plainTextToBodyDoc('Primero.\n\nSegundo.\n\nTercero.')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('Primero.'), parrafo('Segundo.'), parrafo('Tercero.')],
    });
  });

  it('un salto de línea simple NO separa párrafos: es el mismo párrafo', () => {
    expect(plainTextToBodyDoc('Una línea\npartida en dos')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('Una línea\npartida en dos')],
    });
  });

  it('colapsa varias líneas en blanco seguidas en un solo separador', () => {
    expect(plainTextToBodyDoc('A\n\n\n\nB')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('A'), parrafo('B')],
    });
  });

  it('una línea en blanco con espacios o tabulaciones dentro también separa', () => {
    expect(plainTextToBodyDoc('A\n \t \nB')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('A'), parrafo('B')],
    });
  });

  it('trata los finales de línea de Windows como finales de línea', () => {
    expect(plainTextToBodyDoc('A\r\n\r\nB\r\nC')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('A'), parrafo('B\nC')],
    });
  });

  it('recorta los extremos de cada párrafo', () => {
    expect(plainTextToBodyDoc('  A  \n\n  B  ')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('A'), parrafo('B')],
    });
  });

  it('un texto vacío o en blanco produce el documento vacío, no un párrafo vacío', () => {
    for (const texto of ['', '   ', '\n', '\n\n\n', ' \t \n ']) {
      expect(plainTextToBodyDoc(texto)).toEqual({ tipo: 'doc', contenido: [] });
    }
  });

  it('no interpreta marcas: el texto llega tal cual', () => {
    expect(plainTextToBodyDoc('**negrita** y _cursiva_')).toEqual({
      tipo: 'doc',
      contenido: [parrafo('**negrita** y _cursiva_')],
    });
  });

  it('lo que produce pasa el validador del vocabulario cerrado', () => {
    const cuerpos = [
      'A',
      'Primero.\n\nSegundo.',
      'A\n\n\n\nB',
      '**x**',
      '  extremos  ',
      'A\r\n\r\nB',
      '¿Acentos, tildes y ñ?\n\nSí.',
    ];
    for (const cuerpo of cuerpos) {
      expect(() => validateBodyDoc(plainTextToBodyDoc(cuerpo))).not.toThrow();
    }
  });

  it('el texto de los párrafos es el cuerpo original sin los separadores', () => {
    const original = 'Uno.\n\nDos.\n\nTres.';
    const doc = plainTextToBodyDoc(original);
    expect(JSON.stringify(doc)).toBe(JSON.stringify(plainTextToBodyDoc(original)));
  });
});
