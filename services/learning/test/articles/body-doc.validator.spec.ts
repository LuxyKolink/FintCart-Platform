/**
 * Validador del vocabulario cerrado del documento de bloques (T120, FR-063, FR-068).
 *
 * La mitad de estos casos comprueban **rechazos**, y esa proporción es deliberada:
 * un validador que solo se prueba con documentos válidos pasa igual de verde si su
 * cuerpo es `return doc`. Lo que hay que fijar es que **niega**, y que al negar dice
 * qué nodo, qué atributo y en qué parte del árbol — porque el documento lo escribe
 * una máquina y lo depura una persona.
 *
 * Los casos de `href` son los que más justifican que el vocabulario sea cerrado:
 * `negrita` con `href`, `jaVaScRiPt:` y un `href` relativo tienen que caer los tres.
 * Comparar texto contra una lista negra de esquemas habría dejado pasar el segundo.
 */
import { DomainError } from '../../src/common/errors';
import {
  BODY_DOC_MAX_DEPTH,
  BODY_DOC_MAX_NODES,
  BODY_DOC_MAX_TEXT,
  EMPTY_BODY_DOC,
} from '../../src/articles/body-doc';
import {
  extractBodyDocReferences,
  validateBodyDoc,
} from '../../src/articles/body-doc.validator';

const HASH = 'a'.repeat(64);

/**
 * Atajo para el contenido EN LÍNEA. Un nodo `texto` no puede colgar de la raíz
 * —el validador lo rechaza, y tiene razón: el texto vive dentro de un bloque—,
 * así que las pruebas que hablan de marcas, enlaces y longitudes lo envuelven en
 * un párrafo. Escribirlas sin envolver fue mi error, no una licencia del formato.
 */
function parrafo(...enLinea: readonly unknown[]): unknown {
  return { tipo: 'parrafo', contenido: enLinea };
}

/** Documento válido que ejercita todos los nodos admitidos. */
function documentoCompleto(): unknown {
  return {
    tipo: 'doc',
    contenido: [
      { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Cómo ahorrar' }] },
      {
        tipo: 'parrafo',
        contenido: [
          { tipo: 'texto', texto: 'Ahorra ' },
          { tipo: 'texto', texto: 'primero', marcas: [{ tipo: 'negrita' }] },
          { tipo: 'texto', texto: ' y luego gasta.', marcas: [{ tipo: 'cursiva' }] },
          {
            tipo: 'texto',
            texto: 'Ver la fuente',
            marcas: [{ tipo: 'enlace', href: 'https://example.org/dato' }],
          },
          {
            tipo: 'texto',
            texto: 'Escríbenos',
            marcas: [{ tipo: 'enlace', href: 'mailto:hola@fintcart.local' }],
          },
        ],
      },
      {
        tipo: 'lista',
        ordenada: false,
        contenido: [
          {
            tipo: 'item_lista',
            contenido: [
              { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Un elemento' }] },
              {
                tipo: 'lista',
                ordenada: true,
                contenido: [
                  {
                    tipo: 'item_lista',
                    contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Anidado' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { tipo: 'imagen', image_id: HASH, alt: 'Una alcancía llena de monedas', pie: 'Figura 1' },
      { tipo: 'calculadora', calculator_id: 'ahorro', version: 3 },
    ],
  };
}

function rechaza(doc: unknown, fragmentoDelMensaje: RegExp): void {
  let lanzado: unknown;
  try {
    validateBodyDoc(doc);
  } catch (err) {
    lanzado = err;
  }
  if (lanzado === undefined) {
    throw new Error(
      'se esperaba un rechazo, pero el documento se ACEPTÓ: ' + JSON.stringify(doc).slice(0, 160),
    );
  }
  expect(lanzado).toMatchObject({ code: 'invalid_argument' });
  expect((lanzado as Error).message).toMatch(fragmentoDelMensaje);
}

describe('validateBodyDoc — documentos válidos', () => {
  it('acepta un documento con todos los nodos y marcas admitidos', () => {
    const doc = documentoCompleto();
    expect(validateBodyDoc(doc)).toBe(doc);
  });

  it('acepta el documento vacío de un artículo recién creado', () => {
    expect(validateBodyDoc(EMPTY_BODY_DOC)).toEqual({ tipo: 'doc', contenido: [] });
  });

  it('acepta un texto sin marcas y con marcas vacías', () => {
    expect(() =>
      validateBodyDoc({
        tipo: 'doc',
        contenido: [
          { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Sin marcas' }] },
          { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Lista vacía', marcas: [] }] },
        ],
      }),
    ).not.toThrow();
  });

  it('no muta el documento: devuelve el mismo objeto, no una copia corregida', () => {
    const doc = documentoCompleto();
    const antes = JSON.stringify(doc);
    expect(validateBodyDoc(doc)).toBe(doc);
    expect(JSON.stringify(doc)).toBe(antes);
  });

  it('acepta `http` además de `https` y `mailto`', () => {
    expect(() =>
      validateBodyDoc({
        tipo: 'doc',
        contenido: [
          {
            tipo: 'parrafo',
            contenido: [
              {
                tipo: 'texto',
                texto: 'enlace',
                marcas: [{ tipo: 'enlace', href: 'http://example.org/x?a=1#b' }],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe('validateBodyDoc — la raíz', () => {
  it('rechaza un documento que no es un objeto', () => {
    rechaza('texto suelto', /la raíz debe ser un objeto/);
    rechaza(null, /la raíz debe ser un objeto/);
    rechaza([], /la raíz debe ser un objeto/);
    rechaza(42, /la raíz debe ser un objeto/);
  });

  it('rechaza una raíz que no sea `doc`', () => {
    rechaza({ tipo: 'parrafo', contenido: [] }, /la raíz debe ser un objeto/);
  });

  it('rechaza una raíz `doc` sin `contenido`', () => {
    rechaza({ tipo: 'doc' }, /la raíz debe ser un objeto/);
  });

  it('nombra el tipo que llegó cuando la raíz es un nodo suelto', () => {
    rechaza({ tipo: 'texto', texto: 'hola' }, /la raíz debe ser un objeto/);
  });
});

describe('validateBodyDoc — vocabulario cerrado (T120)', () => {
  it('rechaza un nodo desconocido y dice dónde está', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'tabla', filas: [] }] }] },
      /nodo "tabla" no admitido en body_doc\.contenido\[0\]\.contenido\[0\]/,
    );
  });

  it('rechaza una marca desconocida', () => {
    rechaza(
      { tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'subrayado' }] })] },
      /marca "subrayado" no admitida/,
    );
  });

  it('rechaza un atributo no admitido en un nodo', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'parrafo', color: 'rojo', contenido: [] }] },
      /atributo "color" no admitido en un nodo "parrafo"/,
    );
  });

  it('rechaza un atributo no admitido en una marca', () => {
    rechaza(
      {
        tipo: 'doc',
        contenido: [parrafo({ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'negrita', href: 'https://a.b' }] })],
      },
      /atributo "href" no admitido en la marca "negrita"/,
    );
  });

  it('rechaza HTML colado como atributo: no hay campo libre donde meterlo', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'parrafo', contenido: [], html: '<script>x</script>' }] },
      /atributo "html" no admitido/,
    );
  });
});

describe('validateBodyDoc — jerarquía', () => {
  it('rechaza un encabezado dentro de un elemento de lista', () => {
    rechaza(
      {
        tipo: 'doc',
        contenido: [
          {
            tipo: 'lista',
            ordenada: false,
            contenido: [
              {
                tipo: 'item_lista',
                contenido: [{ tipo: 'encabezado', nivel: 2, contenido: [] }],
              },
            ],
          },
        ],
      },
      /"encabezado" no puede estar dentro de "item_lista"/,
    );
  });

  it('rechaza un párrafo dentro de un párrafo', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'parrafo', contenido: [] }] }] },
      /"parrafo" no puede estar dentro de "parrafo"/,
    );
  });

  it('rechaza un texto directamente en la raíz', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'texto', texto: 'suelto' }] },
      /"texto" no puede estar dentro de "doc"/,
    );
  });

  it('rechaza un nodo hoja con hijos: la imagen no contiene nada', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'imagen', image_id: HASH, alt: 'algo', contenido: [] }] },
      /atributo "contenido" no admitido en un nodo "imagen"/,
    );
  });

  it('rechaza un contenedor sin `contenido`', () => {
    rechaza({ tipo: 'doc', contenido: [{ tipo: 'lista', ordenada: true }] }, /necesita "contenido"/);
  });

  it('rechaza un hijo que no es un nodo', () => {
    rechaza({ tipo: 'doc', contenido: ['texto suelto'] }, /no es un nodo/);
  });
});

describe('validateBodyDoc — nodos con reglas propias', () => {
  it('rechaza un texto vacío', () => {
    rechaza({ tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: '' })] }, /"texto" no vacío/);
  });

  it('rechaza un texto sin el campo `texto`', () => {
    rechaza({ tipo: 'doc', contenido: [parrafo({ tipo: 'texto' })] }, /"texto" no vacío/);
  });

  it('rechaza un encabezado de nivel 1 o 5, y uno sin nivel', () => {
    for (const nivel of [1, 5, undefined, '2']) {
      rechaza(
        { tipo: 'doc', contenido: [{ tipo: 'encabezado', nivel, contenido: [] }] },
        /necesita "nivel" 2\/3\/4/,
      );
    }
  });

  it('rechaza una lista sin decidir si es ordenada', () => {
    rechaza({ tipo: 'doc', contenido: [{ tipo: 'lista', contenido: [] }] }, /necesita "ordenada"/);
  });

  it('rechaza una imagen sin `alt` (T120)', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'imagen', image_id: HASH }] },
      /una imagen necesita "alt" no vacío.*lector de pantalla/s,
    );
  });

  it('rechaza un `alt` que son solo espacios', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'imagen', image_id: HASH, alt: '   ' }] },
      /necesita "alt" no vacío/,
    );
  });

  it('rechaza una imagen cuyo `image_id` no es el SHA-256 en hexadecimal', () => {
    for (const imageId of ['', 'no-es-un-hash', HASH.slice(0, 63), HASH.toUpperCase()]) {
      rechaza(
        { tipo: 'doc', contenido: [{ tipo: 'imagen', image_id: imageId, alt: 'algo' }] },
        /"image_id" con el SHA-256 del contenido/,
      );
    }
  });

  it('rechaza un pie de foto vacío si está presente', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'imagen', image_id: HASH, alt: 'algo', pie: ' ' }] },
      /"pie".*no puede estar vacío/s,
    );
  });

  it('rechaza una calculadora sin versión, con versión 0 o con versión no entera', () => {
    for (const version of [undefined, 0, -1, 1.5, '3']) {
      rechaza(
        { tipo: 'doc', contenido: [{ tipo: 'calculadora', calculator_id: 'ahorro', version }] },
        /"version" entera ≥ 1/,
      );
    }
  });

  it('rechaza una calculadora sin identificador', () => {
    rechaza(
      { tipo: 'doc', contenido: [{ tipo: 'calculadora', version: 1 }] },
      /necesita "calculator_id"/,
    );
  });
});

describe('validateBodyDoc — el `href` es la superficie de ataque (T120)', () => {
  it('rechaza `javascript:`', () => {
    rechaza(
      {
        tipo: 'doc',
        contenido: [
          parrafo({ tipo: 'texto', texto: 'click', marcas: [{ tipo: 'enlace', href: 'javascript:alert(1)' }] }),
        ],
      },
      /esquema "javascript:" no admitido/,
    );
  });

  it('rechaza el mismo esquema escrito con mayúsculas mezcladas', () => {
    rechaza(
      {
        tipo: 'doc',
        contenido: [
          parrafo({ tipo: 'texto', texto: 'click', marcas: [{ tipo: 'enlace', href: 'JaVaScRiPt:alert(1)' }] }),
        ],
      },
      /esquema "javascript:" no admitido/,
    );
  });

  it('rechaza `data:`', () => {
    rechaza(
      {
        tipo: 'doc',
        contenido: [
          parrafo({
            tipo: 'texto',
            texto: 'click',
            marcas: [{ tipo: 'enlace', href: 'data:text/html;base64,PHNjcmlwdD4=' }],
          }),
        ],
      },
      /esquema "data:" no admitido/,
    );
  });

  it('rechaza `file:`, `vbscript:` y `blob:`', () => {
    for (const href of ['file:///etc/passwd', 'vbscript:msgbox', 'blob:https://x/y']) {
      rechaza(
        { tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'enlace', href }] })] },
        /esquema .* no admitido/,
      );
    }
  });

  it('rechaza un enlace sin `href`', () => {
    rechaza(
      { tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'enlace' }] })] },
      /una marca enlace necesita "href"/,
    );
  });

  it('rechaza un `href` que no es una URL absoluta', () => {
    for (const href of ['/catalogo', 'ejemplo.org', '#ancla', 'www.example.org']) {
      rechaza(
        { tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'enlace', href }] })] },
        /no es una URL absoluta/,
      );
    }
  });
});

describe('validateBodyDoc — límites de forma', () => {
  it('rechaza un texto que pasa del tope', () => {
    rechaza(
      { tipo: 'doc', contenido: [parrafo({ tipo: 'texto', texto: 'x'.repeat(BODY_DOC_MAX_TEXT + 1) })] },
      /pasa del tope/,
    );
  });

  it('rechaza un anidamiento mayor que el tope', () => {
    // lista > item_lista > lista > … un nivel más que el máximo permitido.
    let nodo: Record<string, unknown> = { tipo: 'parrafo', contenido: [] };
    for (let i = 0; i < BODY_DOC_MAX_DEPTH; i += 1) {
      nodo = { tipo: 'lista', ordenada: false, contenido: [{ tipo: 'item_lista', contenido: [nodo] }] };
    }
    rechaza({ tipo: 'doc', contenido: [nodo] }, /anidamiento mayor de/);
  });

  it('rechaza un documento con demasiados nodos', () => {
    const parrafos = Array.from({ length: BODY_DOC_MAX_NODES }, (_, i) =>
      parrafo({ tipo: 'texto', texto: `t${i}` }),
    );
    rechaza({ tipo: 'doc', contenido: parrafos }, /pasa de \d+ nodos/);
  });

  it('acepta justo por debajo de los límites', () => {
    const parrafos = Array.from({ length: 500 }, (_, i) =>
      parrafo({ tipo: 'texto', texto: `p${i}`, marcas: [{ tipo: 'negrita' }] }),
    );
    expect(() => validateBodyDoc({ tipo: 'doc', contenido: parrafos })).not.toThrow();
  });
});

describe('extractBodyDocReferences — FR-066, FR-070', () => {
  it('extrae las imágenes y calculadoras sin repetir y en orden de aparición', () => {
    const doc = {
      tipo: 'doc',
      contenido: [
        { tipo: 'imagen', image_id: 'b'.repeat(64), alt: 'uno' },
        { tipo: 'calculadora', calculator_id: 'ahorro', version: 1 },
        { tipo: 'imagen', image_id: 'b'.repeat(64), alt: 'otra vez la misma' },
        { tipo: 'calculadora', calculator_id: 'credito', version: 2 },
        { tipo: 'calculadora', calculator_id: 'ahorro', version: 3 },
      ],
    };
    expect(extractBodyDocReferences(validateBodyDoc(doc))).toEqual({
      imageIds: ['b'.repeat(64)],
      calculatorIds: ['ahorro', 'credito'],
    });
  });

  it('encuentra las referencias anidadas dentro de listas', () => {
    const doc = validateBodyDoc({
      tipo: 'doc',
      contenido: [
        {
          tipo: 'lista',
          ordenada: false,
          contenido: [
            {
              tipo: 'item_lista',
              contenido: [
                { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'x' }] },
                { tipo: 'imagen', image_id: 'c'.repeat(64), alt: 'dentro' },
              ],
            },
          ],
        },
      ],
    });
    expect(extractBodyDocReferences(doc).imageIds).toEqual(['c'.repeat(64)]);
  });

  it('un documento sin bloques incrustados no referencia nada', () => {
    expect(extractBodyDocReferences(EMPTY_BODY_DOC)).toEqual({ imageIds: [], calculatorIds: [] });
  });
});

describe('invalidArgument — el rechazo es de dominio, no del driver', () => {
  it('lanza un error de la casa, no un `Error` suelto', () => {
    expect(() => validateBodyDoc({ tipo: 'doc', contenido: [{ tipo: 'x' }] })).toThrow(DomainError);
  });
});
