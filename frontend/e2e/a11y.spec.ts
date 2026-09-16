import { expect, test } from '@playwright/test';

import { expectScreenIsAccessible } from './support/a11y';
import { waitForVerificationLink } from './support/mailhog';

/**
 * Barrera de accesibilidad (T011, FR-093…FR-096, SC-030…SC-032).
 *
 * POR QUÉ ES UNA SUITE APARTE Y NO ASERCIONES SUELTAS: las 4 suites de recorrido ya
 * seleccionan por rol y etiqueta accesible, así que cubren lo funcional, pero no
 * AFIRMAN la accesibilidad: un `getByLabel` que encuentra el control no dice si el
 * contraste del texto que lo acompaña cumple AA, ni si el teclado llega hasta él. Esto
 * es lo que el rediseño podría romper en silencio.
 *
 * SE AMPLÍA POR GRUPO, NO DE UNA VEZ: cada grupo de los seis migra sus pantallas y
 * las añade aquí. Correr la suite entera contra pantallas todavía sin migrar llenaría
 * el informe de fallos que son el trabajo pendiente, no una regresión.
 */

interface Screen {
  readonly path: string;
  /** Acciones que el teclado DEBE alcanzar para dar la pantalla por recorrible. */
  readonly actions: readonly string[];
}

const ACCESS_SCREENS: readonly Screen[] = [
  { path: '/iniciar-sesion', actions: ['Iniciar sesión'] },
  { path: '/crear-cuenta', actions: ['Crear cuenta'] },
];

const LEARNER_SCREENS: readonly Screen[] = [
  { path: '/catalogo', actions: ['Cerrar sesión'] },
  { path: '/simuladores', actions: ['Cerrar sesión'] },
  { path: '/progreso', actions: ['Cerrar sesión'] },
  { path: '/notificaciones', actions: ['Cerrar sesión'] },
  { path: '/perfil', actions: ['Cerrar sesión'] },
];

test.describe('accesibilidad de las pantallas de acceso', () => {
  for (const screen of ACCESS_SCREENS) {
    test(`${screen.path} es recorrible por teclado y legible`, { tag: '@a11y' }, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator('form').first()).toBeVisible();
      await expectScreenIsAccessible(page, screen.actions);
    });
  }
});

test(
  'las pantallas del portal son recorribles por teclado y legibles',
  { tag: '@a11y' },
  async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-a11y-${stamp}@fintcart.test`;
    const password = 'Dem0stracion!2026';

    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(`A11y ${stamp}`);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    const link = await waitForVerificationLink(email);
    await page.goto(link);
    await page.getByRole('link', { name: 'Iniciar sesión' }).click();
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);

    for (const screen of LEARNER_SCREENS) {
      await page.goto(screen.path);
      await expect(page.locator('main')).toBeVisible();
      await expectScreenIsAccessible(page, screen.actions);
    }
  },
);
