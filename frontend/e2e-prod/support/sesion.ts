import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Las cuentas del humo autenticado y cómo se entra con ellas.
 *
 * Vive aparte porque ya son tres grupos —aprendiz, administrador y el par editorial— y el
 * guion de entrada (correo, contraseña, «Iniciar sesión», esperar el catálogo) tiene que ser
 * EL MISMO en todos: si aquí cambiara un selector, cambia para los tres a la vez en lugar de
 * quedarse uno atrás.
 *
 * Las cuentas NO las crea la suite: el registro manda el correo de verificación por SMTP real
 * (Gmail) y la única forma de leer el enlace es el buzón del destinatario. Las crea un
 * operador una sola vez y llegan por entorno (deploy/vps/README.md §7).
 *
 * Los roles editoriales y el de administrador tampoco los concede la API a propósito (FR-008):
 * se conceden con `deploy/vps/rol` y `BOOTSTRAP_ADMIN_EMAIL`, y el token que ya estaba emitido
 * no los lleva, así que estas pruebas inician sesión desde cero.
 */
export type Cuenta = { email: string; password: string };

/** Lee `E2E_<PREFIJO>_EMAIL` y `E2E_<PREFIJO>_PASSWORD`. Si falta algo, la prueba se salta. */
export function cuenta(prefijo: string): Cuenta {
  return {
    email: process.env['E2E_' + prefijo + '_EMAIL'] ?? '',
    password: process.env['E2E_' + prefijo + '_PASSWORD'] ?? '',
  };
}

export async function entrar(page: Page, quien: Cuenta): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(quien.email);
  await page.getByLabel('Contraseña').fill(quien.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/);
}
