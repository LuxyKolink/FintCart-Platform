import { expect, test, type Browser, type Page } from '@playwright/test';

import { deleteArticleByTitle } from './support/articles';
import { deleteCalculator } from './support/calculators';
import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';

/**
 * Una calculadora incrustada en un artículo, de punta a punta (T150, T156; FR-070…FR-072).
 *
 * ## Qué recorre
 *
 * El editor **incrusta** una calculadora publicada desde el editor de verdad, el artículo se
 * publica, y un lector la **ejecuta sin salir del artículo** (FR-071) y la encuentra después en
 * su historial de simulaciones. Y el segundo tramo comprueba lo que pasa cuando la calculadora
 * deja de estar publicada: el artículo **sigue leyéndose** y el bloque se convierte en un aviso
 * (FR-072).
 *
 * ## Por qué la ejecución pasa por el historial y no solo por la pantalla
 *
 * FR-071 no pide «que se pueda calcular», pide que la ejecución quede registrada como cualquier
 * otra. La ruta es la misma —borde → Orquestador → Simulador— y comprobarlo es lo que distingue
 * este bloque de un calculador de juguete: si alguien lo reescribiera para calcular en el
 * navegador, el resultado se vería igual y no quedaría nada en el historial.
 *
 * ## Por qué la calculadora y la publicación se hacen por la API
 *
 * La calculadora se crea como la crea el constructor (ya existe, T097: el comentario anterior
 * decía que no, y dejó de ser cierto) y la versión se envía a revisión y se aprueba por las rutas
 * del borde. Lo que se prueba aquí es el bloque incrustado; el constructor tiene su propia prueba
 * de recorrido completo (`constructor-calculadora.spec.ts`) y el flujo editorial la suya
 * (`us4-editorial.spec.ts`). Repetirlos aquí solo añadiría minutos y puntos de fallo ajenos.
 */

const DEFINITION = {
  inputs: [
    {
      key: 'monto',
      label: 'Monto a invertir',
      type: 'monto',
      unit: 'COP',
      required: true,
      min_value: '0',
      max_value: '1000000',
      default_value: '100',
    },
  ],
  validations: [],
  outputs: [{ key: 'doble', label: 'Doble del monto', expression: 'monto * 2', scale: 2 }],
};

const PASSWORD = 'Dem0stracion!2026';

interface Sesion {
  readonly email: string;
  readonly password: string;
}

/** El prefijo de todo lo que crean estas pruebas, para poder limpiarlo después. */
const PREFIJO = 'ZZE2E incrustada';

async function crearCuenta(page: Page, prefijo: string): Promise<Sesion> {
  const stamp = Date.now();
  const email = `e2e-${prefijo}-${stamp}@fintcart.test`;

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`${prefijo} ${stamp}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  const link = await waitForVerificationLink(email);
  await page.goto(link);

  return { email, password: PASSWORD };
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

/** Llama al borde con la sesión de la página. */
async function api(
  page: Page,
  metodo: 'get' | 'post' | 'delete',
  ruta: string,
  data?: unknown,
): Promise<{ status: number; json: unknown }> {
  const cabeceras = { Authorization: `Bearer ${await token(page)}`, 'Content-Type': 'application/json' };
  const url = `http://localhost:8080${ruta}`;
  const response =
    metodo === 'post'
      ? await page.request.post(url, { headers: cabeceras, data: data ?? {} })
      : metodo === 'delete'
        ? await page.request.delete(url, { headers: cabeceras })
        : await page.request.get(url, { headers: cabeceras });
  const texto = await response.text();
  return { status: response.status(), json: texto === '' ? null : (JSON.parse(texto) as unknown) };
}

/**
 * Crea una calculadora y la publica (crear → proponer → aprobar con otro rol).
 *
 * Devuelve la sesión del AUTOR además de la del coordinador: hace falta para el segundo tramo,
 * que borra la calculadora, y solo su dueño puede —el Simulador responde lo mismo, `NotFound`,
 * a «no existe» y a «no es tuya», así que borrarla con otra sesión no probaría nada—.
 */
async function publicarCalculadora(
  browser: Browser,
  nombre: string,
): Promise<{ id: string; coordinador: Page; autor: Page }> {
  const contextoAutor = await browser.newContext();
  const autor = await contextoAutor.newPage();
  const sesionAutor = await crearCuenta(autor, 'incrusta-autor');
  grantRole(sesionAutor.email, 'editor');
  await entrar(autor, sesionAutor);

  const creada = await api(autor, 'post', '/calculators', {
    name: nombre,
    description: 'Multiplica por dos.',
    definition: DEFINITION,
  });
  expect(creada.status, JSON.stringify(creada.json)).toBe(201);
  const id = (creada.json as { calculator_id: string }).calculator_id;

  const propuesta = await api(autor, 'post', `/calculators/${id}/submit`);
  expect(propuesta.status, JSON.stringify(propuesta.json)).toBe(200);

  const contextoCoordinador = await browser.newContext();
  const coordinador = await contextoCoordinador.newPage();
  const sesionCoordinador = await crearCuenta(coordinador, 'incrusta-coord');
  grantRole(sesionCoordinador.email, 'coordinador_editorial');
  await entrar(coordinador, sesionCoordinador);

  const aprobada = await api(coordinador, 'post', `/editorial/calculators/${id}/approve`);
  expect(aprobada.status, JSON.stringify(aprobada.json)).toBe(200);

  return { id, coordinador, autor };
}

/**
 * Lo que crean estas pruebas, para limpiarlo al terminar.
 *
 * `afterEach` y no `afterAll` porque una prueba que falla a mitad deja lo suyo creado, y un
 * artículo publicado por una prueba se queda en el catálogo público de la siguiente ejecución —y
 * en sus capturas visuales—. Las dos limpiezas van por SQL (`support/`) y solo alcanzan a los
 * nombres con el prefijo de prueba.
 */
const articulos: string[] = [];
const calculadoras: string[] = [];

test.afterEach(() => {
  while (articulos.length > 0) {
    const titulo = articulos.pop();
    if (titulo !== undefined) {
      deleteArticleByTitle(titulo);
    }
  }
  while (calculadoras.length > 0) {
    const nombre = calculadoras.pop();
    if (nombre !== undefined) {
      deleteCalculator(nombre);
    }
  }
});

test.describe('calculadora incrustada en un artículo', () => {
  test('se incrusta desde el editor, se ejecuta desde el artículo y queda en el historial (FR-071)', async ({
    browser,
  }) => {
    test.slow();
    const stamp = Date.now();
    const nombreCalculadora = `${PREFIJO} ${stamp}`;
    const titulo = `Artículo con calculadora ${stamp}`;
    articulos.push(titulo);
    calculadoras.push(nombreCalculadora);

    const { id: calculadoraId, coordinador } = await publicarCalculadora(browser, nombreCalculadora);

    // ── 1. El editor escribe el artículo e INCRUSTA la calculadora ─────────
    const contextoEditor = await browser.newContext();
    const editor = await contextoEditor.newPage();
    const sesionEditor = await crearCuenta(editor, 'incrusta-editor');
    grantRole(sesionEditor.email, 'editor');
    await entrar(editor, sesionEditor);

    await editor.goto('/editorial');
    await editor.getByLabel('Título').fill(titulo);
    await editor.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
    await editor.getByLabel('Cuerpo', { exact: true }).fill('Un artículo con una calculadora dentro.');

    // La calculadora se inserta con el panel del editor, que es lo que se está probando: la
    // lista sale del catálogo público, así que solo puede ofrecer las publicadas.
    await editor.getByRole('button', { name: 'Incrustar una calculadora' }).click();
    await editor.getByLabel('Calculadora del catálogo').selectOption({ label: `${nombreCalculadora} · versión 1` });
    await editor.getByRole('button', { name: 'Incrustar calculadora' }).click();
    // El bloque queda EN el documento, con su versión a la vista.
    await expect(editor.locator('.fc-rte__calculadora-version')).toHaveText('Versión 1');

    // La versión se toma de la RESPUESTA de crear el borrador, no de la dirección: el editor se
    // queda en `/editorial` con el borrador abierto, y adivinar «la última versión del artículo»
    // fallaría con dos pruebas en paralelo sobre el mismo artículo.
    const [respuesta] = await Promise.all([
      editor.waitForResponse(
        (r) => r.url().endsWith('/editorial/articles') && r.request().method() === 'POST',
      ),
      editor.getByRole('button', { name: 'Crear borrador' }).click(),
    ]);
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const creada = (await respuesta.json()) as { version_id: string; article_id: string };
    const versionId = creada.version_id;
    await expect(editor.getByText('Estado actual:')).toBeVisible();

    // ── 2. Se publica ──────────────────────────────────────────────────────
    const enviado = await api(editor, 'post', `/editorial/versions/${versionId}/submit`);
    expect(enviado.status, JSON.stringify(enviado.json)).toBe(200);
    const publicado = await api(coordinador, 'post', `/editorial/versions/${versionId}/publish`);
    expect(publicado.status, JSON.stringify(publicado.json)).toBe(200);

    // ── 3. Un lector la ejecuta SIN salir del artículo ──────────────────────
    const contextoLector = await browser.newContext();
    const lector = await contextoLector.newPage();
    const sesionLector = await crearCuenta(lector, 'incrusta-lector');
    await entrar(lector, sesionLector);

    // Se abre el artículo por su dirección: el camino catálogo → artículo ya lo recorre
    // `us1-aprendizaje` con las aserciones que no se tocan (N-13), y aquí lo que se prueba es el
    // bloque incrustado. Ir por el catálogo añadiría el doble enlace del destacado y de la fila
    // —los dos con el mismo nombre— sin aportar nada a lo que se está comprobando.
    await lector.goto(`/articulos/${creada.article_id}`);
    await expect(lector.getByRole('heading', { name: titulo })).toBeVisible();

    // El bloque está montado dentro del artículo: se ve el formulario, y la URL no cambió.
    const url = lector.url();
    await lector.getByLabel('Monto a invertir').fill('25000');
    await lector.getByRole('button', { name: 'Calcular' }).click();

    // La cifra con formato colombiano y la procedencia (FR-050/FR-058): la escala la declaró el
    // autor, así que `50000` se enseña como `50.000,00` y no se inventa ningún símbolo.
    await expect(lector.getByText('50.000,00')).toBeVisible();
    await expect(lector.getByText('Calculado con la versión 1')).toBeVisible();
    // Sin salir del artículo: si el bloque navegara al simulador, el historial quedaría igual y
    // la prueba no lo notaría.
    expect(lector.url()).toBe(url);

    // ── 4. Y la ejecución quedó en el HISTORIAL del lector (FR-071) ─────────
    await lector.goto('/simuladores/historial');
    // La fila existe con la PROCEDENCIA que exige T110: la versión con la que se calculó. Es lo
    // que distingue una ejecución registrada de una cifra pintada en una pantalla.
    await expect(lector.getByText('versión 1')).toBeVisible();
    // Y el resultado queda registrado. Ojo con lo que se afirma: el historial enseña el valor
    // CANÓNICO que devolvió el Simulador (`50000`), no el formateado del ejecutor
    // (`50.000,00`), porque el historial no conoce la escala que declaró el autor —no viaja en
    // la entrada— y una calculadora de usuario no está en `calculators.config.ts`. La
    // diferencia es de presentación y se anota como hallazgo 16 en vez de afirmarla aquí.
    await expect(lector.getByText('50000')).toBeVisible();
  });

  test('si la calculadora deja de estar publicada, el artículo sigue leyéndose con un aviso (FR-072)', async ({
    browser,
  }) => {
    test.slow();
    const stamp = Date.now();
    const nombreCalculadora = `${PREFIJO} caída ${stamp}`;
    const titulo = `Artículo con calculadora caída ${stamp}`;
    articulos.push(titulo);
    // La calculadora se apunta TAMBIÉN, aunque la prueba la borre a propósito: si la prueba falla
    // ANTES del borrado —que es lo que pasó al escribirla— la calculadora queda publicada en el
    // catálogo, y el `afterEach` no tiene forma de saber cuál era. `deleteCalculator` no falla si
    // ya no existe, así que apuntarla no cuesta nada y cubre el caso que sí se dio.
    calculadoras.push(nombreCalculadora);

    const { id: calculadoraId, coordinador, autor } = await publicarCalculadora(
      browser,
      nombreCalculadora,
    );

    const contextoEditor = await browser.newContext();
    const editor = await contextoEditor.newPage();
    const sesionEditor = await crearCuenta(editor, 'caida-editor');
    grantRole(sesionEditor.email, 'editor');
    await entrar(editor, sesionEditor);

    await editor.goto('/editorial');
    await editor.getByLabel('Título').fill(titulo);
    await editor.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
    await editor.getByLabel('Cuerpo', { exact: true }).fill('Cuerpo que tiene que seguir leyéndose.');
    await editor.getByRole('button', { name: 'Incrustar una calculadora' }).click();
    await editor.getByLabel('Calculadora del catálogo').selectOption({ label: `${nombreCalculadora} · versión 1` });
    await editor.getByRole('button', { name: 'Incrustar calculadora' }).click();
    const [respuesta] = await Promise.all([
      editor.waitForResponse(
        (r) => r.url().endsWith('/editorial/articles') && r.request().method() === 'POST',
      ),
      editor.getByRole('button', { name: 'Crear borrador' }).click(),
    ]);
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const creada = (await respuesta.json()) as { version_id: string; article_id: string };
    const versionId = creada.version_id;
    await expect(editor.getByText('Estado actual:')).toBeVisible();
    expect((await api(editor, 'post', `/editorial/versions/${versionId}/submit`)).status).toBe(200);
    expect((await api(coordinador, 'post', `/editorial/versions/${versionId}/publish`)).status).toBe(200);

    // La calculadora se ELIMINA: es la forma realista de que «deje de estar publicada» —no hay
    // transición de «despublicar»— y deja el artículo apuntando a algo que ya no existe. Eso es
    // exactamente lo que FR-072 tiene que tolerar.
    // La borra su DUEÑO: el Simulador contesta `NotFound` tanto a «no existe» como a «no es
    // tuya» —a propósito, para no ser un oráculo—, así que borrarla desde otra sesión no
    // probaría nada.
    const borrado = await api(autor, 'delete', `/calculators/${calculadoraId}`);
    expect(borrado.status, JSON.stringify(borrado.json)).toBe(200);

    // ── El artículo se sigue leyendo ───────────────────────────────────────
    const contextoLector = await browser.newContext();
    const lector = await contextoLector.newPage();
    const sesionLector = await crearCuenta(lector, 'caida-lector');
    await entrar(lector, sesionLector);

    await lector.goto(`/articulos/${creada.article_id}`);
    await expect(lector.getByRole('heading', { name: titulo })).toBeVisible();

    // El aviso SUSTITUYE al bloque, y el texto del artículo sigue ahí: es la mitad que importa
    // de FR-072 —el artículo no se rompe por una referencia rota—.
    await expect(lector.getByText('Aquí había una calculadora que ya no está publicada')).toBeVisible();
    await expect(lector.getByText('Cuerpo que tiene que seguir leyéndose.')).toBeVisible();
    await expect(lector.getByRole('button', { name: 'Calcular' })).toHaveCount(0);
  });
});
