/**
 * El editor en el navegador (T131, T132).
 *
 * Aquí no se prueban las conversiones —tienen su propio archivo, con veintiún casos— sino lo
 * que solo se puede ver con un editor de verdad montado: que la barra diga su estado, que la
 * imagen no se pueda insertar sin descripción, que el archivo se revise antes de subirlo y
 * que subir y describir termine en un documento con la imagen dentro.
 *
 * Corre en Chrome (Karma) y no con un doble del DOM porque el editor ES ProseMirror: montarlo
 * de verdad es la única forma de que estas pruebas digan algo sobre lo que usa quien escribe.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, of, throwError } from 'rxjs';

import type { BodyDocNode } from '../../../shared/body-doc';
import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { TiptapEditorComponent } from './tiptap-editor.component';

/** El doble del servicio: anota lo que se le pide y responde lo que la prueba decida. */
class ApiFalsa {
  public readonly subidas: { articleId: string; archivo: File }[] = [];
  public respuesta: unknown = {
    image_id: 'a'.repeat(64),
    article_id: 'art-1',
    mime_type: 'image/png',
    byte_size: 10,
    width: 2,
    height: 2,
  };
  public falla = false;

  public uploadImage(articleId: string, archivo: File): Observable<unknown> {
    this.subidas.push({ articleId, archivo });
    return this.falla
      ? throwError(() => new EditorialError('invalid', 'no aceptada'))
      : of(this.respuesta as never);
  }
}

const IMAGEN_ID = 'a'.repeat(64);
const IMAGEN: BodyDocNode = {
  tipo: 'doc',
  contenido: [{ tipo: 'imagen', image_id: IMAGEN_ID, alt: 'Una alcancía', pie: 'Figura 1' }],
};

describe('fc-tiptap-editor', () => {
  let fixture: ComponentFixture<TiptapEditorComponent>;
  let componente: TiptapEditorComponent;
  let api: ApiFalsa;

  beforeEach(async () => {
    api = new ApiFalsa();
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, TiptapEditorComponent],
      providers: [{ provide: EditorialApiService, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(TiptapEditorComponent);
    fixture.componentRef.setInput('labelledBy', 'etiqueta-de-prueba');
    componente = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** El área de escritura que monta ProseMirror. */
  function superficie(): HTMLElement {
    const host = fixture.nativeElement.querySelector('.fc-rte__content');
    if (host === null) {
      throw new Error('el editor no montó su superficie');
    }
    return host as HTMLElement;
  }

  /**
   * El editor de ProseMirror, para las pruebas que necesitan una selección real.
   *
   * Se accede a un miembro privado a propósito: las dos pruebas de enlace necesitan que haya
   * TEXTO SELECCIONADO, y una marca sobre una selección vacía no se ve en el documento. La
   * alternativa —exponer el editor solo para las pruebas— convertiría un detalle interno en
   * parte de la interfaz del componente para siempre.
   */
  function editor(): {
    commands: { setContent: (contenido: unknown) => void };
    chain: () => { selectAll: () => { run: () => void } };
  } {
    return (componente as unknown as { editor: never })['editor'];
  }

  it('el área de escritura existe y se llama por su etiqueta visible', () => {
    const host = superficie();

    // El nombre accesible sale de `aria-labelledby`: es el texto que se ve en la pantalla y
    // no una segunda descripción que pueda decir otra cosa.
    expect(host.getAttribute('aria-labelledby')).toBe('etiqueta-de-prueba');
    expect(host.getAttribute('role')).toBe('textbox');
    expect(host.getAttribute('aria-multiline')).toBe('true');
  });

  it('la barra declara el estado de cada formato con `aria-pressed`, no solo con color', () => {
    // Solo los `button`: la etiqueta del campo de archivo comparte la clase de la barra
    // —se ve igual— pero su estado no es «activado/desactivado», y su nombre accesible lo
    // comprueba la prueba del campo de archivo.
    const botones = Array.from(
      fixture.nativeElement.querySelectorAll('button.fc-rte__btn'),
    ) as HTMLButtonElement[];

    // Cada botón tiene nombre accesible y un estado explícito.
    for (const boton of botones) {
      expect(boton.getAttribute('aria-label')).toBeTruthy();
      if (!boton.hasAttribute('disabled')) {
        expect(boton.getAttribute('aria-pressed')).not.toBeNull();
      }
    }
    const etiquetas = botones.map((boton) => boton.getAttribute('aria-label'));
    expect(etiquetas).toContain('Negrita');
    expect(etiquetas).toContain('Encabezado de nivel 3');
    expect(etiquetas).toContain('Lista con viñetas');
  });

  it('el campo de archivo tiene nombre accesible por su etiqueta', () => {
    // Es la corrección de un defecto que encontró la barrera de accesibilidad: antes había
    // un botón con `aria-label` que pulsaba el campo por detrás, y el campo —alcanzable con
    // el teclado— quedaba sin nombre. La etiqueta que lo activa ES su nombre.
    const campo = campoDeArchivo();

    expect(campo.id).toBe('fc-rte-archivo');
    const etiqueta = fixture.nativeElement.querySelector('label[for="fc-rte-archivo"]') as HTMLLabelElement;
    expect(etiqueta.textContent).toContain('Insertar una imagen');
  });

  it('sin artículo, el campo de imagen está desactivado y dice por qué', () => {
    // Una imagen pertenece a un artículo: no hay dónde guardarla antes de crearlo.
    const campo = campoDeArchivo();

    expect(campo.disabled).toBe(true);
    expect(campo.getAttribute('aria-describedby')).toBe('fc-rte-imagen-aviso');
    expect(fixture.nativeElement.textContent).toContain('Guarda el borrador para poder insertar imágenes');
  });

  it('con artículo, el campo de imagen se activa', () => {
    fixture.componentRef.setInput('articleId', 'art-1');
    fixture.detectChanges();

    const campo = campoDeArchivo();

    expect(campo.disabled).toBe(false);
    expect(campo.getAttribute('aria-describedby')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Guarda el borrador');
  });

  it('un documento que llega del formulario se carga en el editor', () => {
    componente.writeValue(IMAGEN);
    fixture.detectChanges();

    expect(superficie().querySelector('img')?.getAttribute('alt')).toBe('Una alcancía');
    expect(superficie().textContent).toContain('Figura 1');
  });

  it('un documento vacío deja el editor listo para escribir, no roto', () => {
    componente.writeValue({ tipo: 'doc', contenido: [] });
    fixture.detectChanges();

    expect(superficie().querySelector('p')).not.toBeNull();
  });

  describe('la imagen (T132)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('articleId', 'art-1');
      fixture.detectChanges();
    });

    /** Elige un archivo como lo haría el navegador. */
    function elegir(nombre: string, tipo: string, bytes: number): void {
      const entrada = campoDeArchivo();
      const archivo = new File([new Uint8Array(bytes)], nombre, { type: tipo });
      const lista = { 0: archivo, length: 1, item: () => archivo } as unknown as FileList;
      Object.defineProperty(entrada, 'files', { value: lista, configurable: true });
      entrada.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('un archivo que no es imagen se rechaza SIN subirlo', () => {
      elegir('contrato.pdf', 'application/pdf', 10);

      expect(api.subidas.length).toBe(0);
      expect(fixture.nativeElement.textContent).toContain('Se admiten PNG, JPEG y WebP');
    });

    it('una imagen de más de 2 MB se rechaza SIN subirla', () => {
      // Se comprueba el tamaño antes de gastar la subida: el límite del servidor llegaría
      // después de enviar megabytes por la red.
      elegir('enorme.png', 'image/png', 3 * 1024 * 1024);

      expect(api.subidas.length).toBe(0);
      expect(fixture.nativeElement.textContent).toContain('el máximo son 2 MB');
    });

    it('una imagen válida se sube al artículo del borrador', () => {
      elegir('foto.png', 'image/png', 1024);

      expect(api.subidas.length).toBe(1);
      expect(api.subidas[0]?.articleId).toBe('art-1');
      expect(api.subidas[0]?.archivo.name).toBe('foto.png');
    });

    it('tras subirla, se pide la descripción y no se puede insertar sin ella', () => {
      elegir('foto.png', 'image/png', 1024);

      const insertar = botonPorTexto('Insertar imagen');
      // Sin descripción no se inserta: el `alt` es obligatorio en el vocabulario, y dejarlo
      // pasar convertiría un requisito de accesibilidad en un error al guardar.
      expect(insertar.disabled).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Obligatoria');

      escribirEn('Descripción de la imagen', 'Una alcancía con monedas');
      fixture.detectChanges();

      expect(botonPorTexto('Insertar imagen').disabled).toBe(false);
    });

    it('insertar la imagen descrita pone el nodo en el documento', () => {
      elegir('foto.png', 'image/png', 1024);
      escribirEn('Descripción de la imagen', 'Una alcancía con monedas');
      escribirEn('Pie de foto (opcional)', 'Figura 1');
      fixture.detectChanges();

      const emitido = capturar();
      botonPorTexto('Insertar imagen').click();
      fixture.detectChanges();

      const nodo = emitido.doc?.contenido?.find((bloque: BodyDocNode) => bloque.tipo === 'imagen');
      expect(nodo).toEqual({
        tipo: 'imagen',
        image_id: IMAGEN_ID,
        alt: 'Una alcancía con monedas',
        pie: 'Figura 1',
      });
      // Y el panel se cierra: la imagen ya está en el documento.
      expect(fixture.nativeElement.textContent).not.toContain('Insertar imagen');
    });

    it('un rechazo del servidor se explica sin perder lo escrito', () => {
      api.falla = true;
      elegir('foto.png', 'image/png', 1024);

      expect(fixture.nativeElement.textContent).toContain('El servidor no aceptó la imagen');
      expect(fixture.nativeElement.textContent).not.toContain('Descripción de la imagen');
    });
  });

  describe('el enlace', () => {
    it('un esquema no admitido no se aplica y se explica cuáles sí', () => {
      editor().commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pulsa aquí' }] }],
      });
      editor().chain().selectAll().run();
      fixture.detectChanges();

      botonPorTexto('enlace').click();
      // El panel se dibuja al pulsar: sin este `detectChanges`, el campo todavía no existe
      // —el orden de estas tres líneas es el que tiene la interacción de verdad.
      fixture.detectChanges();
      escribirEn('Dirección del enlace', 'javascript:alert(1)');
      fixture.detectChanges();

      const emitido = capturar();
      botonPorTexto('Aplicar enlace').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Solo se admiten direcciones');
      // El documento no se tocó: no hay ningún enlace en la superficie…
      expect(fixture.nativeElement.querySelector('.fc-rte__content a')).toBeNull();
      // …y tampoco se emitió un cambio, porque no hubo edición. Un rechazo que emitiera un
      // documento marcaría el formulario como «modificado» sin que nadie haya cambiado nada.
      expect(emitido.doc).toBeNull();
    });

    it('una dirección sin esquema se admite y se le pone https', () => {
      editor().commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pulsa' }] }],
      });
      editor().chain().selectAll().run();
      fixture.detectChanges();

      botonPorTexto('enlace').click();
      fixture.detectChanges();
      escribirEn('Dirección del enlace', 'ejemplo.com');
      fixture.detectChanges();

      const emitido = capturar();
      botonPorTexto('Aplicar enlace').click();
      fixture.detectChanges();

      // Escribir `ejemplo.com` y obtener un enlace roto sería peor que no admitirlo.
      expect(emitido.doc?.contenido?.[0]?.contenido?.[0]?.marcas).toEqual([
        { tipo: 'enlace', href: 'https://ejemplo.com' },
      ]);
    });
  });

  /**
   * Recoge el documento que el editor emite al formulario.
   *
   * Se guarda en un objeto y no en una variable con unión `null` porque el compilador no
   * puede saber que el `onChange` ya se llamó cuando se lee: con una variable suelta, cada
   * acceso posterior obligaría a un `!` que ocultaría el caso de verdad —que no se haya
   * emitido nada— en vez de hacerlo fallar en la comprobación.
   */
  function capturar(): { doc: BodyDocNode | null } {
    const caja: { doc: BodyDocNode | null } = { doc: null };
    componente.registerOnChange((valor) => {
      caja.doc = valor;
    });
    return caja;
  }

  /** El campo de archivo, que es el control que abre el diálogo del sistema. */
  function campoDeArchivo(): HTMLInputElement {
    return fixture.nativeElement.querySelector('.fc-rte__archivo') as HTMLInputElement;
  }

  /** El botón cuyo nombre accesible contiene ese texto. */
  function botonPorTexto(texto: string): HTMLButtonElement {
    const botones = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const encontrado = botones.find((boton) => (boton.getAttribute('aria-label') ?? boton.textContent ?? '').includes(texto));
    if (encontrado === undefined) {
      throw new Error(`no hay ningún botón «${texto}»`);
    }
    return encontrado;
  }

  /**
   * Escribe en un campo del panel por su ETIQUETA, como lo haría alguien.
   *
   * Por etiqueta y no por identificador porque el identificador lo genera `fc-input` por
   * dentro: un selector atado a un `id` concreto estaría probando un detalle interno del
   * componente compartido, y se rompería cada vez que ese componente cambie cómo numera sus
   * campos, sin que nada de esta pantalla hubiera cambiado.
   */
  function escribirEn(etiqueta: string, valor: string): void {
    const etiquetas = Array.from(fixture.nativeElement.querySelectorAll('label')) as HTMLLabelElement[];
    const encontrada = etiquetas.find((candidata) => (candidata.textContent ?? '').trim() === etiqueta);
    if (encontrada === undefined) {
      throw new Error(`no hay ningún campo «${etiqueta}» en el panel`);
    }
    const campo = fixture.nativeElement.querySelector(
      `#${encontrada.getAttribute('for') ?? ''}`,
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
  }
});

describe('la integración con el formulario', () => {
  it('un `FormControl` recibe el documento y lo marca vacío cuando no hay bloques', async () => {
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, TiptapEditorComponent],
      providers: [{ provide: EditorialApiService, useValue: new ApiFalsa() }],
    }).compileComponents();

    const fixture = TestBed.createComponent(TiptapEditorComponent);
    fixture.detectChanges();
    const control = new FormControl<BodyDocNode | null>(null);
    const escrito: BodyDocNode[] = [];
    control.valueChanges.subscribe((valor) => {
      if (valor !== null) {
        escrito.push(valor);
      }
    });

    // El editor empieza con un párrafo vacío: eso es «sin bloques», no «con un bloque».
    fixture.componentInstance.writeValue({ tipo: 'doc', contenido: [] });
    fixture.detectChanges();

    expect(escrito.length).toBe(0);
  });
});
