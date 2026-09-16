import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BannerTone = 'error' | 'success' | 'info' | 'warning';

/**
 * FintCart Banner — mensaje en línea con tono (error, éxito, aviso, información).
 *
 * POR QUÉ EXISTE: `.fc-banner` era una clase artesanal de `styles.scss` que usaban
 * las pantallas de acceso y el editor. T029 la retira de las tres pantallas de
 * US1, pero el mensaje sigue existiendo: la biblioteca no tenía el componente, así
 * que la clase sobrevivía por carencia, no por diseño (FR-087).
 *
 * ACCESIBILIDAD: el tono decide el `role`. Un error usa `alert` (asertivo) porque
 * un fallo que no se anuncia deja al usuario esperando; el resto usa `status`
 * (cortés) para no interrumpir. El texto NO va en un color que dependa del tono:
 * el contraste se resuelve por tono en la hoja y todos superan AA sobre su propio
 * fondo (FR-096).
 */
@Component({
  selector: 'fc-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fc-banner" [attr.data-tone]="tone()" [attr.role]="role()">
      <ng-content />
    </div>
  `,
  styleUrl: './banner.component.css',
})
export class BannerComponent {
  readonly tone = input<BannerTone>('info');
  /** `alert` para lo que debe interrumpir, `status` para lo demás. */
  protected readonly role = computed(() =>
    this.tone() === 'error' || this.tone() === 'warning' ? 'alert' : 'status',
  );
}
