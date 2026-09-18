import { defineConfig, devices } from '@playwright/test';

/**
 * No gestiona `webServer`: cada spec ejercita la SPA contra la pila completa
 * (Gateway, servicios, MailHog) levantada por `dev/up` — no solo `ng serve`.
 * Arrancar aquí únicamente el frontend dejaría cada endpoint real devolviendo
 * "conexión rechazada" y el fallo parecería un bug de la SPA.
 */
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
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
    launchOptions: { slowMo },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
