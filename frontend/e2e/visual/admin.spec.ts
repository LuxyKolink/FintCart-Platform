import { expect, test, type Page } from '@playwright/test';

import { expectControlsAreLabelled, expectTextMeetsAaContrast } from '../support/a11y';
import { waitForVerificationLink } from '../support/mailhog';
import { grantRole } from '../support/roles';

/**
 * Captura visual de las pantallas de administración a cada punto de corte (T108, FR-124).
 *
 * Son las dos pantallas del cuarto rol: el catálogo de categorías y el procedimiento anual
 * de indicadores. Las dos son FORMULARIOS CON LISTA, que es la disposición que más aprieta
 * en 360 px —una tabla o una rejilla de campos que no cabe deja de ser legible mucho antes
 * que un párrafo—, así que son justo las que conviene mirar a los cuatro anchos.
 *
 * Como en el resto de capturas, no hay `toHaveScreenshot`: lo que se automatiza es lo que un
 * ojo no debería tener que revisar en cada cambio —que la captura salga a cada ancho, que
 * nada desplace en horizontal y que ninguna cifra quede recortada— y la imagen queda para
 * revisarla a mano.
 *
 * La tercera pantalla del rol es la bandeja de administración de cuentas (T148, US7), que
 * todavía no existe.
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
  { name: 'categorias', path: '/admin/categorias', marker: 'Administración de categorías' },
  { name: 'indicadores', path: '/admin/indicadores', marker: 'Indicadores financieros' },
];

async function signInAsAdmin(page: Page): Promise<void> {
  const stamp = Date.now();
  const email = `e2e-adminvisual-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`Admin visual ${stamp}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  const link = await waitForVerificationLink(email);
  await page.goto(link);

  // El rol se concede antes de entrar: el JWT lo lleva dentro, así que un token emitido
  // antes de la concesión no serviría.
  grantRole(email, 'administrador');

  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/, { timeout: 20_000 });
}

test.describe('captura visual — administración', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const { token, width } of WIDTHS) {
    test(`@visual ${width}px (${token})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });

      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(
          page.locator('main').getByText(screen.marker, { exact: false }).first(),
        ).toBeVisible();

        // La lista de vigencias llega después de la petición: sin esperarla, la captura
        // saldría con los esqueletos de carga y no con las cifras, que son lo que interesa
        // mirar a cada ancho (N-15: ninguna cifra se recorta).
        if (screen.name === 'indicadores') {
          await expect(page.getByText('En curso').first()).toBeVisible();
        }

        // FR-127: la página nunca desplaza en horizontal. En el mínimo de 360 px es donde
        // la rejilla de fechas y las cifras de las vigencias aprietan.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `${screen.name} desplaza en horizontal a ${String(width)}px`,
        ).toBeLessThanOrEqual(0);

        // Barrido de barrera: etiquetas asociadas y contraste AA de todo el texto visible.
        // La captura se hace DESPUÉS, para que una pantalla que no cumple no deje una
        // imagen que parezca aprobada.
        await expectControlsAreLabelled(page);
        await expectTextMeetsAaContrast(page);

        await page.screenshot({
          path: `test-results/visual/admin/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      }
    });
  }
});
