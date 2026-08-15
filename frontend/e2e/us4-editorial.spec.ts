import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';

/**
 * Recorrido completo de US4 (T156, FR-006/FR-007/FR-008/FR-009/FR-013): un editor
 * redacta un artículo con su cuestionario y lo envía a revisión; un coordinador
 * editorial DISTINTO lo aprueba y publica; el artículo aparece en el catálogo público.
 *
 * Dos actores, no uno — es el punto entero de FR-008. `dev/seed role` concede los
 * roles porque no existe (ni debe existir) ningún endpoint de auto-postulación
 * editorial; ver `support/roles.ts`. Cada cuenta tiene que volver a iniciar sesión
 * DESPUÉS de recibir su rol: el JWT ya emitido no lo lleva.
 */
test('un editor publica un artículo tras la aprobación de un coordinador distinto', async ({ page }) => {
  const stamp = Date.now();
  const editorEmail = `e2e-editor-${stamp}@fintcart.test`;
  const coordEmail = `e2e-coordinador-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const title = `Artículo E2E ${stamp}`;

  async function registerAndVerify(email: string, displayName: string): Promise<void> {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(displayName);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();

    const link = await waitForVerificationLink(email);
    await page.goto(link);
    await expect(page.getByText('Tu correo quedó verificado')).toBeVisible();
  }

  async function login(email: string): Promise<void> {
    await page.goto('/iniciar-sesion');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);
  }

  await test.step('registrar editor y coordinador (dos cuentas distintas, FR-008)', async () => {
    await registerAndVerify(editorEmail, `Editor E2E ${stamp}`);
    grantRole(editorEmail, 'editor');

    await registerAndVerify(coordEmail, `Coordinador E2E ${stamp}`);
    grantRole(coordEmail, 'coordinador_editorial');
  });

  await test.step('el editor crea un borrador con su cuestionario y lo envía a revisión', async () => {
    // Reingreso obligatorio: el rol se concedió DESPUÉS del primer login de esta
    // sesión de navegador (el registro no deja sesión iniciada).
    await login(editorEmail);
    await page.getByRole('link', { name: 'Editorial' }).click();
    await expect(page).toHaveURL(/\/editorial$/);

    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Categoría').fill('ahorro');
    await page.getByLabel('Cuerpo', { exact: true }).fill('Cuerpo del artículo de prueba, con suficiente longitud.');
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByText('Estado actual:')).toBeVisible();

    await page.getByLabel('Título del cuestionario').fill('Cuestionario de prueba');
    await page.getByLabel('Umbral de aprobación (0–100)').fill('50');
    await page.locator('input[formcontrolname="prompt"]').first().fill('¿Cuánto es 2 + 2?');
    await page.getByPlaceholder('Opción A').first().fill('3');
    await page.getByPlaceholder('Opción B').first().fill('4');
    await page.getByLabel('Opción B correcta').first().check();
    await page.locator('input[formcontrolname="weight"]').first().fill('1');
    await page.getByRole('button', { name: 'Crear cuestionario' }).click();
    await expect(page.getByText('Cuestionario guardado.')).toBeVisible();

    await page.getByRole('button', { name: 'Enviar a revisión' }).click();
    await expect(page.getByText('Enviado a revisión.')).toBeVisible();
  });

  await test.step('el coordinador aprueba y publica', async () => {
    await login(coordEmail);
    await page.getByRole('link', { name: 'Revisión' }).click();
    await expect(page).toHaveURL(/\/editorial\/revision$/);
    await expect(page.getByText(title, { exact: false })).not.toBeVisible();

    // La bandeja no muestra el título (ArticleVersion no lo lleva, ver la nota de
    // T167–T169 en tasks.md): se identifica el ítem correcto por el fragmento de
    // cuerpo que sí se ve en la vista previa.
    const card = page.locator('article', { hasText: 'Cuerpo del artículo de prueba' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Aprobar y publicar' }).click();
    await expect(card).not.toBeVisible();
  });

  await test.step('el artículo aparece en el catálogo público', async () => {
    await page.goto('/catalogo');
    await expect(page.getByRole('heading', { name: title, level: 3 })).toBeVisible();
  });
});
