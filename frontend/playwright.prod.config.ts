import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de la suite de humo del DESPLIEGUE (`deploy/vps/`), hermana de
 * `playwright.config.ts` —que sigue apuntando a la pila de desarrollo.
 *
 * POR QUÉ DOS CONFIGURACIONES Y NO UNA CON `E2E_BASE_URL`: no basta con cambiar la URL.
 * La suite de desarrollo obtiene su cuenta leyendo el correo de verificación en MailHog
 * (`e2e/support/mailhog.ts`), que en el despliegue no existe —allí el correo sale por
 * SMTP real—, y dos de sus specs hablan con el borde por `http://localhost:8080` fijo.
 * Contra el despliegue eso no es solo inútil: registraría usuarios de verdad y llenaría
 * de intentos la base de datos de producción. Son dos entornos con dos contratos de
 * prueba distintos, así que son dos configuraciones.
 *
 * `E2E_BASE_URL` es OBLIGATORIA y sin valor por defecto: un despliegue distinto del que
 * se cree, o un `localhost` heredado, haría pasar un humo contra la máquina equivocada.
 */
const baseURL = process.env['E2E_BASE_URL'];
if (!baseURL) {
  throw new Error(
    'Falta E2E_BASE_URL. La suite de humo del despliegue se lanza así:\n' +
      '  E2E_BASE_URL=https://<dominio> npx playwright test --config=playwright.prod.config.ts',
  );
}

/**
 * Cámara lenta, para MIRAR las pruebas.
 *
 * `--slow-mo` no es una bandera de `playwright test` —no sale en su `--help`, porque es una
 * opción de configuración, no de línea de órdenes—: pedirla por ahí aborta la ejecución con
 * «unknown option». Así que se lee del entorno, que sí se puede escribir delante de cualquier
 * orden:
 *
 *     E2E_LENTO=800 npm run e2e:prod:ver
 *
 * Sin la variable no hay retardo: la suite corre a velocidad normal. Con ella, cada acción
 * espera esos milisegundos, que es lo que hace visible lo que el navegador va haciendo.
 * OJO: el retardo se suma al tiempo de la prueba, así que cámara lenta muy alta pide subir
 * también el `timeout` de la prueba.
 */
const slowMo = Number(process.env['E2E_LENTO'] ?? 0) || undefined;

export default defineConfig({
  /**
   * Fuera de `e2e/` A PROPÓSITO: dentro, la suite de desarrollo (`testDir: './e2e'`) la
   * recogería y pasaría de 59 pruebas a 66 contra `localhost`, que es justo la garantía que
   * 003 y N-13 protegen. Una carpeta hermana no toca ni una línea de la configuración de dev.
   */
  testDir: './e2e-prod',
  timeout: 60_000,
  /**
   * La tolerancia de las aserciones describe el camino MÁS LARGO por el que se ejecuta esta
   * suite, no el más corto.
   *
   * Medido el 2026-09-18: ejecutada EN la máquina, la suite entera tarda ~19 s y el servidor
   * responde en milisegundos —20 inicios de sesión entre 5 y 95 ms, `/catalog/articles` en
   * 6,3 ms—, así que nunca roza los 5 s por defecto. Ejecutada desde fuera del campus, las
   * MISMAS pruebas fallaron dos veces en el margen por defecto: la página se quedaba en
   * `/iniciar-sesion` a los 5 s, con el inicio de sesión ya concedido en el servidor. Los
   * segundos no los pone la plataforma, los pone el viaje por el perímetro del CTIC y la red
   * de quien mira.
   *
   * Subir el margen NO tapa un fallo: lo que se afirma sigue siendo lo mismo —que tras entrar
   * se llega al catálogo—, y sin llegar nunca falla. Lo que cambia es cuánto se espera a que
   * el viaje termine. Un margen que solo valga dentro del campus convierte cada ejecución
   * desde casa en un falso rojo.
   */
  expect: { timeout: 15_000 },
  /**
   * EN SERIE, y no por prudencia genérica: en paralelo, desde fuera del campus, se cae.
   *
   * Medido el 2026-09-18 desde casa: cuatro navegadores a la vez cruzando un enlace lento
   * dejaron dos pruebas clavadas en `/iniciar-sesion` a los 15 s, con el inicio de sesión YA
   * concedido por el servidor —24 peticiones de token en esa ventana, todas 200, entre 5 y 23
   * ms— y sin una sola petición fallida ni mensaje de error en la pantalla: el formulario ni
   * siquiera llegó a enviarse. La misma suite, en serie, pasa. Dentro de la máquina el paralelo
   * no molesta porque no hay viaje que repartir.
   *
   * Es un humo, no una prueba de carga: la concurrencia no aporta cobertura aquí, solo ruido.
   * Para medir concurrencia está `deploy/loadtest/`, que es su sitio.
   */
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  // Carpeta propia: una ejecución contra el despliegue no puede pisar las capturas de
  // la suite de desarrollo (115 imágenes que se comparan a ojo contra el UI kit).
  outputDir: 'test-results/prod',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: { slowMo },
    /**
     * El despliegue sirve con la CA propia de Caddy mientras el CTIC no abra 80/443 a
     * Internet (ver `deploy/vps/README.md`), así que el certificado no valida contra las
     * autoridades del sistema. Con la CA instalada en la máquina que ejecuta la suite,
     * `E2E_TLS_ESTRICTO=true` convierte esta tolerancia en una comprobación de verdad.
     */
    ignoreHTTPSErrors: process.env['E2E_TLS_ESTRICTO'] !== 'true',
  },
  projects: [{ name: 'despliegue', use: { ...devices['Desktop Chrome'] } }],
});
