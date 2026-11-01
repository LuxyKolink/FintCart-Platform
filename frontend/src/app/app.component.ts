import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthService } from './core/auth/auth.service';
import { BrandLogoComponent, ButtonComponent } from './shared/ui';

/**
 * Rutas del flujo de acceso: `/iniciar-sesion`, `/crear-cuenta`, `/auth/verify-email`.
 * En ellas el panel de marca de `fc-auth-layout` es el dueño de la marca, así que la
 * cabecera no repite el logotipo (ver `showBrandLockup`).
 */
const ACCESS_ROUTES = ['/iniciar-sesion', '/crear-cuenta', '/auth/verify-email'] as const;

/**
 * Armazón de la aplicación — barra superior, navegación por rol y cierre de sesión.
 *
 * Es la vigésima superficie y se ve en el 100 % de las vistas (research D-30), así
 * que su estética no puede quedarse atrás mientras se migran las 19 pantallas: un
 * marco viejo alrededor de contenido nuevo se nota en todas.
 *
 * DECISIONES QUE NO SON EVIDENTES:
 *
 * 1. La navegación se sigue derivando del ROL (`auth.hasRole(...)`), nunca de una
 *    comprobación de autorización hecha en la vista. La vista decide qué enlaces
 *    mostrar; quién puede entrar lo decide el guard (Principio VII).
 * 2. El logotipo pasa a `BrandLogo` en lugar del `<img>` suelto: era la última
 *    referencia a mano a `assets/logo/`, y el componente es el único dueño de esa
 *    ruta (FR-090). En las pantallas de acceso el logotipo NO se dibuja —lo dibuja
 *    el panel de marca— y el enlace a casa queda como palabra «FintCart» en tinta.
 * 3. Los botones de divulgación («Menú» y «Más») son `<button>` nativos y no
 *    `fc-button`. Necesitan `aria-expanded`/`aria-controls` EN el propio botón, y
 *    esos atributos escritos sobre `<fc-button>` acaban en el elemento anfitrión, no
 *    en el `<button>` interior: un lector de pantalla los ignoraría. La
 *    accesibilidad manda sobre la uniformidad estética. (Además, reutilizar
 *    `fc-button` para «Más» rompería la prueba que localiza el cierre de sesión por
 *    `#fc-app-nav fc-button button`.)
 *
 * LA NAVEGACIÓN TIENE TRES ESTADOS, y el corte no es solo de ancho: depende del
 * NÚMERO de destinos, que a su vez depende del rol (un aprendiz ve 7 enlaces, un
 * coordinador editorial 10, un administrador 9).
 *
 *   · < 1024 px        — un solo botón «Menú» que abre la lista completa en columna.
 *   · 1024 – 1279 px   — destinos primarios en línea y el resto en un desplegable
 *                        «Más» (divulgación accesible: `aria-expanded`, Escape
 *                        cierra y devuelve el foco al botón, clic fuera cierra).
 *   · ≥ 1280 px        — todos los destinos en una sola línea, sin desplegable.
 *
 * POR QUÉ 1280 Y NO 1024: once destinos a 15 px no caben en 1024 sin partir
 * palabras («Mis / calculadoras», «Tu / progreso»), y `white-space: nowrap` sin
 * desplegable solo los empujaría a una segunda fila, que se lee como barra rota
 * —el defecto medido en `/tmp/screens/nav-1024.png`—. El desplegable es la única
 * solución que conserva TODOS los destinos y ninguna etiqueta partida. En 1280 sí
 * caben: la fila completa mide ~935 px a 14 px por enlace y la cabecera ofrece
 * 1120 − 120 del logotipo.
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

  /** Solo tiene efecto por debajo de `--bp-lg`; encima, la navegación está en línea. */
  protected readonly menuOpen = signal(false);

  /** Desplegable «Más»: solo tiene efecto entre `--bp-lg` y `--bp-xl`. */
  protected readonly moreOpen = signal(false);

  private readonly moreToggle = viewChild<ElementRef<HTMLButtonElement>>('moreToggle');
  private readonly moreWrap = viewChild<ElementRef<HTMLElement>>('moreWrap');

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * En las pantallas de acceso el panel de marca ya dibuja el logotipo. Repetirlo en
   * la cabecera son dos marcas en el mismo viewport a 100 px de distancia, y el panel
   * es el que manda ahí (brief §8). El ENLACE a casa se queda —es la única salida
   * hacia el catálogo desde el acceso—, pero como palabra en tinta: la marca es un
   * activo, y un texto no es el activo (brief §12).
   */
  protected readonly showBrandLockup = computed(
    () => !ACCESS_ROUTES.some((route) => this.currentUrl().startsWith(route)),
  );

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** `stopPropagation`: el `click` que abre el desplegable no debe llegar al `<nav>`,
   * que cierra la navegación móvil al elegir un destino. */
  protected toggleMore(event: MouseEvent): void {
    event.stopPropagation();
    this.moreOpen.update((open) => !open);
  }

  protected closeMenus(): void {
    this.menuOpen.set(false);
    this.moreOpen.set(false);
  }

  /** Escape cierra el desplegable «Más» y devuelve el foco a su botón (FR-094). */
  protected onEscape(): void {
    if (this.moreOpen()) {
      this.moreOpen.set(false);
      this.moreToggle()?.nativeElement.focus();
      return;
    }
    this.closeMenus();
  }

  /** Un clic fuera del desplegable lo cierra; dentro no, para no cerrarlo al abrirlo. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.moreOpen()) {
      return;
    }
    const wrap = this.moreWrap()?.nativeElement;
    if (wrap !== undefined && event.target instanceof Node && wrap.contains(event.target)) {
      return;
    }
    this.moreOpen.set(false);
  }

  protected onLogout(): void {
    this.auth.logout().subscribe(() => {
      void this.router.navigateByUrl('/iniciar-sesion');
    });
  }
}
