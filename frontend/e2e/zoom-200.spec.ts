import { expect, test, type Page } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';

/**
 * FR-097 / SC-035: la interfaz sigue siendo utilizable con el tamaño de fuente del
 * navegador al 200 %, sin pérdida de contenido ni de funcionalidad (T083).
 *
 * CÓMO SE SIMULA. Subir la fuente por defecto del navegador equivale a subir el `rem`:
 * el navegador aplica ese tamaño al elemento raíz, y todo lo que esté en `rem` crece.
 * Eso es exactamente lo que se reproduce con `html { font-size: 200% }`, y es la razón
 * por la que el sistema de diseño mide tipografía y espaciado en `rem` y no en `px`.
 *
 * QUÉ SE COMPRUEBA, y por qué no basta con «se ve»:
 *   1. La página NO desplaza en horizontal —el fallo clásico al agrandar la letra—.
 *   2. Cada cifra monetaria y cada resultado siguen completos. Un valor recortado por
 *      el zoom no es texto incompleto: es un dato falso (N-15, Principio VIII), así que
 *      se compara el ancho del contenido con el de su caja.
 *   3. La acción principal sigue existiendo y siendo alcanzable.
 */
async function expectNothingIsLost(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'la página desplaza en horizontal con la fuente al 200 %').toBeLessThanOrEqual(1);

  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.fc-num, dd, dt'))
      .filter((element) => element.offsetParent !== null)
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()}: ${(element.textContent ?? '').trim().slice(0, 40)}`),
  );
  expect(clipped, 'cifras recortadas con la fuente al 200 % (N-15)').toEqual([]);
}

test.describe('la interfaz aguanta la fuente del navegador al 200 %', { tag: '@a11y' }, () => {
  test('acceso, catálogo, lector y resultado del simulador', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-zoom-${stamp}@fintcart.test`;
    const password = 'Dem0stracion!2026';

    await page.goto('/iniciar-sesion');
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
    await expectNothingIsLost(page);

    await page.goto('/crear-cuenta');
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await page.getByLabel('Nombre para mostrar').fill(`Zoom ${stamp}`);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();
    await expectNothingIsLost(page);

    await page.goto(await waitForVerificationLink(email));
    await page.getByRole('link', { name: 'Iniciar sesión' }).click();
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);

    // El catálogo es la pantalla con más contenido en columnas, y el sitio donde una
    // rejilla rígida rompería primero.
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await expect(page.locator('main a[href^="/articulos/"]').first()).toBeVisible();
    await expectNothingIsLost(page);

    await page.locator('main a[href^="/articulos/"]').first().click();
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await expect(page.locator('article')).toBeVisible();
    await expectNothingIsLost(page);

    // Y el resultado del simulador, que es donde vive el dinero.
    await page.goto('/simuladores/ahorro');
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await page.getByLabel('Depósito inicial').fill('1234567.89');
    await page.getByLabel('Aporte mensual').fill('100000');
    await page.getByLabel('Tasa anual').fill('0.08');
    await page.getByLabel('Plazo').fill('12');
    await page.getByRole('button', { name: 'Calcular' }).click();

    const money = page.locator('dd.fc-num').first();
    await expect(money).toContainText('$');
    // No basta con que el signo pesos siga ahí: la cifra tiene que estar ENTERA.
    await expect(money).not.toContainText('…');
    await expectNothingIsLost(page);

    // Y la privacidad, donde una consecuencia legal no puede quedar recortada.
    await page.goto('/perfil/eliminar-cuenta');
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await expect(page.getByText('Qué pasa exactamente')).toBeVisible();
    await expectNothingIsLost(page);
  });
});
