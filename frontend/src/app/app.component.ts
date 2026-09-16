import { Component, signal, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth/auth.service';
import { BrandLogoComponent, ButtonComponent } from './shared/ui';

/**
 * Armazón de la aplicación — barra superior, navegación por rol y cierre de sesión.
 *
 * Es la vigésima superficie y se ve en el 100 % de las vistas (research D-30), así
 * que su estética no puede quedarse atrás mientras se migran las 19 pantallas: un
 * marco viejo alrededor de contenido nuevo se nota en todas.
 *
 * TRES DECISIONES QUE NO SON EVIDENTES:
 *
 * 1. La navegación se sigue derivando del ROL (`auth.hasRole(...)`), nunca de una
 *    comprobación de autorización hecha en la vista. La vista decide qué enlaces
 *    mostrar; quién puede entrar lo decide el guard (Principio VII).
 * 2. El logotipo pasa a `BrandLogo` en lugar del `<img>` suelto: era la última
 *    referencia a mano a `assets/logo/`, y el componente es el único dueño de esa
 *    ruta (FR-090).
 * 3. El botón que despliega el menú móvil es un `<button>` nativo y no `fc-button`.
 *    El control de divulgación necesita `aria-expanded`/`aria-controls` EN el propio
 *    botón, y esos atributos escritos sobre `<fc-button>` acaban en el elemento
 *    anfitrión, no en el `<button>` interior: un lector de pantalla los ignoraría.
 *    La accesibilidad manda sobre la uniformidad estética.
 */
@Component({
  selector: 'fc-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, BrandLogoComponent, ButtonComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Solo tiene efecto por debajo de `--bp-md`; encima, el menú es siempre horizontal. */
  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected onLogout(): void {
    this.auth.logout().subscribe(() => {
      void this.router.navigateByUrl('/iniciar-sesion');
    });
  }
}
