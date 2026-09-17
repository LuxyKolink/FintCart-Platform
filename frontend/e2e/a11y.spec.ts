import { expect, test, type Page } from '@playwright/test';

import { expectScreenIsAccessible } from './support/a11y';
import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';
import { deleteArticleByTitle } from './support/articles';

/**
 * Barrera de accesibilidad (T011/T080/T081/T082, FR-093…FR-096, SC-030…SC-032).
 *
 * POR QUÉ ES UNA SUITE APARTE Y NO ASERCIONES SUELTAS: las 4 suites de recorrido ya
 * seleccionan por rol y etiqueta accesible, así que cubren lo funcional, pero no
 * AFIRMAN la accesibilidad: un `getByLabel` que encuentra el control no dice si el
 * contraste del texto que lo acompaña cumple AA, ni si el teclado llega hasta él. Esto
 * es lo que el rediseño podría romper en silencio.
 *
 * LAS 20 PANTALLAS, NO SOLO LAS FÁCILES. La suite se fue ampliando con cada grupo
 * —primero acceso, luego el portal, luego las tres del editorial— hasta cubrir todas
 * las pantallas migradas. Las que dependen de datos (lector, cuestionario, resultado
 * del simulador) se descubren navegando, porque su ruta lleva un identificador real:
 * fijarla en el archivo ataría la prueba a la fixture de datos.
 *
 * La captura visual, en `e2e/visual/`, comprueba etiquetas y contraste a las cuatro
 * anchuras; aquí se comprueba además el **recorrido por teclado**, que es lo que estas
 * pruebas cubren una sola vez por pantalla (el orden de tabulación cambia con la
 * disposición, y las dos anchuras extremas ya están cubiertas en la captura).
 */

interface Screen {
  readonly path: string;
  /** Acciones que el teclado DEBE alcanzar para dar la pantalla por recorrible. */
  readonly actions: readonly string[];
}

const ACCESS_SCREENS: readonly Screen[] = [
  { path: '/iniciar-sesion', actions: ['Iniciar sesión'] },
  { path: '/crear-cuenta', actions: ['Crear cuenta'] },
];

/** Pantallas del portal que no dependen de datos: se visitan tal cual. */
const PORTAL_SCREENS: readonly Screen[] = [
  { path: '/catalogo', actions: ['Cerrar sesión'] },
  { path: '/progreso', actions: ['Cerrar sesión'] },
  { path: '/notificaciones', actions: ['Cerrar sesión'] },
  { path: '/perfil', actions: ['Guardar cambios', 'Eliminar mi cuenta'] },
  { path: '/perfil/reporte', actions: ['Volver al perfil'] },
  { path: '/perfil/contrasena', actions: ['Cambiar contraseña'] },
  { path: '/perfil/eliminar-cuenta', actions: ['Eliminar mi cuenta'] },
  { path: '/simuladores', actions: ['Ver tu historial'] },
];

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/);
}

/** Registra, verifica por correo y deja la sesión iniciada. Devuelve el correo. */
async function registerAndSignIn(page: Page, prefix: string): Promise<string> {
  const stamp = Date.now();
  const email = `${prefix}-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';

  await page.goto('/crear-cuenta');
  await page.getByLabel('Nombre para mostrar').fill(`${prefix} ${stamp}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  const link = await waitForVerificationLink(email);
  await page.goto(link);
  // La pantalla de verificación también entra en la barrera: tiene su propio enlace.
  await expectScreenIsAccessible(page, ['Iniciar sesión']);
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  await signIn(page, email, password);
  return email;
}

/**
 * Lo que crea esta prueba, para limpiarlo al terminar (T156/hallazgo 10).
 *
 * Un artículo publicado por una prueba se queda en el catálogo público —no hay endpoint que
 * borre artículos, y no debe haberlo—, así que aparece en las capturas de la siguiente
 * ejecución y cambia los conteos de las pantallas. Se limpia por SQL, como una operación de
 * operador.
 */
const articulosCreados: string[] = [];

test.afterEach(() => {
  while (articulosCreados.length > 0) {
    const titulo = articulosCreados.pop();
    if (titulo !== undefined) {
      deleteArticleByTitle(titulo);
    }
  }
});

test.describe('accesibilidad de las pantallas de acceso', () => {
  for (const screen of ACCESS_SCREENS) {
    test(`${screen.path} es recorrible por teclado y legible`, { tag: '@a11y' }, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator('form').first()).toBeVisible();
      await expectScreenIsAccessible(page, screen.actions);
    });
  }
});

test('las pantallas del portal son recorribles por teclado y legibles', { tag: '@a11y' }, async ({ page }) => {
  await registerAndSignIn(page, 'e2e-a11y');

  await test.step('catalogo y lector', async () => {
    // El lector y el cuestionario dependen de datos: se descubren navegando.
    const articles = page.locator('main a[href^="/articulos/"]');
    await expect(articles.first()).toBeVisible();
    await articles.first().click();
    await expect(page.locator('article')).toBeVisible();
    // El lector cargado no tiene acciones propias salvo el enlace al cuestionario, y no
    // todos los artículos traen uno: la acción que se comprueba aquí es la del armazón,
    // y el enlace al cuestionario se comprueba en el paso siguiente, que sí exige que
    // exista. (`Volver al catálogo` vive en el estado «no encontrado», no en este.)
    await expectScreenIsAccessible(page, ['Cerrar sesión']);
  });

  await test.step('cuestionario', async () => {
    // No todos los artículos traen cuestionario (lo mismo que documenta
    // `us1-aprendizaje.spec.ts`), así que se buscan unos pocos. Es barato: solo la
    // primera lectura paga el recorrido por teclado.
    let quizPath: string | null = null;
    for (let index = 0; index < 5 && quizPath === null; index += 1) {
      const quizLink = page.getByRole('link', { name: 'Iniciar cuestionario' });
      if ((await quizLink.count()) > 0) {
        quizPath = await quizLink.getAttribute('href');
        break;
      }
      await page.goto('/catalogo');
      const next = page.locator('main a[href^="/articulos/"]').nth(index);
      if ((await next.count()) === 0) {
        break;
      }
      await next.click();
      await expect(page.locator('article')).toBeVisible();
    }

    if (quizPath === null) {
      test.skip(true, 'ninguno de los artículos de la fixture trae cuestionario');
    }

    await page.goto(quizPath ?? '');
    await expect(page.locator('fieldset').first()).toBeVisible();

    // El botón nace deshabilitado: hasta que no se responde no es alcanzable, así que
    // la comprobación se hace sobre la pantalla ya respondida, que es la que se usa.
    const fieldsets = page.locator('fieldset');
    const total = await fieldsets.count();
    for (let index = 0; index < total; index += 1) {
      await fieldsets.nth(index).locator('input[type="radio"]').first().check();
    }

    await expectScreenIsAccessible(page, ['Enviar respuestas']);
  });

  for (const screen of PORTAL_SCREENS) {
    await test.step(screen.path, async () => {
      await page.goto(screen.path);
      await expect(page.locator('main')).toBeVisible();
      await expectScreenIsAccessible(page, screen.actions);
    });
  }

  await test.step('historial sin simulaciones', async () => {
    // Se visita ANTES de simular nada: así la barrera cubre el estado vacío, que es
    // el que nadie mira y el que deja la pantalla en blanco si se rompe.
    await page.goto('/simuladores/historial');
    await expectScreenIsAccessible(page, ['Ir a las calculadoras']);
  });

  await test.step('simulador y su resultado', async () => {
    await page.goto('/simuladores/ahorro');
    await expect(page.locator('main')).toBeVisible();
    await expectScreenIsAccessible(page, ['Calcular']);

    // Etiquetas reales de la definición semilla de `ahorro`: salen de la base, no de
    // una plantilla, que es justo lo que FR-107 trajo.
    await page.getByLabel('Depósito inicial').fill('1000000');
    await page.getByLabel('Aporte mensual').fill('100000');
    await page.getByLabel('Tasa anual').fill('0.08');
    await page.getByLabel('Plazo').fill('12');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.locator('dd.fc-num').first()).toContainText('$');

    // El resultado trae cifras monetarias y la tabla del historial: es la pantalla
    // con más texto del portal, y la que más fácilmente se saldría del contraste.
    await expectScreenIsAccessible(page, ['Ver historial']);
  });
});

test('las pantallas editoriales son recorribles por teclado y legibles', { tag: '@a11y' }, async ({ page }) => {
  const email = await registerAndSignIn(page, 'e2e-a11y-ed');

  // Un solo usuario con los dos roles permite ver la cola y el listado sin cambiar de
  // sesión; el editor no necesita rol para pintarse, pero sí para cargar versiones.
  grantRole(email, 'editor');
  grantRole(email, 'coordinador_editorial');

  // El JWT ya emitido no lleva los roles nuevos: hay que volver a entrar.
  await page.goto('/iniciar-sesion');
  await signIn(page, email, 'Dem0stracion!2026');

  await test.step('/editorial (el marco del editor)', async () => {
    await page.goto('/editorial');
    await expect(page.locator('main')).toBeVisible();
    await expectScreenIsAccessible(page, ['Crear borrador']);
  });

  await test.step('un borrador para que el listado y la cola tengan contenido', async () => {
    await page.goto('/editorial');
    const title = `Artículo de barrera ${Date.now().toString()}`;
    articulosCreados.push(title);
    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
    await page.getByLabel('Cuerpo', { exact: true }).fill('Cuerpo del artículo de la barrera de accesibilidad.');
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByText('Estado actual:')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar a revisión' }).click();
    await expect(page.getByText('Enviado a revisión.')).toBeVisible();
  });

  await test.step('/editorial/borradores', async () => {
    await page.goto('/editorial/borradores');
    await expect(page.getByText('En revisión')).toBeVisible();
    await expectScreenIsAccessible(page, ['Nuevo artículo']);
  });

  await test.step('/editorial/revision', async () => {
    await page.goto('/editorial/revision');
    await expect(page.getByRole('button', { name: 'Aprobar y publicar' }).first()).toBeVisible();
    await expectScreenIsAccessible(page, ['Aprobar y publicar']);
  });
});

test('la administración es recorrible por teclado y legible (FR-093…FR-096)', { tag: '@a11y' }, async ({ page }) => {
  // Un administrador recién creado: la ruta exige el rol y el JWT lo lleva dentro, así
  // que hay que concederlo antes de entrar.
  const email = await registerAndSignIn(page, 'e2e-a11y-admin');
  grantRole(email, 'administrador');
  await page.goto('/iniciar-sesion');
  await signIn(page, email, 'Dem0stracion!2026');

  await test.step('/admin/categorias', async () => {
    await page.goto('/admin/categorias');
    await expect(page.locator('main')).toBeVisible();
    await expectScreenIsAccessible(page, ['Crear categoría']);
  });

  await test.step('/admin/indicadores', async () => {
    await page.goto('/admin/indicadores');
    await expect(page.getByRole('heading', { name: 'Indicadores financieros' })).toBeVisible();
    // El formulario de carga anual es la acción de la pantalla, y las cifras de las
    // vigencias —que van en `.fc-num`, sin truncar— son el texto que más fácilmente se
    // saldría del contraste: la barrera las mide aquí.
    await expectScreenIsAccessible(page, ['Cargar vigencia']);
  });
});
