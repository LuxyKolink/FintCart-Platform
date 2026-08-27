import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AvatarComponent } from '../avatar/avatar.component';
import { BadgeComponent } from '../badge/badge.component';
import { BrandLogoComponent } from '../brand-logo/brand-logo.component';
import { ButtonComponent } from '../button/button.component';
import { CardComponent } from '../card/card.component';
import { CheckboxComponent } from '../checkbox/checkbox.component';
import { IconComponent, type IconName } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import { ModuleBoxComponent } from '../module-box/module-box.component';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { SelectComponent, type SelectOption } from '../select/select.component';
import { TabsComponent, type TabItem } from '../tabs/tabs.component';
import { TagComponent } from '../tag/tag.component';

const ALL_ICON_NAMES: IconName[] = [
  'arrow-right',
  'bell',
  'book-open',
  'calculator',
  'check',
  'check-circle',
  'chevron-right',
  'circle',
  'clipboard-check',
  'clock',
  'corner-up-left',
  'credit-card',
  'file-text',
  'flame',
  'info',
  'loader',
  'mail-check',
  'piggy-bank',
  'plus',
  'save',
  'search',
  'send',
  'settings',
  'shield',
  'shield-check',
];

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'ahorro', label: 'Ahorro' },
  { value: 'credito', label: 'Crédito' },
  { value: 'inversion', label: 'Inversión' },
];

const DEMO_TABS: TabItem[] = [
  { id: 'temas', label: 'Temas', count: 12 },
  { id: 'economico', label: 'Económico', count: 4 },
  { id: 'deportes', label: 'Deportes' },
];

/**
 * Galería interna de verificación visual de shared/ui (T048). Reproduce las
 * agrupaciones de design/components/{display,forms,layout}/*.card.html con los
 * componentes Angular ya migrados — no es una pantalla del producto.
 */
@Component({
  selector: 'fc-ui-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvatarComponent,
    BadgeComponent,
    BrandLogoComponent,
    ButtonComponent,
    CardComponent,
    CheckboxComponent,
    IconComponent,
    InputComponent,
    ModuleBoxComponent,
    ProgressBarComponent,
    SelectComponent,
    TabsComponent,
    TagComponent,
  ],
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.css',
})
export class GalleryComponent {
  protected readonly iconNames = ALL_ICON_NAMES;
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly demoTabs = DEMO_TABS;
}
