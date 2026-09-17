import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  forwardRef,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Editor, type JSONContent } from '@tiptap/core';

import { BannerComponent, ButtonComponent, InputComponent } from '../../../shared/ui';
import {
  BODY_DOC_HEADING_LEVELS,
  BODY_DOC_LINK_SCHEMES,
  BODY_DOC_MAX_ALT,
  EMPTY_BODY_DOC,
  isSafeHref,
  type BodyDocNode,
} from '../../../shared/body-doc';
import { mediaImageUrl } from '../../../shared/media-url';
import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { EXTENSIONES, toBodyDoc, toEditorDoc } from './tiptap-document';

/** Tipos de imagen que el servidor acepta, para no subir en balde. */
const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp'];
/** Tope del servidor (2 MB). Se comprueba aquí para no gastar la subida. */
const TOPE_BYTES = 2 * 1024 * 1024;

/** La imagen ya subida que espera a que se la describa. */
interface ImagenPendiente {
  readonly imageId: string;
  readonly url: string;
}

/**
 * Editor de texto enriquecido del artículo (T131, T132, FR-063, research D-14).
 *
 * Sustituye al `<textarea>` y no es un cambio de adorno: el cuerpo de un artículo es un
 * documento de bloques con estructura —encabezados, listas, negritas, imágenes— y un área de
 * texto no puede representarla. Lo que se escribe aquí es lo que el lector dibuja, nodo por
 * nodo, porque las dos partes comparten el mismo vocabulario (`shared/body-doc.ts`) y la
 * conversión está en un solo sitio (`tiptap-document.ts`).
 *
 * **Se comporta como un control de formulario** (`ControlValueAccessor`): su valor es el
 * documento de bloques, así que el formulario que lo use puede validarlo y enviarlo sin
 * saber que por debajo hay ProseMirror. Cuando cambia el texto emite el documento ya
 * convertido; cuando el formulario escribe un valor, carga el documento en el editor.
 *
 * DOS DECISIONES QUE SE VEN EN LA PANTALLA:
 *
 * - **La imagen se sube al elegirla, antes de describirla.** El panel muestra la imagen REAL
 *   que servirá el servidor y no una vista previa local: lo que hay que comprobar antes de
 *   insertarla es lo que el servidor aceptó, y una vista previa del archivo del disco
 *   enseñaría algo que quizá no es lo que se guardó (otro tipo, otras dimensiones). El
 *   precio es que una imagen que se sube y no se inserta queda sin referencia; el contenido
 *   se direcciona por su hash, así que subirla otra vez no duplica bytes.
 * - **En un artículo que todavía no existe, el botón de imagen está desactivado y dice por
 *   qué.** Una imagen pertenece a un artículo (`article_images.article_id`), así que no hay
 *   dónde guardarla antes de crear el borrador. Es una restricción del modelo de datos, y se
 *   explica en pantalla en vez de dejar un botón que falle.
 *
 * Lo que NO hace: no valida el documento entero —eso es del servidor, que es quien lo
 * guarda— y no permite editar la descripción de una imagen ya insertada. Se pide al
 * insertarla porque el `alt` es obligatorio en el vocabulario (FR-067); cambiarlo después
 * es una tarea que nadie ha pedido y que aquí no se finge.
 */
@Component({
  selector: 'fc-tiptap-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `ViewEncapsulation.None` y NO la encapsulación por defecto, por un motivo concreto:
  // TipTap crea el DOM del documento con JavaScript, y esos nodos no llevan el atributo de
  // ámbito que Angular añade a lo que dibuja su plantilla. Con la encapsulación por defecto,
  // los estilos del contenido —párrafos, listas, imágenes— no coincidirían con ningún
  // elemento y el editor se vería como texto sin formato. La alternativa (`::ng-deep`) está
  // desaconsejada y se filtra igual; aquí al menos los nombres van prefijados con
  // `fc-rte__`, así que no pueden chocar con nada de fuera.
  encapsulation: ViewEncapsulation.None,
  imports: [ReactiveFormsModule, BannerComponent, ButtonComponent, InputComponent],
  templateUrl: './tiptap-editor.component.html',
  styleUrl: './tiptap-editor.component.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TiptapEditorComponent), multi: true },
  ],
})
export class TiptapEditorComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  /** Artículo al que pertenecen las imágenes. Nulo mientras el artículo no exista. */
  public readonly articleId = input<string | null>(null);
  /**
   * El `id` de la etiqueta visible del campo.
   *
   * El área de escritura se llama por su etiqueta (`aria-labelledby`) y no por un
   * `aria-label` propio: así el nombre accesible es exactamente el texto que se ve —«Cuerpo»—
   * y no una segunda descripción que puede decir otra cosa. Un `aria-label` que repita el
   * texto visible es la forma habitual de que un lector de pantalla anuncie un nombre
   * distinto del que está en la pantalla.
   */
  public readonly labelledBy = input<string>('');
  public readonly invalid = input<boolean>(false);

  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;
  private readonly api = inject(EditorialApiService);
  private readonly zone = inject(NgZone);

  private editor: Editor | null = null;
  private onChange: (valor: BodyDocNode) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  /** El valor que el formulario escribió por última vez, para no reescribirlo en bucle. */
  private ultimoEscrito: string | null = null;
  /**
   * El valor que llegó ANTES de que el editor existiera.
   *
   * El formulario escribe el valor en cuanto lo tiene, y el editor de ProseMirror solo
   * puede recibirlo cuando la vista existe (`ngAfterViewInit`). Sin guardarlo, abrir un
   * borrador lo dejaría en blanco y el primer guardado lo borraría de verdad —el peor
   * fallo posible aquí, porque se lleva por delante el trabajo de quien escribe.
   */
  private valorPendiente: BodyDocNode | null = null;

  protected readonly niveles = BODY_DOC_HEADING_LEVELS;
  protected readonly maxAlt = BODY_DOC_MAX_ALT;
  protected readonly esquemasDeEnlace = BODY_DOC_LINK_SCHEMES.map((esquema) => `${esquema}:`).join(', ');

  /** Marcas y bloques activos donde está el cursor, para el estado de la barra. */
  protected readonly activos = signal<ReadonlySet<string>>(new Set());

  protected readonly imagenPendiente = signal<ImagenPendiente | null>(null);
  protected readonly subiendo = signal(false);
  protected readonly errorImagen = signal<string | null>(null);

  protected readonly panelEnlaceAbierto = signal(false);
  protected readonly errorEnlace = signal<string | null>(null);

  /**
   * Los tres campos del panel son controles de formulario y no señales con manejadores.
   *
   * No es preferencia de estilo: `fc-input` es un control de formulario —así lo usa toda la
   * aplicación— y pasarle un valor suelto obligaría a reimplementar a mano su validación y
   * su estado de error. Con un `FormControl` el `alt` obligatorio es una regla declarada
   * (`Validators.required`), el aviso lo pinta el propio campo y el botón de insertar se
   * apaga solo cuando no se puede insertar.
   */
  protected readonly hrefControl: FormControl<string> = new FormControl('', { nonNullable: true });
  protected readonly altControl: FormControl<string> = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(BODY_DOC_MAX_ALT)],
  });
  protected readonly pieControl: FormControl<string> = new FormControl('', { nonNullable: true });

  public ngAfterViewInit(): void {
    this.editor = new Editor({
      element: this.host.nativeElement,
      extensions: EXTENSIONES,
      content: toEditorDoc(EMPTY_BODY_DOC),
      // La barra de herramientas no lleva `contenteditable`, y las teclas de formato
      // (Ctrl+B, Ctrl+I) vienen de las extensiones: sin etiqueta, un lector de pantalla no
      // sabría qué es esta zona editable.
      editorProps: {
        attributes: {
          class: 'fc-rte__content',
          role: 'textbox',
          'aria-multiline': 'true',
          ...this.etiqueta(),
        },
      },
      onUpdate: (): void => this.desdeElEditor(),
      onSelectionUpdate: (): void => this.desdeElEditor(),
    });
    // El valor que llegó antes de que el editor existiera, ahora que ya existe.
    if (this.valorPendiente !== null) {
      const pendiente = this.valorPendiente;
      this.valorPendiente = null;
      this.writeValue(pendiente);
      return;
    }
    this.refrescarActivos();
  }

  public ngOnDestroy(): void {
    // Sin esto, el editor sigue escuchando en un DOM que ya no existe: se acumulan
    // instancias al navegar entre pantallas y la memoria crece con cada visita.
    this.editor?.destroy();
    this.editor = null;
  }

  // ── ControlValueAccessor ────────────────────────────────────────────────────

  public writeValue(valor: BodyDocNode | null): void {
    const doc = valor ?? EMPTY_BODY_DOC;
    if (this.editor === null) {
      this.valorPendiente = doc;
      return;
    }
    this.ultimoEscrito = JSON.stringify(doc);
    // `emitUpdate: false`: cargar un valor del formulario no es una edición de quien
    // escribe, y emitirlo dispararía un ciclo de «el padre escribe, el hijo avisa, el padre
    // escribe».
    this.editor.commands.setContent(toEditorDoc(doc), { emitUpdate: false });
    this.refrescarActivos();
  }

  public registerOnChange(fn: (valor: BodyDocNode) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(esDeshabilitado: boolean): void {
    this.editor?.setEditable(!esDeshabilitado);
  }

  // ── barra de herramientas ───────────────────────────────────────────────────

  protected alternarNegrita(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  protected alternarCursiva(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  protected alternarEncabezado(nivel: number): void {
    this.editor?.chain().focus().toggleHeading({ level: nivel as 2 | 3 | 4 }).run();
  }

  protected alternarVinietas(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  protected alternarNumerada(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  protected estaActivo(clave: string): boolean {
    return this.activos().has(clave);
  }

  /** ¿Se puede intentar insertar una imagen? Depende de que el artículo ya exista. */
  protected get puedeInsertarImagen(): boolean {
    return this.articleId() !== null && !this.subiendo();
  }

  // ── enlace ──────────────────────────────────────────────────────────────────

  protected abrirPanelEnlace(): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    // Se precarga el enlace que ya tuviera el texto seleccionado: reescribirlo desde cero
    // para cambiar una letra de la URL es una forma de perder la buena.
    const previo = editor.getAttributes('link')['href'];
    this.hrefControl.setValue(typeof previo === 'string' ? previo : '');
    this.errorEnlace.set(null);
    this.panelEnlaceAbierto.set(true);
  }

  protected cerrarPanelEnlace(): void {
    this.panelEnlaceAbierto.set(false);
  }

  protected aplicarEnlace(): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    const url = this.hrefControl.value.trim();
    if (url === '') {
      // Vaciar el campo y aplicar es quitar el enlace: es la forma natural de deshacerlo.
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      this.cerrarPanelEnlace();
      return;
    }
    // La misma comprobación que hace el servidor al guardar y la que hace el lector al
    // dibujar. Aquí es donde evita el trabajo inútil: sin ella, el enlace entraría al
    // documento, el guardado fallaría y el error hablaría de un nodo del documento en vez
    // de la dirección que se acaba de escribir.
    if (!this.esEnlaceAdmitido(url)) {
      this.errorEnlace.set(
        `Solo se admiten direcciones que empiecen por ${this.esquemasDeEnlace} (por ejemplo https://ejemplo.com).`,
      );
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: this.conEsquema(url) }).run();
    this.cerrarPanelEnlace();
  }

  protected quitarEnlace(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.cerrarPanelEnlace();
  }

  // ── imagen (T132) ───────────────────────────────────────────────────────────

  protected onArchivoElegido(evento: Event): void {
    // Se limpia el error anterior: quien vuelve a elegir un archivo está intentándolo otra
    // vez, y el aviso del intento fallido ya no describe nada.
    this.errorImagen.set(null);
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];
    // Se limpia el input en cuanto se lee el archivo: sin esto, elegir el MISMO archivo dos
    // veces seguidas no dispara el evento, y la segunda vez no pasaría nada.
    entrada.value = '';
    if (archivo === undefined) {
      return;
    }

    const problema = this.problemaDelArchivo(archivo);
    if (problema !== null) {
      this.errorImagen.set(problema);
      return;
    }
    this.subirImagen(archivo);
  }

  /** Lo que se puede saber del archivo ANTES de subirlo. */
  private problemaDelArchivo(archivo: File): string | null {
    if (!TIPOS_ACEPTADOS.includes(archivo.type)) {
      return `El archivo es de tipo ${archivo.type === '' ? 'desconocido' : archivo.type}. Se admiten PNG, JPEG y WebP.`;
    }
    if (archivo.size > TOPE_BYTES) {
      return `La imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo son 2 MB.`;
    }
    return null;
  }

  private subirImagen(archivo: File): void {
    const articleId = this.articleId();
    if (articleId === null) {
      return;
    }
    this.subiendo.set(true);
    this.api.uploadImage(articleId, archivo).subscribe({
      next: (imagen) => {
        this.subiendo.set(false);
        // Los campos se limpian y se marcan como «sin tocar»: el panel es nuevo, y un error
        // heredado del intento anterior avisaría de algo que ya no está en pantalla.
        this.altControl.reset('');
        this.pieControl.reset('');
        this.imagenPendiente.set({ imageId: imagen.image_id, url: mediaImageUrl(imagen.image_id) });
      },
      error: (err: unknown) => {
        this.subiendo.set(false);
        this.errorImagen.set(this.mensajeDeError(err));
      },
    });
  }

  protected cancelarImagen(): void {
    this.imagenPendiente.set(null);
    this.altControl.reset('');
    this.pieControl.reset('');
  }

  protected insertarImagen(): void {
    const pendiente = this.imagenPendiente();
    const editor = this.editor;
    const alt = this.altControl.value.trim();
    if (pendiente === null || editor === null || alt === '') {
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'imagen',
        attrs: { imageId: pendiente.imageId, alt, pie: this.pieControl.value.trim() },
      })
      .run();
    this.cancelarImagen();
  }

  // ── interior ────────────────────────────────────────────────────────────────

  /**
   * El editor avisó de un cambio: se emite el documento ya convertido.
   *
   * Va dentro de `zone.run` por un motivo concreto y no por costumbre: ProseMirror procesa
   * las transacciones en su propio bucle de eventos —con `requestAnimationFrame` y
   * microtareas—, así que sus avisos no siempre llegan dentro de la zona de Angular. Sin
   * esto, la barra de herramientas se quedaría mostrando el formato de donde estaba el
   * cursor antes, y lo peor: el formulario no se enteraría de que hay cambios, así que no
   * avisaría de que falta guardar.
   */
  /** Cómo se llama esta zona: por su etiqueta visible, o por un nombre propio si no hay. */
  private etiqueta(): Record<string, string> {
    const labelledBy = this.labelledBy();
    return labelledBy === ''
      ? { 'aria-label': 'Cuerpo del artículo' }
      : { 'aria-labelledby': labelledBy };
  }

  private desdeElEditor(): void {
    this.zone.run(() => {
      this.refrescarActivos();
      const editor = this.editor;
      if (editor === null) {
        return;
      }
      const doc = toBodyDoc(editor.getJSON() as JSONContent);
      const serializado = JSON.stringify(doc);
      if (serializado === this.ultimoEscrito) {
        // El cambio vino de `writeValue` (el padre cargó el documento): no es una edición.
        return;
      }
      this.ultimoEscrito = serializado;
      this.onChange(doc);
      this.onTouched();
    });
  }

  private refrescarActivos(): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    const claves = new Set<string>();
    if (editor.isActive('bold')) {
      claves.add('negrita');
    }
    if (editor.isActive('italic')) {
      claves.add('cursiva');
    }
    if (editor.isActive('link')) {
      claves.add('enlace');
    }
    if (editor.isActive('bulletList')) {
      claves.add('vinietas');
    }
    if (editor.isActive('orderedList')) {
      claves.add('numerada');
    }
    for (const nivel of BODY_DOC_HEADING_LEVELS) {
      if (editor.isActive('heading', { level: nivel })) {
        claves.add(`h${nivel}`);
      }
    }
    this.activos.set(claves);
  }

  /**
   * ¿Se puede insertar este enlace?
   *
   * Se reutiliza la MISMA función que usan el lector y el servidor (`isSafeHref`) en vez de
   * repetir aquí la lista: tres listas de esquemas admitidos son tres listas que se separan,
   * y la que se quedara corta sería la que decide.
   */
  protected esEnlaceAdmitido(url: string): boolean {
    return isSafeHref(this.conEsquema(url.trim()));
  }

  private conEsquema(url: string): string {
    return /^[a-z][a-z0-9+.-]*:/iu.test(url) ? url : `https://${url}`;
  }

  private mensajeDeError(err: unknown): string {
    if (err instanceof EditorialError) {
      return err.kind === 'invalid'
        ? 'El servidor no aceptó la imagen. Se admiten PNG, JPEG y WebP de hasta 2 MB.'
        : err.message;
    }
    return 'No pudimos subir la imagen.';
  }
}
