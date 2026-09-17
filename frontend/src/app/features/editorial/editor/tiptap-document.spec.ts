/**
 * Las dos conversiones del editor (T131, T132, FR-063).
 *
 * Lo que se fija aquí es el CONTRATO del editor con el vocabulario del servidor, y hay dos
 * propiedades que valen más que el resto:
 *
 *  1. **Nada que el servidor vaya a rechazar puede salir de la conversión.** Un nodo fuera
 *     del vocabulario, un enlace `javascript:`, un `texto` vacío o un encabezado con un nivel
 *     que no existe. Si algo así se colara, quien escribe vería un error al guardar que habla
 *     de un nodo que no ve, y tendría que adivinar cuál de los bloques es.
 *  2. **Guardar sin tocar nada no cambia el documento.** Es la propiedad que impide que el
 *     editor corrompa un artículo por el mero hecho de abrirlo: cargar y volver a guardar
 *     tiene que dar exactamente el mismo árbol. Un editor que «normaliza» en silencio hace
 *     que la comparación de versiones deje de servir para nada.
 *
 * Se prueban como funciones puras, sin navegador: son funciones puras, y probarlas a través
 * de la interfaz ataría estas reglas a cómo se dibuja la barra de herramientas.
 */
import type { JSONContent } from '@tiptap/core';

import type { BodyDocNode } from '../../../shared/body-doc';
import { toBodyDoc, toEditorDoc } from './tiptap-document';

/** Una marca de ProseMirror. */
type Marca = { type: string; attrs?: Record<string, unknown> };

/** Un párrafo de ProseMirror con un texto. */
function pm(texto: string, marcas?: Marca[]): JSONContent {
  return marcas === undefined
    ? { type: 'paragraph', content: [{ type: 'text', text: texto }] }
    : { type: 'paragraph', content: [{ type: 'text', text: texto, marks: marcas }] };
}

/** Un párrafo del vocabulario con un texto. */
function doc(texto: string, marcas?: readonly { tipo: string; href?: string }[]): BodyDocNode {
  return marcas === undefined
    ? { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto }] }
    : { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto, marcas: [...marcas] }] };
}

describe('toBodyDoc — lo que se escribe se convierte en el vocabulario del servidor', () => {
  it('un párrafo con texto', () => {
    const resultado = toBodyDoc({ type: 'doc', content: [pm('Hola')] });

    expect(resultado).toEqual({ tipo: 'doc', contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Hola' }] }] });
  });

  it('las tres marcas del vocabulario, y solo esas', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [pm('negro', [{ type: 'bold' }]), pm('ita', [{ type: 'italic' }]), pm('aquí', [{ type: 'link', attrs: { href: 'https://ejemplo.com' } }])],
    });

    expect(resultado.contenido).toEqual([
      doc('negro', [{ tipo: 'negrita' }]),
      doc('ita', [{ tipo: 'cursiva' }]),
      doc('aquí', [{ tipo: 'enlace', href: 'https://ejemplo.com' }]),
    ]);
  });

  it('un enlace con esquema no admitido se cae y el texto SE QUEDA', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [pm('pulsa', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])],
    });

    // No se pierde el texto: se pierde el enlace. Es la misma decisión que toma el lector.
    expect(resultado.contenido).toEqual([doc('pulsa')]);
  });

  it('un encabezado conserva su nivel, y uno imposible cae al nivel por defecto', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tres' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Uno' }] },
      ],
    });

    // El `h1` es de la PANTALLA, no del artículo: el vocabulario empieza en 2. Un nivel 1
    // no se guarda tal cual porque el servidor lo rechazaría; se convierte al primero
    // admitido, que es el único resultado razonable sin descartar el bloque entero.
    expect(resultado.contenido).toEqual([
      { tipo: 'encabezado', nivel: 3, contenido: [{ tipo: 'texto', texto: 'Tres' }] },
      { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Uno' }] },
    ]);
  });

  it('una lista ordenada y una con viñetas se distinguen, con sus elementos', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [pm('Uno')] },
            { type: 'listItem', content: [pm('Dos')] },
          ],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [pm('Otro')] }] },
      ],
    });

    expect(resultado.contenido).toEqual([
      {
        tipo: 'lista',
        ordenada: true,
        contenido: [
          { tipo: 'item_lista', contenido: [doc('Uno')] },
          { tipo: 'item_lista', contenido: [doc('Dos')] },
        ],
      },
      { tipo: 'lista', ordenada: false, contenido: [{ tipo: 'item_lista', contenido: [doc('Otro')] }] },
    ]);
  });

  it('el `ordenada` viaja SIEMPRE, porque el vocabulario lo exige', () => {
    // Una lista sin decidir si está ordenada se dibujaría distinta según quién la lea: el
    // validador del servidor la rechaza y aquí se comprueba que la conversión siempre lo pone.
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [pm('x')] }] }],
    });

    const lista = resultado.contenido?.[0];
    expect(lista?.tipo).toBe('lista');
    expect(typeof lista?.ordenada).toBe('boolean');
  });

  it('una imagen lleva identificador, `alt` y pie', () => {
    const id = 'a'.repeat(64);
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'imagen', attrs: { imageId: id, alt: 'Una alcancía', pie: 'Figura 1' } }],
    });

    expect(resultado.contenido).toEqual([{ tipo: 'imagen', image_id: id, alt: 'Una alcancía', pie: 'Figura 1' }]);
  });

  it('el pie vacío no se guarda como cadena vacía', () => {
    // El vocabulario dice «si está, no puede estar vacío»: guardar `pie: ''` sería mandar un
    // dato que el servidor rechaza para expresar «no hay pie», que es lo que dice su ausencia.
    const id = 'b'.repeat(64);
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'imagen', attrs: { imageId: id, alt: 'x', pie: '   ' } }],
    });

    expect(resultado.contenido?.[0]).toEqual({ tipo: 'imagen', image_id: id, alt: 'x' });
  });

  it('una imagen sin identificador válido no se guarda', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [
        { type: 'imagen', attrs: { imageId: null, alt: 'x' } },
        { type: 'imagen', attrs: { imageId: 'no-es-un-hash', alt: 'x' } },
      ],
    });

    expect(resultado.contenido).toEqual([]);
  });

  it('un párrafo vacío no se guarda: es el que deja el editor recién abierto', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'paragraph' }, { type: 'paragraph', content: [] }, pm('De verdad')],
    });

    expect(resultado.contenido).toEqual([doc('De verdad')]);
  });

  it('un nodo de texto sin texto no se guarda', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
    });

    expect(resultado.contenido).toEqual([]);
  });

  it('un tipo de nodo desconocido se descarta en vez de viajar', () => {
    // No debería llegar (el esquema no lo produce), pero si alguien añade una extensión sin
    // tocar esta función, es mejor perder el bloque que mandarlo y recibir un rechazo.
    const resultado = toBodyDoc({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }, pm('Válido')],
    });

    expect(resultado.contenido).toEqual([doc('Válido')]);
  });

  it('el texto de varias marcas se guarda con TODAS', () => {
    const resultado = toBodyDoc({
      type: 'doc',
      content: [pm('fuerte', [{ type: 'bold' }, { type: 'italic' }])],
    });

    expect(resultado.contenido).toEqual([doc('fuerte', [{ tipo: 'negrita' }, { tipo: 'cursiva' }])]);
  });
});

describe('toEditorDoc — lo que se guardó se vuelve a abrir igual', () => {
  it('un documento completo se convierte en bloques editables', () => {
    const id = 'c'.repeat(64);
    const documento: BodyDocNode = {
      tipo: 'doc',
      contenido: [
        { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Título' }] },
        doc('Texto', [{ tipo: 'negrita' }]),
        {
          tipo: 'lista',
          ordenada: false,
          contenido: [{ tipo: 'item_lista', contenido: [doc('Viñeta')] }],
        },
        { tipo: 'imagen', image_id: id, alt: 'Descripción', pie: 'Pie' },
      ],
    };

    const editable = toEditorDoc(documento);

    expect(editable.type).toBe('doc');
    expect(editable.content?.map((nodo) => nodo.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'imagen',
    ]);
    expect(editable.content?.[0]?.attrs?.['level']).toBe(2);
    expect(editable.content?.[1]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]);
    expect(editable.content?.[3]?.attrs).toEqual({ imageId: id, alt: 'Descripción', pie: 'Pie' });
  });

  it('un documento vacío deja un párrafo: sin él no hay dónde escribir', () => {
    const editable = toEditorDoc({ tipo: 'doc', contenido: [] });

    // ProseMirror necesita un bloque donde poner el cursor. Sin esto, la pantalla se vería
    // vacía y la primera letra que alguien escribiera no aparecería.
    expect(editable.content).toEqual([{ type: 'paragraph' }]);
  });

  it('una imagen sin `alt` no se reconstruye', () => {
    const editable = toEditorDoc({
      tipo: 'doc',
      contenido: [{ tipo: 'imagen', image_id: 'd'.repeat(64), alt: '  ' }, doc('Queda esto')],
    });

    expect(editable.content?.map((nodo) => nodo.type)).toEqual(['paragraph']);
    expect(editable.content?.[0]?.content?.[0]?.text).toBe('Queda esto');
  });

  it('una calculadora no se pierde en silencio: queda su referencia', () => {
    // El editor no inserta calculadoras (T153), pero un documento que las traiga no puede
    // perderlas al abrirlo y guardarlo. Se conserva una referencia honesta: texto que dice
    // que hay una calculadora y cuál.
    const editable = toEditorDoc({
      tipo: 'doc',
      contenido: [{ tipo: 'calculadora', calculator_id: 'calc-1', version: 3 }],
    });

    expect(editable.content?.[0]?.content?.[0]?.text).toBe('[calculadora calc-1]');
  });

  it('un enlace con esquema no admitido se abre sin enlace, no sin texto', () => {
    const editable = toEditorDoc({
      tipo: 'doc',
      contenido: [doc('pulsa', [{ tipo: 'enlace', href: 'javascript:alert(1)' }])],
    });

    expect(editable.content?.[0]?.content?.[0]?.text).toBe('pulsa');
    expect(editable.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });
});

describe('ida y vuelta — abrir y guardar no cambia el documento', () => {
  const id = 'e'.repeat(64);
  const DOCUMENTO: BodyDocNode = {
    tipo: 'doc',
    contenido: [
      { tipo: 'encabezado', nivel: 3, contenido: [{ tipo: 'texto', texto: 'Cómo ahorrar' }] },
      {
        tipo: 'parrafo',
        contenido: [
          { tipo: 'texto', texto: 'Ahorra ' },
          { tipo: 'texto', texto: 'primero', marcas: [{ tipo: 'negrita' }] },
          { tipo: 'texto', texto: ' y luego gasta', marcas: [{ tipo: 'cursiva' }] },
        ],
      },
      {
        tipo: 'lista',
        ordenada: true,
        contenido: [
          { tipo: 'item_lista', contenido: [doc('Fijos')] },
          { tipo: 'item_lista', contenido: [doc('Variables')] },
        ],
      },
      {
        tipo: 'parrafo',
        contenido: [{ tipo: 'texto', texto: 'Más información', marcas: [{ tipo: 'enlace', href: 'https://ejemplo.com' }] }],
      },
      { tipo: 'imagen', image_id: id, alt: 'Una alcancía con monedas', pie: 'Figura 1' },
    ],
  };

  it('guardar sin tocar nada devuelve EXACTAMENTE el mismo documento', () => {
    // Es la propiedad que impide que abrir un artículo lo modifique. Si se rompiera, cada
    // visita a un borrador crearía una diferencia en el historial sin que nadie escribiera.
    expect(toBodyDoc(toEditorDoc(DOCUMENTO))).toEqual(DOCUMENTO);
  });

  it('y volver a abrirlo tampoco', () => {
    expect(toEditorDoc(toBodyDoc(toEditorDoc(DOCUMENTO)))).toEqual(toEditorDoc(DOCUMENTO));
  });

  it('sobrevive a un documento de bloques anidados', () => {
    const anidado: BodyDocNode = {
      tipo: 'doc',
      contenido: [
        {
          tipo: 'lista',
          ordenada: false,
          contenido: [
            {
              tipo: 'item_lista',
              contenido: [
                doc('Primero'),
                { tipo: 'lista', ordenada: true, contenido: [{ tipo: 'item_lista', contenido: [doc('Dentro')] }] },
              ],
            },
          ],
        },
      ],
    };

    expect(toBodyDoc(toEditorDoc(anidado))).toEqual(anidado);
  });
});
