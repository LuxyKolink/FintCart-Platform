import { expect, test } from '@playwright/test';
import { cuenta, entrar } from './support/sesion';

/**
 * Parte AUTENTICADA del humo del despliegue (T173).
 *
 * QUÉ AÑADE SOBRE `humo.spec.ts`: todo lo demás del despliegue se comprueba sin sesión
 * —el borde, el paquete, las redirecciones, el catálogo público—, pero hay cosas que solo
 * existen con una sesión delante: que el catálogo de artículos pinta el contenido, que el
 * simulador CALCULA contra la base de producción y devuelve un decimal sin truncar, que la
 * simulación queda en el historial, y que la administración rechaza a quien no es
 * administrador. Eso es lo que se comprueba aquí.
 *
 * POR QUÉ NECESITA CUENTAS QUE NO CREA ELLA MISMA: el registro manda el correo de
 * verificación por SMTP real (Gmail), y la única forma de leer el enlace es el buzón del
 * destinatario. La suite de desarrollo resuelve eso con MailHog; aquí no hay MailHog que
 * valga. Así que un operador crea **dos cuentas** una sola vez y se las pasa por entorno.
 * El procedimiento está en `deploy/vps/README.md` §7.
 *
 * QUÉ ESCRIBE: una simulación, la del usuario de prueba, que es exactamente lo que hace un
 * usuario de verdad al usar el simulador. Nada más: no se registra a nadie, no se publica
 * contenido y no se borra nada. La cuenta de administrador solo LEE.
 *
 * SI FALTAN LAS CUENTAS, ESTAS PRUEBAS SE SALTAN DICIENDO QUÉ FALTA. Un salto aquí no
 * significa «no hacía falta comprobarlo», significa «esto no se ha comprobado»: la última
 * línea de cada salto nombra la variable y el apartado del README.
 */

const APRENDIZ = cuenta('USUARIO');
const ADMIN = cuenta('ADMIN');

const FALTA_APRENDIZ =
  'sin E2E_USUARIO_EMAIL / E2E_USUARIO_PASSWORD: la parte autenticada NO se comprobó (ver deploy/vps/README.md §7)';
const FALTA_ADMIN =
  'sin E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD: la administración NO se comprobó (ver deploy/vps/README.md §7)';

test.describe('aprendiz con sesión', () => {
  test.beforeEach(() => {
    test.skip(!APRENDIZ.email || !APRENDIZ.password, FALTA_APRENDIZ);
  });

  /**
   * DOS PRUEBAS Y NO UNA, a propósito. Estaban juntas, y el `test.skip` de la primera parte
   * —«el despliegue no tiene artículos publicados», que es una premisa legítimamente ausente—
   * se llevaba por delante también la comprobación del simulador, que no depende de que haya
   * contenido. Una premisa que falta no puede esconder una comprobación que sí se puede hacer:
   * es la misma lección del hallazgo 33.
   */
  test('lee un artículo del catálogo', async ({ page }) => {
    await entrar(page, APRENDIZ);

    await test.step('el catálogo de artículos tiene contenido', async () => {
      // Este salto es legítimo y ruidoso: el despliegue puede estar sin sembrar contenido
      // editorial, y entonces no hay nada que leer. No se disimula —un catálogo vacío se
      // vería como un fallo de la aplicación cuando es una decisión de puesta en marcha—,
      // pero tampoco se hace pasar por bueno.
      const articulos = page.locator('a[href^="/articulos/"]');

      /**
       * ANTES DE DECIDIR SI EL CATÁLOGO ESTÁ VACÍO, ESPERAR A QUE TERMINE.
       *
       * La primera versión contaba los artículos nada más entrar y, si salían cero, se saltaba.
       * Desde fuera del campus la lista todavía viajaba, así que el salto se disparaba con el
       * catálogo lleno: una comprobación que SÍ se podía hacer quedaba escondida detrás de un
       * «no hay contenido». Es el hallazgo 33 —el salto que no distingue «no aplica» de «no lo
       * he mirado»— cometido esta vez en la prueba en lugar de en el código.
       *
       * La pantalla sí distingue: mientras carga pinta esqueletos, y cuando termina o hay
       * artículos o hay un estado vacío con su título. Se espera a uno de los dos, y solo
       * entonces el cero significa «el despliegue no tiene artículos publicados».
       */
      await expect(page.getByRole('heading', { name: 'Catálogo de aprendizaje' })).toBeVisible();
      await expect(
        articulos.first().or(page.locator('fc-empty-state')),
        'el catálogo terminó de cargar: o hay artículos o hay estado vacío',
      ).toBeVisible();

      test.skip(
        (await articulos.count()) === 0,
        'el despliegue no tiene artículos publicados: lectura NO comprobada (falta sembrar contenido)',
      );
      await articulos.first().click();
      await expect(page.locator('article')).toBeVisible();
      // El cuerpo se arma por bloques (FR-061): si el documento no se pintara, el artículo
      // saldría con título y nada más.
      await expect(page.locator('article h2, article p').first()).toBeVisible();
    });

  });

  test('ejecuta una calculadora y ve la simulación en su historial', async ({ page }) => {
    await entrar(page, APRENDIZ);

    await test.step('el simulador calcula contra la base de producción', async () => {
      await page.getByRole('link', { name: 'Simuladores' }).click();
      await expect(page).toHaveURL(/\/simuladores$/);
      await page.getByRole('link', { name: 'Crédito' }).click();
      await expect(page).toHaveURL(/\/simuladores\/credito/);

      await page.getByLabel('Monto del crédito').fill('10000000');
      await page.getByLabel('Tasa anual').fill('0.24');
      await page.getByLabel('Número de cuotas').fill('12');
      await page.getByRole('button', { name: 'Calcular' }).click();

      const cuota = page.locator('dd.fc-num').first();
      await expect(cuota).toBeVisible();

      /**
       * La cifra monetaria NO se trunca (N-15, Principio VIII). Una cifra recortada
       * —`$1.234…`— no es texto incompleto: es un dato falso, y en un simulador financiero
       * es la única cosa que no se puede perdonar. Por eso no se comprueba «que empiece por
       * $» sino que los grupos de millar estén ENTEROS: una cifra truncada por la mitad
       * rompe la agrupación y no pasa esta expresión. El separador decimal es la coma y el
       * de millares el punto (formato de la plataforma), y el resultado llega como cadena
       * decimal de punta a punta, nunca como número en coma flotante.
       */
      await expect(cuota).toHaveText(/^\$\s?\d{1,3}(\.\d{3})+(,\d{1,2})?$/);
      await expect(cuota).not.toContainText('…');
    });

    await test.step('la simulación queda en el historial', async () => {
      await page.getByRole('link', { name: 'Ver historial' }).click();
      await expect(page).toHaveURL(/\/simuladores\/historial/);
      // La simulación que se acaba de hacer es la más reciente y la primera que se ve.
      await expect(page.getByText('Crédito', { exact: true }).first()).toBeVisible();
      await expect(page.locator('dd.fc-num').first()).toHaveText(/^\$\s?\d{1,3}(\.\d{3})+(,\d{1,2})?$/);
    });
  });

  test('no puede entrar en la administración', async ({ page }) => {
    await entrar(page, APRENDIZ);

    /**
     * El cuarto rol no se hereda (FR-081) y la comprobación se hace en el GUARD, no
     * escondiendo un enlace: se escribe la URL a mano, que es lo que haría quien intentara
     * colarse. La respuesta correcta es acabar en el catálogo, no en un error.
     */
    await page.goto('/admin/indicadores');
    await expect(page).toHaveURL(/\/catalogo/);
    await expect(page.getByRole('heading', { name: 'Indicadores' })).toHaveCount(0);

    await page.goto('/admin/categorias');
    await expect(page).toHaveURL(/\/catalogo/);
  });
});

test.describe('administrador con sesión', () => {
  test.beforeEach(() => {
    test.skip(!ADMIN.email || !ADMIN.password, FALTA_ADMIN);
  });

  test('entra en la administración y ve el catálogo de indicadores', async ({ page }) => {
    await entrar(page, ADMIN);

    await page.goto('/admin/indicadores');
    await expect(page).toHaveURL(/\/admin\/indicadores/);
    await expect(page.getByRole('heading', { name: 'Indicadores financieros' })).toBeVisible();

    /**
     * Los cinco del sembrado, POR NOMBRE —que es como los referencian las fórmulas (`@UVT`)
     * y como los dibuja la pantalla— y no por la forma del marcado.
     *
     * La primera versión de esta prueba buscaba `tbody tr`, dando por hecho una tabla. La
     * pantalla los pinta como tarjetas con encabezado, así que falló contra un despliegue
     * que estaba perfectamente: los cinco, con su valor y «En curso». Es la misma lección
     * del hallazgo 32 —una prueba que se inventa el marcado falla por su cuenta y señala al
     * sitio equivocado—, y se arregla asertando lo que se ve, no cómo está hecho.
     *
     * Se comprueban los cinco y no uno: ver uno solo diría que la pantalla responde, no que
     * el sembrado llegó completo.
     */
    for (const nombre of ['IPC', 'SMMLV', 'TASA_USURA', 'UVR', 'UVT']) {
      await expect(
        page.getByRole('heading', { name: nombre, exact: true }),
        `el indicador ${nombre} del sembrado aparece en la administración`,
      ).toBeVisible();
    }
    await expect(page.getByText('En curso').first(), 'y con su vigencia abierta').toBeVisible();
  });
});
