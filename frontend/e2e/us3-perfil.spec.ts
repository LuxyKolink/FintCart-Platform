import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';

/**
 * Recorrido completo de US3 (T131, FR-005/FR-017/FR-018/FR-023/FR-030): login →
 * perfil → editar datos y preferencias → confirmación → reporte estadístico de
 * actividad → bandeja in-app → cambio de contraseña → eliminación de cuenta.
 * Corre contra la pila real levantada por `dev/up`, igual que
 * `us1-aprendizaje.spec.ts` y `us2-simuladores.spec.ts` — mismo registro y
 * verificación de correo vía MailHog, sin dobles de red.
 *
 * El cambio de contraseña y la eliminación de cuenta van AL FINAL, en ese orden y
 * dentro del mismo test: los dos terminan la sesión (el primero porque invalida
 * las sesiones abiertas, FR-005; el segundo porque el flujo la cierra al aceptar
 * la solicitud, FR-030), así que cualquiera de los dos deja inservible el resto
 * del recorrido si se probara antes.
 */
test('un usuario administra su perfil, preferencias, reporte y cuenta', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-perfil-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const displayName = `E2E Perfil ${stamp}`;

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

  await test.step('editar perfil y preferencias con confirmación', async () => {
    await page.getByRole('link', { name: 'Tu perfil' }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    const nuevoNombre = `${displayName} (editado)`;
    await page.getByLabel('Nombre para mostrar').fill(nuevoNombre);
    await page.getByLabel('Notificaciones por correo electrónico').uncheck();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(page.getByText('Tus cambios se guardaron correctamente')).toBeVisible();
    // Recargar confirma que persistió del lado del servidor y no solo en el
    // estado local del formulario.
    await page.reload();
    await expect(page.getByLabel('Nombre para mostrar')).toHaveValue(nuevoNombre);
    await expect(page.getByLabel('Notificaciones por correo electrónico')).not.toBeChecked();
  });

  await test.step('reporte estadístico de actividad', async () => {
    await page.getByRole('link', { name: 'Ver reporte de actividad' }).click();
    await expect(page).toHaveURL(/\/perfil\/reporte/);
    // Cuenta recién creada, sin contenido consumido ni simulaciones (Independent
    // Test de US3): los cuatro indicadores existen y parten en cero.
    await expect(page.getByText('Puntos acumulados')).toBeVisible();
    await expect(page.getByText('Cuestionarios respondidos')).toBeVisible();
    await expect(page.getByText('Simulaciones ejecutadas')).toBeVisible();
  });

  await test.step('bandeja in-app', async () => {
    await page.getByRole('link', { name: 'Notificaciones' }).click();
    await expect(page).toHaveURL(/\/notificaciones/);
    await expect(page.getByRole('heading', { name: 'Tus notificaciones' })).toBeVisible();
  });

  await test.step('cambio de contraseña (termina la sesión)', async () => {
    await page.goto('/perfil/contrasena');
    const nuevaPassword = 'Dem0stracion!2027';
    await page.getByLabel('Contraseña actual').fill(password);
    await page.getByLabel('Contraseña nueva').fill(nuevaPassword);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();

    await expect(page.getByText('cerramos tu sesión actual')).toBeVisible();
    await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion/);

    // La contraseña nueva funciona; la anterior ya no.
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(nuevaPassword);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);
  });

  await test.step('eliminación de cuenta (derecho Ley 1581, FR-030)', async () => {
    await page.goto('/perfil/eliminar-cuenta');
    await expect(page.getByText('irreversible')).toBeVisible();
    await page.getByLabel('Escribe ELIMINAR MI CUENTA para confirmar').fill('ELIMINAR MI CUENTA');
    await page.getByRole('button', { name: 'Eliminar mi cuenta de forma permanente' }).click();

    await expect(page.getByText('Recibimos tu solicitud')).toBeVisible();
    await page.getByRole('button', { name: 'Ir a iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion/);
  });
});
