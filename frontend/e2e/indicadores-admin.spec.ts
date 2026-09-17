import { expect, test } from '@playwright/test';

import { deleteIndicator } from './support/indicators';
import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';

/**
 * Procedimiento anual de indicadores (T108, FR-055–FR-062): el administrador carga la
 * vigencia del año y ve el estado del calendario.
 *
 * ## Qué comprueba que no comprueben las pruebas unitarias
 *
 * Que el formulario hable con la BASE de verdad: el valor entra como texto, viaja como
 * cadena decimal por el borde, se guarda en `NUMERIC(20,6)` y vuelve a la pantalla. Un
 * `number` colado en cualquier punto del camino redondearía la cifra sin que ninguna
 * prueba de componente lo notara, porque el doble acepta lo que le den.
 *
 * El segundo escenario —el rechazo por solapamiento (FR-059)— se comprueba por su
 * EFECTO y no por el mensaje: el mensaje lo redacta el borde, y la garantía es que la
 * lista de vigencias no crezca.
 *
 * El rol se concede con `dev/seed role` porque no existe ningún endpoint que permita
 * auto-postularse (FR-082); ver `support/roles.ts`.
 */
/**
 * Indicador que la prueba crea, para poder borrarlo al terminar.
 *
 * La API no tiene `DELETE` de vigencias —a propósito: una vigencia se corrige, no se
 * borra— y una prueba que deja datos cambia el estado para la siguiente: la lista crece, las
 * capturas visuales enseñan indicadores de prueba y el recorrido por teclado de la barrera
 * se alarga con cada `Corregir`. Se anota aquí y se borra en el `afterEach`, que corre
 * también cuando la prueba falla.
 */
let indicadorCreado: string | null = null;

test.afterEach(() => {
  if (indicadorCreado !== null) {
    deleteIndicator(indicadorCreado);
    indicadorCreado = null;
  }
});

test('el administrador carga la vigencia anual y ve el estado del procedimiento', async ({ page }) => {
  const stamp = Date.now();
  const adminEmail = `e2e-admin-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  // Un nombre de indicador propio de la prueba: no toca las cifras sembradas (UVT, IPC…)
  // y deja la base como estaba. El formato lo impone el `CHECK` de la tabla.
  const nombre = `ZZE2E${stamp}`;
  indicadorCreado = nombre;

  await test.step('registrar y habilitar al administrador', async () => {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(`Admin E2E ${stamp}`);
    await page.getByLabel('Correo electrónico').fill(adminEmail);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();

    const link = await waitForVerificationLink(adminEmail);
    await page.goto(link);
    await expect(page.getByText('Tu correo quedó verificado')).toBeVisible();

    grantRole(adminEmail, 'administrador');
    // El rol se concede DESPUÉS de verificar el correo, como en `us4-editorial`: el
    // registro no deja sesión iniciada y el reingreso de abajo ya trae el rol en el JWT.
  });

  await test.step('entrar y llegar a la pantalla de indicadores', async () => {
    // Reingreso obligatorio: el rol se concedió después del registro, y el JWT ya emitido
    // no lo lleva.
    await page.goto('/iniciar-sesion');
    await page.getByLabel('Correo electrónico').fill(adminEmail);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    // El plazo se amplía AQUÍ y solo aquí: el acceso incluye la verificación de la
    // contraseña, que es deliberadamente costosa (es lo que la protege de un ataque por
    // fuerza bruta), y en esta máquina eso ha tardado más de cinco segundos bajo carga —
    // está medido en `specs/002-.../findings.md`. Un plazo mayor en el resto de la prueba
    // escondería una lentitud de verdad; en el acceso, lo que evita es un fallo que no
    // habla del diseño sino del anfitrión.
    await expect(page).toHaveURL(/\/catalogo/, { timeout: 20_000 });

    await page.getByRole('link', { name: 'Indicadores' }).click();
    await expect(page).toHaveURL(/\/admin\/indicadores/);
    await expect(page.getByRole('heading', { name: 'Indicadores financieros' })).toBeVisible();
  });

  await test.step('las vigencias sembradas están a la vista', async () => {
    // `dev/seed` deja el año en curso cargado, así que la lista no puede estar vacía.
    await expect(page.getByRole('heading', { name: 'UVT' })).toBeVisible();
    await expect(page.getByText('En curso').first()).toBeVisible();
  });

  await test.step('cargar una vigencia nueva', async () => {
    await page.getByRole('textbox', { name: 'Indicador' }).fill(nombre);
    // La cifra entra como TEXTO con sus decimales: si el valor pasara por `number` en
    // algún punto, `1234.56` seguiría siéndolo, pero `0.123456` (seis decimales) es el
    // caso que revela un redondeo binario.
    await page.getByLabel('Valor').fill('0.123456');
    await page.getByLabel('Aplica desde').fill('2026-01-01');
    await page.getByLabel('Aplica hasta').fill('2027-01-01');
    await page.getByRole('button', { name: 'Cargar vigencia' }).click();

    // El aviso de éxito por su tono y no por `role="status"`: los esqueletos de carga son
    // regiones vivas con el mismo rol, y seleccionar por rol resolvía a tres elementos.
    await expect(page.locator('.fc-banner[data-tone="success"]')).toContainText('Vigencia');
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
    // La cifra vuelve entera y con sus seis decimales, sin recortar (N-15).
    await expect(page.locator('.fc-num', { hasText: '0.123456' }).first()).toBeVisible();
  });

  await test.step('un solapamiento no añade una vigencia más (FR-059)', async () => {
    await page.getByRole('textbox', { name: 'Indicador' }).fill(nombre);
    await page.getByLabel('Valor').fill('9999');
    await page.getByLabel('Aplica desde').fill('2026-06-01');
    await page.getByLabel('Aplica hasta').fill('2026-08-01');
    await page.getByRole('button', { name: 'Cargar vigencia' }).click();

    // El rechazo se anuncia y NO se crea nada: la vigencia del paso anterior sigue siendo
    // la única de este indicador.
    await expect(page.locator('.fc-banner[data-tone="error"]')).toContainText('solapa');
    await expect(page.locator('.fc-num', { hasText: '9999' })).toHaveCount(0);
  });

  await test.step('corregir la cifra de una vigencia existente', async () => {
    // La vigencia de ESTA prueba y no «la última de la lista»: la base tiene las sembradas
    // (UVT, IPC…) y afirmar sobre la última sería afirmar sobre el orden alfabético.
    const grupo = page.locator('.fc-ind__grupo', { hasText: nombre });
    await grupo.getByRole('button', { name: 'Corregir' }).click();
    await page.getByLabel('Valor').fill('0.5');
    await page.getByRole('button', { name: 'Guardar corrección' }).click();

    await expect(page.locator('.fc-banner[data-tone="success"]')).toContainText('corregida');
    await expect(page.locator('.fc-num', { hasText: '0.5' }).first()).toBeVisible();
  });

  await test.step('el panel de estado nombra lo que se quedó sin vigencia (FR-061, FR-062)', async () => {
    // El panel no se puede provocar desde la interfaz sin estropear los datos sembrados, y
    // que la consulta detecte un hueco de verdad se comprueba contra la base en
    // `services/simulator/tests/indicators_db.rs`. Lo que se verifica AQUÍ es la mitad que
    // es de esta pantalla: que pinta lo que el servidor dice.
    //
    // Se intercepta la respuesta en lugar de esperar a que el calendario real esté mal: una
    // prueba del 31 de diciembre pasaría o fallaría según el día, que es la peor clase de
    // prueba.
    await page.route('**/admin/indicators/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          missing_names: ['UVT'],
          expiring: [{ name: 'IPC', valid_to: '2027-01-01', days_remaining: 12 }],
        }),
      }),
    );

    await page.reload();

    const panel = page.getByRole('heading', { name: 'Estado del procedimiento' });
    await expect(panel).toBeVisible();

    // El aviso de lo que falta va como `warning` y con el nombre del indicador: es lo
    // único de la pantalla que pide hacer algo.
    const faltantes = page.locator('.fc-banner[data-tone="warning"]');
    await expect(faltantes).toContainText('sin vigencia');
    await expect(faltantes).toContainText('UVT');

    // Y el de lo que está por vencer dice CUÁNDO y CUÁNTOS días quedan, no solo que vence.
    const porVencer = page.locator('.fc-banner[data-tone="info"]');
    await expect(porVencer).toContainText('IPC');
    await expect(porVencer).toContainText('2027-01-01');
    await expect(porVencer).toContainText('quedan 12 días');
  });
});
