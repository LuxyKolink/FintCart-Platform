import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  LucideArrowRight,
  LucideBell,
  LucideBookOpen,
  LucideCalculator,
  LucideCheck,
  LucideChevronRight,
  LucideCircle,
  LucideCircleCheck,
  LucideClipboardCheck,
  LucideClock,
  LucideCornerUpLeft,
  LucideCreditCard,
  LucideDynamicIcon,
  LucideFileText,
  LucideFlame,
  LucideInfo,
  LucideLoader,
  LucideMailCheck,
  LucidePiggyBank,
  LucidePlus,
  LucideSave,
  LucideSearch,
  LucideSend,
  LucideSettings,
  LucideShield,
  LucideShieldCheck,
  type LucideIconData,
} from '@lucide/angular';

/**
 * The 25 icons the FintCart UI kits use (research D-32 / T033). Adding a name here
 * pulls in exactly that icon's component — nothing more, per FR-085.
 */
export type IconName =
  | 'arrow-right'
  | 'bell'
  | 'book-open'
  | 'calculator'
  | 'check'
  | 'check-circle'
  | 'chevron-right'
  | 'circle'
  | 'clipboard-check'
  | 'clock'
  | 'corner-up-left'
  | 'credit-card'
  | 'file-text'
  | 'flame'
  | 'info'
  | 'loader'
  | 'mail-check'
  | 'piggy-bank'
  | 'plus'
  | 'save'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'shield-check';

const ICONS: Record<IconName, LucideIconData> = {
  'arrow-right': LucideArrowRight.icon,
  bell: LucideBell.icon,
  'book-open': LucideBookOpen.icon,
  calculator: LucideCalculator.icon,
  check: LucideCheck.icon,
  'check-circle': LucideCircleCheck.icon,
  'chevron-right': LucideChevronRight.icon,
  circle: LucideCircle.icon,
  'clipboard-check': LucideClipboardCheck.icon,
  clock: LucideClock.icon,
  'corner-up-left': LucideCornerUpLeft.icon,
  'credit-card': LucideCreditCard.icon,
  'file-text': LucideFileText.icon,
  flame: LucideFlame.icon,
  info: LucideInfo.icon,
  loader: LucideLoader.icon,
  'mail-check': LucideMailCheck.icon,
  'piggy-bank': LucidePiggyBank.icon,
  plus: LucidePlus.icon,
  save: LucideSave.icon,
  search: LucideSearch.icon,
  send: LucideSend.icon,
  settings: LucideSettings.icon,
  shield: LucideShield.icon,
  'shield-check': LucideShieldCheck.icon,
};

/**
 * FintCart Icon — wraps the 25 registered Lucide icons behind FintCart's own
 * name vocabulary. Lucide is a substitution chosen by the design system, not
 * a FintCart brand asset (design/README.md:98): if a proprietary icon set
 * replaces it, only ICONS above and the kits change.
 *
 * DECORATIVO vs CON NOMBRE (brief §7, FR-095). El registro de 25 iconos se
 * conserva y el trazo baja a 1.5: a 20 px el trazo de 2 px engorda la silueta y
 * devuelve la densidad de intranet que la dirección de arte v2 retira.
 *
 * El icono es SIEMPRE decorativo salvo que se le pase `label`, y esa distinción
 * no se deja al azar: `LucideDynamicIcon` emite `aria-hidden="true"` en cuanto
 * no hay `title`, de modo que un icono sin etiqueta no roba el nombre accesible
 * del texto que acompaña ni aparece como imagen suelta ante el lector de
 * pantalla. Cuando SÍ hay etiqueta, se añade `role="img"` para que el `<title>`
 * se anuncie (un `<svg>` sin rol no expone su título). Las dos ramas son
 * excluyentes, así que nunca coinciden `aria-hidden` y `role="img"`.
 */
@Component({
  selector: 'fc-icon',
  standalone: true,
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [lucideIcon]="data()"
      [size]="size()"
      [strokeWidth]="strokeWidth()"
      [title]="label() ?? undefined"
      [attr.role]="label() ? 'img' : null"
      class="fc-icon"
    ></svg>
  `,
  styles: `
    /*
     * Solo geometría de colocación: el color lo hereda ('stroke: currentColor'
     * lo pone Lucide), así que un icono dentro de un encabezado de estado toma
     * el color del estado sin que este componente sepa nada de la paleta.
     * 'flex: none' evita que el icono se comprima en una fila flexible —el
     * defecto que hacía desaparecer el icono de un botón estrecho—.
     */
    .fc-icon {
      display: inline-block;
      vertical-align: middle;
      flex: none;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number | string>(20);
  /** Trazo 1.5 (brief §7). El registro de iconos no cambia. */
  readonly strokeWidth = input<number | string>(1.5);
  /** Accessible label. Leave unset for decorative icons (the common case). */
  readonly label = input<string | null>(null);

  protected readonly data = computed(() => ICONS[this.name()]);
}
