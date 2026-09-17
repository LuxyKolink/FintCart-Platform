import { expect, test, type Page } from '@playwright/test';

import { deleteCalculator } from './support/calculators';
import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';

/**
 * Curaduría de calculadoras de extremo a extremo (T116–T119; FR-051…FR-054, SC-018).
 *
 * ## Qué recorre, y por qué hacía falta
 *
 * El autor propone su calculadora, la bandeja del coordinador la muestra, un coordinador
 * DISTINTO la aprueba, y el catálogo público la sirve y la ejecuta. Cada eslabón existe en otra
 * capa —el Simulador decide las transiciones, la base impone la separación de autoría, el
 * Orquestador publica el evento, el borde exige el rol—(y ninguno de ellos se prueba aquí: lo
 * que se prueba es que la cadena entera funciona y que la interfaz cuenta la verdad).
 *
 * ## Por qué la calculadora se crea por la API y no por la interfaz
 *
 * Porque lo que se prueba aquí es la CURADURÍA —proponer, ver en la bandeja, aprobar, servir en
 * el catálogo— y no el formulario que escribe la definición: el constructor visual existe desde
 * T097 y tiene su propia prueba de recorrido completo (`constructor-calculadora.spec.ts`).
 * Repetirlo aquí alargaría esta prueba sin comprobar nada de lo suyo.
 *
 * La prueba usa la sesión REAL de la aplicación —lee el token que el SPA guardó y llama al borde
 * con él— y crea la calculadora como la crea el constructor: por `POST /calculators`, con el
 * token de la persona que la va a proponer. Inventarse un token o sembrar la fila en la base
 * probaría menos: la calculadora tiene que ser de quien dice serlo, o la aprobación no
 * significaría nada.
 *
 * ## La separación de autoría se comprueba contra el servidor
 *
 * El segundo tramo crea una calculadora del PROPIO coordinador y comprueba que, al intentar
 * aprobarla, el servidor responde 403 y la pantalla lo explica. Que los botones se escondan no
 * probaría nada: lo que hay que ver es que **el servidor no deja**, aunque la interfaz insista.
 */

const DEFINITION = {
  inputs: [
    {
      key: 'monto',
      label: 'Monto a invertir',
      type: 'monto',
      unit: 'COP',
      required: true,
    },
  ],
  validations: [],
  outputs: [
    {
      key: 'doble',
      label: 'Doble del monto',
      expression: 'monto * 2',
      scale: 2,
    },
  ],
};

interface Sesion {
  readonly email: string;
  readonly password: string;
}

async function crearCuenta(page: Page, prefijo: string): Promise<Sesion> {
  const stamp = Date.now();
  const email = `e2e-${prefijo}-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`${prefijo} ${stamp}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

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

/** El token que el SPA guardó para esta sesión. */
async function token(page: Page): Promise<string> {
  const stored = await page.evaluate(
    () => sessionStorage.getItem('fc_access_token') ?? localStorage.getItem('fc_access_token'),
  );
  expect(stored, 'la sesión tiene que haber guardado un token').not.toBeNull();
  return stored ?? '';
}

/** Crea una calculadora con la sesión de quien esté conectado, como hará el constructor. */
async function crearCalculadora(page: Page, nombre: string): Promise<string> {
  const response = await page.request.post('http://localhost:8080/calculators', {
    headers: {
      Authorization: `Bearer ${await token(page)}`,
      'Content-Type': 'application/json',
    },
    data: { name: nombre, description: 'Calculadora de prueba', definition: DEFINITION },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { calculator_id: string };
  return body.calculator_id;
}

/**
 * Nombres creados por las pruebas de este archivo, para poder limpiarlos al terminar.
 *
 * `afterEach` y no `afterAll` porque una prueba que falla a mitad deja su calculadora creada
 * —y puede haber dejado una publicada, que ya no se borra por la API—. La limpieza va por SQL
 * (`support/calculators.ts`) y solo alcanza a los nombres con el prefijo de prueba.
 */
const creadas: string[] = [];

test.afterEach(() => {
  while (creadas.length > 0) {
    const nombre = creadas.pop();
    if (nombre !== undefined) {
      deleteCalculator(nombre);
    }
  }
});

test.describe('curaduría de calculadoras', () => {
  test('el autor propone, un coordinador aprueba y el catálogo lo sirve', async ({ browser }) => {
    const stamp = Date.now();
    const nombre = `ZZE2E doble ${stamp}`;
    creadas.push(nombre);

    // ── 1. El autor crea y propone ──────────────────────────────────────────
    const contextoAutor = await browser.newContext();
    const autor = await contextoAutor.newPage();
    const sesionAutor = await crearCuenta(autor, 'curador');
    await entrar(autor, sesionAutor);

    const id = await crearCalculadora(autor, nombre);

    await autor.goto('/calculadoras/mis');
    await expect(autor.getByRole('heading', { name: nombre })).toBeVisible();
    // Nace privada: es FR-051, y la pantalla lo dice con una palabra, no con un color.
    await expect(autor.getByText('Privada', { exact: true })).toBeVisible();

    await autor.getByRole('button', { name: 'Proponer para publicación' }).click();
    await expect(autor.getByText('quedó propuesta')).toBeVisible();
    await expect(autor.getByText('En revisión', { exact: true })).toBeVisible();

    // ── 2. Un coordinador DISTINTO la ve en su bandeja y la aprueba ─────────
    const contextoCoordinador = await browser.newContext();
    const coordinador = await contextoCoordinador.newPage();
    const sesionCoordinador = await crearCuenta(coordinador, 'coord');
    // El rol se concede antes de entrar: viaja dentro del token.
    grantRole(sesionCoordinador.email, 'coordinador_editorial');
    await entrar(coordinador, sesionCoordinador);

    await coordinador.goto('/editorial/calculadoras');
    const fila = coordinador.locator('article', { hasText: nombre });
    await expect(fila).toBeVisible();
    // La definición se enseña antes de aprobar: qué devuelve y con cuántos decimales.
    await expect(fila.getByText('Doble del monto (2 decimales)')).toBeVisible();

    await fila.getByRole('button', { name: 'Aprobar y publicar' }).click();
    await expect(coordinador.getByText('está publicada')).toBeVisible();
    // La decisión saca la calculadora de la cola: ya no está pendiente.
    await expect(coordinador.locator('article', { hasText: nombre })).toHaveCount(0);

    // ── 3. El catálogo público la sirve y se puede ejecutar ────────────────
    await autor.goto('/calculadoras');
    await expect(autor.getByRole('heading', { name: nombre })).toBeVisible();

    // El catálogo también lista las SIETE calculadoras de la plataforma, así que hay que abrir
    // la tarjeta de ESTA: `getByRole('link', { name: 'Abrir' }).last()` sería la de la última
    // calculadora de la lista y la prueba navegaría a otra —lo hizo, en la primera ejecución—.
    await autor
      .locator('article', { hasText: nombre })
      .getByRole('link', { name: 'Abrir' })
      .click();
    await expect(autor).toHaveURL(new RegExp(`/calculadoras/${id}$`));
    await expect(autor.getByText('Publicada', { exact: true })).toBeVisible();

    await autor.getByLabel('Monto a invertir').fill('1234.5');
    await autor.getByRole('button', { name: 'Calcular' }).click();

    // La cifra sale con la escala que declaró su autor y sin símbolo de moneda: el catálogo no
    // sabe si son pesos, una tasa o unos meses, y poner `$` sería inventarlo (N-15).
    await expect(autor.getByText('Doble del monto')).toBeVisible();
    await expect(autor.getByText('2.469,00')).toBeVisible();
    // Versión 1: la calculadora se creó, se propuso y se aprobó sin editarla. La aprobación
    // publica la versión vigente, así que lo que el catálogo sirve es esa.
    //
    // Esta línea encontró un defecto real: la respuesta de la ejecución no llevaba la
    // procedencia, porque el resultado del Orquestador no la tenía —el historial sí—, y la
    // pantalla decía «Calculado con la versión 0».
    await expect(autor.getByText('Calculado con la versión 1 de la calculadora.')).toBeVisible();

    // ── 4. Lo PRIVADO no se cuela en el catálogo público ───────────────────
    const contextoAnonimo = await browser.newContext();
    const anonimo = await contextoAnonimo.newPage();
    await anonimo.goto('/calculadoras');
    // Sin sesión, el guard redirige al acceso: la ruta de la SPA está protegida aunque el borde
    // deje abierta la lectura del catálogo.
    await expect(anonimo).toHaveURL(/\/iniciar-sesion/);

    await contextoAnonimo.close();
    await contextoAutor.close();
    await contextoCoordinador.close();
  });

  test('nadie aprueba su propia calculadora, y la pantalla lo explica', async ({ page }) => {
    const stamp = Date.now();
    const nombre = `ZZE2E propia ${stamp}`;
    creadas.push(nombre);

    const sesion = await crearCuenta(page, 'coordpropio');
    grantRole(sesion.email, 'coordinador_editorial');
    await entrar(page, sesion);

    const id = await crearCalculadora(page, nombre);

    // Se propone por la interfaz, que es el camino que existe: el botón está en «Mis
    // calculadoras» y es el mismo que usa cualquier autor.
    await page.goto('/calculadoras/mis');
    await page.getByRole('button', { name: 'Proponer para publicación' }).click();
    await expect(page.getByText('quedó propuesta')).toBeVisible();

    // Y ahora la aprueba el propio autor, que además es coordinador: FR-053.
    await page.goto('/editorial/calculadoras');
    const fila = page.locator('article', { hasText: nombre });
    await expect(fila).toBeVisible();
    // La pantalla la señala como tuya —es información— y NO esconde el botón: la barrera vive
    // en el servidor, y esconderlo aquí sugeriría que la regla está en la interfaz.
    await expect(fila.getByText('Tuya')).toBeVisible();

    await fila.getByRole('button', { name: 'Aprobar y publicar' }).click();

    await expect(page.getByText('Ninguna calculadora la aprueba su propio autor')).toBeVisible();
    await expect(page.getByText('Tu propuesta sigue esperando')).toBeVisible();

    // Y sigue en la cola: el rechazo del servidor no la sacó de la bandeja.
    await expect(page.locator('article', { hasText: nombre })).toBeVisible();

    // El motivo del rechazo, en cambio, lo puede escribir OTRO coordinador; aquí se comprueba
    // solo que el autor NO puede ni aprobar ni rechazar lo suyo.
    await fila.getByRole('button', { name: 'Rechazar' }).click();
    await page.getByLabel('Motivo del rechazo').fill('no la puedo revisar yo');
    await page.getByRole('button', { name: 'Confirmar rechazo' }).click();
    await expect(page.getByText('Ninguna calculadora la aprueba su propio autor')).toBeVisible();
    // No se movió de la cola.
    await expect(page.locator('article', { hasText: nombre })).toBeVisible();
    expect(id).not.toBe('');
  });
});
