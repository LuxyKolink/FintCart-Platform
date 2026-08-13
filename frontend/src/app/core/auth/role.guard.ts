import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { Role } from './jwt';

/** Fábrica de guard: `roleGuard('editor', 'coordinador_editorial')` (FR-006). */
export function roleGuard(...allowed: Role[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/iniciar-sesion'], { queryParams: { returnUrl: state.url } });
    }
    if (auth.hasRole(...allowed)) {
      return true;
    }
    return router.createUrlTree(['/catalogo']);
  };
}
