import { expect, test, type Page } from '@playwright/test';

import { expectControlsAreLabelled, expectTextMeetsAaContrast } from '../support/a11y';
import { waitForVerificationLink } from '../support/mailhog';
import { grantRole } from '../support/roles';

/**
 * Captura visual del flujo editorial a cada punto de corte (T073).
 *
 * ─── LA FRONTERA CON 002 (FR-123, T070) ────────────────────────────────────────
 *
 * La captura del editor se incluye A PROPÓSITO, aunque 003 no lo migre: es la evidencia de
 * dónde queda la frontera. El editor conserva su superficie de redacción tal cual —esa la
 * reescribe 002—, así que sus 8 estilos en línea siguen ahí y `styles.scss` sigue siendo
 * necesario. Las dos pantallas que sí se migran en este grupo son el listado de versiones y
 * la bandeja de revisión.
 *
 * ─── POR QUÉ UNA SOLA CUENTA CON DOS ROLES ─────────────────────────────────────
 *
 * Con `editor` y `coordinador_editorial` en el mismo usuario se puede crear, enviar a
 * revisión y ver la cola sin cambiar de sesión. Y no es una licencia del test: al pulsar
 * «Aprobar y publicar» sobre el contenido propio, el borde lo rechaza por FR-008, así que la
 * captura recoge el aviso de FR-116 **de verdad** — el caso que la pantalla existe para
 * explicar.
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

async function signInAsEditorAndCoordinator(page: Page): Promise<string> {
  const stamp = Date.now();
  const email = `e2e-edvisual-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const title = `Artículo editorial ${stamp}`;

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`Editorial ${stamp}`);
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

  // Dos roles en la misma cuenta, concedidos como lo haría un operador (no hay endpoint de
  // auto-postulación editorial, y no debe haberlo).
  grantRole(email, 'editor');
  grantRole(email, 'coordinador_editorial');

  // El JWT ya emitido no lleva los roles nuevos: hay que volver a entrar.
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/);

  // Un borrador enviado a revisión, para que el listado y la cola tengan contenido real.
  await page.goto('/editorial');
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
  await page
    .getByLabel('Cuerpo', { exact: true })
    .fill('Cuerpo del artículo editorial de prueba, con la longitud suficiente para la vista previa.');
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(page.getByText('Estado actual:')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar a revisión' }).click();
  await expect(page.getByText('Enviado a revisión.')).toBeVisible();

  return title;
}

test.describe('captura visual — editorial', () => {
  let screens: readonly Screen[] = [];

  test.beforeEach(async ({ page }) => {
    await signInAsEditorAndCoordinator(page);

    screens = [
      // El editor NO se migra en 003 (lo reescribe 002): se captura para dejar constancia
      // de la frontera, no porque este grupo lo cambie.
      // Al recargar, el editor arranca sin borrador: el marcador tiene que ser algo que
      // exista SIEMPRE en esa pantalla, no el estado del borrador que se acaba de crear.
      { name: 'editor', path: '/editorial', marker: 'Crear borrador' },
      { name: 'listado-versiones', path: '/editorial/borradores', marker: 'En revisión' },
      { name: 'revision', path: '/editorial/revision', marker: 'Aprobar y publicar' },
    ];
  });

  for (const { token, width } of WIDTHS) {
    test(`@visual ${width}px (${token})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });

      for (const screen of screens) {
        await page.goto(screen.path);
        await expect(page.locator('main').getByText(screen.marker, { exact: false }).first()).toBeVisible();

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} desplaza en horizontal a ${String(width)}px`).toBeLessThanOrEqual(0);

        await expectControlsAreLabelled(page);
        await expectTextMeetsAaContrast(page);

        await page.screenshot({
          path: `test-results/visual/editorial/${screen.name}-${String(width)}.png`,
          fullPage: true,
        });
      }

      // FR-116: el aviso de que no puedes aprobar tu propio contenido, capturado de verdad
      // —el borde lo rechaza— y con su propio texto, no como error genérico.
      await page.goto('/editorial/revision');
      // Se apunta a MI versión y no a la primera de la cola: la bandeja puede tener versiones
      // de otras ejecuciones, y pulsar «publicar» en una ajena la publicaría de verdad.
      const mine = page.locator('article').filter({ hasText: 'Tú' }).first();
      await mine.getByRole('button', { name: 'Aprobar y publicar' }).click();
      await expect(page.getByText('No puedes aprobar tu propio contenido')).toBeVisible();

      await expectTextMeetsAaContrast(page);
      await page.screenshot({
        path: `test-results/visual/editorial/revision-propia-${String(width)}.png`,
        fullPage: true,
      });
    });
  }
});
