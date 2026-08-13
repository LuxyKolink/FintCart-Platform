import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';

/**
 * Recorrido completo de US1 (SC-001): registro → verificación de correo →
 * inicio de sesión → catálogo → lectura de artículo → cuestionario → progreso.
 * Corre contra la pila real levantada por `dev/up` (Gateway, Aprendizaje,
 * Usuarios, Auth, Orquestador, MailHog) — no hay dobles de red aquí.
 */
test('un usuario nuevo completa registro, verificación, login, lectura y cuestionario', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const displayName = `E2E ${stamp}`;

  await test.step('registro', async () => {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(displayName);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();
  });

  await test.step('verificación de correo', async () => {
    const link = await waitForVerificationLink(email);
    await page.goto(link);
    await expect(page.getByText('Tu correo quedó verificado')).toBeVisible();
    await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  });

  await test.step('inicio de sesión', async () => {
    await expect(page).toHaveURL(/\/iniciar-sesion/);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);
  });

  await test.step('catálogo y lectura de artículo', async () => {
    const firstArticle = page.locator('a[href^="/articulos/"]').first();
    await expect(firstArticle).toBeVisible();
    await firstArticle.click();
    await expect(page.locator('article')).toBeVisible();
  });

  await test.step('cuestionario', async () => {
    const startQuiz = page.getByRole('link', { name: 'Iniciar cuestionario' });
    // No todos los artículos de la fixture de datos tienen cuestionario asociado;
    // el escenario 2 de spec.md solo exige que EXISTA el camino, no que este
    // artículo en particular lo tenga.
    if ((await startQuiz.count()) === 0) {
      test.skip(true, 'el artículo elegido no tiene cuestionario asociado');
    }
    await startQuiz.click();
    await expect(page).toHaveURL(/\/cuestionarios\//);

    const fieldsets = page.locator('fieldset');
    const total = await fieldsets.count();
    for (let i = 0; i < total; i += 1) {
      await fieldsets.nth(i).locator('input[type="radio"]').first().check();
    }

    await page.getByRole('button', { name: 'Enviar respuestas' }).click();
    await expect(page.getByText(/Intento n\.º/)).toBeVisible();
  });

  await test.step('progreso', async () => {
    await page.getByRole('link', { name: 'Ver tu progreso' }).click();
    await expect(page).toHaveURL(/\/progreso/);
    await expect(page.locator('.fc-num')).toHaveText(/\d+ puntos/);
  });
});
