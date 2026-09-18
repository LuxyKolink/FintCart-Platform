import { expect, test } from '@playwright/test';

import { expectScreenIsAccessible } from '../e2e/support/a11y';

/**
 * Humo del DESPLIEGUE (T172): comprueba lo que solo existe una vez desplegado —el borde,
 * el paquete construido, el certificado, la redirección de las rutas protegidas y el
 * contrato del sembrado— sin escribir nada en la base de datos de producción.
 *
 * QUÉ NO CUBRE, Y POR QUÉ (alcance honesto):
 *
 * - **Todo lo que necesita sesión**: el registro manda un correo real por SMTP de Gmail,
 *   y la única forma de leer el enlace de verificación es el buzón del destinatario. Por
 *   eso la parte autenticada del humo vive en `autenticado.spec.ts` y exige cuentas ya
 *   verificadas que crea un operador una sola vez (ver `README.md` §7).
 * - **Los recorridos completos de US1–US4** siguen siendo responsabilidad de `e2e/` contra
 *   la pila de desarrollo, con MailHog y con limpieza de datos. Este humo no los sustituye:
 *   comprueba que el despliegue está en pie, no que la plataforma esté bien (eso ya lo
 *   hicieron 59 pruebas antes de subirla).
 *
 * Todo lo de aquí es `GET` o navegación: se puede repetir sin dejar rastro.
 */

/** El catálogo público del sembrado: siete definiciones (FR-019, FR-052). */
const CALCULADORAS_SEMBRADAS = 7;

test('el borde sirve la configuración de tiempo de ejecución y apunta a su propio API', async ({ page }) => {
  const origen = new URL(process.env['E2E_BASE_URL']!).origin;

  const respuesta = await page.request.get('/config.js');
  expect(respuesta.status(), 'el borde sirve /config.js').toBe(200);

  const configuracion = await respuesta.text();
  /**
   * Se comprueba el valor, no solo que exista: si el API apuntara a otro origen —o a un
   * `localhost` de desarrollo que se colara en la imagen—, el SPA se cargaría bien y
   * ninguna de sus llamadas funcionaría, que es el peor fallo posible: la pantalla se ve.
   */
  expect(configuracion, 'la base del API es la del mismo dominio').toContain(`${origen}/api`);
  expect(configuracion, 'sin rastro de la pila de desarrollo').not.toContain('localhost');
});

/**
 * EL FALLO QUE ESTA PRUEBA EXISTE PARA ATRAPAR (hallazgo 39)
 * ----------------------------------------------------------
 * La configuración de tiempo de ejecución tenía solo la mitad del servidor: nginx escribía y
 * servía `/config.js` —y la prueba de arriba lo comprobaba, con su contenido correcto—, pero
 * el bundle **no lo leía**: usaba el valor compilado (`/v1`, un marcador). Resultado: el SPA
 * se veía perfecto y cada llamada al API acababa en nginx, que responde `405 Not Allowed` a
 * un POST sobre un fichero estático. Se descubrió intentando registrar una cuenta de verdad,
 * no con la suite: la prueba miraba el fichero, no el cableado.
 *
 * Por eso esta prueba no comprueba el fichero, comprueba el CABLEADO: navega, envía el
 * formulario y mira a dónde va la petición y quién responde. El intento es con una cuenta
 * que no existe, así que no crea ni modifica nada —`401 invalid_grant` es la respuesta
 * correcta—, y distingue tres fallos distintos:
 *
 *   · `405` de nginx  → el SPA sigue usando una ruta que no pasa por el borde;
 *   · `404` del borde  → la ruta del API no coincide con la del gateway;
 *   · `401` del borde  → el cableado está bien y las credenciales son las que fallan. Esta.
 */
test('el SPA llama al API por el mismo origen y con la ruta del borde, no contra nginx', async ({ page }) => {
  const origen = new URL(process.env['E2E_BASE_URL']!).origin;
  const llamadas: { url: string; estado: number; servidor: string }[] = [];

  page.on('response', async (respuesta) => {
    if (respuesta.request().method() !== 'POST') return;
    const cabeceras = await respuesta.allHeaders();
    llamadas.push({
      url: respuesta.url(),
      estado: respuesta.status(),
      servidor: cabeceras['server'] ?? '',
    });
  });

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill('humo-no-existe@ejemplo.test');
  await page.getByLabel('Contraseña').fill('no-es-la-contrasena-de-nadie');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect.poll(() => llamadas.length, 'el SPA envió la petición de autorización').toBeGreaterThan(0);

  const autorizacion = llamadas[0];
  expect(autorizacion.url, 'la petición va al API del mismo origen, con el prefijo del borde').toBe(
    `${origen}/api/oauth/authorize`,
  );
  /**
   * `405` es la firma de nginx (un POST contra un fichero estático) y `404` la de una ruta que
   * el gateway no conoce. Un `401` es lo que devuelve el servidor de autenticación cuando las
   * credenciales no valen, y es exactamente lo que se espera aquí.
   */
  expect(autorizacion.estado, 'responde el borde, no nginx').toBe(401);
  expect(autorizacion.servidor, 'nginx no aparece en la respuesta').not.toContain('nginx');

  /**
   * Y la ruta concreta por la que apareció el fallo. Con un cuerpo inválido, la respuesta
   * tiene que ser del BORDE —`400` de validación— y no el `405` de nginx ni un `404` de ruta
   * desconocida. No crea nada: la validación rechaza antes de tocar la base, así que esta
   * comprobación se puede repetir sin miedo.
   */
  const registro = await page.request.post('/api/auth/register', { data: {} });
  expect(registro.status(), 'el registro llega al borde, no a nginx').toBe(400);
});

test('el paquete del SPA arranca en el acceso, sin errores de consola ni respuestas fallidas', async ({ page }) => {
  const errores: string[] = [];
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  page.on('pageerror', (fallo) => errores.push(fallo.message));
  page.on('response', (respuesta) => {
    /**
     * Las respuestas fallidas delatan lo que un `goto` no ve: el paquete carga, pero un
     * fragmento perezoso o un recurso estático no llega. Se toleran los 401/403, que son
     * respuestas legítimas de la plataforma —por ejemplo, un sondeo sin sesión— y no
     * fallos de entrega.
     */
    if (respuesta.status() >= 400 && respuesta.status() !== 401 && respuesta.status() !== 403) {
      errores.push(`${respuesta.status()} ${respuesta.url()}`);
    }
  });

  await page.goto('/iniciar-sesion');
  await expect(page).toHaveURL(/\/iniciar-sesion/);
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();

  expect(errores, 'consola y red limpias al arrancar el SPA').toEqual([]);
});

test('las rutas protegidas no se abren sin sesión', async ({ page }) => {
  /**
   * El `authGuard` de la SPA es lo único que impide ver la pantalla de otra persona desde
   * un navegador sin sesión, y el borde ya exige token para sus datos —así que aquí se
   * comprueba la parte que el borde no puede cubrir. No se prueban los datos: se prueba
   * que la navegación no abra el armazón de una cuenta ajena.
   */
  for (const ruta of ['/catalogo', '/calculadoras', '/perfil', '/notificaciones', '/editorial']) {
    await page.goto(ruta);
    await expect(page, `${ruta} exige sesión`).toHaveURL(/\/iniciar-sesion/);
  }
});

test('el catálogo público de calculadoras trae las siete del sembrado', async ({ page }) => {
  const respuesta = await page.request.get('/api/calculators');
  expect(respuesta.status()).toBe(200);

  const cuerpo = (await respuesta.json()) as { items?: unknown };
  const items = (cuerpo.items ?? []) as readonly Record<string, unknown>[];

  expect(items.length, 'las siete definiciones semilla (FR-019)').toBe(CALCULADORAS_SEMBRADAS);
  for (const calculadora of items) {
    expect(calculadora['state'], 'el catálogo público solo tiene publicadas').toBe('publicada');
    expect(String(calculadora['name']).length, 'toda calculadora tiene nombre').toBeGreaterThan(0);
  }
});

test('el catálogo público de categorías responde en el borde', async ({ page }) => {
  /**
   * La taxonomía NO es contenido editorial: la crean las migraciones de Aprendizaje, así que
   * un despliegue recién puesto en marcha ya la tiene y cero categorías sí es un fallo. Lo que
   * NO se siembra son los artículos: eso lo escribe un editor desde la SPA.
   */
  const respuesta = await page.request.get('/api/catalog/categories');
  expect(respuesta.status()).toBe(200);

  /**
   * La clave es `categories`, no `items`: lo aprendió esta prueba al fallar la primera vez.
   * Se lee la clave del contrato y no una lista «de lo que haya» porque un `?? []` silencioso
   * convierte un cambio de forma en «no hay contenido», que es justo el fallo que se quiere
   * ver — la taxonomía viene con las migraciones, así que cero categorías sí sería un fallo.
   */
  const cuerpo = (await respuesta.json()) as { categories?: readonly Record<string, unknown>[] };
  const lista = cuerpo.categories ?? [];
  expect(lista.length, 'la taxonomía viene con las migraciones').toBeGreaterThan(0);

  for (const categoria of lista) {
    expect(String(categoria['slug'] ?? '').length, 'toda categoría tiene slug').toBeGreaterThan(0);
    expect(categoria['active'], 'el catálogo público solo sirve activas').toBe(true);
  }
});

test('la pantalla de acceso cumple lo que exige el design system', async ({ page }) => {
  /**
   * Se reutiliza la barrera de 003 tal cual —etiqueta asociada, contraste AA real medido
   * sobre el color computado y recorrido por teclado—: si el despliegue sirviera un
   * paquete con los tokens sin aplicar, la pantalla se seguiría viendo y esto no pasaría.
   */
  await page.goto('/iniciar-sesion');
  /**
   * Esperar a que el formulario esté EN PIE antes de medir no rebaja la barrera: mide lo que
   * quiere medir —la pantalla terminada— en vez de una pantalla a medio cargar. Se supo porque
   * esta prueba falló una vez de tres ejecutando la suite completa: por Internet el fragmento
   * perezoso de la pantalla de acceso tarda más que en local, el recorrido por teclado empezaba
   * sobre un formulario que aún no existía y el fallo parecía de accesibilidad cuando era de
   * reloj. Un `retry` habría escondido esta carrera en vez de quitarla.
   */
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  await expectScreenIsAccessible(page, ['Iniciar sesión']);
});

test('no hay desplazamiento horizontal en el mínimo soportado', async ({ page }) => {
  // El mínimo de 003 (FR-124): por debajo de 360 px no hay compromiso declarado.
  await page.setViewportSize({ width: 360, height: 720 });
  for (const ruta of ['/iniciar-sesion', '/crear-cuenta']) {
    await page.goto(ruta);
    // Igual que arriba: se mide la pantalla cargada, no el esqueleto de carga.
    await expect(page.locator('form')).toBeVisible();
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(desborda, `${ruta} no desplaza en horizontal a 360 px`).toBe(false);
    await page.screenshot({ path: `test-results/prod${ruta.replace(/\//g, '-')}-360.png`, fullPage: true });
  }
});
