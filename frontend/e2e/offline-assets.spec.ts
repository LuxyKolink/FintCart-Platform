import { expect, test, type Page } from '@playwright/test';

/**
 * FR-092 / SC-033: la interfaz se presenta completa con la conectividad hacia
 * servicios externos bloqueada.
 *
 * POR QUÉ SE MIDE Y NO SE AFIRMA: «no dependemos de fuentes externas» es una promesa
 * que solo se sostiene tapando la red y comprobando que no falta nada. Bloquear todas
 * las peticiones que no vayan al propio origen y ver que la tipografía, los iconos y el
 * logotipo siguen ahí es la única prueba que distingue «los servimos nosotros» de «los
 * sirve un CDN que hoy responde».
 *
 * SE USA LA GALERÍA INTERNA (`/interno/galeria`, T048) porque es la única pantalla que
 * reúne a la vez las tres familias tipográficas, los 25 iconos y los 5 logotipos sin
 * depender de datos ni de sesión. Si la interfaz fuera a pedir una fuente a Google, aquí
 * se vería.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function blockExternalRequests(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && !LOCAL_HOSTS.has(url.hostname)) {
      blocked.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return blocked;
}

test(
  'la interfaz se presenta completa con la conectividad externa bloqueada',
  { tag: '@offline' },
  async ({ page }) => {
    const blocked = await blockExternalRequests(page);

    await page.goto('/iniciar-sesion');
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();

    await page.goto('/interno/galeria');
    await expect(page.getByRole('heading', { name: 'Marca' })).toBeVisible();

    const report = await page.evaluate(async () => {
      // `document.fonts.check` devuelve false para una familia declarada pero aún no
      // cargada, así que forzar la carga es parte de la prueba: si el `src` apuntara a
      // un CDN bloqueado, la carga fallaría y `check` seguiría en false. Es más
      // estricto que mirar solo lo que la pantalla usó de casualidad.
      await Promise.allSettled([
        document.fonts.load('16px Roboto'),
        document.fonts.load('16px "Noto Sans JP"'),
        document.fonts.load('16px "IBM Plex Mono"'),
      ]);
      await document.fonts.ready;
      const logo = document.querySelector<HTMLImageElement>('fc-brand-logo img');
      return {
        fontFaces: document.fonts.size,
        roboto: document.fonts.check('16px Roboto'),
        notoSans: document.fonts.check('16px "Noto Sans JP"'),
        plexMono: document.fonts.check('16px "IBM Plex Mono"'),
        icons: document.querySelectorAll('svg').length,
        logoLoaded: logo !== null && logo.complete && logo.naturalWidth > 0,
      };
    });

    expect(report.fontFaces, 'no se registró ninguna fuente local').toBeGreaterThan(0);
    expect(report.roboto, 'Roboto (cuerpo) no se cargó desde el bundle local').toBe(true);
    expect(report.notoSans, 'Noto Sans JP (títulos) no se cargó desde el bundle local').toBe(true);
    expect(report.plexMono, 'IBM Plex Mono (cifras) no se cargó desde el bundle local').toBe(true);
    expect(report.icons, 'no se renderizó ningún icono sin red externa').toBeGreaterThan(0);
    expect(report.logoLoaded, 'el logotipo no se sirvió desde el origen local').toBe(true);

    expect(blocked, `la SPA pidió recursos externos: ${blocked.join(', ')}`).toEqual([]);
  },
);
