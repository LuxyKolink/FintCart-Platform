import { expect, test } from '@playwright/test';

/**
 * Captura visual de las tres pantallas de acceso a cada punto de corte (T027).
 *
 * POR QUÉ NO HAY UNA ASERCIÓN `toHaveScreenshot`: la referencia visual es el kit
 * (`design/ui_kits/auth/`), que es HTML estático con React y Lucide por CDN —no
 * una imagen versionada—, así que una comparación automática contra él no existe.
 * Lo que sí se automatiza es lo que un ojo no debe tener que comprobar en cada
 * revisión: que la captura se produzca a cada ancho, que el panel de marca siga
 * visible (N-14) y que la página **no** desplace en horizontal (FR-127). Las
 * imágenes quedan en `test-results/visual/auth/` para contrastarlas con el kit.
 *
 * Los anchos son los tokens de `src/styles/tokens/breakpoints.css` (D-27) más el
 * mínimo de 360 px que exige FR-124. Se escriben como literales, igual que en los
 * `@media`, porque la captura ocurre en el navegador y no puede leer `var()`.
 */
const BREAKPOINTS = [
  { token: '--bp-sm', width: 480 },
  { token: '--bp-md', width: 768 },
  { token: '--bp-lg', width: 1024 },
  { token: '--bp-xl', width: 1280 },
] as const;

/** Mínimo soportado (FR-124), por debajo del menor punto de corte declarado. */
const MIN_WIDTH = 360;

const WIDTHS: readonly { token: string; width: number }[] = [
  ...BREAKPOINTS,
  { token: 'min', width: MIN_WIDTH },
];

interface Screen {
  readonly name: string;
  readonly path: string;
  /** Acción principal que debe seguir siendo visible a cualquier ancho. */
  readonly action: string;
}

const SCREENS: readonly Screen[] = [
  { name: 'iniciar-sesion', path: '/iniciar-sesion', action: 'Iniciar sesión' },
  { name: 'crear-cuenta', path: '/crear-cuenta', action: 'Crear cuenta' },
  {
    name: 'verificar-correo',
    path: '/auth/verify-email',
    action: 'Reenviar correo de verificación',
  },
];

for (const screen of SCREENS) {
  test.describe(`captura visual — ${screen.name}`, () => {
    for (const { token, width } of WIDTHS) {
      test(`@visual ${width}px (${token})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(screen.path);

        const brandPanel = page.locator('fc-brand-panel');
        await expect(brandPanel, 'el panel de marca se ocultó (N-14)').toBeVisible();
        await expect(page.getByRole('button', { name: screen.action })).toBeVisible();

        // FR-127: la página nunca desplaza en horizontal; lo que no quepa se
        // desplaza dentro de su contenedor.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'la página desplaza en horizontal').toBeLessThanOrEqual(0);

        await page.screenshot({
          path: `test-results/visual/auth/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      });
    }
  });
}
