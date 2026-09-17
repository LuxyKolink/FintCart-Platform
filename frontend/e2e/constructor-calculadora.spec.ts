import { expect, test, type Page } from '@playwright/test';

import { deleteCalculator } from './support/calculators';
import { waitForVerificationLink } from './support/mailhog';

/**
 * Constructor visual de calculadoras, de extremo a extremo (T097, FR-043…FR-046).
 *
 * ## Qué recorre
 *
 * Una persona entra, escribe una calculadora EN LA PANTALLA —no por la API, que es lo que hacía
 * falta antes de que el constructor existiera—, se equivoca, ve el problema señalado por el
 * servidor, lo corrige, la guarda, la ejecuta y comprueba que las cotas que declaró se respetan.
 *
 * ## Las dos cosas que solo se pueden probar aquí
 *
 *   1. **Que la comprobación en vivo la hace el SERVIDOR.** La prueba escribe una fórmula que
 *      referencia un dato que no existe y espera el problema con su ubicación. El analizador vive en
 *      el Simulador; si el constructor se inventara el veredicto, esto no aparecería.
 *   2. **Que las cotas declaradas llegan al ejecutor.** Es el defecto que destapó el constructor:
 *      el contrato manda `min_value`/`max_value` y el ejecutor leía `min`/`max`, así que no
 *      comprobaba ninguna cota y nada fallaba —porque todas las calculadoras de prueba se ejecutaban
 *      dentro del rango—. Aquí se declara un máximo, se intenta pasarlo y se exige que el ejecutor
 *      lo rechace SIN llegar a calcular.
 *
 * ## Lo que NO comprueba, y por qué
 *
 * La curaduría completa —proponer, aprobar, aparecer en el catálogo— está en
 * `curaduria-calculadoras.spec.ts`; repetirla aquí haría que las dos pruebas fallaran por el mismo
 * motivo y ninguna dijera más. Esta llega hasta «guardada y ejecutable», que es lo que el
 * constructor promete.
 */

/** Nombres creados por estas pruebas, para limpiarlos al terminar (ver `curaduria-calculadoras`). */
const creadas: string[] = [];

test.afterEach(() => {
  while (creadas.length > 0) {
    const nombre = creadas.pop();
    if (nombre !== undefined) {
      deleteCalculator(nombre);
    }
  }
});

interface Sesion {
  readonly email: string;
  readonly password: string;
}

async function crearCuenta(page: Page, prefijo: string): Promise<Sesion> {
  const stamp = Date.now();
  const email = `e2e-${prefijo}-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`constructor ${stamp}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // El enlace se pide y se visita, pero NO se entra desde ahí: la pantalla de verificación dice
  // que la cuenta quedó confirmada y no lleva al formulario de acceso.
  const link = await waitForVerificationLink(email);
  await page.goto(link);

  return { email, password };
}

async function entrar(page: Page, sesion: Sesion): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(sesion.email);
  await page.getByLabel('Contraseña').fill(sesion.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/);
}

test.describe('constructor de calculadoras', () => {
  test('se escribe, se corrige con lo que dice el servidor, se guarda y se ejecuta', async ({ page }) => {
    const stamp = Date.now();
    const nombre = `ZZE2E constructor ${stamp}`;
    creadas.push(nombre);

    await entrar(page, await crearCuenta(page, 'constructor'));

    // ── 1. Se llega desde «Mis calculadoras», que antes no ofrecía crearla ──
    await page.goto('/calculadoras/mis');
    await page.getByRole('link', { name: 'Crear una calculadora' }).click();
    await expect(page).toHaveURL(/\/calculadoras\/nueva$/);
    await expect(page.getByRole('heading', { name: 'Constructor de calculadoras' })).toBeVisible();

    // Los módulos se nombran por lo que son: el formulario tiene tres listas repetibles y dos de
    // ellas tienen campos con la MISMA etiqueta —«Clave»—, así que hay que decir en cuál se
    // escribe. Se busca por el texto del módulo y no por una clase.
    const datos = page.locator('fc-module-box', { hasText: 'Datos que pide' });
    const resultados = page.locator('fc-module-box', { hasText: 'Resultados' });

    await page.getByLabel('Nombre', { exact: true }).fill(nombre);
    await page.getByLabel('Descripción').fill('Doble del monto, con cota');

    await datos.getByLabel('Clave', { exact: true }).fill('monto');
    await datos.getByLabel('Etiqueta', { exact: true }).fill('Monto a invertir');
    await datos.getByLabel('Mínimo', { exact: true }).fill('1000');
    await datos.getByLabel('Máximo', { exact: true }).fill('1000000');
    await datos.getByLabel('Valor por defecto', { exact: true }).fill('1000');

    // Un error a propósito: `capital` no es ningún dato de esta definición. La fórmula es
    // sintácticamente correcta, así que solo un analizador puede decir que no se puede calcular.
    await resultados.getByLabel('Clave', { exact: true }).fill('doble');
    await resultados.getByLabel('Etiqueta', { exact: true }).fill('Doble del monto');
    await resultados.getByLabel('Fórmula', { exact: true }).fill('monto * capital');
    await resultados.getByLabel('Decimales', { exact: true }).fill('2');

    // ── 2. El problema lo dice el SERVIDOR y con su ubicación (FR-046) ──────
    await page.getByRole('button', { name: 'Comprobar ahora' }).click();

    await expect(page.getByText('Hay algo que corregir antes de guardar')).toBeVisible();
    const problema = page.getByText(/outputs\[0\]\.expression/);
    await expect(problema).toBeVisible();

    // ── 3. Se corrige y la comprobación aprueba ─────────────────────────────
    await resultados.getByLabel('Fórmula', { exact: true }).fill('monto * 2');
    await page.getByRole('button', { name: 'Comprobar ahora' }).click();

    await expect(page.getByText('se puede analizar', { exact: false })).toBeVisible();

    // ── 4. Se guarda, y la pantalla dice que es privada ─────────────────────
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByText('quedó guardada y es privada')).toBeVisible();
    // La ruta pasa a la de edición: recargar después de crear no puede crear OTRA calculadora.
    await expect(page).toHaveURL(/\/calculadoras\/[0-9a-f-]{36}\/editar$/);

    // ── 5. Se ejecuta, y la COTA declarada se respeta ──────────────────────
    await page.getByRole('link', { name: 'Ver y ejecutar' }).click();
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible();

    // El valor por defecto que se declaró en el constructor, no uno vacío: es la otra mitad del
    // defecto de los nombres del contrato.
    const campo = page.getByLabel('Monto a invertir');
    await expect(campo).toHaveValue('1000');

    // Un valor por encima del máximo declarado no se calcula: el formulario lo rechaza antes de
    // salir y lo explica, en vez de mandarlo y dejar que el servidor conteste con un error suyo.
    await campo.fill('2000000');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.getByText('Revisa los campos marcados')).toBeVisible();
    // Y NO se calcula: el bloque de resultado no llega a existir. Se busca por el título y no por
    // el texto de la salida, porque «Doble del monto» también está en la descripción de la
    // calculadora —el mismo tropiezo de selectores por subcadena que ya apareció con «Revisión»—.
    await expect(page.getByRole('heading', { name: 'Resultado' })).toHaveCount(0);

    // Y dentro del rango calcula, con la escala que declaró su autor y sin símbolo de moneda.
    await campo.fill('1234.5');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.getByText('2.469,00')).toBeVisible();
  });
});
