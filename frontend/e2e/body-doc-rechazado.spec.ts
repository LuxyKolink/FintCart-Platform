import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';
import { deleteArticleByTitle } from './support/articles';

/**
 * Un documento fuera del vocabulario se rechaza al guardar y NO llega al lector (T134,
 * FR-063, FR-068, research D-14).
 *
 * El editor no puede producir un documento así —su esquema no tiene esos nodos, y eso es la
 * primera barrera—, de modo que la única forma de intentarlo es enviar la petición a mano.
 * Se intercepta el `PATCH` que hace la propia aplicación y se le cambia el documento en
 * vuelo: así la petición que sale es la de un cliente hostil de verdad, con la SESIÓN REAL
 * y contra el BORDE real, que es lo que hay que comprobar. Un `fetch` desde la consola con
 * un token inventado no probaría nada del camino que usa la aplicación.
 *
 * Se comprueban las dos mitades de FR-068, y la segunda es la que importa:
 *
 *   1. El servidor rechaza (400) y **no guarda**: el borrador queda exactamente como estaba.
 *   2. El nodo prohibido **no aparece por ninguna parte** en el lector. Si el rechazo
 *      fallara en silencio, esto lo delataría.
 *
 * Los tres casos son las tres familias de ataque del vocabulario: un nodo que no existe, un
 * enlace con esquema peligroso y un atributo de más en un nodo válido. El último es el que
 * más fácil se cuela: `{tipo:'parrafo', onload:'…'}` es un párrafo legítimo con una carga
 * encima.
 */

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

test('un documento con un nodo no admitido no llega al lector', async ({ page }) => {
  const stamp = Date.now();
  const editorEmail = `e2e-invalido-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const cuerpoLegitimo = `Cuerpo legítimo de la prueba ${stamp}, con la longitud suficiente.`;

  async function registerAndVerify(): Promise<void> {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(`Editor inválido ${stamp}`);
    await page.getByLabel('Correo electrónico').fill(editorEmail);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();

    const link = await waitForVerificationLink(editorEmail);
    await page.goto(link);
    await expect(page.getByText('Tu correo quedó verificado')).toBeVisible();
  }

  await registerAndVerify();
  grantRole(editorEmail, 'editor');

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(editorEmail);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/catalogo/);

  await page.getByRole('link', { name: 'Editorial' }).click();
  const title = `Artículo con documento inválido ${stamp}`;
  articulosCreados.push(title);
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
  await page.getByLabel('Cuerpo', { exact: true }).fill(cuerpoLegitimo);
  // El identificador de la versión se lee de la RESPUESTA de creación, no de la URL: tras
  // crear, la aplicación se queda en `/editorial` (modo crear) y volver a cargar ahí
  // devolvería el formulario vacío en lugar del borrador. Para comprobar lo que quedó
  // GUARDADO hay que abrir la versión por su dirección de edición.
  const creacion = page.waitForResponse(
    (r) => r.url().endsWith('/editorial/articles') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(page.getByText('Estado actual:')).toBeVisible();
  // La respuesta se espera y se analiza en dos pasos: `(await p).json()` devuelve una
  // PROMESA, así que desestructurarla directamente da un objeto vacío —y `undefined` en la
  // URL— sin que el compilador diga nada, porque un `as Promise<…>` lo permite.
  const respuesta = await creacion;
  const { version_id: versionId, article_id: articleId } = (await respuesta.json()) as {
    version_id: string;
    article_id: string;
  };

  /** Guarda el documento legítimo, para tener un estado previo que no debe cambiar. */
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();

  const maliciosos = [
    {
      nombre: 'un nodo que no existe en el vocabulario',
      doc: {
        tipo: 'doc',
        contenido: [
          { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Antes' }] },
          { tipo: 'html' },
          { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Después' }] },
        ],
      },
    },
    {
      nombre: 'un enlace con esquema peligroso',
      doc: {
        tipo: 'doc',
        contenido: [
          {
            tipo: 'parrafo',
            contenido: [
              { tipo: 'texto', texto: 'Pulsa aquí', marcas: [{ tipo: 'enlace', href: 'javascript:alert(1)' }] },
            ],
          },
        ],
      },
    },
    {
      nombre: 'un atributo de más en un nodo válido',
      doc: {
        tipo: 'doc',
        contenido: [{ tipo: 'parrafo', onload: 'alert(1)', contenido: [{ tipo: 'texto', texto: 'Con carga' }] }],
      },
    },
  ];

  for (const caso of maliciosos) {
    // El documento se sustituye JUSTO antes de que salga. La petición la sigue haciendo la
    // aplicación —con su token, su ruta y su forma—; lo único que cambia es el cuerpo.
    await page.route('**/editorial/versions/**', async (route) => {
      const peticion = route.request();
      if (peticion.method() !== 'PATCH') {
        await route.continue();
        return;
      }
      const cuerpo = peticion.postDataJSON() as Record<string, unknown>;
      cuerpo['body_doc'] = caso.doc;
      await route.continue({ postData: JSON.stringify(cuerpo) });
    });

    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    // El servidor lo rechaza con un mensaje de datos inválidos (400 en el borde).
    await expect(page.getByText('Revisa los datos ingresados')).toBeVisible({
      timeout: 15_000,
    });

    await page.unroute('**/editorial/versions/**');
  }

  // Y lo que de verdad importa: el borrador quedó EXACTAMENTE como estaba. Se abre la
  // versión de nuevo —recarga real, no memoria del editor— para leer lo guardado en la base.
  await page.goto(`/editorial/versiones/${versionId}?articleId=${articleId}`);
  await expect(page.getByLabel('Cuerpo', { exact: true })).toContainText(cuerpoLegitimo);
  // El atributo de más y el `javascript:` no se guardaron en ninguna parte.
  await expect(page.locator('.fc-rte__content')).not.toContainText('Con carga');
  await expect(page.locator('.fc-rte__content')).not.toContainText('Antes');
  await expect(page.locator('.fc-rte__content a')).toHaveCount(0);
});
