import { expect, test, type Page } from '@playwright/test';

import { expectControlsAreLabelled, expectTextMeetsAaContrast } from '../support/a11y';
import { waitForVerificationLink } from '../support/mailhog';

/**
 * Captura visual de las cuatro pantallas de perfil a cada punto de corte (T062, FR-124).
 *
 * Sin kit propio: la referencia son las guías del design system y los componentes
 * compartidos, así que no hay `toHaveScreenshot` — lo que se automatiza es lo que un ojo no
 * debería tener que revisar en cada cambio: que la captura salga a cada ancho y que la
 * página no desplace en horizontal (FR-127).
 *
 * ADEMÁS SE EXTIENDE LA BARRERA DE ACCESIBILIDAD A TRES PANTALLAS QUE NO ESTÁN EN ELLA. La
 * suite `a11y.spec.ts` recorre `/perfil` pero no sus tres pantallas hijas, y su propio
 * comentario pide ampliarla «por grupo». Se hace desde aquí, con los MISMOS ayudantes
 * (`expectControlsAreLabelled` y `expectTextMeetsAaContrast`, de `support/a11y.ts`), en
 * lugar de tocar la suite: la nota N-13 prohíbe modificar `e2e/*.spec.ts`, y una barrera que
 * se copia es una barrera que se puede relajar sin que nadie lo note.
 */
const WIDTHS: readonly { token: string; width: number }[] = [
  { token: '--bp-sm', width: 480 },
  { token: '--bp-md', width: 768 },
  { token: '--bp-lg', width: 1024 },
  { token: '--bp-xl', width: 1280 },
  { token: 'min', width: 360 },
];

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly marker: string;
}

const SCREENS: readonly Screen[] = [
  { name: 'perfil', path: '/perfil', marker: 'Tu perfil' },
  { name: 'reporte', path: '/perfil/reporte', marker: 'Tu reporte de actividad' },
  { name: 'contrasena', path: '/perfil/contrasena', marker: 'Cambiar contraseña' },
  { name: 'eliminar-cuenta', path: '/perfil/eliminar-cuenta', marker: 'Qué pasa exactamente' },
];

async function signIn(page: Page): Promise<void> {
  const stamp = Date.now();
  const email = `e2e-perfilvisual-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`Perfil visual ${stamp}`);
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
}

test.describe('captura visual — perfil', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const { token, width } of WIDTHS) {
    test(`@visual ${width}px (${token})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });

      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.locator('main').getByText(screen.marker, { exact: false }).first()).toBeVisible();

        // FR-127: la página nunca desplaza en horizontal. En el mínimo de 360 px es donde
        // el correo del titular, las frases de confirmación y las tablas del reporte aprietan.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} desplaza en horizontal a ${String(width)}px`).toBeLessThanOrEqual(0);

        // Barrido de barrera: etiquetas asociadas y contraste AA de todo el texto visible.
        // La captura se hace DESPUÉS, para que una pantalla que no cumple no deje una
        // imagen que parezca aprobada.
        await expectControlsAreLabelled(page);
        await expectTextMeetsAaContrast(page);

        await page.screenshot({
          path: `test-results/visual/profile/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      }
    });
  }
});
