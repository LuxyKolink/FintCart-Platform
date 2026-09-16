import { expect, test, type Page } from '@playwright/test';

import { waitForVerificationLink } from '../support/mailhog';

/**
 * Captura visual de los simuladores a cada punto de corte (T052) y comprobación de que
 * **ninguna cifra monetaria se recorta** (T049, nota N-15).
 *
 * POR QUÉ LA COMPROBACIÓN DE N-15 VIVE AQUÍ Y NO EN UNA PRUEBA DE UNIDAD: que una cifra no
 * quepa es una cuestión de geometría del navegador —`scrollWidth` contra `clientWidth`,
 * `text-overflow`, `line-clamp`— y eso no existe fuera del navegador. Se ejecuta en las
 * cinco anchuras, que es donde el problema aparecería.
 *
 * La referencia visual sigue siendo el kit (`design/ui_kits/simulators/`), que es HTML
 * estático: por eso no hay `toHaveScreenshot`, sino capturas para contrastar a ojo y
 * aserciones automáticas de lo que un ojo no debería tener que revisar en cada cambio.
 */
const WIDTHS: readonly { token: string; width: number }[] = [
  { token: '--bp-sm', width: 480 },
  { token: '--bp-md', width: 768 },
  { token: '--bp-lg', width: 1024 },
  { token: '--bp-xl', width: 1280 },
  { token: 'min', width: 360 },
];

async function signIn(page: Page): Promise<void> {
  const stamp = Date.now();
  const email = `e2e-simvisual-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`Sim visual ${stamp}`);
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

/**
 * N-15: un importe cortado no es texto incompleto, es un dato falso. Se comprueba que cada
 * cifra monetaria visible se dibuja ENTERA: sin puntos suspensivos, sin recorte por líneas
 * y sin desbordar su propia caja.
 */
async function expectMoneyIsNeverTruncated(page: Page, where: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const found: string[] = [];
    for (const figure of Array.from(document.querySelectorAll<HTMLElement>('.fc-num'))) {
      const text = (figure.textContent ?? '').trim();
      if (!text.includes('$')) {
        continue;
      }
      const style = getComputedStyle(figure);
      const clamped = style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '';
      const ellipsis = style.textOverflow === 'ellipsis';
      // `scrollWidth > clientWidth` con `overflow: visible` significa que el texto se sale
      // de su caja: está recortado aunque no se vea un punto suspensivo.
      const overflowing = figure.scrollWidth > figure.clientWidth + 1;
      if (clamped || ellipsis || overflowing) {
        found.push(`${text} (clamp=${String(clamped)} ellipsis=${String(ellipsis)} overflow=${String(overflowing)})`);
      }
    }
    return found;
  });

  expect(offenders, `cifras monetarias recortadas en ${where} (N-15)`).toEqual([]);
}

test.describe('captura visual — simuladores', () => {
  let screens: readonly { name: string; path: string; marker: string }[] = [];

  test.beforeEach(async ({ page }) => {
    await signIn(page);

    // Se ejecuta una simulación de verdad: el resultado y su entrada en el historial son
    // las dos vistas con cifras monetarias, y sin ejecutarla no existirían.
    await page.goto('/simuladores/credito');
    await page.getByLabel('Monto del crédito').fill('10000000');
    await page.getByLabel('Tasa anual').fill('0.24');
    await page.getByLabel('Número de cuotas').fill('12');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.locator('dt', { hasText: 'Cuota mensual' }).first()).toBeVisible();

    screens = [
      { name: 'selector', path: '/simuladores', marker: 'Simuladores financieros' },
      { name: 'formulario', path: '/simuladores/credito', marker: 'Monto del crédito' },
      { name: 'formulario-resultado', path: '/simuladores/credito', marker: 'Cuota mensual' },
      // El marcador tiene que ser TEXTO VISIBLE: `Modo de cálculo` es el `aria-label` del
      // nav de modos y no aparece en ningún nodo de texto.
      { name: 'colombia', path: '/simuladores/colombia_especifica', marker: 'Efectiva Anual' },
      { name: 'historial', path: '/simuladores/historial', marker: 'Parámetros' },
    ];
  });

  for (const { token, width } of WIDTHS) {
    test(`@visual ${width}px (${token})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });

      for (const screen of screens) {
        await page.goto(screen.path);
        if (screen.name === 'formulario-resultado') {
          // El resultado no persiste al recargar: hay que volver a calcular.
          await page.getByLabel('Monto del crédito').fill('10000000');
          await page.getByLabel('Tasa anual').fill('0.24');
          await page.getByLabel('Número de cuotas').fill('12');
          await page.getByRole('button', { name: 'Calcular' }).click();
        }
        await expect(page.locator('main').getByText(screen.marker, { exact: false }).first()).toBeVisible();

        // FR-127: la página nunca desplaza en horizontal.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} desplaza en horizontal a ${String(width)}px`).toBeLessThanOrEqual(0);

        await expectMoneyIsNeverTruncated(page, `${screen.name} a ${String(width)}px`);

        await page.screenshot({
          path: `test-results/visual/simulators/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      }
    });
  }
});
