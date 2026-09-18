import { expect, test } from '@playwright/test';
import { cuenta, entrar } from './support/sesion';

/**
 * La parte EDITORIAL del humo del despliegue.
 *
 * POR QUÉ EXISTE: los roles editoriales no se conceden por la API —un endpoint que dejara
 * auto-concederse `coordinador_editorial` anularía la separación de responsabilidades de
 * FR-008—, así que en el despliegue se conceden a mano con `deploy/vps/rol`. Eso significa
 * que el camino que va del rol concedido a la pantalla que lo exige pasa por piezas que
 * ninguna otra prueba del despliegue toca: que el token lo lleve, que el guard lo lea y que
 * la pantalla exista. Aquí se recorre entero, y de paso que el editor NO entra donde no le
 * toca — que es lo que separa «hay roles» de «los roles sirven para algo».
 *
 * NO PUBLICA NADA: entra, mira y cierra. El contenido del despliegue lo siembra
 * `deploy/vps/seed-contenido`, no una prueba.
 */

const EDITOR = cuenta('EDITOR');
const COORDINADOR = cuenta('COORDINADOR');
const FALTA =
  'sin E2E_EDITOR_* / E2E_COORDINADOR_*: el camino editorial NO se comprobó (deploy/vps/rol + README.md §7)';

test.describe('editorial con sesión', () => {
  test.beforeEach(() => {
    test.skip(!EDITOR.email || !EDITOR.password || !COORDINADOR.email || !COORDINADOR.password, FALTA);
  });

  test('el coordinador abre la bandeja de revisión', async ({ page }) => {
    await entrar(page, COORDINADOR);

    await page.goto('/editorial/revision');
    await expect(page).toHaveURL(/\/editorial\/revision/);
    await expect(page.getByRole('heading', { name: 'Bandeja de revisión' })).toBeVisible();
  });

  test('el editor escribe borradores y no entra en la revisión', async ({ page }) => {
    await entrar(page, EDITOR);

    // Su sitio: los borradores que sí puede escribir.
    await page.goto('/editorial/borradores');
    await expect(page).toHaveURL(/\/editorial\/borradores/);
    await expect(page.getByRole('heading', { name: 'Mis borradores' })).toBeVisible();

    // Y la revisión, escrita a mano en la barra de direcciones: el guard tiene que devolverlo
    // al catálogo. Sin esto, «tiene el rol» y «el rol limita algo» serían lo mismo.
    await page.goto('/editorial/revision');
    await expect(page).toHaveURL(/\/catalogo/);
    await expect(page.getByRole('heading', { name: 'Bandeja de revisión' })).toHaveCount(0);
  });
});
