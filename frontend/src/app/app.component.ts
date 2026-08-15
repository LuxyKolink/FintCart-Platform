import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'fc-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="fc-topbar">
      <a class="fc-topbar__brand" routerLink="/catalogo">
        <img src="assets/logo/fintcart-mark.svg" alt="" width="28" height="28" />
        <span>FintCart</span>
      </a>
      @if (auth.isAuthenticated()) {
        <nav class="fc-topbar__nav">
          <a routerLink="/catalogo">Catálogo</a>
          <a routerLink="/simuladores">Simuladores</a>
          <a routerLink="/progreso">Tu progreso</a>
          <a routerLink="/notificaciones">Notificaciones</a>
          @if (auth.hasRole('editor', 'coordinador_editorial')) {
            <a routerLink="/editorial">Editorial</a>
          }
          @if (auth.hasRole('coordinador_editorial')) {
            <a routerLink="/editorial/revision">Revisión</a>
          }
          <a routerLink="/perfil">Tu perfil</a>
          <button type="button" class="fc-topbar__logout" (click)="onLogout()">Cerrar sesión</button>
        </nav>
      }
    </header>
    <main class="fc-shell">
      <router-outlet />
    </main>
  `,
  styles: `
    .fc-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-2) var(--space-4);
      background: var(--surface-card);
      border-bottom: var(--border-hairline) solid var(--border-default);
    }
    .fc-topbar__brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-family: var(--font-display);
      font-weight: var(--fw-bold);
      color: var(--text-strong);
    }
    .fc-topbar__nav {
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .fc-topbar__logout {
      font: inherit;
      color: var(--text-link);
      background: none;
      border: 0;
      cursor: pointer;
      padding: 0;
    }
    .fc-shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: var(--space-4);
    }
  `,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected onLogout(): void {
    this.auth.logout().subscribe(() => {
      void this.router.navigateByUrl('/iniciar-sesion');
    });
  }
}
