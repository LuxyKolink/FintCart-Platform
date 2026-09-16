import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { BrandPanelComponent } from '../../../shared/ui';

/**
 * FintCart AuthLayout — el card partido de las tres pantallas de acceso: panel
 * de marca a un lado, formulario al otro (FR-098, T019).
 *
 * POR QUÉ VIVE EN `features/auth/` Y NO EN `shared/ui/`: la biblioteca compartida
 * guarda componentes que CUALQUIER pantalla puede usar; `fc-brand-panel` sí lo
 * es (es la identidad de marca), pero esta disposición solo tiene sentido para el
 * flujo de acceso. FR-087 prohíbe un componente propio de UNA pantalla; esto es
 * propio de UN flujo de tres pantallas, que es el caso que la regla no cubre.
 *
 * POR QUÉ EL ENCABEZADO ES UN INPUT Y NO CONTENIDO PROYECTADO: las tres
 * pantallas necesitan el mismo `<h1>` + subtítulo, y dejarlo en cada plantilla
 * habría repetido la jerarquía de encabezados tres veces — con el riesgo de que
 * una se quede en `<h2>` y rompa el esquema de la pantalla.
 */
@Component({
  selector: 'fc-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandPanelComponent],
  templateUrl: './auth-layout.component.html',
  styleUrl: './auth-layout.component.css',
})
export class AuthLayoutComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
}
