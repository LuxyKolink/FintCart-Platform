import { expect, test } from '@playwright/test';

import { waitForVerificationLink } from './support/mailhog';
import { grantRole } from './support/roles';

/**
 * Una imagen entra por el editor y sale en el lector (T132, T129, T130, FR-064…FR-067).
 *
 * Es el recorrido que no cubre ninguna prueba por separado: el editor sube un archivo de
 * verdad por `multipart`, el borde lo reenvía, Aprendizaje valida los BYTES y lo guarda
 * direccionado por su hash, el documento se guarda con la referencia y el lector la pinta.
 * Cada pieza tiene su prueba —la del borde con un cliente falso, la del servicio contra
 * PostgreSQL real, la del componente con un servicio falso— y **este es el único sitio donde
 * se juntan**: un desacuerdo en la forma del identificador, del nombre del campo del
 * formulario o de la dirección de la imagen aparecería aquí y en ningún otro.
 *
 * La imagen se genera en el propio recorrido y no se lee del disco: así la prueba no depende
 * de ningún archivo del repositorio, y el contenido es distinto en cada ejecución (el hash
 * cambia, con lo que también se comprueba que el identificador se calcula y no se copia).
 */
test('el editor sube una imagen y el lector la muestra', async ({ page }) => {
  const stamp = Date.now();
  const editorEmail = `e2e-img-editor-${stamp}@fintcart.test`;
  const coordEmail = `e2e-img-coord-${stamp}@fintcart.test`;
  const password = 'Dem0stracion!2026';
  const title = `Artículo con imagen ${stamp}`;
  const descripcion = `Una alcancía con monedas (${stamp})`;
  // El cuerpo lleva el sello de la ejecución: la bandeja de revisión NO muestra el título
  // —`ArticleVersion` no lo lleva, ver la nota de T167–T169 en `tasks.md`—, así que el ítem
  // se identifica por el fragmento de cuerpo que sí se ve, y dos ejecuciones seguidas
  // dejarían varias versiones en revisión con el mismo texto si no fuera único.
  const cuerpo = `Un presupuesto no es una lista de prohibiciones (${stamp}): es una fotografía de a dónde va tu dinero.`;

  async function registerAndVerify(email: string, displayName: string): Promise<void> {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre para mostrar').fill(displayName);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Te enviamos un correo de verificación')).toBeVisible();

    const link = await waitForVerificationLink(email);
    await page.goto(link);
    await expect(page.getByText('Tu correo quedó verificado')).toBeVisible();
  }

  async function login(email: string): Promise<void> {
    await page.goto('/iniciar-sesion');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/catalogo/);
  }

  await test.step('registrar editor y coordinador', async () => {
    await registerAndVerify(editorEmail, `Editor imagen ${stamp}`);
    grantRole(editorEmail, 'editor');
    await registerAndVerify(coordEmail, `Coordinador imagen ${stamp}`);
    grantRole(coordEmail, 'coordinador_editorial');
  });

  await test.step('el editor crea el borrador', async () => {
    await login(editorEmail);
    await page.getByRole('link', { name: 'Editorial' }).click();
    await expect(page).toHaveURL(/\/editorial$/);

    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Categoría').selectOption({ label: 'Ahorro' });
    // El cuerpo se escribe en el editor de texto enriquecido, que se llama por su etiqueta
    // visible: `fill` sobre la superficie editable de ProseMirror.
    await page.getByLabel('Cuerpo', { exact: true }).fill(cuerpo);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByText('Estado actual:')).toBeVisible();
  });

  await test.step('el editor sube la imagen, la describe y la inserta', async () => {
    // Un PNG de 2x2 generado aquí: el mismo archivo que elegiría alguien desde su disco.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
      'base64',
    );
    await page.locator('.fc-rte__archivo').setInputFiles({
      name: 'alcancia.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // El panel pide la descripción DESPUÉS de subir: lo que se ve es la imagen que servirá
    // el servidor, no una vista previa del archivo del disco.
    await expect(page.getByText('Descripción de la imagen')).toBeVisible();
    const insertar = page.getByRole('button', { name: 'Insertar imagen' });
    await expect(insertar).toBeDisabled();

    await page.getByLabel('Descripción de la imagen').fill(descripcion);
    await page.getByLabel('Pie de foto (opcional)').fill('Figura 1');
    await expect(insertar).toBeEnabled();
    await insertar.click();

    // La imagen queda dentro del documento que se está editando.
    await expect(page.locator('.fc-rte__content img')).toBeVisible();
    await expect(page.locator('.fc-rte__content figcaption')).toHaveText('Figura 1');

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Guardado.')).toBeVisible();
  });

  await test.step('enviar a revisión y publicar (dos actores, FR-008)', async () => {
    await page.getByRole('button', { name: 'Enviar a revisión' }).click();
    await expect(page.getByText('Enviado a revisión.')).toBeVisible();

    await login(coordEmail);
    await page.getByRole('link', { name: 'Revisión' }).click();
    const card = page.locator('article', { hasText: String(stamp) });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Aprobar y publicar' }).click();
    await expect(card).not.toBeVisible();
  });

  await test.step('el lector pinta la imagen que subió el editor', async () => {
    await page.goto('/catalogo');
    await page.getByRole('heading', { name: title, level: 3 }).click();
    await expect(page).toHaveURL(/\/articulos\//);

    const imagen = page.locator('.fc-blocks__image').first();
    await expect(imagen).toBeVisible();
    // `naturalWidth` y no solo la visibilidad: un `<img>` que no carga sigue ocupando su
    // sitio y se ve «visible». Lo que prueba que el navegador recibió los bytes es que la
    // imagen tenga ancho natural.
    await expect.poll(async () => imagen.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    // Y su `alt` es el que se escribió en el editor: es lo que lee un lector de pantalla.
    await expect(imagen).toHaveAttribute('alt', descripcion);
    await expect(page.getByText('Figura 1')).toBeVisible();
  });
});
