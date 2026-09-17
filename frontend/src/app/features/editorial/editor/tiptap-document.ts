/**
 * El esquema del editor y las dos conversiones (T131, FR-063, research D-14).
 *
 * El editor **no es un HTML cualquiera**: ProseMirror no permite crear un nodo que no esté
 * en el esquema, así que la forma más barata de que el vocabulario cerrado del servidor se
 * cumpla es que la barra de herramientas no pueda producir otra cosa. No se desactivan
 * botones «que dan error»: no existen los nodos.
 *
 * De las extensiones de TipTap se apagan casi todas —cita, código, bloque de código, línea
 * horizontal, tachado, subrayado, salto de línea, nodo final— y las que quedan se
 * configuran con los límites del vocabulario: encabezados de 2 a 4, enlaces con tres
 * esquemas. **El salto de línea se apaga a conciencia**: el vocabulario no tiene nodo para
 * él, así que si existiera, pulsar Mayús+Intro produciría un nodo que al guardar
 * desaparecería del documento sin avisar. Un atajo que crea algo que no se puede guardar es
 * peor que un atajo que no hace nada.
 *
 * Las dos conversiones son las únicas fronteras: `toBodyDoc` al guardar y `toEditorDoc` al
 * cargar. Existen porque ProseMirror tiene su propio formato (`doc`/`paragraph`/`text`) y el
 * vocabulario del artículo es otro (`doc`/`parrafo`/`texto`). Traducir en dos funciones
 * pequeñas y probadas es lo que permite que ninguna de las dos partes sepa cómo es la otra.
 *
 * Lo que este archivo NO hace: no habla con la red, no sube imágenes y no dibuja nada. Un
 * nodo que no se puede representar —una imagen sin identificador— se descarta al guardar;
 * no se inventa su contenido.
 */
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import {
  BODY_DOC_HEADING_LEVELS,
  isImageId,
  isSafeHref,
  type BodyDocMark,
  type BodyDocNode,
} from '../../../shared/body-doc';
import { mediaImageUrl } from '../../../shared/media-url';

/** Nivel de encabezado por defecto de la barra: el `h2` es el primero que un artículo usa. */
export const NIVEL_POR_DEFECTO: number = BODY_DOC_HEADING_LEVELS[0];

/**
 * El nodo `imagen`, con `alt` obligatorio y pie opcional (T132, FR-067).
 *
 * Es un nodo **atómico**: no tiene contenido editable. Eso no es una limitación técnica
 * sino la decisión que hace que el `alt` no se pueda perder: si el `alt` fuera texto
 * dentro del documento, seleccionarlo y borrarlo dejaría una imagen sin descripción, y el
 * servidor la rechazaría al guardar con un error que habla de un nodo que quien escribe no
 * ve. Aquí el `alt` es un ATRIBUTO que se pide al insertar y que solo se cambia a
 * propósito.
 */
export const Imagen = Node.create({
  name: 'imagen',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      imageId: { default: null },
      alt: { default: '' },
      pie: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-image-id]' }];
  },

  renderHTML({ node }) {
    // `src` sale de `shared/media-url`, la misma función que usa el lector: si el editor
    // mostrara la imagen por una ruta y el lector por otra, una de las dos pantallas
    // enseñaría un hueco y no habría ningún error que lo explicara.
    const figure: unknown[] = [
      'figure',
      mergeAttributes({ 'data-image-id': String(node.attrs['imageId'] ?? '') }),
      ['img', { src: mediaImageUrl(node.attrs['imageId'] as string | undefined), alt: node.attrs['alt'] }],
    ];
    const pie = node.attrs['pie'];
    if (typeof pie === 'string' && pie !== '') {
      figure.push(['figcaption', {}, pie]);
    }
    return figure as never;
  },
});

/**
 * El nodo `calculadora` (T152, FR-070).
 *
 * Es atómico por la misma razón que la imagen, y con una consecuencia mayor: un cálculo
 * incrustado son DOS datos —qué calculadora y con qué versión—, y la versión se fija al
 * incrustar para que el artículo quede atado a la definición con la que se escribió. Si fueran
 * texto dentro del documento, borrar un carácter cambiaría la versión que el artículo declara.
 *
 * La vista en el editor NO trae el nombre de la calculadora: el documento guarda el
 * identificador, que es lo único que no cambia. Escribir el nombre en el nodo lo dejaría
 * obsoleto el día que alguien renombre la calculadora, y el editor enseñaría un nombre que ya no
 * existe. Lo que se ve es la referencia y la versión, que es lo que se está fijando.
 */
export const Calculadora = Node.create({
  name: 'calculadora',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      calculatorId: { default: null },
      version: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-calculator-id]' }];
  },

  renderHTML({ node }) {
    const version = node.attrs['version'];
    return [
      'aside',
      mergeAttributes({
        'data-calculator-id': String(node.attrs['calculatorId'] ?? ''),
        // El atributo lleva la versión y no solo el identificador: lo que se está fijando es
        // «esta calculadora, en esta versión», y sin ella el nodo no se puede reconstruir.
        'data-calculator-version': String(version ?? ''),
        class: 'fc-rte__calculadora',
      }),
      ['p', { class: 'fc-rte__calculadora-titulo' }, 'Calculadora incrustada'],
      ['p', { class: 'fc-rte__calculadora-version' }, `Versión ${String(version ?? '?')}`],
      ['p', { class: 'fc-rte__calculadora-id' }, String(node.attrs['calculatorId'] ?? '')],
    ] as never;
  },
});

/**
 * Las extensiones del editor, ya restringidas al vocabulario.
 *
 * Cada `false` es una decisión y no una limpieza: lo que no se puede producir no se puede
 * guardar, y lo que no se puede guardar no llega al lector.
 */
export const EXTENSIONES = [
  StarterKit.configure({
    // Fuera del vocabulario (D-14): no existen nodos para ellos.
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    // El vocabulario no tiene nodo de salto de línea; ver la cabecera.
    hardBreak: false,
    // Cursores decorativos: no aportan nada al documento y sí nodos que hay que ignorar.
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
    // Dentro del vocabulario, con sus límites.
    heading: { levels: [...BODY_DOC_HEADING_LEVELS] },
    link: {
      // Un enlace se edita, no se navega: pulsarlo dentro del editor sacaría a quien
      // escribe de su borrador y, si el enlace estuviera mal, le haría perder lo escrito.
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      isAllowedUri: (url) => isSafeHref(conEsquema(url)),
    },
  }),
  Imagen,
  Calculadora,
];

/** Añade el esquema por defecto a una URL escrita sin él (`ejemplo.com` → `https://…`). */
function conEsquema(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/iu.test(url) ? url : `https://${url}`;
}

/**
 * Documento de ProseMirror → documento de bloques (`body_doc`).
 *
 * Es la conversión que se ejecuta al guardar, y por eso **descarta en vez de inventar**:
 *
 *  - Un párrafo o un encabezado sin texto no se guarda. Es lo que deja un documento recién
 *    abierto —ProseMirror nace con un párrafo vacío— y guardarlo llenaría el artículo de
 *    bloques vacíos que se ven como huecos.
 *  - Un nodo de texto sin texto (`''`) tampoco: el vocabulario exige que `texto` no esté
 *    vacío, y un nodo así lo rechazaría el servidor.
 *  - Una imagen sin identificador válido no se guarda: no hay nada que referenciar.
 *  - Una marca de enlace con un esquema no admitido se cae, y el texto queda SIN enlace.
 *    Es la misma decisión que toma el lector: se pierde el enlace, no el contenido.
 *
 * Nada de esto es silencioso en el sentido que importa: el resultado de la conversión es el
 * que viaja, y el formulario avisa antes de enviarlo (`body-doc-validator.ts`, que comprueba
 * la única regla que se puede comprobar sin el vocabulario completo: que haya algún bloque).
 */
export function toBodyDoc(doc: JSONContent): BodyDocNode {
  return { tipo: 'doc', contenido: bloquesDe(doc.content ?? []) };
}

/** Los bloques hijos de un contenedor, ya convertidos y sin los que no aportan nada. */
function bloquesDe(nodos: readonly JSONContent[]): BodyDocNode[] {
  return nodos
    .map((nodo) => bloqueDe(nodo))
    .filter((nodo): nodo is BodyDocNode => nodo !== null);
}

/** Un bloque (`parrafo`, `encabezado`, `lista` o `imagen`), o `null` si no se guarda. */
function bloqueDe(nodo: JSONContent): BodyDocNode | null {
  switch (nodo.type) {
    case 'paragraph': {
      const contenido = enLinea(nodo.content ?? []);
      return contenido.length === 0 ? null : { tipo: 'parrafo', contenido };
    }
    case 'heading': {
      const contenido = enLinea(nodo.content ?? []);
      const nivel = Number(nodo.attrs?.['level'] ?? NIVEL_POR_DEFECTO);
      const admitido = (BODY_DOC_HEADING_LEVELS as readonly number[]).includes(nivel)
        ? nivel
        : NIVEL_POR_DEFECTO;
      return contenido.length === 0 ? null : { tipo: 'encabezado', nivel: admitido, contenido };
    }
    case 'bulletList':
      return listaDe(nodo, false);
    case 'orderedList':
      return listaDe(nodo, true);
    case 'imagen': {
      const imageId = nodo.attrs?.['imageId'];
      if (!isImageId(imageId)) {
        return null;
      }
      const alt = nodo.attrs?.['alt'];
      const pie = nodo.attrs?.['pie'];
      return {
        tipo: 'imagen',
        image_id: imageId,
        // El `alt` va tal cual aunque esté vacío: el vocabulario lo exige no vacío, y
        // mandarlo así hace que el error venga del servidor con su mensaje —que explica
        // POR QUÉ hace falta— en lugar de que este código lo borre en silencio dejando un
        // hueco donde estaba la imagen.
        alt: typeof alt === 'string' ? alt : '',
        ...(typeof pie === 'string' && pie.trim() !== '' ? { pie } : {}),
      };
    }
    case 'calculadora': {
      // Sin identificador ni versión no hay nada que referenciar: no se guarda el bloque. Es la
      // misma decisión que con la imagen, y aquí importa más, porque un nodo así el servidor lo
      // rechazaría por «una calculadora necesita version entera ≥ 1» y el mensaje hablaría de un
      // nodo que quien escribe no ve.
      const calculatorId = nodo.attrs?.['calculatorId'];
      const version = nodo.attrs?.['version'];
      if (typeof calculatorId !== 'string' || calculatorId.trim() === '') {
        return null;
      }
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return null;
      }
      return { tipo: 'calculadora', calculator_id: calculatorId, version };
    }
    default:
      // Un tipo desconocido no debería llegar (el esquema no lo produce). Si llegara —una
      // extensión añadida más adelante sin tocar esta función— se descarta aquí en vez de
      // enviarse y provocar un rechazo del servidor por un nodo que nadie quiso escribir.
      return null;
  }
}

/** Una lista con sus elementos. */
function listaDe(nodo: JSONContent, ordenada: boolean): BodyDocNode | null {
  const items: BodyDocNode[] = [];
  for (const item of nodo.content ?? []) {
    const contenido = bloquesDe(item.content ?? []);
    // Un elemento vacío no se guarda: una viñeta sin nada dentro se dibuja como un punto
    // suelto y el vocabulario no tiene forma de expresar «elemento vacío».
    if (contenido.length > 0) {
      items.push({ tipo: 'item_lista', contenido });
    }
  }
  return items.length === 0 ? null : { tipo: 'lista', ordenada, contenido: items };
}

/** El contenido en línea de un párrafo o un encabezado: nodos `texto` con sus marcas. */
function enLinea(nodos: readonly JSONContent[]): BodyDocNode[] {
  const salida: BodyDocNode[] = [];
  for (const nodo of nodos) {
    // Un contenedor dentro de un párrafo no existe en el vocabulario (`parrafo` solo admite
    // `texto`), y el esquema del editor tampoco lo produce.
    if (nodo.type !== 'text') {
      continue;
    }
    const texto = nodo.text ?? '';
    // El vocabulario exige que `texto` no esté vacío: un nodo de texto sin texto lo
    // rechazaría el servidor al guardar.
    if (texto === '') {
      continue;
    }
    const marcas = marcasDe(nodo.marks ?? []);
    salida.push(marcas.length === 0 ? { tipo: 'texto', texto } : { tipo: 'texto', texto, marcas });
  }
  return salida;
}

/** Las marcas del vocabulario que lleva un nodo de texto. */
function marcasDe(marcas: readonly JSONContent[]): BodyDocMark[] {
  const salida: BodyDocMark[] = [];
  for (const marca of marcas) {
    if (marca.type === 'bold') {
      salida.push({ tipo: 'negrita' });
    } else if (marca.type === 'italic') {
      salida.push({ tipo: 'cursiva' });
    } else if (marca.type === 'link') {
      const href = marca.attrs?.['href'];
      // Un `href` sin esquema admitido NO se convierte en marca: el texto queda, el
      // enlace se cae. Es la misma regla que aplica el lector y la que aplica el
      // servidor, así que un documento que se ve sin enlace tampoco se guarda con él.
      if (isSafeHref(href)) {
        salida.push({ tipo: 'enlace', href });
      }
    }
  }
  return salida;
}

/**
 * Documento de bloques → documento de ProseMirror.
 *
 * Es la conversión de vuelta, la que se ejecuta al abrir un borrador. **Descarta lo que no
 * sabe representar** en vez de lanzar: un documento que llega de la base pasó por el
 * validador al guardarse, y si algo no encaja es mejor abrir el borrador con lo que se
 * pueda editar que dejar la pantalla en blanco con un error.
 */
export function toEditorDoc(doc: BodyDocNode): JSONContent {
  return { type: 'doc', content: bloquesAEditables(doc.contenido ?? []) };
}

function bloquesAEditables(nodos: readonly BodyDocNode[]): JSONContent[] {
  const salida: JSONContent[] = [];
  for (const nodo of nodos) {
    const editable = bloqueAEditable(nodo);
    if (editable !== null) {
      salida.push(editable);
    }
  }
  // Un documento vacío en ProseMirror tiene que tener al menos un párrafo: sin él no hay
  // dónde poner el cursor y la primera pulsación no escribe nada.
  return salida.length === 0 ? [{ type: 'paragraph' }] : salida;
}

function bloqueAEditable(nodo: BodyDocNode): JSONContent | null {
  switch (nodo.tipo) {
    case 'parrafo':
      return { type: 'paragraph', content: enLineaEditable(nodo.contenido ?? []) };
    case 'encabezado': {
      const nivel = nodo.nivel ?? NIVEL_POR_DEFECTO;
      const admitido = (BODY_DOC_HEADING_LEVELS as readonly number[]).includes(nivel)
        ? nivel
        : NIVEL_POR_DEFECTO;
      return { type: 'heading', attrs: { level: admitido }, content: enLineaEditable(nodo.contenido ?? []) };
    }
    case 'lista':
      return {
        type: nodo.ordenada === true ? 'orderedList' : 'bulletList',
        content: (nodo.contenido ?? [])
          .map((item) => ({ type: 'listItem', content: bloquesAEditables(item.contenido ?? []) }))
          .filter((item) => item.content.length > 0),
      };
    case 'imagen': {
      // Sin identificador válido o sin `alt` no se puede reconstruir la imagen: el
      // vocabulario exige las dos cosas, así que un nodo así no pudo guardarse por el
      // camino del editor. Se descarta en vez de dibujar una imagen sin descripción.
      if (!isImageId(nodo.image_id) || (nodo.alt ?? '').trim() === '') {
        return null;
      }
      return {
        type: 'imagen',
        attrs: { imageId: nodo.image_id, alt: nodo.alt, pie: nodo.pie ?? null },
      };
    }
    case 'calculadora': {
      // T152: el editor YA la produce y la sabe reconstruir. Se exige lo mismo que al guardar
      // —identificador y versión entera— porque un nodo a medias no se puede editar ni volver a
      // guardar: se descarta y el bloque se pierde, pero no se convierte en texto.
      //
      // Convertirla en un párrafo con su identificador fue lo que hizo T131 mientras el nodo no
      // existía, y era PEOR que descartarla: al guardar, el párrafo sustituía al bloque y el
      // artículo perdía la calculadora sin ningún error. Un bloque que no se puede representar se
      // pierde, se ve que se perdió, y el que escribe puede volver a insertarlo.
      const version = nodo.version;
      if (
        typeof nodo.calculator_id !== 'string' ||
        nodo.calculator_id.trim() === '' ||
        typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version < 1
      ) {
        return null;
      }
      return {
        type: 'calculadora',
        attrs: { calculatorId: nodo.calculator_id, version },
      };
    }
    default:
      return null;
  }
}

function enLineaEditable(nodos: readonly BodyDocNode[]): JSONContent[] {
  const salida: JSONContent[] = [];
  for (const nodo of nodos) {
    if (nodo.tipo !== 'texto' || (nodo.texto ?? '') === '') {
      continue;
    }
    // El tipo de `marks` en TipTap exige un `type` no opcional, así que se declara con la
    // forma exacta en vez de `JSONContent[]`: sin esto, un `marca` sin tipo —que este código
    // nunca construye— pasaría el compilador y fallaría al cargar el documento.
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    for (const marca of nodo.marcas ?? []) {
      if (marca.tipo === 'negrita') {
        marks.push({ type: 'bold' });
      } else if (marca.tipo === 'cursiva') {
        marks.push({ type: 'italic' });
      } else if (marca.tipo === 'enlace' && isSafeHref(marca.href)) {
        marks.push({ type: 'link', attrs: { href: marca.href } });
      }
    }
    salida.push(marks.length === 0 ? { type: 'text', text: nodo.texto } : { type: 'text', text: nodo.texto, marks });
  }
  return salida;
}
