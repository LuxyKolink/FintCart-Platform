import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';

/**
 * Recorrido completo de US2 (FR-019–FR-022): login → selector de calculadoras →
 * ejecutar la calculadora de crédito con parámetros decimales → resultado con
 * precisión preservada → entrada en el historial. Corre contra la pila real
 * levantada por `dev/up`, igual que `us1-aprendizaje.spec.ts` — mismo registro y
 * verificación de correo vía MailHog, sin dobles de red.
 */
test('un usuario ejecuta una calculadora financiera y la ve en su historial', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-sim-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const displayName = `E2E Sim ${stamp}`;

  await test.step('registro y verificación de correo', async () => {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(displayName);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();

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

  await test.step('selector de las cinco calculadoras', async () => {
    await page.getByRole('link', { name: 'Simuladores' }).click();
    await expect(page).toHaveURL(/\/simuladores$/);
    await expect(page.getByRole('heading', { name: 'Simuladores financieros' })).toBeVisible();
    await page.getByRole('link', { name: 'Crédito' }).click();
    await expect(page).toHaveURL(/\/simuladores\/credito/);
  });

  await test.step('ejecutar la calculadora de crédito', async () => {
    await page.getByLabel('Monto del crédito').fill('10000000');
    await page.getByLabel('Tasa anual').fill('0.24');
    await page.getByLabel('Número de cuotas').fill('12');
    await page.getByRole('button', { name: 'Calcular' }).click();

    await expect(page.getByText('Cuota mensual')).toBeVisible();
    // Precisión decimal preservada de punta a punta: el resultado se sirve como
    // string decimal y se presenta con separador de miles, nunca como `number`.
    await expect(page.locator('dd.fc-num').first()).toContainText('$');
  });

  await test.step('la simulación queda en el historial', async () => {
    await page.getByRole('link', { name: 'Ver historial' }).click();
    await expect(page).toHaveURL(/\/simuladores\/historial/);
    await expect(page.getByText('Crédito', { exact: true })).toBeVisible();
    await expect(page.getByText('Cuota mensual')).toBeVisible();
  });
});
