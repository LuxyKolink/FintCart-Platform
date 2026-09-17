import { expect, test, type Page } from '@playwright/test';

import { waitForVerificationLink } from '../support/mailhog';

/**
 * Captura visual de las cinco pantallas del portal a cada punto de corte (T041).
 *
 * POR QUÉ NO HAY UNA ASERCIÓN `toHaveScreenshot`: la referencia visual es el kit
 * (`design/ui_kits/learner/`), que es HTML estático con React por CDN —no una imagen
 * versionada—, así que no existe una comparación automática contra él. Lo que sí se
 * automatiza es lo que un ojo no debería tener que comprobar en cada revisión: que la
 * captura se produzca a cada ancho y que la página **no** desplace en horizontal
 * (FR-127). Las imágenes quedan en `test-results/visual/learner/` para contrastarlas.
 *
 * El portal necesita sesión, así que el recorrido se registra de verdad —igual que la
 * barrera de accesibilidad— en lugar de inyectar un token: un token inventado no
 * probaría que las pantallas cargan sus datos.
 *
 * Los anchos son los tokens de `src/styles/tokens/breakpoints.css` (D-27) más el mínimo
 * de 360 px (FR-124), escritos como literales porque la captura ocurre en el navegador.
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
  /** Algo que debe seguir siendo visible a cualquier ancho para dar la pantalla por viva. */
  readonly marker: string;
}

async function signIn(page: Page): Promise<void> {
  const stamp = Date.now();
  const email = `e2e-visual-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`Visual ${stamp}`);
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

test.describe('captura visual — portal de aprendizaje', () => {
  let screens: readonly Screen[] = [];

  test.beforeEach(async ({ page }) => {
    await signIn(page);

    // Las rutas del lector y del cuestionario dependen de datos reales, así que se
    // descubren navegando: el primer artículo del catálogo y su cuestionario.
    const firstArticle = page.locator('a[href^="/articulos/"]').first();
    await expect(firstArticle).toBeVisible();
    const articlePath = (await firstArticle.getAttribute('href')) ?? '';

    screens = [
      { name: 'catalogo', path: '/catalogo', marker: 'Catálogo de aprendizaje' },
      // El marcador del lector no puede ser «Iniciar cuestionario»: no todos los
      // artículos traen cuestionario, y la captura tiene que producirse igual.
      { name: 'articulo', path: articlePath, marker: 'contenido vigente' },
      { name: 'progreso', path: '/progreso', marker: 'Puntos acumulados' },
      { name: 'notificaciones', path: '/notificaciones', marker: 'Tus notificaciones' },
    ];

    // El cuestionario solo se captura si el artículo elegido trae uno; el escenario 2 de
    // spec.md exige que EXISTA el camino, no que ese artículo en particular lo tenga.
    await page.goto(articlePath);
    const quizLink = page.getByRole('link', { name: 'Iniciar cuestionario' });
    if ((await quizLink.count()) > 0) {
      const quizPath = (await quizLink.getAttribute('href')) ?? '';
      screens = [...screens, { name: 'cuestionario', path: quizPath, marker: 'Enviar respuestas' }];
    }
  });

  for (const { token, width } of WIDTHS) {
    test(`@visual ${width}px (${token})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const screen of screens) {
        await page.goto(screen.path);
        // Acotado a `<main>`: sin acotar, un marcador como «Tu progreso» también
        // coincide con el enlace del armazón… que bajo `--bp-md` está oculto, así que
        // `.first()` resolvía a un elemento invisible y la captura no llegaba a hacerse.
        await expect(
          page.locator('main').getByText(screen.marker, { exact: false }).first(),
        ).toBeVisible();

        // El lector renderiza el DOCUMENTO DE BLOQUES, no el respaldo en texto (T133,
        // FR-063). Es la única aserción de esta suite que mira una clase, y se justifica:
        // los dos caminos pintan párrafos y una captura no los distingue, así que sin
        // esto un fallo silencioso —el documento deja de llegar y el lector cae al texto—
        // dejaría el rediseño «verde» con la funcionalidad perdida. Comprueba el efecto
        // observable: lo que se ve en pantalla viene del documento.
        if (screen.name === 'articulo') {
          await expect(page.locator('.fc-blocks').first()).toBeVisible();
        }

        // FR-127: la página NUNCA desplaza en horizontal. Lo que no quepa —las pestañas
        // de una categoría con nombre largo, la tabla del historial— se desplaza dentro
        // de su propio contenedor.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} desplaza en horizontal a ${String(width)}px`).toBeLessThanOrEqual(0);

        await page.screenshot({
          path: `test-results/visual/learner/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      }
    });
  }
});
