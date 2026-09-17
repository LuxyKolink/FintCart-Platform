import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BodyDocComponent } from './body-doc.component';
import { parseBodyDoc, isSafeHref, type BodyDocNode } from './body-doc';

/**
 * El render del documento de bloques (T133, FR-063, FR-068, nota N-08).
 *
 * Dos bloques de pruebas, y el segundo importa más que el primero:
 *
 * 1. **Que cada tipo de nodo se dibuja con el elemento que le toca.** Un `parrafo` es un
 *    `<p>`, una lista ordenada es un `<ol>` y un encabezado de nivel 3 es un `<h3>`. Si
 *    esto se rompe, la pantalla se ve casi igual y un lector de pantalla oye otra cosa.
 * 2. **Que el marcado NO se interpreta.** El texto de un nodo que contenga
 *    `<script>alert(1)</script>` tiene que aparecer **como texto** y no crear ningún
 *    elemento. Es la prueba de FR-068: con `innerHTML` habría un `<script>` en el DOM, y
 *    sin él no puede haberlo. Y un `href` con `javascript:` no se dibuja como enlace.
 *
 * La segunda mitad es la razón de ser de todo el vocabulario cerrado, así que se prueba
 * con el ataque dentro, no con un documento bonito.
 */
describe('BodyDocComponent', () => {
  let fixture: ComponentFixture<BodyDocComponent>;

  async function render(doc: BodyDocNode): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [BodyDocComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(BodyDocComponent);
    fixture.componentRef.setInput('doc', doc);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const parrafo = (...hijos: unknown[]): unknown => ({ tipo: 'parrafo', contenido: hijos });
  const texto = (t: string, marcas?: unknown[]): unknown => ({
    tipo: 'texto',
    texto: t,
    ...(marcas === undefined ? {} : { marcas }),
  });

  /** Documento válido a partir de contenido ya construido. */
  function doc(...bloques: unknown[]): BodyDocNode {
    const parsed = parseBodyDoc({ tipo: 'doc', contenido: bloques });
    if (parsed === null) {
      throw new Error('el documento de prueba no se pudo interpretar');
    }
    return parsed;
  }

  it('dibuja un párrafo como `<p>` con su texto', async () => {
    const host = await render(doc(parrafo(texto('Un párrafo.'))));

    const p = host.querySelector('p');
    expect(p?.textContent?.trim()).toBe('Un párrafo.');
  });

  it('dibuja las marcas como clases, sin anidar elementos de más', async () => {
    const host = await render(
      doc(parrafo(texto('negrita', [{ tipo: 'negrita' }]), texto('cursiva', [{ tipo: 'cursiva' }]))),
    );

    expect(host.querySelector('.fc-blocks__strong')?.textContent).toBe('negrita');
    expect(host.querySelector('.fc-blocks__em')?.textContent).toBe('cursiva');
  });

  it('un encabezado usa el nivel que dice el documento', async () => {
    for (const [nivel, etiqueta] of [
      [2, 'H2'],
      [3, 'H3'],
      [4, 'H4'],
    ] as const) {
      const host = await render(
        doc({ tipo: 'encabezado', nivel, contenido: [texto('Título')] }),
      );
      expect(host.querySelector(etiqueta.toLowerCase())).not.toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('un nivel fuera de rango cae a `h2`, nunca a `h1`', async () => {
    // El `h1` es el título de la pantalla: dos `h1` en la misma vista rompen la jerarquía
    // que anuncia un lector de pantalla (SC-030).
    const host = await render(doc({ tipo: 'encabezado', nivel: 1, contenido: [texto('Título')] }));

    expect(host.querySelector('h1')).toBeNull();
    expect(host.querySelector('h2')).not.toBeNull();
  });

  it('una lista ordenada es `<ol>` y una sin ordenar es `<ul>`', async () => {
    const items = [{ tipo: 'item_lista', contenido: [parrafo(texto('Uno'))] }];

    const ordenada = await render(doc({ tipo: 'lista', ordenada: true, contenido: items }));
    expect(ordenada.querySelector('ol')).not.toBeNull();
    expect(ordenada.querySelector('ol > li')).not.toBeNull();
    TestBed.resetTestingModule();

    const suelta = await render(doc({ tipo: 'lista', ordenada: false, contenido: items }));
    expect(suelta.querySelector('ul')).not.toBeNull();
    expect(suelta.querySelector('ul > li')).not.toBeNull();
  });

  it('anida una lista dentro de un elemento sin romper la semántica', async () => {
    const host = await render(
      doc({
        tipo: 'lista',
        ordenada: false,
        contenido: [
          {
            tipo: 'item_lista',
            contenido: [parrafo(texto('Padre')), { tipo: 'lista', ordenada: true, contenido: [] }],
          },
        ],
      }),
    );

    expect(host.querySelector('ul > li > p')?.textContent?.trim()).toBe('Padre');
    expect(host.querySelector('ul > li > ol')).not.toBeNull();
  });

  describe('el marcado no se interpreta (FR-068)', () => {
    it('un texto con etiquetas aparece como TEXTO, no como elemento', async () => {
      const host = await render(doc(parrafo(texto('<script>alert(1)</script> y <b>negrita</b>')))); 

      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('b')).toBeNull();
      expect(host.textContent).toContain('<script>alert(1)</script>');
      expect(host.textContent).toContain('<b>negrita</b>');
    });

    it('un texto con un `<img onerror>` tampoco crea un elemento con manejador', async () => {
      const host = await render(doc(parrafo(texto('<img src=x onerror="alert(1)">')))); 

      expect(host.querySelector('img')).toBeNull();
      expect(host.textContent).toContain('onerror');
    });

    it('un `href` con `javascript:` NO se dibuja como enlace', async () => {
      const host = await render(
        doc(parrafo(texto('pincha', [{ tipo: 'enlace', href: 'javascript:alert(1)' }]))),
      );

      expect(host.querySelector('a')).toBeNull();
      // El texto no se pierde: se dibuja sin enlace, que es lo honesto —el lector ve lo
      // que decía el documento y no puede pulsarlo.
      expect(host.textContent).toContain('pincha');
    });

    it('el mismo esquema con mayúsculas mezcladas tampoco', async () => {
      const host = await render(
        doc(parrafo(texto('pincha', [{ tipo: 'enlace', href: 'JaVaScRiPt:alert(1)' }]))),
      );

      expect(host.querySelector('a')).toBeNull();
    });

    it('un `href` sin esquema absoluto no se convierte en enlace', async () => {
      for (const href of ['/catalogo', 'ejemplo.org', '#ancla']) {
        const host = await render(doc(parrafo(texto('pincha', [{ tipo: 'enlace', href }]))));
        expect(host.querySelector('a')).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('un `href` admitido sí es un enlace, con `rel` de seguridad', async () => {
      const host = await render(
        doc(parrafo(texto('fuente', [{ tipo: 'enlace', href: 'https://example.org/dato' }]))),
      );

      const enlace = host.querySelector('a');
      expect(enlace?.getAttribute('href')).toBe('https://example.org/dato');
      expect(enlace?.getAttribute('rel')).toContain('noopener');
    });

    it('una marca desconocida se ignora y el texto se conserva', async () => {
      const host = await render(doc(parrafo(texto('subrayado', [{ tipo: 'subrayado' }]))));

      expect(host.textContent).toContain('subrayado');
      expect(host.querySelector('.fc-blocks__strong')).toBeNull();
    });

    it('un nodo desconocido no se dibuja en absoluto', async () => {
      const host = await render(doc({ tipo: 'tabla', filas: [['a']] }, parrafo(texto('Sí se ve')))); 

      expect(host.textContent).toContain('Sí se ve');
      expect(host.querySelector('table')).toBeNull();
    });
  });

  describe('imagen', () => {
    const IMAGEN = { tipo: 'imagen', image_id: 'a'.repeat(64), alt: 'Una alcancía', pie: 'Figura 1' };

    it('dibuja la imagen con su `alt` y su pie', async () => {
      const host = await render(doc(IMAGEN));

      const img = host.querySelector('img');
      expect(img?.getAttribute('alt')).toBe('Una alcancía');
      expect(img?.getAttribute('src')).toContain('a'.repeat(64));
      expect(host.querySelector('figcaption')?.textContent).toContain('Figura 1');
    });

    it('si la imagen NO se puede cargar, muestra el texto alternativo en su lugar', async () => {
      // Mientras el camino `/media/images` no exista (T129/T130), este es el estado real
      // de la pantalla. No es un parche: es lo que debe verse cuando una imagen falta, y
      // es lo que un lector de pantalla anuncia.
      const host = await render(doc(IMAGEN));
      const img = host.querySelector('img');
      img?.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('[role="img"]')?.textContent).toContain('Una alcancía');
    });

    it('una imagen sin `alt` no deja un hueco mudo', async () => {
      const host = await render(doc({ tipo: 'imagen', image_id: 'b'.repeat(64) }));
      const img = host.querySelector('img');
      img?.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(host.textContent).toContain('Imagen sin descripción');
    });
  });

  describe('calculadora incrustada', () => {
    it('se dibuja como referencia con su enlace al simulador', async () => {
      const host = await render(doc({ tipo: 'calculadora', calculator_id: 'ahorro', version: 2 }));

      const enlace = host.querySelector('a');
      expect(enlace?.getAttribute('href')).toBe('/simuladores/ahorro');
      expect(host.textContent).toContain('Versión 2');
    });
  });

  describe('parseBodyDoc', () => {
    it('acepta un documento y una cadena JSON con un documento', () => {
      const objeto = { tipo: 'doc', contenido: [{ tipo: 'texto', texto: 'x' }] };
      expect(parseBodyDoc(objeto)?.tipo).toBe('doc');
      expect(parseBodyDoc(JSON.stringify(objeto))?.tipo).toBe('doc');
    });

    it('devuelve `null` si no hay documento, en vez de lanzar', () => {
      // `null` es la respuesta correcta: significa «usa el texto plano» y el lector tiene
      // ese camino. Lanzar dejaría al lector sin un artículo que sí está.
      for (const entrada of [undefined, null, '', 'no es json', '{', 42, [], { tipo: 'otra' }]) {
        expect(parseBodyDoc(entrada)).toBeNull();
      }
    });

    it('descarta los nodos y las marcas que no conoce, conservando el resto', () => {
      const doc = parseBodyDoc({
        tipo: 'doc',
        contenido: [
          { tipo: 'desconocido' },
          { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'x', marcas: [{ tipo: 'raro' }] }] },
        ],
      });

      expect(doc?.contenido?.length).toBe(1);
      expect(doc?.contenido?.[0]?.contenido?.[0]?.marcas).toEqual([]);
    });
  });

  describe('isSafeHref', () => {
    it('admite http, https y mailto', () => {
      expect(isSafeHref('http://example.org')).toBeTrue();
      expect(isSafeHref('https://example.org')).toBeTrue();
      expect(isSafeHref('mailto:hola@fintcart.local')).toBeTrue();
    });

    it('rechaza el resto, incluidos los esquemas disfrazados', () => {
      for (const href of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'file:///etc/passwd',
        'vbscript:msgbox',
        'blob:https://x/y',
        '/relativo',
        '',
        undefined,
      ]) {
        expect(isSafeHref(href)).toBeFalse();
      }
    });
  });
});
